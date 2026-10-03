import { createServer } from "node:http";
import { z } from "zod";
import { applyDnsRelease, buildReleaseEvent } from "./cutover_plan.js";
import type { CutoverInput } from "./cutover_plan.js";
import { InfraiDnsClient, InfraiError } from "./infrai_dns_client.js";

const requestSchema = z.object({
  domain: z.string().min(1),
  hostname: z.string().min(1),
  target: z.string().min(1),
  previousTarget: z.string().min(1),
  ttl: z.number().int().min(30).max(300),
  releaseId: z.string().min(1).max(100),
}).strict().superRefine((value, context) => {
  if (value.hostname !== value.domain && !value.hostname.endsWith(`.${value.domain}`)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["hostname"], message: "hostname must belong to domain" });
  }
});

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const client = new InfraiDnsClient(apiKey);

const server = createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  try {
    if (request.method !== "POST" || (request.url !== "/cutovers" && request.url !== "/rollbacks")) {
      response.writeHead(404).end(JSON.stringify({ error: "route not found" }));
      return;
    }

    const parsed = requestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid request", issues: parsed.error.issues }));
      return;
    }

    const input = parsed.data as CutoverInput;
    const operation = request.url === "/cutovers" ? "cutover" : "rollback";
    const built = buildReleaseEvent(input, operation, "built");
    const released = await applyDnsRelease(client, input, operation);
    response.writeHead(200).end(JSON.stringify({ buildEvent: built, ...released }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "request body must be JSON" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code, details: error.details }));
      return;
    }
    response.writeHead(502).end(JSON.stringify({ error: "upstream request failed" }));
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`DNS cutover service listening on http://localhost:${port}`));
