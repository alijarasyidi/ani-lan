import type { FastifyInstance } from "fastify";

import { AniCliInputError, AniCliError, type AniCliService } from "../services/ani-cli.js";

interface AnimeParams {
  id: string;
}

export async function registerAnimeRoutes(app: FastifyInstance, aniCli: AniCliService): Promise<void> {
  await app.get<{ Params: AnimeParams }>(
    "/api/anime/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            id: {
              type: "string",
              minLength: 1,
              maxLength: 256,
              pattern: "^[A-Za-z0-9_-]+$"
            }
          },
          required: ["id"],
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      try {
        return await aniCli.getEpisodes(request.params.id);
      } catch (error) {
        if (error instanceof AniCliInputError) {
          return reply.status(400).send({ error: "Invalid anime selection." });
        }

        if (error instanceof AniCliError) {
          request.log.error({ message: error.message, exitCode: error.exitCode }, "ani-cli episode lookup failed");
        } else {
          request.log.error(error, "ani-cli episode lookup failed");
        }

        return reply.status(502).send({ error: "Could not load episodes." });
      }
    }
  );
}
