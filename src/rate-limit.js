// In-process failure throttling.
//
// The invitation redeem route is unauthenticated, so it is the only place where
// an anonymous caller can (a) enumerate codes and (b) guess the name bound to a
// used code to hijack that guest's identity and recordings. Counters live in
// memory: the web server is a single process, and a restart simply clears the
// throttle. State is keyed on the client address or the invitation record id,
// never on anything the caller can reset.

// Behind the site proxy the socket peer is loopback and the caller's address
// arrives in a forwarding header. Those headers are honoured only for a
// loopback peer, so a client that reaches the app directly cannot spoof its way
// around the per-IP throttle.
const loopbackV4 = /^(?:::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function isLoopback(address) {
  const value = String(address || "").split("%")[0];
  if (!value) return false;
  return value === "::1" || loopbackV4.test(value);
}

function firstHeaderAddress(value) {
  const candidate = String(value || "").split(",")[0].trim();
  return candidate && candidate.length <= 45 ? candidate : "";
}

function clientIp(req) {
  const peer = String(req.socket?.remoteAddress || "");
  if (isLoopback(peer)) {
    const real = firstHeaderAddress(req.get?.("x-real-ip"));
    if (real) return real;
    const forwarded = firstHeaderAddress(req.get?.("x-forwarded-for"));
    if (forwarded) return forwarded;
  }
  return peer || "unknown";
}

// A failure budget: the first `limit` failures inside `windowMs` are free. The
// next one starts a cooldown that grows with each repeat offence, so an ongoing
// attacker converges on `blockMaxMs` while an honest user who mistyped a name
// waits only briefly.
function createFailureLimiter({
  limit,
  windowMs,
  blockBaseMs,
  blockGrowth = 3,
  blockMaxMs,
  maxKeys = 5000,
  now = Date.now,
}) {
  const entries = new Map();

  function sweep(reference) {
    if (entries.size <= maxKeys) return;
    for (const [key, entry] of entries) {
      const idle = entry.failures.every((at) => at <= reference - windowMs);
      if (idle && entry.blockedUntil <= reference) entries.delete(key);
    }
    if (entries.size <= maxKeys) return;
    // Still over budget means many distinct offenders are active at once. Evict
    // the least recently seen keys so the map cannot grow without bound.
    const oldestFirst = [...entries.entries()].sort((left, right) => left[1].lastSeen - right[1].lastSeen);
    for (const [key] of oldestFirst.slice(0, entries.size - maxKeys)) entries.delete(key);
  }

  function prune(entry, reference) {
    const cutoff = reference - windowMs;
    if (entry.failures.some((at) => at <= cutoff)) {
      entry.failures = entry.failures.filter((at) => at > cutoff);
    }
  }

  function check(key) {
    const entry = entries.get(key);
    if (!entry) return { blocked: false, retryAfterSeconds: 0 };
    const reference = now();
    if (entry.blockedUntil <= reference) return { blocked: false, retryAfterSeconds: 0 };
    return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - reference) / 1000)) };
  }

  function fail(key) {
    const reference = now();
    let entry = entries.get(key);
    if (!entry) {
      entry = { failures: [], blockedUntil: 0, strikes: 0, lastSeen: reference };
      entries.set(key, entry);
    }
    entry.lastSeen = reference;
    prune(entry, reference);
    entry.failures.push(reference);
    if (entry.failures.length < limit) {
      sweep(reference);
      return { blocked: false, retryAfterSeconds: 0 };
    }
    const blockMs = Math.min(blockMaxMs, blockBaseMs * blockGrowth ** entry.strikes);
    entry.strikes += 1;
    entry.blockedUntil = reference + blockMs;
    entry.failures = [];
    sweep(reference);
    return { blocked: true, retryAfterSeconds: Math.ceil(blockMs / 1000) };
  }

  return {
    check,
    fail,
    reset(key) { entries.delete(key); },
    size() { return entries.size; },
  };
}

module.exports = { clientIp, createFailureLimiter, isLoopback };
