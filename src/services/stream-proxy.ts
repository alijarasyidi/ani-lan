import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream } from "node:stream/web";

const streamLifetimeMs = 30 * 60_000;
const maxPlaylistBytes = 2 * 1024 * 1024;
const proxyUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36";

interface StreamTarget {
  url: URL;
  referrer?: URL;
  expiresAt: number;
  allowedOrigins: Set<string>;
}

export interface StreamProxyResponse {
  contentType: string;
  body: string | Readable;
}

export class StreamProxyError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "StreamProxyError";
    this.statusCode = statusCode;
  }
}

export class StreamProxy {
  private readonly targets = new Map<string, StreamTarget>();

  create(streamUrl: string, referrer?: string): string {
    const url = parseHttpUrl(streamUrl);
    const parsedReferrer = referrer ? parseHttpUrl(referrer) : undefined;
    const token = randomBytes(18).toString("base64url");

    this.removeExpired();
    this.targets.set(token, {
      url,
      referrer: parsedReferrer,
      expiresAt: Date.now() + streamLifetimeMs,
      allowedOrigins: new Set([url.origin])
    });

    return `/api/stream/${token}`;
  }

  async request(token: string, path?: string): Promise<StreamProxyResponse> {
    const target = this.targets.get(token);
    if (!target || target.expiresAt <= Date.now()) {
      this.targets.delete(token);
      throw new StreamProxyError("Stream URL is no longer available", 404);
    }
    target.expiresAt = Date.now() + streamLifetimeMs;

    const upstreamUrl = path ? this.resolvePath(target, path) : target.url;
    const headers = new Headers({
      Accept: "*/*",
      "User-Agent": proxyUserAgent
    });

    if (target.referrer) {
      headers.set("Referer", target.referrer.toString());
      headers.set("Origin", target.referrer.origin);
    }

    let response: Response;
    try {
      response = await fetch(upstreamUrl, { headers });
    } catch {
      throw new StreamProxyError("Unable to fetch stream from provider");
    }

    if (!response.ok) {
      throw new StreamProxyError(`Provider returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!isPlaylist(upstreamUrl, contentType)) {
      if (!response.body) {
        throw new StreamProxyError("Provider returned an empty stream");
      }

      return {
        contentType,
        body: Readable.fromWeb(response.body as unknown as ReadableStream<Uint8Array>)
      };
    }

    const playlist = await response.text();
    if (Buffer.byteLength(playlist, "utf8") > maxPlaylistBytes) {
      throw new StreamProxyError("Provider returned an oversized playlist");
    }

    return {
      contentType: "application/vnd.apple.mpegurl",
      body: rewritePlaylist(playlist, upstreamUrl, token, target)
    };
  }

  private resolvePath(target: StreamTarget, path: string): URL {
    let url: URL;

    try {
      url = new URL(path);
    } catch {
      throw new StreamProxyError("Invalid stream resource", 400);
    }

    if ((url.protocol !== "http:" && url.protocol !== "https:") || !target.allowedOrigins.has(url.origin)) {
      throw new StreamProxyError("Stream resource is not allowed", 400);
    }

    return url;
  }

  private removeExpired(): void {
    const now = Date.now();

    for (const [token, target] of this.targets) {
      if (target.expiresAt <= now) {
        this.targets.delete(token);
      }
    }
  }
}

function parseHttpUrl(value: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new StreamProxyError("Invalid stream URL", 400);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new StreamProxyError("Invalid stream URL", 400);
  }

  return url;
}

function isPlaylist(url: URL, contentType: string): boolean {
  return url.pathname.endsWith(".m3u8") || /mpegurl|mpeg-url/i.test(contentType);
}

function rewritePlaylist(playlist: string, playlistUrl: URL, token: string, target: StreamTarget): string {
  return playlist
    .split(/\r?\n/)
    .map((line) => {
      const attribute = line.match(/URI="([^"]+)"/);
      if (attribute) {
        const resourceUrl = resolveResource(attribute[1], playlistUrl, target);
        return line.replace(attribute[1], proxyResourceUrl(token, resourceUrl));
      }

      if (line.length === 0 || line.startsWith("#")) {
        return line;
      }

      const resourceUrl = resolveResource(line, playlistUrl, target);
      return proxyResourceUrl(token, resourceUrl);
    })
    .join("\n");
}

function resolveResource(value: string, baseUrl: URL, target: StreamTarget): URL {
  let resourceUrl: URL;

  try {
    resourceUrl = new URL(value, baseUrl);
  } catch {
    throw new StreamProxyError("Provider returned an invalid playlist resource");
  }

  if (resourceUrl.protocol !== "http:" && resourceUrl.protocol !== "https:") {
    throw new StreamProxyError("Provider returned an invalid playlist resource");
  }

  target.allowedOrigins.add(resourceUrl.origin);
  return resourceUrl;
}

function proxyResourceUrl(token: string, resourceUrl: URL): string {
  return `/api/stream/${token}?path=${encodeURIComponent(resourceUrl.toString())}`;
}
