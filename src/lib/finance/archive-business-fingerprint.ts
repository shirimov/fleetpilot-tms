import { createHash } from "node:crypto";
import { FinancialValidationError } from "./financial-control-errors";

// Versioned comparison only. Never serialize this representation into raw evidence storage.
export const BUSINESS_FINGERPRINT_VERSION = "quickmanage-fixed-pays-v1";
type Node =
  | ["object", [string, Node][]]
  | ["array", Node[]]
  | ["string" | "number" | "literal", string];
const fail = (): never => {
  throw new FinancialValidationError(
    "Invalid statement business comparison source.",
  );
};
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Strict, bounded lossless JSON tree. Numeric lexemes retain precision AND type.
 * JSON.parse alone rounds large/fractional numbers; parseSource converts numbers
 * to strings. Neither is sufficient for a fail-closed comparison fingerprint.
 */
function tree(bytes: Uint8Array): Node {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) fail();
  let input: string;
  try {
    input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail();
  }
  const token =
    /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/y;
  let offset = 0;
  const whitespace = () => {
    while (/[ \t\r\n]/.test(input[offset] ?? "!") && offset < input.length)
      offset++;
  };
  const next = () => {
    whitespace();
    token.lastIndex = offset;
    const match = token.exec(input);
    if (!match) return fail();
    offset = token.lastIndex;
    return match[0];
  };
  const peek = () => {
    whitespace();
    return input[offset];
  };
  const read = (depth: number): Node => {
    if (depth > 40) fail();
    const t = next();
    if (t === "{") {
      const entries: [string, Node][] = [],
        keys = new Set<string>();
      if (peek() !== "}")
        for (;;) {
          const keyToken = next();
          if (!keyToken.startsWith('"')) fail();
          const key: string = JSON.parse(keyToken);
          if (keys.has(key) || next() !== ":") fail();
          keys.add(key);
          entries.push([key, read(depth + 1)]);
          if (peek() === "}") break;
          if (next() !== ",") fail();
        }
      if (next() !== "}") fail();
      entries.sort((a, b) => compare(a[0], b[0]));
      return ["object", entries];
    }
    if (t === "[") {
      const values: Node[] = [];
      if (peek() !== "]")
        for (;;) {
          if (values.length >= 5000) fail();
          values.push(read(depth + 1));
          if (peek() === "]") break;
          if (next() !== ",") fail();
        }
      if (next() !== "]") fail();
      return ["array", values];
    }
    if (t.startsWith('"')) return ["string", JSON.parse(t)];
    if (/^-?\d/.test(t)) return ["number", t];
    if (["true", "false", "null"].includes(t)) return ["literal", t];
    return fail();
  };
  const result = read(0);
  whitespace();
  if (offset !== input.length) fail();
  return result;
}
const field = (node: Node | undefined, key: string) =>
  node?.[0] === "object"
    ? node[1].find(([name]) => name === key)?.[1]
    : undefined;

/** Only data.fixed_pays is unordered. Sort by weekday rank, then complete typed
 * canonical row as the tie-breaker. No row is deduplicated, summed or rounded;
 * duplicate weekdays and identical rows retain their full multiplicity. Unknown
 * row fields participate in the tie-breaker and fingerprint, never disappear.
 */
export function statementBusinessFingerprint(bytes: Uint8Array): string {
  const value = tree(bytes),
    fixed = field(field(value, "data"), "fixed_pays");
  if (fixed && !(fixed[0] === "literal" && fixed[1] === "null")) {
    if (fixed[0] !== "array") return fail();
    const days = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const rows = fixed[1].map((row) => {
      const day = field(row, "day");
      if (!day || day[0] !== "string" || !days.includes(day[1])) return fail();
      return { row, day: days.indexOf(day[1]), key: JSON.stringify(row) };
    });
    rows.sort((a, b) => a.day - b.day || compare(a.key, b.key));
    fixed[1] = rows.map((x) => x.row);
  }
  return createHash("sha256")
    .update(BUSINESS_FINGERPRINT_VERSION + ":" + JSON.stringify(value))
    .digest("hex");
}
