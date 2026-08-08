import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultMenuAdapter = path.join(projectRoot, "tools", "ani-cli-menu");
const defaultPlayerAdapter = path.join(projectRoot, "tools", "ani-cli-mpv-capture");
const maxQueryLength = 120;

export interface AniCliOptions {
  binary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export interface AniCliStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface AnimeSearchResult {
  id: string;
  title: string;
}

export interface AnimeEpisode {
  number: number;
}

export interface AnimeDetails {
  id: string;
  title: string;
  episodes: AnimeEpisode[];
}

export interface EpisodeResolution {
  title: string;
  episode: number;
  streamUrl: string;
}

export class AniCliError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;

  constructor(message: string, options: { exitCode?: number | null; stderr?: string } = {}) {
    super(message);
    this.name = "AniCliError";
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr ?? "";
  }
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

interface CommandOptions {
  allowedExitCodes?: number[];
  environment?: Record<string, string>;
}

interface Selection {
  query: string;
  index: number;
}

export function parseMenuRows(output: string): string[] {
  const marker = "ANICLI_MENU_ROW\t";

  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith(marker))
    .map((line) => line.slice(marker.length));
}

export function parseSearchRows(rows: string[], query: string): AnimeSearchResult[] {
  const results: AnimeSearchResult[] = [];

  for (const row of rows) {
    const match = row.trim().match(/^(\d+)\s+(.+)$/);
    if (!match) {
      continue;
    }

    const index = Number(match[1]);
    const title = decodeTitle(match[2].trim());
    if (!Number.isInteger(index) || index < 1 || title.length === 0) {
      continue;
    }

    results.push({ id: encodeSelection({ query, index }), title });
  }

  return results;
}

export function parseEpisodeRows(rows: string[]): AnimeEpisode[] {
  const episodes = new Set<number>();

  for (const row of rows) {
    const value = Number(row.trim());
    if (Number.isInteger(value) && value > 0) {
      episodes.add(value);
    }
  }

  return [...episodes].sort((left, right) => left - right).map((number) => ({ number }));
}

export function parseMarker(output: string, marker: string): string | undefined {
  const prefix = `${marker}\t`;
  const line = output.split(/\r?\n/).find((value) => value.startsWith(prefix));
  return line?.slice(prefix.length).trim() || undefined;
}

export function encodeSelection(selection: Selection): string {
  return Buffer.from(JSON.stringify(selection), "utf8").toString("base64url");
}

export function decodeSelection(value: string): Selection {
  let selection: unknown;

  try {
    selection = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AniCliError("Invalid anime selection");
  }

  if (
    typeof selection !== "object" ||
    selection === null ||
    typeof (selection as Selection).query !== "string" ||
    typeof (selection as Selection).index !== "number" ||
    !Number.isInteger((selection as Selection).index) ||
    (selection as Selection).index < 1
  ) {
    throw new AniCliError("Invalid anime selection");
  }

  validateQuery((selection as Selection).query);
  return selection as Selection;
}

export class AniCliService {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly historyDirectory: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AniCliOptions = {}) {
    this.binary = options.binary ?? process.env.ANICLI_BIN ?? "ani-cli";
    this.timeoutMs = options.timeoutMs ?? readPositiveInteger(process.env.ANICLI_TIMEOUT_MS, 60_000);
    this.maxOutputBytes = options.maxOutputBytes ?? readPositiveInteger(process.env.ANICLI_MAX_OUTPUT_BYTES, 1_048_576);
    this.historyDirectory = path.join(os.tmpdir(), "anilan-ani-cli");
  }

  async checkAvailability(): Promise<AniCliStatus> {
    try {
      const output = await this.enqueue(() => this.run(["--version"]));
      const version = parseVersion(`${output.stdout}\n${output.stderr}`);

      if (!version) {
        return { available: false, error: "ani-cli returned no recognizable version" };
      }

      return { available: true, version };
    } catch (error) {
      return {
        available: false,
        error: error instanceof AniCliError ? error.message : "Unable to execute ani-cli"
      };
    }
  }

  async search(query: string): Promise<AnimeSearchResult[]> {
    validateQuery(query);

    const output = await this.enqueue(() =>
      this.run([query], {
        allowedExitCodes: [1],
        environment: {
          ANICLI_CAPTURE_MODE: "search",
          ANICLI_RESULT_INDEX: "1"
        }
      })
    );
    const results = parseSearchRows(parseMenuRows(output.stderr), query);

    if (results.length === 0) {
      throw new AniCliError("ani-cli returned no search results", { stderr: output.stderr });
    }

    return results;
  }

  async getEpisodes(id: string): Promise<AnimeDetails> {
    const selection = decodeSelection(id);
    const output = await this.enqueue(() =>
      this.run([selection.query], {
        allowedExitCodes: [1],
        environment: {
          ANICLI_CAPTURE_MODE: "episodes",
          ANICLI_RESULT_INDEX: String(selection.index)
        }
      })
    );
    const menuRows = parseMenuRows(output.stderr);
    const episodes = parseEpisodeRows(menuRows);
    const selectedResult = parseSearchRows(menuRows, selection.query).find(
      (result) => decodeSelection(result.id).index === selection.index
    );

    if (!selectedResult || episodes.length === 0) {
      throw new AniCliError("ani-cli returned no episodes", { stderr: output.stderr });
    }

    return { id, title: selectedResult.title, episodes };
  }

  async resolveEpisode(id: string, episode: number): Promise<EpisodeResolution> {
    const selection = decodeSelection(id);
    validateEpisode(episode);

    const output = await this.enqueue(() =>
      this.run(["-S", String(selection.index), "-e", String(episode), selection.query])
    );
    const title = parseMarker(output.stderr, "ANICLI_TITLE");
    const streamUrl = parseMarker(output.stderr, "ANICLI_STREAM_URL");

    if (!title || !streamUrl || !isHttpUrl(streamUrl)) {
      throw new AniCliError("ani-cli returned no browser-playable stream", { stderr: output.stderr });
    }

    return { title, episode, streamUrl };
  }

  private async run(args: string[], options: CommandOptions = {}): Promise<CommandOutput> {
    await mkdir(this.historyDirectory, { recursive: true });

    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      ANI_CLI_HIST_DIR: this.historyDirectory,
      ANI_CLI_LOG: "0",
      ANI_CLI_MENU: defaultMenuAdapter,
      ANI_CLI_PLAYER: defaultPlayerAdapter,
      ANI_CLI_NO_DETACH: "1",
      ANI_CLI_EXIT_AFTER_PLAY: "1",
      TERM: "dumb",
      ...options.environment
    };

    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd: projectRoot,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout: string[] = [];
      const stderr: string[] = [];
      let outputBytes = 0;
      let timedOut = false;
      let outputTooLarge = false;
      let settled = false;

      const finishError = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error);
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, this.timeoutMs);

      const collect = (target: string[], chunk: Buffer) => {
        if (settled) {
          return;
        }

        outputBytes += chunk.byteLength;
        if (outputBytes > this.maxOutputBytes) {
          outputTooLarge = true;
          child.kill("SIGTERM");
          return;
        }

        target.push(chunk.toString("utf8"));
      };

      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.on("error", (error) => {
        clearTimeout(timer);
        finishError(new AniCliError("Unable to start ani-cli", { stderr: error.message }));
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);

        if (settled) {
          return;
        }
        settled = true;

        const output = { stdout: stdout.join(""), stderr: stderr.join("") };
        if (timedOut) {
          reject(new AniCliError("ani-cli timed out", { stderr: output.stderr }));
        } else if (outputTooLarge) {
          reject(new AniCliError("ani-cli produced too much output", { stderr: output.stderr }));
        } else if (exitCode !== 0 && !options.allowedExitCodes?.includes(exitCode ?? -1)) {
          reject(new AniCliError("ani-cli exited unsuccessfully", { exitCode, stderr: output.stderr }));
        } else {
          resolve(output);
        }
      });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function validateQuery(query: string): void {
  if (query.trim().length === 0 || query.length > maxQueryLength || /[\r\n]/.test(query)) {
    throw new AniCliError("Anime query is invalid");
  }
}

function validateEpisode(episode: number): void {
  if (!Number.isInteger(episode) || episode < 1 || episode > 10_000) {
    throw new AniCliError("Episode number is invalid");
  }
}

function decodeTitle(value: string): string {
  return value.replace(/&#039;/g, "'").replace(/&quot;/g, '"');
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function parseVersion(output: string): string | undefined {
  return output.match(/\b\d+\.\d+\.\d+\b/)?.[0];
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("ani-cli numeric configuration is invalid");
  }

  return parsed;
}
