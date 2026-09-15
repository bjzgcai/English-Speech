const crypto = require("node:crypto");
const { appendJsonLine, readJsonLines } = require("./storage");

const cookieName = "englisheval_analytics";
const pages = new Set(["/leaderboard", "/game", "/examine", "/history", "/intro", "/prepare"]);
const bots = /bot|crawler|spider|slurp|headless/i;
// Reports describe a Chinese calendar day. Event timestamps are stored as UTC
// ISO strings, so the UTC day that shares the same digits is not the reported
// day: it would drop 00:00-08:00 local and pull in the next day's small hours.
// All day boundaries below are therefore drawn at 00:00 UTC+8.
const DAY_MS = 24 * 60 * 60 * 1000;
const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;

const visitorId = req => (req.cookies?.[cookieName] || String(req.get("cookie") || "").split(";").map(x => x.trim().split("=")).find(x => x[0] === cookieName)?.[1] || "");
function id(req, res) {
  let value = visitorId(req);
  if (!/^[0-9a-f-]{36}$/.test(value)) {
    value = crypto.randomUUID();
    res.cookie(cookieName, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 180 * 24 * 60 * 60 * 1000, path: "/" });
  }
  return value;
}
function track(file, req, res, event, properties = {}) {
  if (!event || bots.test(req.get("user-agent") || "")) return;
  const user = req.user?.openId || "";
  appendJsonLine(file, { id: crypto.randomUUID(), ts: new Date().toISOString(), event, visitorId: id(req, res), userHash: user ? crypto.createHash("sha256").update(user).digest("hex") : "", path: req.path, referrer: String(req.get("referer") || "").slice(0, 300), userAgent: String(req.get("user-agent") || "").slice(0, 300), ...properties });
}
// The China local calendar day (`YYYY-MM-DD`) an instant belongs to.
function localDay(instant) {
  const ms = typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + CHINA_OFFSET_MS).toISOString().slice(0, 10);
}
// The China local day before `instant`; what a 09:30 digest reports as "前一天".
function previousDay(instant = Date.now()) {
  return localDay(instant - DAY_MS);
}
function daily(events, date) {
  const rows = events.filter(e => e.ts && localDay(e.ts) === date);
  const pv = rows.filter(e => e.event === "page_view");
  const ids = new Set(pv.map(e => e.visitorId).filter(Boolean));
  const first = new Map();
  events.forEach(e => { if (e.visitorId && (!first.has(e.visitorId) || e.ts < first.get(e.visitorId))) first.set(e.visitorId, e.ts); });
  const pageViews = {};
  pv.forEach(e => { const page = e.page || e.path; if (page) pageViews[page] = (pageViews[page] || 0) + 1; });
  const eventCounts = {};
  rows.forEach(e => { eventCounts[e.event] = (eventCounts[e.event] || 0) + 1; });
  return {
    date,
    pv: pv.length,
    uv: ids.size,
    newUsers: [...ids].filter(v => first.has(v) && localDay(first.get(v)) === date).length,
    events: eventCounts,
    pageViews,
    dataIntegrity: events.length > 0 ? "ok" : "missing",
  };
}
// Evaluations that actually finished, attributed to the page that ran them.
// /game and /examine record and save through the same pipeline, so the page is
// not on the saved answer: the recorded question carries `challengeId` only for
// the weekly game topic, and that marker is what separates the two. Every other
// saved answer is an examine run.
const EVALUATION_PAGES = ["/game", "/examine"];
const evaluationPage = record => (record?.question?.challengeId ? "/game" : "/examine");

// A saved answer counts once its evaluation reached `completed`. A run that
// ended in `failed` or `skipped` did not finish an evaluation, and a missing
// `finishedAt` cannot be attributed to a day at all. `people` counts distinct
// owners, so someone who answers three times counts once.
function evaluations(records, date) {
  const buckets = new Map(EVALUATION_PAGES.map(page => [page, { count: 0, owners: new Set() }]));
  const owners = new Set();
  records.forEach(record => {
    if (record?.evaluation?.status !== "completed" || localDay(record.finishedAt) !== date) return;
    const bucket = buckets.get(evaluationPage(record));
    bucket.count += 1;
    if (record.openId) {
      bucket.owners.add(record.openId);
      owners.add(record.openId);
    }
  });
  return {
    pages: Object.fromEntries(EVALUATION_PAGES.map(page => [page, { count: buckets.get(page).count, people: buckets.get(page).owners.size }])),
    count: EVALUATION_PAGES.reduce((sum, page) => sum + buckets.get(page).count, 0),
    people: owners.size,
    // The file is created on boot, so an empty read means the collector never
    // wrote — not that nobody answered.
    dataIntegrity: records.length > 0 ? "ok" : "missing",
  };
}

module.exports = { cookieName, pages, track, daily, evaluations, EVALUATION_PAGES, localDay, previousDay, readEvents: readJsonLines };
