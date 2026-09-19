import { statementFixture } from "./quickmanage";

// Approved sample UUIDs/versions/timestamp shapes only; all recipient, Company,
// money and PDF content is synthetic. No live source documents are fixtures.
export const acceptedStatements = [
  ["aa8cfcb3-98d0-440f-ac60-848cbaee2d94", 5, "2026-09-18T20:29:59.807237Z", 3],
  [
    "a5b383ce-4915-4e1c-9a1d-b0be9ba736e8",
    8,
    "2026-09-18T20:31:23.426609Z",
    27,
  ],
  [
    "6dabfcdb-6cf3-473e-84c8-21e00f7baf19",
    16,
    "2026-09-15T19:00:38.619549Z",
    7,
  ],
  [
    "05024dca-f6f0-4ef6-8f13-07f448f5e06a",
    17,
    "2026-09-11T19:06:04.034404Z",
    16,
  ],
  [
    "1c142977-eb13-471b-b709-04557fbba558",
    10,
    "2026-09-18T20:39:47.725261Z",
    18,
  ],
] as const;

export function acceptedStatementFixtures() {
  return acceptedStatements.map(([id, version, updated, lines], index) => {
    const f = statementFixture({
      id,
      version,
      pid: index === 2 || index === 3 ? "2026-36" : "2026-37",
      terminated: index === 2 || index === 3,
      contractor: index === 1 || index === 3,
    });
    f.payload.data.updated_date = updated;
    f.payload.data.deductions = [];
    f.payload.data.trips = Array.from({ length: lines }, (_, i) => ({
      ...f.payload.data.trips[0],
      trip_number: i,
      net_amount:
        index === 3 && i < 3
          ? [4643.6192, 442.99199999999996, 1928.3968][i]
          : 180,
    }));
    f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
    return f;
  });
}
