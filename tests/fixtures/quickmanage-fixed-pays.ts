import { statementFixture } from "./quickmanage";

/** Diagnosed v14 fixed-pay shape; all recipient/truck/PDF data is synthetic. */
export function fixedPaysFixture() {
  const fixture = statementFixture({
    id: "7cf5f4a2-8626-4808-bf03-0f3e9218efdd",
    version: 14,
    terminated: true,
    pid: "2026-03",
  });
  const payload = {
    ...fixture.payload,
    data: {
      ...fixture.payload.data,
      fixed_pays: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ].map((day) => ({
        day,
        type: "FP",
        amount: day === "Sunday" ? 0 : 35.71,
        worked_unit: day === "Sunday" ? 0 : 1,
      })),
    },
  };
  return {
    ...fixture,
    payload,
    bundle: { ...fixture.bundle, detail: Buffer.from(JSON.stringify(payload)) },
  };
}
