import assert from "node:assert/strict";
import test from "node:test";
import { applyDnsRelease } from "../src/cutover_plan.js";
import type { InfraiDnsClient } from "../src/infrai_dns_client.js";

test("rollback restores the captured target with the short TTL", async () => {
  const writes: Array<Record<string, unknown>> = [];
  const fakeClient = {
    getZone: async () => ({ zone_id: "zone_health_tools" }),
    upsertRecord: async (input: Record<string, unknown>, key: string) => {
      writes.push({ ...input, key });
      return input;
    },
    listRecords: async () => [{ record_type: "CNAME", name: "dev.health.example" }],
  } as unknown as InfraiDnsClient;

  const result = await applyDnsRelease(fakeClient, {
    domain: "health.example",
    hostname: "dev.health.example",
    target: "tools-green.internal.example",
    previousTarget: "tools-blue.internal.example",
    ttl: 60,
    releaseId: "release-2026-09-27",
  }, "rollback");

  assert.equal(writes[0]?.zone_id, "zone_health_tools");
  assert.equal(writes[0]?.content, "tools-blue.internal.example");
  assert.equal(writes[0]?.ttl, 60);
  assert.match(String(writes[0]?.key), /^release-2026-09-27:rollback:/);
  assert.equal(result.event.operation, "rollback");
  assert.deepEqual(result.diagnostics, { matchingRecords: 1, ttl: 60 });
});
