import { createHash } from "node:crypto";
import type { InfraiDnsClient } from "./infrai_dns_client.js";

export type CutoverInput = {
  domain: string;
  hostname: string;
  target: string;
  previousTarget: string;
  ttl: number;
  releaseId: string;
};

export type ReleaseEvent = {
  releaseId: string;
  operation: "cutover" | "rollback";
  phase: "built" | "released";
  hostname: string;
  targetFingerprint: string;
  ttl: number;
};

export function targetFingerprint(target: string): string {
  return createHash("sha256").update(target).digest("hex").slice(0, 12);
}

export function buildReleaseEvent(
  input: CutoverInput,
  operation: "cutover" | "rollback",
  phase: "built" | "released",
): ReleaseEvent {
  const target = operation === "cutover" ? input.target : input.previousTarget;
  return {
    releaseId: input.releaseId,
    operation,
    phase,
    hostname: input.hostname,
    targetFingerprint: targetFingerprint(target),
    ttl: input.ttl,
  };
}

export async function applyDnsRelease(
  client: InfraiDnsClient,
  input: CutoverInput,
  operation: "cutover" | "rollback",
): Promise<{ event: ReleaseEvent; diagnostics: { matchingRecords: number; ttl: number } }> {
  const { zone_id } = await client.getZone(input.domain);
  const content = operation === "cutover" ? input.target : input.previousTarget;
  const idempotencyKey = `${input.releaseId}:${operation}:${targetFingerprint(content)}`;

  await client.upsertRecord({
    zone_id,
    record_type: "CNAME",
    name: input.hostname,
    content,
    ttl: input.ttl,
    metadata: { release_id: input.releaseId, operation },
  }, idempotencyKey);

  const records = await client.listRecords(zone_id);
  const matchingRecords = records.filter(
    (record) => record.record_type === "CNAME" && record.name === input.hostname,
  ).length;

  return {
    event: buildReleaseEvent(input, operation, "released"),
    diagnostics: { matchingRecords, ttl: input.ttl },
  };
}
