import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../server.js";
import { AniCliInputError, type AnimeDetails, type AniCliService } from "../services/ani-cli.js";

function fakeService(getEpisodes: (id: string) => Promise<AnimeDetails>): AniCliService {
  return { getEpisodes } as AniCliService;
}

test("anime route returns episode details", async () => {
  const details = {
    id: "selection",
    title: "One Piece",
    episodes: [{ number: 1 }, { number: 2 }]
  };
  const app = await createServer(fakeService(async () => details));

  const response = await app.inject({ method: "GET", url: "/api/anime/selection" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), details);
  await app.close();
});

test("anime route returns 400 for an invalid selection", async () => {
  const app = await createServer(
    fakeService(async () => {
      throw new AniCliInputError("Invalid anime selection");
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/anime/invalid" });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Invalid anime selection." });
  await app.close();
});

test("anime route hides provider failures", async () => {
  const app = await createServer(
    fakeService(async () => {
      throw new Error("provider details");
    })
  );

  const response = await app.inject({ method: "GET", url: "/api/anime/selection" });

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "Could not load episodes." });
  await app.close();
});

test("episode route returns a resolved stream", async () => {
  const resolution = {
    title: "One Piece",
    episode: 1,
    streamUrl: "https://example.test/episode.m3u8"
  };
  const app = await createServer({
    resolveEpisode: async () => resolution
  } as unknown as AniCliService);

  const response = await app.inject({
    method: "GET",
    url: "/api/anime/selection/episode/1"
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), resolution);
  await app.close();
});

test("episode route returns 400 for invalid episode input", async () => {
  const app = await createServer({
    resolveEpisode: async () => {
      throw new AniCliInputError("Episode number is invalid");
    }
  } as unknown as AniCliService);

  const response = await app.inject({
    method: "GET",
    url: "/api/anime/selection/episode/1"
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "Invalid episode request." });
  await app.close();
});

test("episode route hides stream-resolution failures", async () => {
  const app = await createServer({
    resolveEpisode: async () => {
      throw new Error("provider details");
    }
  } as unknown as AniCliService);

  const response = await app.inject({
    method: "GET",
    url: "/api/anime/selection/episode/1"
  });

  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "Could not resolve this episode." });
  await app.close();
});
