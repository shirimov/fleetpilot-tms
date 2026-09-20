import { statementBusinessFingerprint } from "./archive-business-fingerprint";
import { AuthorizationDeniedError } from "@/lib/auth/auth-errors";
import { quickManageClient } from "@/lib/integrations/quickmanage-client";
import { FinancialValidationError } from "./financial-control-errors";
import {
  hash,
  integer,
  inventoryFingerprint,
  object,
  parseSource,
  str,
  uuid,
  type SourceObject,
} from "./archive-normalize";

export class ArchiveProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ArchiveProviderError";
  }
}
export type InventoryResult = {
  items: SourceObject[];
  fingerprint: string;
  metadata: SourceObject;
};
export interface ArchiveProvider {
  readonly accountKey: string;
  companies(): Promise<SourceObject[]>;
  inventory(companyId: string, pid: string): Promise<InventoryResult>;
  bundle(
    companyId: string,
    statementId: string,
  ): Promise<{
    detail: Uint8Array;
    pdf: Uint8Array;
    originalFilename?: string;
  }>;
}
// Bound network concurrency and queue length per application process; jobs are also fenced in PostgreSQL.
let readQueue = Promise.resolve();
let queuedReads = 0;
async function queuedRead<T>(work: () => Promise<T>): Promise<T> {
  if (queuedReads >= 10) throw new ArchiveProviderError("PROVIDER_RETRY_LATER");
  queuedReads++;
  const previous = readQueue;
  let release!: () => void;
  readQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    queuedReads--;
    release();
  }
}
export class QuickManageArchiveProvider implements ArchiveProvider {
  constructor(
    readonly accountKey: string,
    private readonly headers: () => Promise<Record<string, string>>,
    private readonly request: typeof fetch = fetch,
    private readonly wait: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}
  private read(
    path: string,
    body?: SourceObject,
    received?: (r: Response) => void,
  ) {
    return queuedRead(() => this.readSerial(path, body, received));
  }
  private async readSerial(
    path: string,
    body?: SourceObject,
    received?: (r: Response) => void,
  ) {
    // Only callers below construct paths. No arbitrary URL, mutation method, or redirect support.
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await this.request(`https://api.quickmanage.com${path}`, {
          method: body ? "POST" : "GET",
          headers: {
            ...(await this.headers()),
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          cache: "no-store",
        });
      } catch {
        if (attempt === 2)
          throw new ArchiveProviderError("PROVIDER_UNAVAILABLE");
        await this.wait(500 * (attempt + 1));
        continue;
      }
      if (response.status === 401 || response.status === 403)
        throw new ArchiveProviderError("AUTHENTICATION_REQUIRED");
      if (response.status === 429 || response.status >= 500) {
        const raw = response.headers.get("retry-after"),
          seconds = raw && /^\d+$/.test(raw) ? Number(raw) : null;
        const delay =
          seconds !== null
            ? seconds * 1000
            : raw
              ? Math.max(0, Date.parse(raw) - Date.now())
              : 1000 * (attempt + 1);
        if (attempt === 2 || !Number.isFinite(delay) || delay > 5000)
          throw new ArchiveProviderError("PROVIDER_RETRY_LATER");
        await this.wait(delay);
        continue;
      }
      if (!response.ok)
        throw new ArchiveProviderError(
          response.status === 404 ? "SOURCE_NOT_FOUND" : "PROVIDER_READ_FAILED",
        );
      received?.(response);
      const limit = path.includes("/download?")
        ? 20 * 1024 * 1024
        : 10 * 1024 * 1024;
      if (Number(response.headers.get("content-length") || 0) > limit)
        throw new ArchiveProviderError("SOURCE_TOO_LARGE");
      const reader = response.body?.getReader();
      if (!reader) throw new ArchiveProviderError("EMPTY_SOURCE");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new ArchiveProviderError("SOURCE_TOO_LARGE");
        }
        chunks.push(value);
      }
      return new Uint8Array(Buffer.concat(chunks));
    }
    throw new ArchiveProviderError("PROVIDER_RETRY_LATER");
  }
  async companies() {
    const value = parseSource(await this.read("/api/carriers")).data;
    if (!Array.isArray(value))
      throw new ArchiveProviderError("INVALID_COMPANY_INVENTORY");
    return value.map(object);
  }
  async inventory(companyId: string, pid: string): Promise<InventoryResult> {
    uuid(companyId);
    if (!/^\d{4}-\d{2}$/.test(pid))
      throw new FinancialValidationError("Valid PID required.");
    const body = {
      carrier_id: companyId,
      keyword: "",
      statuses: [],
      roles: [],
      tag_ids: [],
      exclude_tags: null,
      page: 0,
      contractor: null,
    };
    const scan = async () => {
      const count = integer(
        object(
          parseSource(await this.read("/api/payroll/statements/stats", body))
            .data,
        ).count,
      );
      const items: SourceObject[] = [],
        pages: { page: number; checksum: string; count: number }[] = [];
      let terminal = false;
      for (let page = 0; page < 80; page++) {
        const bytes = await this.read(`/api/payroll/statements?page=${page}`, {
          ...body,
          page,
        });
        const data = object(parseSource(bytes).data);
        if (!Array.isArray(data.items) || typeof data.has_more !== "boolean")
          throw new ArchiveProviderError("INVALID_INVENTORY");
        pages.push({ page, checksum: hash(bytes), count: data.items.length });
        for (const value of data.items) {
          const x = object(value);
          if (x.carrier_id !== companyId)
            throw new ArchiveProviderError("COMPANY_MISMATCH");
          uuid(x.statement_id);
          uuid(x.driver_id);
          integer(x.version);
          if (
            !/^\d{6}$/.test(String(x.batch_id)) ||
            typeof x.contractor !== "boolean"
          )
            throw new ArchiveProviderError("INVALID_INVENTORY");
          items.push(x);
        }
        if (!data.has_more) {
          terminal = true;
          break;
        }
        if (!data.items.length)
          throw new ArchiveProviderError("EMPTY_NONTERMINAL_PAGE");
        await this.wait(100);
      }
      if (
        !terminal ||
        items.length !== count ||
        new Set(items.map((x) => x.statement_id)).size !== count
      )
        throw new ArchiveProviderError("INVENTORY_INCOMPLETE");
      return { items, pages, count, fingerprint: inventoryFingerprint(items) };
    };
    const first = await scan(),
      second = await scan();
    if (first.fingerprint !== second.fingerprint)
      throw new ArchiveProviderError("INVENTORY_CHANGED");
    const items = second.items.filter(
      (x) => String(x.batch_id) === pid.replace("-", ""),
    );
    return {
      items,
      fingerprint: inventoryFingerprint(items),
      metadata: {
        provider: "QUICKMANAGE",
        companyId,
        pid,
        filters: body,
        companyCount: second.count,
        companyFingerprint: second.fingerprint,
        firstPages: first.pages,
        secondPages: second.pages,
        verifiedTwice: true,
      },
    };
  }
  async bundle(companyId: string, statementId: string) {
    uuid(companyId);
    uuid(statementId);
    const path = `/api/payroll/${statementId}?carrier_id=${companyId}`;
    let originalFilename: string | undefined;
    const detail = await this.read(path),
      pdf = await this.read(
        `/api/payroll/${statementId}/download?carrier_id=${companyId}`,
        undefined,
        (r) => {
          const disposition = r.headers.get("content-disposition") ?? "";
          const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
          try {
            originalFilename = encoded
              ? decodeURIComponent(encoded)
              : disposition.match(/filename="([^"]+)"/i)?.[1];
          } catch {
            originalFilename = undefined;
          }
        },
      ),
      after = await this.read(path);
    if (
      statementBusinessFingerprint(detail) !==
      statementBusinessFingerprint(after)
    )
      throw new ArchiveProviderError("SOURCE_CHANGED_DURING_CAPTURE");
    if (str(object(parseSource(detail).data).statement_id) !== statementId)
      throw new ArchiveProviderError("STATEMENT_MISMATCH");
    if (Buffer.from(pdf.slice(0, 5)).toString() !== "%PDF-")
      throw new ArchiveProviderError("INVALID_PDF");
    return { detail, pdf, originalFilename };
  }
}
export function archiveProviderConfigured() {
  return (
    process.env.QUICKMANAGE_ARCHIVE_ENABLED === "true" &&
    Boolean(process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID) &&
    Boolean(process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY) &&
    quickManageClient.isConfigured()
  );
}
export function liveArchiveProvider(operatingGroupId: string): ArchiveProvider {
  if (!archiveProviderConfigured())
    throw new ArchiveProviderError("ARCHIVE_CONNECTION_DISABLED");
  if (process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID !== operatingGroupId)
    throw new AuthorizationDeniedError();
  return new QuickManageArchiveProvider(
    process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY!,
    async () => ({
      Authorization: `Bearer ${(await quickManageClient.getAccessToken()).accessToken}`,
    }),
  );
}
