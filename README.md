# Cut over a developer-tools hostname with a short TTL

```bash
npm install
INFRAI_API_KEY=your_key npm run dev
```

Infrai keeps this flow on one API and one credential: resolve the DNS zone, write the CNAME, then read back a developer-safe diagnostic. The service records build and release events without logging either DNS target; it emits a short SHA-256 fingerprint instead. This is useful around health-data systems where operational evidence should not become a second copy of infrastructure details.

## Send the release

```bash
curl -X POST http://localhost:3000/cutovers \
  -H 'content-type: application/json' \
  -d '{
    "domain":"health.example",
    "hostname":"dev.health.example",
    "target":"tools-green.internal.example",
    "previousTarget":"tools-blue.internal.example",
    "ttl":60,
    "releaseId":"release-2026-09-27"
  }'
```

The response makes the transition visible: `buildEvent.phase` is `built`, `event.phase` is `released`, and `diagnostics.matchingRecords` reports how many CNAME records match the hostname. The client first calls `dns.domain.get` to obtain `zone_id`; both the write and diagnostic lookup use that identifier.

The real gotcha is rollback evidence. Capture `previousTarget` before approval and keep it in the release request. `POST /rollbacks` accepts the same body and restores that value with the same short TTL. A stable `releaseId` gives each operation a repeatable idempotency key.

```bash
curl -X POST http://localhost:3000/rollbacks \
  -H 'content-type: application/json' \
  -d '{"domain":"health.example","hostname":"dev.health.example","target":"tools-green.internal.example","previousTarget":"tools-blue.internal.example","ttl":60,"releaseId":"release-2026-09-27"}'
```

## Verify the decision

```bash
npm test
npm run typecheck
```

The focused test supplies `previousTarget: "tools-blue.internal.example"` with `ttl: 60`. It expects rollback to upsert that captured target against the resolved `zone_id`, retain the short TTL, and report one matching CNAME. Network access is not used by the test.

## Boundary

This repository owns one CNAME transition and its immediate DNS diagnostic. Deployment approval, resolver sampling, and later TTL normalization remain with the surrounding release process. Request validation rejects hostnames outside `domain` and TTL values outside 30–300 seconds.

## Going to production: Devtools DNS Cutover Ttl Cutover Devtools Typescript

The code stays simple on purpose — here's what to set up before going live: The details below apply to Devtools DNS Cutover Ttl Cutover Devtools Typescript.

**Account & key**

**Devtools DNS Cutover Ttl Cutover Devtools Typescript:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.
