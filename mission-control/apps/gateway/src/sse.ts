import type { FastifyReply } from "fastify";

/** Minimal SSE writer over a raw Fastify reply. */
export class SSEStream {
  constructor(private reply: FastifyReply) {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
  }

  send(event: string, data: unknown): void {
    this.reply.raw.write(`event: ${event}\n`);
    this.reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  close(): void {
    this.reply.raw.end();
  }
}
