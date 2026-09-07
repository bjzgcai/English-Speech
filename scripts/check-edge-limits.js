#!/usr/bin/env node
// Runs a separate nginx with a synthetic backend; never reloads production nginx.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawnSync } = require("node:child_process");
const assert = require("node:assert/strict");
const { once } = require("node:events");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ee-edge-test-"));
  const pending = new Set();
  let received = 0;
  const backend = http.createServer((req, res) => {
    received++;
    req.resume();
    if (req.url === "/hold") { pending.add(res); res.on("close", () => pending.delete(res)); }
    else res.end("ok");
  });
  backend.listen(0, "127.0.0.1"); await once(backend, "listening");
  const freePort = async () => {
    const server = http.createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
  };
  const port = await freePort();
  const redirectPort = await freePort();
  const config = path.join(dir, "nginx.conf");
  const policy = fs.readFileSync(path.join(__dirname, "../ops/nginx-englisheval.conf"), "utf8")
    .replace(/listen 80;/g, `listen 127.0.0.1:${redirectPort};`)
    .replace(/listen 443 ssl;/g, `listen 127.0.0.1:${port};`)
    .replace(/^\s*(listen \[::\].*|http2 on;|ssl_.*)$/gm, "")
    .replace("127.0.0.1:3199", `127.0.0.1:${backend.address().port}`);
  fs.writeFileSync(config, `pid ${dir}/nginx.pid; error_log ${dir}/error.log; events { worker_connections 1024; } http { access_log off; client_body_temp_path ${dir}/body; proxy_temp_path ${dir}/proxy; ${policy} }`);
  const nginx = args => {
    const result = spawnSync("nginx", ["-p", dir, "-c", config, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  };
  const request = (route, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: route, method, agent: false,
      headers: { "X-Forwarded-For": `192.0.2.${Math.floor(Math.random() * 200)}`, Cookie: `englisheval_guest=forged-${Math.random()}` } }, res => {
      let body = ""; res.on("data", value => { body += value; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject); req.setTimeout(10000, () => req.destroy(new Error("Test timeout"))); req.end();
  });
  let started = false;
  try {
    nginx(["-t"]); nginx([]); started = true;
    const normal = await Promise.all(Array.from({ length: 50 }, () => request("/api/health")));
    assert.ok(normal.every(res => res.status === 200));
    const before = received;
    const burst = await Promise.all(Array.from({ length: 300 }, () => request("/api/admission", "POST")));
    const rejected = burst.filter(res => res.status === 429);
    assert.ok(rejected.length >= 100);
    assert.ok(received - before <= 105, `Too many entries forwarded: ${received - before}`);
    for (const res of rejected) {
      assert.equal(res.headers["retry-after"], "5");
      assert.equal(JSON.parse(res.body).code, "EDGE_BUSY");
    }
    const held = Array.from({ length: 140 }, () => request("/hold"));
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok(pending.size > 0 && pending.size <= 128);
    for (const res of pending) res.end("released");
    const connections = await Promise.all(held);
    assert.ok(connections.some(res => res.status === 429));
    console.log(JSON.stringify({ normal: normal.length, burst: burst.length, rejected: rejected.length, forwarded: burst.length - rejected.length, connectionRejected: connections.filter(res => res.status === 429).length }));
  } finally {
    for (const res of pending) res.end();
    if (started) nginx(["-s", "quit"]);
    backend.closeAllConnections(); await new Promise(resolve => backend.close(resolve));
    fs.rmSync(dir, { force: true, recursive: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
