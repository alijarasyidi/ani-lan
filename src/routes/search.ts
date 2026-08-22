import type { FastifyInstance } from "fastify";

import { AniCliError, type AniCliService } from "../services/ani-cli.js";

interface SearchQuery {
  q: string;
}

export async function registerSearchRoute(app: FastifyInstance, aniCli: AniCliService): Promise<void> {
  await app.get<{ Querystring: SearchQuery }>(
    "/api/search",
    {
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: {
              type: "string",
              minLength: 1,
              maxLength: 120,
              pattern: "^[^\\r\\n]+$"
            }
          },
          required: ["q"],
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      const query = request.query.q.trim();

      if (query.length === 0) {
        return reply.status(400).send({ error: "Search query is required." });
      }

      try {
        return { results: await aniCli.search(query) };
      } catch (error) {
        if (error instanceof AniCliError) {
          request.log.error(
            {
              message: error.message,
              exitCode: error.exitCode,
              failureReason: error.failureReason,
              diagnostic: error.diagnostic
            },
            "ani-cli search failed"
          );
        } else {
          request.log.error(error, "ani-cli search failed");
        }

        return reply.status(502).send({ error: "Could not search anime." });
      }
    }
  );
}
