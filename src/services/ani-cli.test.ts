import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  decodeSelection,
  encodeSelection,
  AniCliService,
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
