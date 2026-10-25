import net from "node:net";
import readline from "node:readline";
const connections = new Map();
function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "open") {
    const socket = net.createConnection(5432, "fleetpilot-drivers-pr99-verify");
    connections.set(message.id, socket);
    socket.on("data", (bytes) =>
      send({ type: "data", id: message.id, bytes: bytes.toString("base64") }),
    );
    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      connections.delete(message.id);
      send({ type: "end", id: message.id });
    });
  } else if (message.type === "data")
    connections.get(message.id)?.write(Buffer.from(message.bytes, "base64"));
  else if (message.type === "end") connections.get(message.id)?.destroy();
});
send({ type: "ready" });
