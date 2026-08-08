import assert from "node:assert/strict";
import test from "node:test";

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
