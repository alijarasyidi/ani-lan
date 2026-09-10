import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultMenuAdapter = path.join(projectRoot, "tools", "ani-cli-menu");
const defaultPlayerAdapter = path.join(projectRoot, "tools", "ani-cli-mpv-capture");
const maxQueryLength = 120;
const defaultMetadataCacheTtlMs = 5 * 60_000;

export interface AniCliOptions {
  binary?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  metadataCacheTtlMs?: number;
}

export type AniCliFailureReason =
  | "cloudflare"
  | "rate-limited"
  | "timeout"
  | "network"
  | "execution"
  | "provider"
  | "unknown";

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
  streamReferrer?: string;
  subtitleUrl?: string;
}

export class AniCliError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly failureReason: AniCliFailureReason;
  readonly diagnostic?: string;

  constructor(
    message: string,
    options: { exitCode?: number | null; stderr?: string; failureReason?: AniCliFailureReason } = {}
  ) {
    super(message);
    this.name = "AniCliError";
    this.exitCode = options.exitCode ?? null;
    this.stderr = options.stderr ?? "";
    this.failureReason = options.failureReason ?? classifyAniCliFailure(message, this.stderr);
    this.diagnostic = summarizeDiagnostic(this.stderr);
  }
}

export class AniCliInputError extends AniCliError {}

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

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
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
    throw new AniCliInputError("Invalid anime selection");
  }

  if (
    typeof selection !== "object" ||
    selection === null ||
    typeof (selection as Selection).query !== "string" ||
    typeof (selection as Selection).index !== "number" ||
    !Number.isInteger((selection as Selection).index) ||
    (selection as Selection).index < 1
  ) {
    throw new AniCliInputError("Invalid anime selection");
  }

  validateQuery((selection as Selection).query);
  return selection as Selection;
}

export class AniCliService {
  private readonly binary: string;
  private readonly timeoutMs: number;
  private readonly maxOutputBytes: number;
  private readonly metadataCacheTtlMs: number;
  private readonly historyDirectory: string;
  private readonly searchCache = new Map<string, CacheEntry<AnimeSearchResult[]>>();
  private readonly episodesCache = new Map<string, CacheEntry<AnimeDetails>>();
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AniCliOptions = {}) {
    this.binary = options.binary ?? process.env.ANICLI_BIN ?? "ani-cli";
    this.timeoutMs = options.timeoutMs ?? readPositiveInteger(process.env.ANICLI_TIMEOUT_MS, 60_000);
    this.maxOutputBytes = options.maxOutputBytes ?? readPositiveInteger(process.env.ANICLI_MAX_OUTPUT_BYTES, 1_048_576);
    this.metadataCacheTtlMs =
      options.metadataCacheTtlMs ??
      readPositiveInteger(process.env.ANICLI_METADATA_CACHE_TTL_MS, defaultMetadataCacheTtlMs);
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

    const cacheKey = normalizeCacheKey(query);
    const cached = this.readCache(this.searchCache, cacheKey);
    if (cached) {
      return cached;
    }

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

    this.writeCache(this.searchCache, cacheKey, results);
    return results;
  }

  async getEpisodes(id: string): Promise<AnimeDetails> {
    const selection = decodeSelection(id);
    const cached = this.readCache(this.episodesCache, id);
    if (cached) {
      return cached;
    }

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
    const listedEpisodes = parseEpisodeRows(menuRows);
    const selectedResult = parseSearchRows(menuRows, selection.query).find(
      (result) => decodeSelection(result.id).index === selection.index
    );
    const directTitle = parseMarker(output.stderr, "ANICLI_TITLE");
    const directStreamUrl = parseMarker(output.stderr, "ANICLI_STREAM_URL");
    const episodes =
      listedEpisodes.length > 0
        ? listedEpisodes
        : directStreamUrl && isHttpUrl(directStreamUrl)
          ? [{ number: 1 }]
          : [];
    const title = selectedResult?.title ?? directTitle;

    if (!title || episodes.length === 0) {
      throw new AniCliError("ani-cli returned no episodes", { stderr: output.stderr });
    }

    const details = { id, title, episodes };
    this.writeCache(this.episodesCache, id, details);
    return details;
  }

  async resolveEpisode(id: string, episode: number): Promise<EpisodeResolution> {
    const selection = decodeSelection(id);
    validateEpisode(episode);

    const output = await this.enqueue(() =>
      this.run(["-S", String(selection.index), "-e", String(episode), selection.query])
    );
    const title = parseMarker(output.stderr, "ANICLI_TITLE");
    const streamUrl = parseMarker(output.stderr, "ANICLI_STREAM_URL");
    const streamReferrer = parseMarker(output.stderr, "ANICLI_STREAM_REFERRER");
    const subtitleUrl = parseMarker(output.stderr, "ANICLI_SUBTITLE_URL");

    if (!title || !streamUrl || !isHttpUrl(streamUrl)) {
      throw new AniCliError("ani-cli returned no browser-playable stream", { stderr: output.stderr });
    }

    return {
      title,
      episode,
      streamUrl,
      ...(streamReferrer && isHttpUrl(streamReferrer) ? { streamReferrer } : {}),
      ...(subtitleUrl && isHttpUrl(subtitleUrl) ? { subtitleUrl } : {})
    };
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
        detached: true,
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
        terminateProcessGroup(child);
      }, this.timeoutMs);

      const collect = (target: string[], chunk: Buffer) => {
        if (settled) {
          return;
        }

        outputBytes += chunk.byteLength;
        if (outputBytes > this.maxOutputBytes) {
          outputTooLarge = true;
          terminateProcessGroup(child);
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

  private readCache<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
    const entry = cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  private writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
    cache.set(key, { value, expiresAt: Date.now() + this.metadataCacheTtlMs });
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

function terminateProcessGroup(child: ReturnType<typeof spawn>): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Fall back to terminating the direct child if process groups are unavailable.
    }
  }

  child.kill("SIGTERM");
}

function validateQuery(query: string): void {
  if (query.trim().length === 0 || query.length > maxQueryLength || /[\r\n]/.test(query)) {
    throw new AniCliInputError("Anime query is invalid");
  }
}

function validateEpisode(episode: number): void {
  if (!Number.isInteger(episode) || episode < 1 || episode > 10_000) {
    throw new AniCliInputError("Episode number is invalid");
  }
}

export function classifyAniCliFailure(message: string, stderr = ""): AniCliFailureReason {
  const output = `${message}\n${stderr}`.toLowerCase();

  if (
    /blocked by cloudflare|just a moment|cf-chl-|challenge-platform|attention required|checking your browser/.test(
      output
    )
  ) {
    return "cloudflare";
  }

  if (/\b429\b|too many requests|rate[ -]?limit|retry[ -]?after/.test(output)) {
    return "rate-limited";
  }

  if (/timed out|timeout/.test(output)) {
    return "timeout";
  }

  if (/unable to start ani-cli/.test(output)) {
    return "execution";
  }

  if (/could not resolve|failed to connect|connection reset|network is unreachable|tls|ssl|curl:/.test(output)) {
    return "network";
  }

  if (/no results|no episodes|no valid sources|no browser-playable stream|exited unsuccessfully/.test(output)) {
    return "provider";
  }

  return "unknown";
}

function summarizeDiagnostic(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("ANICLI_"));

  if (lines.length === 0) {
    return undefined;
  }

  return lines.slice(-3).join(" | ").slice(0, 500);
}

function normalizeCacheKey(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
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
