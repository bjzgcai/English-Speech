const crypto = require("node:crypto");
const { appendJsonLine, readJsonLines } = require("./storage");
const { isGuest } = require("./visitor");

const cookieName = "englisheval_analytics";
const pages = new Set(["/leaderboard", "/game", "/examine", "/history", "/intro", "/prepare"]);
const bots = /bot|crawler|spider|slurp|headless/i;
// The identities a tracked request can carry. A `guest` is someone who redeemed
// an invitation code; every other signed-in visitor is a DingTalk account.
const IDENTITIES = ["dingtalk", "guest"];
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
// The signed-in identity behind a request, if any. Page views and browser
// beacons arrive before any route resolves `req.user`, so callers that can read
// the signed session or guest cookies pass the identity in explicitly.
function identityOf(user) {
  if (!user?.openId) return null;
  return { type: isGuest(user) ? "guest" : "dingtalk", owner: user.openId };
}
// Owners are hashed rather than stored: the digest needs a stable dedupe key for
// UV, not the openId itself. A person signed in on two browsers still counts once.
const ownerHash = owner => crypto.createHash("sha256").update(owner).digest("hex");
function track(file, req, res, event, properties = {}, identity = null) {
  if (!event || bots.test(req.get("user-agent") || "")) return;
  const visitor = identity || identityOf(req.user);
  appendJsonLine(file, { id: crypto.randomUUID(), ts: new Date().toISOString(), event, visitorId: id(req, res), path: req.path, referrer: String(req.get("referer") || "").slice(0, 300), userAgent: String(req.get("user-agent") || "").slice(0, 300), ...properties, identity: visitor?.type || "", userHash: visitor?.owner ? ownerHash(visitor.owner) : "" });
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
function addDays(date, days) {
  return localDay(Date.parse(`${date}T00:00:00+08:00`) + days * DAY_MS);
}
// A weekly digest sent on Wednesday reports the seven China-local calendar
// dates ending the immediately preceding Tuesday.
function previousWeek(instant = Date.now()) {
  const endDate = previousDay(instant);
  return { startDate: addDays(endDate, -6), endDate };
}
// Logged-in page views, split by how the visitor signed in. Anonymous page views
// carry no identity, so they are counted only in the headline PV/UV. `uv` is the
// count of distinct owners: the DingTalk and invitation namespaces cannot
// collide (`guest:` prefixed openIds vs. real ones), so the total is their sum.
function loginSummary(pageViews) {
  const buckets = new Map(IDENTITIES.map(type => [type, { pv: 0, owners: new Set() }]));
  const owners = new Set();
  let pv = 0;
  pageViews.forEach(event => {
    const bucket = buckets.get(event.identity);
    if (!bucket) return;
    bucket.pv += 1;
    pv += 1;
    if (event.userHash) {
      bucket.owners.add(event.userHash);
      owners.add(event.userHash);
    }
  });
  const byIdentity = type => ({ pv: buckets.get(type).pv, uv: buckets.get(type).owners.size });
  return { pv, uv: owners.size, dingtalk: byIdentity("dingtalk"), guest: byIdentity("guest") };
}
function rangeSummary(events, startDate, endDate) {
  if (startDate > endDate) throw new Error("range start is after range end");
  const inRange = event => {
    const day = localDay(event.ts);
    return day >= startDate && day <= endDate;
  };
  const rows = events.filter(inRange);
  const pv = rows.filter(e => e.event === "page_view");
  const ids = new Set(pv.map(e => e.visitorId).filter(Boolean));
  const first = new Map();
  events.forEach(e => { if (e.visitorId && (!first.has(e.visitorId) || e.ts < first.get(e.visitorId))) first.set(e.visitorId, e.ts); });
  const pageViews = {};
  pv.forEach(e => { const page = e.page || e.path; if (page) pageViews[page] = (pageViews[page] || 0) + 1; });
  const eventCounts = {};
  rows.forEach(e => { eventCounts[e.event] = (eventCounts[e.event] || 0) + 1; });
  const newUsers = [...ids].filter(v => first.has(v) && localDay(first.get(v)) >= startDate && localDay(first.get(v)) <= endDate).length;
  return {
    startDate,
    endDate,
    pv: pv.length,
    uv: ids.size,
    newUsers,
    events: eventCounts,
    pageViews,
    logins: loginSummary(pv),
    dataIntegrity: events.length > 0 ? "ok" : "missing",
  };
}
function daily(events, date) {
  return { ...rangeSummary(events, date, date), date };
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
function evaluationsInRange(records, startDate, endDate) {
  if (startDate > endDate) throw new Error("range start is after range end");
  const buckets = new Map(EVALUATION_PAGES.map(page => [page, { count: 0, owners: new Set() }]));
  const owners = new Set();
  records.forEach(record => {
    const day = localDay(record?.finishedAt);
    if (record?.evaluation?.status !== "completed" || day < startDate || day > endDate) return;
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
function evaluations(records, date) {
  return evaluationsInRange(records, date, date);
}

module.exports = {
  cookieName,
  pages,
  track,
  daily,
  rangeSummary,
  loginSummary,
  evaluations,
  evaluationsInRange,
  EVALUATION_PAGES,
  IDENTITIES,
  identityOf,
  localDay,
  previousDay,
  previousWeek,
  readEvents: readJsonLines,
};
