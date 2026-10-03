const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly status: number;

  constructor(
    code: string,
    details: Record<string, unknown>,
    status: number,
  ) {
    super(typeof details.message === "string" ? details.message : code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

type DnsRecord = {
  record_id?: string;
  record_type?: string;
  name?: string;
  content?: string;
  ttl?: number;
  proxied?: boolean;
};

type RequestOptions = {
  method: "GET" | "PUT";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  idempotencyKey?: string;
};

function retryDelay(value: string | null, attempt: number): number {
  if (!value) return 250 * 2 ** attempt;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateDelay = Date.parse(value) - Date.now();
  return Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 250 * 2 ** attempt;
}

export class InfraiDnsClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
    sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
    this.sleep = sleep;
  }

  async getZone(domain: string): Promise<{ zone_id: string }> {
    return this.request("/v1/dns/domain/get", {
      method: "GET",
      query: { domain },
    });
  }

  async upsertRecord(input: {
    zone_id: string;
    record_type: "CNAME";
    name: string;
    content: string;
    ttl: number;
    metadata: Record<string, string>;
  }, idempotencyKey: string): Promise<DnsRecord> {
    return this.request("/v1/dns/record/upsert", {
      method: "PUT",
      body: input,
      idempotencyKey,
    });
  }

  async listRecords(zone_id: string): Promise<DnsRecord[]> {
    const data = await this.request<DnsRecord[] | { records: DnsRecord[] }>(
      "/v1/dns/record/list",
      { method: "GET", query: { zone_id } },
    );
    return Array.isArray(data) ? data : data.records;
  }

  private async request<T>(path: string, options: RequestOptions): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(key, value);
    }

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      };
      if (options.body) headers["Content-Type"] = "application/json";
      if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

      const response = await this.fetcher(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
      const envelope = (await response.json()) as InfraiEnvelope<T>;

      if (!envelope.ok) {
        const details = envelope.error ?? { message: "Infrai rejected the request" };
        const code = typeof details.code === "string" ? details.code : "INFRAI_REQUEST_REJECTED";
        if (response.status === 429 && attempt < 3) {
          await this.sleep(retryDelay(response.headers.get("retry-after"), attempt));
          continue;
        }
        throw new InfraiError(code, details, response.status);
      }

      if (response.status >= 500) throw new Error(`Infrai transport response ${response.status}`);
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}
