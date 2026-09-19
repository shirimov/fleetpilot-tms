import { randomUUID } from "node:crypto";
import { hash, type SourceObject } from "@/lib/finance/archive-normalize";
import type {
  ArchiveProvider,
  InventoryResult,
} from "@/lib/finance/archive-provider";

/** Synthetic contract shapes only. No real recipient, company, PDF or provider IDs. */
export function statementFixture(
  options: {
    id?: string;
    version?: number;
    terminated?: boolean;
    contractor?: boolean;
    pdfSuffix?: string;
    pid?: string;
  } = {},
) {
  const id = options.id ?? randomUUID(),
    recipientId = randomUUID(),
    pid = options.pid ?? "2026-37";
  const payload = {
    data: {
      statement_id: id,
      driver_id: recipientId,
      batch_id: Number(pid.replace("-", "")),
      version: options.version ?? 1,
      status: "settled",
      created_date: "2026-09-17T12:00:00Z",
      updated_date: "2026-09-18T12:00:00Z",
      header: {
        driver: {
          name: "Synthetic Recipient",
          contractor: options.contractor ?? false,
          status: options.terminated ? "terminated" : "active",
          role: options.contractor ? "" : "Company Driver",
          contract_info: "Percent 18%",
          truck_info: { id: randomUUID(), unit: "8558", vin: null },
        },
        carrier: { name: "Synthetic Carrier" },
        period_info: {
          batch_id: pid,
          statement_number: 21,
          start_date: "2026-09-06T00:00:00-04:00",
          end_date: "2026-09-12T19:59:59.999-04:00",
          total_trips: 1,
          total_miles: 250,
        },
        net_pay_info: {
          gross: 1000.01,
          earning: 180,
          net_pay: -20.25,
          payout: 0,
          deductions: 200.25,
        },
      },
      trips: [
        {
          id: randomUUID(),
          trip_number: 17,
          net_amount: 180,
          excluded: false,
          unit_id: "8558",
        },
      ],
      deductions: [
        {
          id: randomUUID(),
          name: "Unclassified source charge",
          charge: 200.25,
          skipped: false,
          unit_id: "8558",
        },
        {
          id: randomUUID(),
          name: "Skipped charge",
          charge: 2.5,
          skipped: true,
        },
      ],
      fuel_transactions: [],
      earnings: [],
    },
  };
  return {
    id,
    recipientId,
    pid,
    payload,
    bundle: {
      detail: Buffer.from(JSON.stringify(payload)),
      pdf: Buffer.from(
        "%PDF-1.4\n% synthetic test evidence " +
          id +
          " " +
          (options.pdfSuffix ?? "") +
          "\n%%EOF",
      ),
    },
  };
}
export class FixtureArchiveProvider implements ArchiveProvider {
  accountKey = "synthetic-" + randomUUID();
  companyId = randomUUID();
  fixtures: ReturnType<typeof statementFixture>[] = [];
  failures = new Set<string>();
  reads = 0;
  async companies() {
    return [
      {
        id: this.companyId,
        carrier_name: "Synthetic Carrier",
        status: "inactive",
      },
    ];
  }
  async inventory(companyId: string, pid: string): Promise<InventoryResult> {
    const items: SourceObject[] = this.fixtures
      .filter((f) => f.pid === pid)
      .map((f) => ({
        carrier_id: companyId,
        statement_id: f.id,
        driver_id: f.recipientId,
        batch_id: pid.replace("-", ""),
        version: String(f.payload.data.version),
        contractor: f.payload.data.header.driver.contractor,
        first_name: "Synthetic",
        last_name: "Recipient",
        updated_date: f.payload.data.updated_date,
        deductions: "200.25",
      }));
    return {
      items,
      fingerprint: hash(
        items
          .map((x) => JSON.stringify(x))
          .sort()
          .join("\n"),
      ),
      metadata: { verifiedTwice: true, source: "synthetic", companyId, pid },
    };
  }
  async bundle(_companyId: string, id: string) {
    this.reads++;
    if (this.failures.has(id)) throw Error("Synthetic transient failure");
    const f = this.fixtures.find((x) => x.id === id);
    if (!f) throw Error("Missing fixture");
    return f.bundle;
  }
}
