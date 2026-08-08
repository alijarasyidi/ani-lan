import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../server.js";
import type { AnimeSearchResult, AniCliService } from "../services/ani-cli.js";

function fakeService(search: (query: string) => Promise<AnimeSearchResult[]>): AniCliService {
  return { search } as AniCliService;
}

test("search route returns validated results", async () => {
  const app = await createServer(
    fakeService(async (query) => [{ id: "selection", title: query }])
  );

  const response = await app.inject({ method: "GET", url: "/api/search?q=one%20piece" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { results: [{ id: "selection", title: "one piece" }] });
  await app.close();
});

test("search route rejects invalid input", async () => {
  const app = await createServer(fakeService(async () => []));

  const response = await app.inject({ method: "GET", url: "/api/search" });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Invalid request." });
  await app.close();
});

test("search route hides service failures", async () => {
  const app = await createServer(
    fakeService(async () => {
      throw new Error("provider details");
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/search?q=one%20piece" });

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "Could not search anime." });
  await app.close();
});
