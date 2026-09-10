import assert from "node:assert/strict";
import test from "node:test";

import { StreamProxy } from "./stream-proxy.js";

test("proxies HLS playlists and provider resources through one origin", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; referrer: string | null }> = [];

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({ url, referrer: headers.get("Referer") });

    if (url.endsWith("index.m3u8")) {
      return new Response("#EXTM3U\n#EXTINF:5,\nseg_00000.ts\n", {
        headers: { "content-type": "application/vnd.apple.mpegurl" }
      });
    }

    return new Response("segment", { headers: { "content-type": "video/mp2t" } });
  };

  try {
    const proxy = new StreamProxy();
    const streamUrl = proxy.create(
      "https://hls.example.test/video/index.m3u8",
      "https://zokoanime.video/"
    );
    const token = streamUrl.split("/").pop();

    assert.ok(token);
    const playlist = await proxy.request(token);

    assert.equal(playlist.contentType, "application/vnd.apple.mpegurl");
    assert.equal(typeof playlist.body, "string");
    assert.match(playlist.body as string, /\/api\/stream\/[A-Za-z0-9_-]+\?path=/);
    assert.equal(requests[0].referrer, "https://zokoanime.video/");

    const resourceUrl = (playlist.body as string).split("\n").at(-2);
    assert.ok(resourceUrl);
    const path = new URL(`https://anilan.test${resourceUrl}`).searchParams.get("path");
    assert.ok(path);

    const segment = await proxy.request(token, path);
    assert.equal(segment.contentType, "video/mp2t");
    assert.equal(requests[1].url, "https://hls.example.test/video/seg_00000.ts");
    assert.equal(requests[1].referrer, "https://zokoanime.video/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
