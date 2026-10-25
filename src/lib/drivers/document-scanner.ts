import net from "node:net";

export type ScanReceipt = {
  status: "CLEAN" | "INFECTED" | "ERROR" | "UNSCANNED";
  engine: string;
  scannedAt: Date | null;
};
export class DriverStorageUnavailableError extends Error {}

// ClamAV INSTREAM protocol. Only a local Unix socket is supported: no public scanner transport.
export async function scanDocument(bytes: Uint8Array): Promise<ScanReceipt> {
  const socketPath = process.env.DRIVERS_CLAMD_SOCKET;
  if (!socketPath)
    return {
      status: process.env.NODE_ENV === "production" ? "ERROR" : "UNSCANNED",
      engine: "not-configured",
      scannedAt: null,
    };
  if (!socketPath.startsWith("/") || socketPath.length > 100)
    return { status: "ERROR", engine: "clamd", scannedAt: null };
  return new Promise((resolve) => {
    const socket = net.createConnection({ path: socketPath });
    let response = "",
      finished = false;
    const finish = (status: ScanReceipt["status"]) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve({
        status,
        engine: "clamd",
        scannedAt:
          status === "CLEAN" || status === "INFECTED" ? new Date() : null,
      });
    };
    const deadline = setTimeout(() => finish("ERROR"), 15000);
    socket.on("error", () => finish("ERROR"));
    socket.on("end", () => {
      if (!finished) finish("ERROR");
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.length > 4096) return finish("ERROR");
      if (!response.includes("\0")) return;
      const answer = response.split("\0")[0];
      finish(
        answer === "stream: OK"
          ? "CLEAN"
          : /^stream: .+ FOUND$/.test(answer)
            ? "INFECTED"
            : "ERROR",
      );
    });
    socket.on("connect", async () => {
      try {
        const write = (chunk: Uint8Array) =>
          new Promise<void>((ok, fail) =>
            socket.write(chunk, (error) => (error ? fail(error) : ok())),
          );
        await write(Buffer.from("zINSTREAM\0"));
        for (
          let offset = 0;
          offset < bytes.length && !finished;
          offset += 65536
        ) {
          const chunk = bytes.subarray(offset, offset + 65536),
            size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length);
          await write(size);
          await write(chunk);
        }
        if (!finished) await write(Buffer.alloc(4));
      } catch {
        finish("ERROR");
      }
    });
  });
}

export function requireCleanDownload(version: {
  scanStatus: string;
  scannedAt: Date | null;
}) {
  if (
    (process.env.NODE_ENV === "production" ||
      process.env.DRIVERS_REQUIRE_CLEAN_SCAN === "true") &&
    (version.scanStatus !== "CLEAN" || !version.scannedAt)
  )
    throw new DriverStorageUnavailableError(
      "Document requires a verified clean scan.",
    );
}
