// Protocol fixture only. This is not antivirus software and never runs outside the isolated runner.
import net from "node:net";
const socket = process.argv[2];
if (
  !socket ||
  !socket.includes("/drivers-pr99-verify.") ||
  !socket.endsWith("/clamd.sock")
)
  throw new Error("Disposable socket required");
const server = net.createServer((client) => {
  let pending = Buffer.alloc(0),
    started = false,
    content = Buffer.alloc(0);
  client.on("error", () => {});
  client.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    if (!started) {
      if (pending.length < 10) return;
      if (pending.subarray(0, 10).toString() !== "zINSTREAM\0")
        return client.destroy();
      pending = pending.subarray(10);
      started = true;
    }
    while (pending.length >= 4) {
      const size = pending.readUInt32BE(0);
      if (size > 10485760) return client.destroy();
      if (pending.length < 4 + size) return;
      if (!size) {
        const text = content.toString();
        client.end(
          text.includes("SIMULATE-INFECTED")
            ? "stream: Synthetic.Test FOUND\0"
            : text.includes("SIMULATE-ERROR")
              ? "stream: scanner unavailable ERROR\0"
              : "stream: OK\0",
        );
        return;
      }
      content = Buffer.concat([content, pending.subarray(4, 4 + size)]);
      pending = pending.subarray(4 + size);
    }
  });
});
server.listen(socket, () => console.log("simulator ready"));
process.on("SIGTERM", () => server.close(() => process.exit()));
