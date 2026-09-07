class DingSender {
  constructor({ clientId, clientSecret, robotCode, userId, fetchImpl = fetch, now = Date.now, timeoutMs = 10000 }) {
    Object.assign(this, { clientId, clientSecret, robotCode, userId, fetchImpl, now, timeoutMs });
    this.token = null;
  }
  async send(content) {
    if (!this.clientId || !this.clientSecret || !this.robotCode || !this.userId) return { status: "failed", code: "credentials_missing" };
    // Failure obtaining a token cannot have delivered a DING.
    if (!this.token || this.token.expires <= this.now()) {
      try {
        const response = await this.fetchImpl("https://api.dingtalk.com/v1.0/oauth2/accessToken", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appKey: this.clientId, appSecret: this.clientSecret }), signal: AbortSignal.timeout(this.timeoutMs),
        });
        const body = await response.json();
        if (!response.ok || typeof body.accessToken !== "string") return { status: response.status === 429 || response.status >= 500 ? "retry" : "failed", code: "token_unavailable", httpStatus: response.status, retryMs: retryAfter(response, this.now()) };
        this.token = { value: body.accessToken, expires: this.now() + Math.max(1, Number(body.expireIn || 7200) - 120) * 1000 };
      } catch { return { status: "retry", code: "token_network_failure", retryMs: 30000 }; }
    }
    try {
      const response = await this.fetchImpl("https://api.dingtalk.com/v1.0/robot/ding/send", {
        method: "POST", headers: { "Content-Type": "application/json", "x-acs-dingtalk-access-token": this.token.value },
        body: JSON.stringify({ robotCode: this.robotCode, remindType: 1, receiverUserIdList: [this.userId], content }), signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await response.json();
      const failed = body.failedList && Object.values(body.failedList).some(users => Array.isArray(users) && users.includes(this.userId));
      if (response.ok && typeof body.openDingId === "string" && body.openDingId && !failed) return { status: "sent", openDingId: body.openDingId };
      if (failed) return { status: "failed", code: "recipient_failed", openDingId: body.openDingId || null };
      if (!body.openDingId && (response.status === 429 || (response.status === 400 && body.code === "toomuch.msg"))) return { status: "retry", code: "rate_limited", httpStatus: response.status, retryMs: retryAfter(response, this.now()) };
      if (response.status === 401) this.token = null;
      return { status: response.status >= 500 || response.ok ? "unknown" : "failed", code: safeCode(body.code), httpStatus: response.status };
    } catch { return { status: "unknown", code: "delivery_network_or_response_failure" }; }
  }
}

function safeCode(code) {
  const known = ["invalid.chatbotId", "miss.staffId", "ding.serverquota.insufficient", "Forbidden.AccessDenied.AccessTokenPermissionDenied", "InvalidAuthentication", "invalidParameter.param.invalid", "ding.receivercount.limit", "system.error", "send.ding.exception"];
  return known.includes(code) ? code : "ding_request_rejected";
}
function retryAfter(response, now) {
  const value = response.headers.get("retry-after");
  if (value && Number.isFinite(Number(value))) return Math.max(1000, Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(1000, date - now) : 30000;
}

async function deliverPending(store, sender, now = Date.now, random = Math.random) {
  const events = store.db.prepare(`SELECT * FROM events e WHERE status IN ('pending','retry') AND next_at<=?
    AND NOT EXISTS (SELECT 1 FROM events older WHERE older.key=e.key AND older.rowid<e.rowid AND older.status IN ('pending','retry','sending'))
    ORDER BY created,rowid LIMIT 4`).all(now());
  for (const event of events) {
    const claimed = store.db.prepare("UPDATE events SET status='sending',attempts=attempts+1 WHERE id=? AND status IN ('pending','retry')").run(event.id);
    if (!claimed.changes) continue;
    const result = await sender.send(event.body);
    const status = result.status === "retry" && event.attempts >= 2 ? "failed" : result.status;
    store.db.prepare("UPDATE events SET status=?,next_at=?,receipt=? WHERE id=?").run(status,
      now() + Math.max(0, result.retryMs || 0) + Math.round(random() * 1000), JSON.stringify(result), event.id);
  }
}
module.exports = { DingSender, deliverPending, retryAfter };
