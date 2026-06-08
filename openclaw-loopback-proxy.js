const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const [, , remoteHost, remotePortRaw, ownerPath, runId] = process.argv;
const remotePort = Number.parseInt(remotePortRaw || "18789", 10);
const localHost = "127.0.0.1";
const localPort = 18789;
const logDir = path.join(os.homedir(), ".openclaw", "logs");
const logPath = path.join(logDir, "loopback-proxy.log");

function log(message) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
  }
}

function ownerStillCurrent() {
  if (!ownerPath || !runId) return true;
  try {
    return fs.readFileSync(ownerPath, "utf8").trim() === runId;
  } catch {
    return false;
  }
}

function closeSocket(socket) {
  if (!socket) return;
  try {
    socket.destroy();
  } catch {
  }
}

if (!remoteHost || !Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) {
  log(`invalid arguments remoteHost=${remoteHost || ""} remotePort=${remotePortRaw || ""}`);
  process.exit(2);
}

const server = net.createServer((client) => {
  client.setKeepAlive(true, 10000);
  client.setNoDelay(true);

  const upstream = net.connect({ host: remoteHost, port: remotePort }, () => {
    upstream.setKeepAlive(true, 10000);
    upstream.setNoDelay(true);
    client.pipe(upstream);
    upstream.pipe(client);
  });

  client.on("error", () => closeSocket(upstream));
  upstream.on("error", (error) => {
    log(`upstream error ${remoteHost}:${remotePort}: ${error.message}`);
    closeSocket(client);
  });
  client.on("close", () => closeSocket(upstream));
  upstream.on("close", () => closeSocket(client));
});

server.on("error", (error) => {
  log(`listen error ${localHost}:${localPort}: ${error.message}`);
  process.exit(1);
});

server.listen(localPort, localHost, () => {
  log(`listening ${localHost}:${localPort} -> ${remoteHost}:${remotePort}`);
});

const ownerTimer = setInterval(() => {
  if (ownerStillCurrent()) return;
  log("owner changed; exiting");
  clearInterval(ownerTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}, 5000);

function shutdown(signal) {
  log(`${signal} received; exiting`);
  clearInterval(ownerTimer);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
