const assert = require("node:assert/strict");
const test = require("node:test");
const { createMemoryReader } = require("../src/memory");

test("macOS cache usage does not falsely signal low memory, and queries are cached", () => {
  let time = 10000;
  let calls = 0;
  let percent = 26;
  const read = createMemoryReader({ platform: "darwin", free: () => 220 * 1024 ** 2, total: () => 16 * 1024 ** 3, now: () => time, exec: (file, args) => {
    assert.equal(file, "/usr/bin/memory_pressure");
    assert.deepEqual(args, ["-Q"]);
    calls++;
    return `System-wide memory free percentage: ${percent}%`;
  } });
  assert.ok(read() > 512 * 1024 ** 2);
  read();
  assert.equal(calls, 1);
  time += 5000;
  percent = 1;
  assert.ok(read() < 512 * 1024 ** 2);
  assert.equal(calls, 2);
});

test("macOS query failures and malformed output retain the conservative fallback", () => {
  for (const exec of [() => { throw new Error("timeout"); }, () => "unknown", () => "System-wide memory free percentage: 101%"]) {
    assert.equal(createMemoryReader({ platform: "darwin", free: () => 123, exec })(), 123);
  }
});

test("Linux still uses MemAvailable and other systems use freemem", () => {
  assert.equal(createMemoryReader({ platform: "linux", read: () => "MemFree: 100 kB\nMemAvailable: 2000 kB\n", free: () => 123 })(), 2000 * 1024);
  assert.equal(createMemoryReader({ platform: "linux", read: () => "MemFree: 100 kB", free: () => 123 })(), 123);
  assert.equal(createMemoryReader({ platform: "win32", free: () => 123 })(), 123);
});
