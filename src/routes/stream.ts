import type { FastifyInstance } from "fastify";

import { StreamProxy, StreamProxyError } from "../services/stream-proxy.js";

interface StreamParams {
  token: string;
}

interface StreamQuery {
  path?: string;
}

export async function registerStreamRoute(app: FastifyInstance, streamProxy: StreamProxy): Promise<void> {
  await app.get<{ Params: StreamParams; Querystring: StreamQuery }>(
    "/api/stream/:token",
    {
      schema: {
        params: {
          type: "object",
          properties: {
            token: {
              type: "string",
              minLength: 1,
              maxLength: 64,
              pattern: "^[A-Za-z0-9_-]+$"
            }
          },
          required: ["token"],
          additionalProperties: false
        },
        querystring: {
          type: "object",
          properties: {
            path: {
              type: "string",
              minLength: 1,
              maxLength: 2_048
            }
          },
          additionalProperties: false
        }
      }
    },
    async (request, reply) => {
      try {
        const response = await streamProxy.request(request.params.token, request.query.path);
        return reply
          .header("Cache-Control", "no-store")
          .type(response.contentType)
          .send(response.body);
      } catch (error) {
        if (error instanceof StreamProxyError) {
          return reply.status(error.statusCode).send({ error: "Could not load this stream." });
        }

        request.log.error(error, "stream proxy failed");
        return reply.status(502).send({ error: "Could not load this stream." });
      }
    }
  );
}
