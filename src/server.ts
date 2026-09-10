import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

import { registerAnimeRoutes } from "./routes/anime.js";
import { registerSearchRoute } from "./routes/search.js";
import { AniCliService } from "./services/ani-cli.js";
import { registerStreamRoute } from "./routes/stream.js";
import { StreamProxy } from "./services/stream-proxy.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = path.join(projectRoot, "public");

function readPort(value: string | undefined): number {
  const port = Number(value ?? "3000");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}

const host = process.env.HOST ?? "0.0.0.0";
const port = readPort(process.env.PORT);

export async function createServer(aniCli: AniCliService) {
  const app = Fastify({ logger: true });

  await app.register(fastifyStatic, {
    root: publicDirectory,
    index: "index.html"
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (!reply.sent) {
      if (isValidationError(error)) {
        void reply.status(400).send({ error: "Invalid request." });
      } else {
        void reply.status(500).send({ error: "Internal server error" });
      }
    }
  });

  app.get("/health", async () => ({ status: "ok" }));
  const streamProxy = new StreamProxy();
  await registerStreamRoute(app, streamProxy);
  await registerSearchRoute(app, aniCli);
  await registerAnimeRoutes(app, aniCli, streamProxy);

  return app;
}

async function start(): Promise<void> {
  const aniCli = new AniCliService();
  const aniCliStatus = await aniCli.checkAvailability();

  if (!aniCliStatus.available) {
    console.error(`ani-cli is unavailable: ${aniCliStatus.error ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }

  const app = await createServer(aniCli);
  app.log.info({ version: aniCliStatus.version }, "ani-cli is available");

  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

function isValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error && Boolean(error.validation);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await start();
}
