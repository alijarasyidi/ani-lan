import type { FastifyInstance } from "fastify";

import { AniCliInputError, AniCliError, type AniCliService } from "../services/ani-cli.js";
import { StreamProxy } from "../services/stream-proxy.js";

interface AnimeParams {
  id: string;
}

interface EpisodeParams extends AnimeParams {
  episode: string;
}

export async function registerAnimeRoutes(
  app: FastifyInstance,
  aniCli: AniCliService,
  streamProxy = new StreamProxy()
): Promise<void> {
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
          request.log.error(
            {
              message: error.message,
              exitCode: error.exitCode,
              failureReason: error.failureReason,
              diagnostic: error.diagnostic
            },
            "ani-cli episode lookup failed"
          );
        } else {
          request.log.error(error, "ani-cli episode lookup failed");
        }

        return reply.status(502).send({ error: "Could not load episodes." });
      }
    }
  );

  await app.get<{ Params: EpisodeParams }>(
    "/api/anime/:id/episode/:episode",
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
            },
            episode: {
              type: "string",
              minLength: 1,
              maxLength: 5,
              pattern: "^[1-9][0-9]{0,4}$"
            }
          },
          required: ["id", "episode"],
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      try {
        const resolution = await aniCli.resolveEpisode(request.params.id, Number(request.params.episode));
        const {
          streamUrl,
          streamReferrer: _streamReferrer,
          subtitleUrl,
          ...publicResolution
        } = resolution;

        return {
          ...publicResolution,
          streamUrl: streamProxy.create(streamUrl, _streamReferrer),
          ...(subtitleUrl
            ? { subtitleUrl: streamProxy.create(subtitleUrl, _streamReferrer) }
            : {})
        };
      } catch (error) {
        if (error instanceof AniCliInputError) {
          return reply.status(400).send({ error: "Invalid episode request." });
        }

        if (error instanceof AniCliError) {
          request.log.error(
            {
              message: error.message,
              exitCode: error.exitCode,
              failureReason: error.failureReason,
              diagnostic: error.diagnostic
            },
            "ani-cli stream resolution failed"
          );
        } else {
          request.log.error(error, "ani-cli stream resolution failed");
        }

        return reply.status(502).send({ error: "Could not resolve this episode." });
      }
    }
  );
}
