import net from "node:net";
import { spawn } from "node:child_process";
import readline from "node:readline";
const sockets = new Map();
let id = 0;
const relay = spawn("docker", [
  "exec",
  "-i",
  "fleetpilot-drivers-pr99-relay",
  "node",
  "/relay.mjs",
]);
function send(message) {
  relay.stdin.write(JSON.stringify(message) + "\n");
}
const server = net.createServer((socket) => {
  const key = ++id;
  sockets.set(key, socket);
  send({ type: "open", id: key });
  socket.on("data", (bytes) =>
    send({ type: "data", id: key, bytes: bytes.toString("base64") }),
  );
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    sockets.delete(key);
    send({ type: "end", id: key });
  });
});
readline.createInterface({ input: relay.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "ready")
    server.listen(15439, "127.0.0.1", () =>
      console.log("Disposable PR99 PostgreSQL relay ready on loopback 15439"),
    );
  else if (message.type === "data")
    sockets.get(message.id)?.write(Buffer.from(message.bytes, "base64"));
  else if (message.type === "end") sockets.get(message.id)?.destroy();
});
relay.stderr.pipe(process.stderr);
relay.on("exit", () => process.exit(1));
process.on("SIGINT", () => {
  for (const socket of sockets.values()) socket.destroy();
  relay.kill();
  server.close();
  process.exit(0);
});
