/** Local acquisition only. No FleetPilot network calls, cookies, tokens or storage exports. */
import { chromium, type APIResponse } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  hash,
  object,
  parseSource,
  uuid,
} from "../src/lib/finance/archive-normalize";
import {
  BRIDGE_FORMAT,
  businessOnly,
  pidValue,
  validateBundle,
  validateCatalog,
  validateInventory,
} from "../src/lib/finance/archive-bridge-validation";

const args = process.argv.slice(2);
const arg = (key: string) => args[args.indexOf(key) + 1];
async function main() {
  const mode = arg("--mode"),
    output = arg("--out");
  if (
    !args.includes("--mode") ||
    !["companies", "inventory", "statement"].includes(mode) ||
    !args.includes("--out")
  )
    throw Error(
      "Usage: npx tsx scripts/quickmanage-browser-export.ts --mode companies|inventory|statement --out private-file.json [--company UUID --pid YYYY-WW --statement UUID]",
    );
  const endpoint = args.includes("--cdp")
    ? arg("--cdp")
    : "http://127.0.0.1:9222";
  const url = new URL(endpoint);
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.protocol !== "http:"
  )
    throw Error("Only a local browser debugging connection is accepted.");
  const companyId = mode === "companies" ? null : uuid(arg("--company")),
    pid = mode === "companies" ? null : pidValue(arg("--pid"));
  const browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  if (!context)
    throw Error("Open and authenticate QuickManage directly first.");
  const page = await context.newPage();
  try {
    await page.route("https://api.quickmanage.com/**", (route) => {
      const r = route.request(),
        u = new URL(r.url());
      return ["GET", "HEAD", "OPTIONS"].includes(r.method()) ||
        (r.method() === "POST" &&
          /^\/api\/payroll\/statements(?:\/stats)?$/.test(u.pathname))
        ? route.continue()
        : route.abort();
    });
    const pending = page.waitForRequest(
      (r) =>
        r
          .url()
          .startsWith("https://api.quickmanage.com/api/payroll/statements?") &&
        r.method() === "POST",
      { timeout: 20000 },
    );
    await page.goto(
      "https://app.quickmanage.com/accounts/payroll/all-statements",
    );
    const observed = await (await pending).allHeaders();
    // Session authorization stays in this process and is sent only to the fixed provider origin.
    const headers = Object.fromEntries(
      Object.entries(observed).filter(
        ([k]) => !k.startsWith(":") && !["host", "content-length"].includes(k),
      ),
    );
    async function read(
      resource: string,
      body?: unknown,
    ): Promise<APIResponse> {
      if (
        !/^\/api\/(carriers$|payroll\/(statements(?:\?page=\d+|\/stats)?$|[0-9a-f-]{36}(?:\/download)?\?carrier_id=[0-9a-f-]{36}$))/.test(
          resource,
        )
      )
        throw Error("Unapproved provider read path.");
      const r = await context.request.fetch(
        "https://api.quickmanage.com" + resource,
        {
          method: body ? "POST" : "GET",
          headers,
          ...(body ? { data: body } : {}),
          maxRedirects: 0,
          timeout: 15000,
        },
      );
      if (!r.ok())
        throw Error(
          "Provider read unavailable; sign in directly or review source permissions.",
        );
      return r;
    }
    async function json(resource: string, body?: unknown) {
      const r = await read(resource, body);
      const bytes = await r.body();
      if (bytes.length > 10 * 1024 * 1024)
        throw Error("Provider JSON too large.");
      const v = parseSource(bytes);
      await r.dispose();
      return v;
    }
    const query = (c: string, page = 0) => ({
      carrier_id: c,
      keyword: "",
      statuses: [],
      roles: [],
      tag_ids: [],
      exclude_tags: null,
      page,
      contractor: null,
    });
    let evidence: unknown;
    if (mode === "companies") {
      const data = (await json("/api/carriers")).data;
      if (!Array.isArray(data) || data.length > 100)
        throw Error("Invalid Company list.");
      const companies = [];
      for (const v of data) {
        const c = object(v),
          id = uuid(c.id),
          stats = object(
            (await json("/api/payroll/statements/stats", query(id))).data,
          );
        companies.push({
          id,
          carrier_name: c.carrier_name,
          status: c.status,
          statementCount: stats.count,
          earliestPid: null,
          latestPid: null,
          dot_number: c.dot_number ?? null,
          mc_number: c.mc_number ?? null,
        });
      }
      evidence = {
        format: BRIDGE_FORMAT,
        kind: "companies",
        provider: "QUICKMANAGE",
        companies,
      };
      validateCatalog(evidence);
    } else if (mode === "inventory") {
      const scan = async () => {
        const stats = object(
          (await json("/api/payroll/statements/stats", query(companyId!))).data,
        );
        const all: ReturnType<typeof object>[] = [];
        let complete = false;
        for (let page = 0; page < 80; page++) {
          const d = object(
            (
              await json(
                "/api/payroll/statements?page=" + page,
                query(companyId!, page),
              )
            ).data,
          );
          if (!Array.isArray(d.items) || typeof d.has_more !== "boolean")
            throw Error("Invalid inventory page.");
          for (const raw of d.items) {
            const x = object(raw);
            if (x.carrier_id !== companyId)
              throw Error("Mixed Company inventory.");
            all.push(x);
          }
          if (!d.has_more) {
            complete = true;
            break;
          }
        }
        if (
          !complete ||
          all.length !== Number(stats.count) ||
          new Set(all.map((x) => x.statement_id)).size !== all.length
        )
          throw Error("Incomplete/unstable Company pagination.");
        const keys = [
          "carrier_id",
          "statement_id",
          "version",
          "batch_id",
          "driver_id",
          "contractor",
          "first_name",
          "last_name",
          "truck_unit_id",
          "role",
          "status",
          "gross",
          "deductions",
          "net_pay",
          "payout",
          "updated_date",
          "start_date",
          "end_date",
        ];
        return all
          .filter((x) => String(x.batch_id) === pid!.replace("-", ""))
          .map((x) =>
            Object.fromEntries(
              keys.filter((k) => x[k] !== undefined).map((k) => [k, x[k]]),
            ),
          )
          .sort((a, b) =>
            String(a.statement_id).localeCompare(String(b.statement_id)),
          );
      };
      const first = await scan(),
        second = await scan();
      if (JSON.stringify(first) !== JSON.stringify(second))
        throw Error("Inventory changed. Repeat the read.");
      evidence = {
        format: BRIDGE_FORMAT,
        kind: "inventory",
        provider: "QUICKMANAGE",
        companyId,
        pid,
        items: first,
        verifiedTwice: true,
      };
      validateInventory(evidence);
    } else {
      const statementId = uuid(arg("--statement")),
        resource = "/api/payroll/" + statementId + "?carrier_id=" + companyId;
      const before = await read(resource),
        detail = await before.body();
      await before.dispose();
      if (detail.length > 10 * 1024 * 1024) throw Error("Detail too large.");
      businessOnly(parseSource(detail));
      const pdfResponse = await read(
        "/api/payroll/" + statementId + "/download?carrier_id=" + companyId,
      );
      const mimeType = pdfResponse.headers()["content-type"]?.split(";")[0],
        pdf = await pdfResponse.body();
      await pdfResponse.dispose();
      if (pdf.length > 20 * 1024 * 1024) throw Error("PDF too large.");
      const after = await read(resource),
        afterBytes = await after.body();
      await after.dispose();
      if (hash(detail) !== hash(afterBytes))
        throw Error("Statement changed during acquisition.");
      evidence = {
        format: BRIDGE_FORMAT,
        kind: "statement",
        provider: "QUICKMANAGE",
        companyId,
        pid,
        statementId,
        version: object(parseSource(detail).data).version,
        detailBase64: detail.toString("base64"),
        pdfBase64: pdf.toString("base64"),
        detailAfterSha256: hash(afterBytes),
        pdfSha256: hash(pdf),
        mimeType,
      };
      validateBundle(evidence);
    }
    await mkdir(path.dirname(path.resolve(output)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(output, JSON.stringify(evidence), {
      mode: 0o600,
      flag: "wx",
    });
    console.log(
      "Validated evidence exported. Upload it from FleetPilot Statements → Capture.",
    );
  } finally {
    await page.close();
    await browser.close();
  }
}
main().catch(() => {
  console.error(
    "Export failed. No credentials were saved. Check the command, source session, output path and provider contract; existing exports are never overwritten.",
  );
  process.exitCode = 1;
});
