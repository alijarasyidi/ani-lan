import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  decodeSelection,
  encodeSelection,
  AniCliError,
  AniCliService,
  classifyAniCliFailure,
  parseEpisodeRows,
  parseMarker,
  parseSearchRows
} from "./ani-cli.js";

test("parses search rows and creates opaque selections", () => {
  const results = parseSearchRows(["1 One Piece", "2 One Piece: Episode of East Blue"], "one piece");

  assert.deepEqual(
    results.map(({ title }) => title),
    ["One Piece", "One Piece: Episode of East Blue"]
  );
  assert.deepEqual(decodeSelection(results[0].id), { query: "one piece", index: 1 });
});

test("parses, sorts, and deduplicates episode rows", () => {
  assert.deepEqual(parseEpisodeRows(["3", "1", "2", "2", "not-an-episode"]), [
    { number: 1 },
    { number: 2 },
    { number: 3 }
  ]);
});

test("parses capture markers", () => {
  const output = "noise\nANICLI_TITLE\tOne Piece\nANICLI_STREAM_URL\thttps://example.test/episode.m3u8\n";

  assert.equal(parseMarker(output, "ANICLI_TITLE"), "One Piece");
  assert.equal(parseMarker(output, "ANICLI_STREAM_URL"), "https://example.test/episode.m3u8");
  assert.equal(encodeSelection({ query: "one piece", index: 2 }), "eyJxdWVyeSI6Im9uZSBwaWVjZSIsImluZGV4IjoyfQ");
});

test("classifies provider failures and removes capture markers from diagnostics", () => {
  const error = new AniCliError("ani-cli returned no search results", {
    stderr: "ANICLI_STREAM_URL\thttps://example.test/private.m3u8\n\u001b[1;31mBlocked by cloudflare\u001b[0m"
  });

  assert.equal(error.failureReason, "cloudflare");
  assert.equal(error.diagnostic, "Blocked by cloudflare");
  assert.equal(classifyAniCliFailure("ani-cli exited unsuccessfully", "HTTP 429 Too Many Requests"), "rate-limited");
});

test("caches successful search metadata for the configured TTL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anilan-cache-"));
  const countFile = path.join(directory, "count");
  const executable = path.join(directory, "ani-cli-cache");

  try {
    await writeFile(
      executable,
      `#!/bin/sh
count=0
[ -f '${countFile}' ] && count=$(cat '${countFile}')
printf '%s' "$((count + 1))" > '${countFile}'
printf 'ANICLI_MENU_ROW\\t1 One Piece\\n' >&2
exit 1
`,
      "utf8"
    );
    await chmod(executable, 0o755);

    const service = new AniCliService({ binary: executable, metadataCacheTtlMs: 60_000 });
    const first = await service.search("one piece");
    const second = await service.search("one   piece");

    assert.deepEqual(second, first);
    assert.equal(await readFile(countFile, "utf8"), "1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("caches successful episode metadata for the configured TTL", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anilan-episode-cache-"));
  const countFile = path.join(directory, "count");
  const executable = path.join(directory, "ani-cli-episode-cache");

  try {
    await writeFile(
      executable,
      `#!/bin/sh
count=0
[ -f '${countFile}' ] && count=$(cat '${countFile}')
printf '%s' "$((count + 1))" > '${countFile}'
printf 'ANICLI_MENU_ROW\\t1 One Piece\\n' >&2
printf 'ANICLI_MENU_ROW\\t1\\n' >&2
exit 1
`,
      "utf8"
    );
    await chmod(executable, 0o755);

    const service = new AniCliService({ binary: executable, metadataCacheTtlMs: 60_000 });
    const id = encodeSelection({ query: "one piece", index: 1 });
    const first = await service.getEpisodes(id);
    const second = await service.getEpisodes(id);

    assert.deepEqual(second, first);
    assert.equal(await readFile(countFile, "utf8"), "1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("treats a directly resolved one-item title as episode one", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anilan-movie-"));
  const executable = path.join(directory, "ani-cli-movie");

  try {
    await writeFile(
      executable,
      `#!/bin/sh
printf 'ANICLI_MENU_ROW\\t1 My Movie\\n' >&2
printf 'ANICLI_TITLE\\tMy Movie\\n' >&2
printf 'ANICLI_STREAM_URL\\thttps://example.test/movie.m3u8\\n' >&2
exit 0
`,
      "utf8"
    );
    await chmod(executable, 0o755);

    const service = new AniCliService({ binary: executable });
    const details = await service.getEpisodes(encodeSelection({ query: "my movie", index: 1 }));

    assert.deepEqual(details, {
      id: encodeSelection({ query: "my movie", index: 1 }),
      title: "My Movie",
      episodes: [{ number: 1 }]
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("captures the provider referrer with a resolved stream", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anilan-referrer-"));
  const executable = path.join(directory, "ani-cli-referrer");

  try {
    await writeFile(
      executable,
      `#!/bin/sh
printf 'ANICLI_TITLE\\tMy Anime\\n' >&2
printf 'ANICLI_STREAM_REFERRER\\thttps://zokoanime.video/\\n' >&2
printf 'ANICLI_STREAM_URL\\thttps://example.test/episode.m3u8\\n' >&2
exit 0
`,
      "utf8"
    );
    await chmod(executable, 0o755);

    const service = new AniCliService({ binary: executable });
    const resolution = await service.resolveEpisode(
      encodeSelection({ query: "my anime", index: 1 }),
      1
    );

    assert.deepEqual(resolution, {
      title: "My Anime",
      episode: 1,
      streamUrl: "https://example.test/episode.m3u8",
      streamReferrer: "https://zokoanime.video/"
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reports a missing ani-cli executable without throwing raw subprocess errors", async () => {
  const service = new AniCliService({ binary: "ani-cli-does-not-exist", timeoutMs: 1_000 });
  const status = await service.checkAvailability();

  assert.equal(status.available, false);
  assert.equal(status.error, "Unable to start ani-cli");
});

test("terminates a timed-out ani-cli subprocess", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "anilan-timeout-"));
  const executable = path.join(directory, "ani-cli-timeout");

  try {
    await writeFile(executable, "#!/bin/sh\nsleep 2\n", "utf8");
    await chmod(executable, 0o755);

    const service = new AniCliService({ binary: executable, timeoutMs: 20 });
    const status = await service.checkAvailability();

    assert.equal(status.available, false);
    assert.equal(status.error, "ani-cli timed out");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
