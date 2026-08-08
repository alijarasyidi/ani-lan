import path from "node:path";
import { fileURLToPath } from "node:url";

import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

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
const app = Fastify({ logger: true });

await app.register(fastifyStatic, {
  root: publicDirectory,
  index: "index.html"
});

app.get("/health", async () => ({ status: "ok" }));

app.setErrorHandler((error, request, reply) => {
  request.log.error(error);

  if (!reply.sent) {
    void reply.status(500).send({ error: "Internal server error" });
  }
});

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
