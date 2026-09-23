const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { daily, evaluations, rangeSummary, evaluationsInRange, identityOf, localDay, previousDay, previousWeek } = require("../src/analytics");
const { buildDigest, MAX_CONTENT_CHARS } = require("../src/weekly-digest");

const event = (ts, name, visitorId, page) => ({ ts, event: name, visitorId, page });
const pageView = (ts, visitorId, page = "/game") => event(ts, "page_view", visitorId, page);
const ownerHash = owner => crypto.createHash("sha256").update(owner).digest("hex");
// A page view by a signed-in visitor: the tracked record carries how they signed
// in plus a hash of the owner, never the openId itself.
const loginView = (ts, owner, identity, page = "/game") => ({
  ...pageView(ts, `cookie-${owner}`, page), identity, userHash: ownerHash(owner),
});

test("a China local day runs from 00:00 to 24:00 UTC+8, not the UTC day", () => {
  assert.equal(localDay("2026-09-13T00:00:00Z"), "2026-09-13"); // 08:00 CST
  assert.equal(localDay("2026-09-13T15:59:59Z"), "2026-09-13"); // 23:59:59 CST
  assert.equal(localDay("2026-09-13T16:00:00Z"), "2026-09-14"); // 00:00 CST next day
  assert.equal(localDay("2026-09-14T00:30:00Z"), "2026-09-14"); // 08:30 CST
});

test("previousDay is the local day a morning digest reports", () => {
  // 09:30 CST on 14 September is 01:30Z the same day.
  assert.equal(previousDay(Date.parse("2026-09-14T01:30:00Z")), "2026-09-13");
  // Just after local midnight the previous day has only just ended.
  assert.equal(previousDay(Date.parse("2026-09-13T16:00:00Z")), "2026-09-13");
  // 07:59 CST still reports the previous local day.
  assert.equal(previousDay(Date.parse("2026-09-13T23:59:00Z")), "2026-09-13");
});

test("previousWeek covers the seven local days ending Tuesday", () => {
  // 09:30 CST on Wednesday, 23 September.
  assert.deepEqual(previousWeek(Date.parse("2026-09-23T01:30:00Z")), {
    startDate: "2026-09-16",
    endDate: "2026-09-22",
  });
  // The function is anchored to the local previous day, not to the UTC date.
  assert.deepEqual(previousWeek(Date.parse("2026-09-23T16:00:00Z")), {
    startDate: "2026-09-17",
    endDate: "2026-09-23",
  });
});

test("weekly range uses China local boundaries and excludes adjacent days", () => {
  const events = [
    pageView("2026-09-15T15:59:59Z", "before"), // 23:59:59 CST on the 15th
    pageView("2026-09-15T16:00:00Z", "start"), // 00:00 CST on the 16th
    pageView("2026-09-22T15:59:59Z", "end"), // 23:59:59 CST on the 22nd
    pageView("2026-09-22T16:00:00Z", "after"), // 00:00 CST on the 23rd
    event("2026-09-16T00:30:00Z", "privacy_accept", "start", "/game"),
  ];
  const summary = rangeSummary(events, "2026-09-16", "2026-09-22");
  assert.equal(summary.pv, 2);
  assert.equal(summary.uv, 2);
  assert.equal(summary.events.page_view, 2);
  assert.equal(summary.events.privacy_accept, 1);
  assert.deepEqual(summary.pageViews, { "/game": 2 });
});

test("weekly range deduplicates visitors and first-time visitors across days", () => {
  const events = [
    pageView("2026-09-14T02:00:00Z", "returning"), // before the range
    pageView("2026-09-17T02:00:00Z", "returning"),
    pageView("2026-09-16T03:00:00Z", "fresh"),
    pageView("2026-09-21T04:00:00Z", "repeat"),
    pageView("2026-09-22T05:00:00Z", "repeat"),
  ];
  const summary = rangeSummary(events, "2026-09-16", "2026-09-22");
  assert.equal(summary.pv, 4);
  assert.equal(summary.uv, 3);
  assert.equal(summary.newUsers, 2);
});

test("identityOf separates DingTalk accounts from redeemed invitations", () => {
  assert.equal(identityOf(null), null);
  assert.equal(identityOf({ openId: "" }), null);
  assert.deepEqual(identityOf({ openId: "dingtalk-open-id" }), { type: "dingtalk", owner: "dingtalk-open-id" });
  // A guest is recognised by its identity type or by the `guest:` owner prefix.
  assert.deepEqual(identityOf({ openId: "guest:11111111-1111-4111-8111-111111111111", identityType: "guest" }),
    { type: "guest", owner: "guest:11111111-1111-4111-8111-111111111111" });
  assert.equal(identityOf({ openId: "guest:11111111-1111-4111-8111-111111111111" }).type, "guest");
});

test("logged-in page views are split by sign-in method, anonymous ones excluded", () => {
  const events = [
    loginView("2026-09-17T02:00:00Z", "ding-1", "dingtalk"),
    loginView("2026-09-17T03:00:00Z", "ding-1", "dingtalk", "/examine"),
    loginView("2026-09-18T02:00:00Z", "ding-2", "dingtalk"),
    loginView("2026-09-19T02:00:00Z", "guest:11111111-1111-4111-8111-111111111111", "guest"),
    loginView("2026-09-19T03:00:00Z", "guest:11111111-1111-4111-8111-111111111111", "guest", "/leaderboard"),
    pageView("2026-09-19T04:00:00Z", "anonymous"),
    // The beacon events carry an identity too, but only page views are PV.
    { ...event("2026-09-19T05:00:00Z", "game_enter", "cookie-ding-1", "/game"), identity: "dingtalk", userHash: ownerHash("ding-1") },
  ];
  const summary = rangeSummary(events, "2026-09-16", "2026-09-22");
  assert.equal(summary.pv, 6);
  assert.deepEqual(summary.logins, {
    pv: 5,
    uv: 3,
    dingtalk: { pv: 3, uv: 2 },
    guest: { pv: 2, uv: 1 },
  });
});

test("a visitor counts once per sign-in method across the whole period", () => {
  const events = [
    loginView("2026-09-16T02:00:00Z", "ding-1", "dingtalk", "/game"),
    loginView("2026-09-22T02:00:00Z", "ding-1", "dingtalk", "/history"),
    loginView("2026-09-14T02:00:00Z", "ding-1", "dingtalk"), // before the period
    loginView("2026-09-20T02:00:00Z", "guest:11111111-1111-4111-8111-111111111111", "guest", "/game"),
    loginView("2026-09-20T03:00:00Z", "guest:11111111-1111-4111-8111-111111111111", "guest", "/game"),
  ];
  const summary = rangeSummary(events, "2026-09-16", "2026-09-22");
  assert.deepEqual(summary.logins, {
    pv: 4,
    uv: 2,
    dingtalk: { pv: 2, uv: 1 },
    guest: { pv: 2, uv: 1 },
  });
});

test("the digest reports logged-in PV/UV split by sign-in method", () => {
  const summary = rangeSummary([
    loginView("2026-09-17T02:00:00Z", "ding-1", "dingtalk"),
    loginView("2026-09-18T02:00:00Z", "ding-1", "dingtalk", "/examine"),
    loginView("2026-09-19T02:00:00Z", "guest:11111111-1111-4111-8111-111111111111", "guest"),
    pageView("2026-09-19T04:00:00Z", "anonymous"),
  ], "2026-09-16", "2026-09-22");
  const content = buildDigest(summary);
  assert.match(content, /登录用户：PV 3 \/ UV 2/);
  assert.match(content, /钉钉登录：PV 2 \/ UV 1/);
  assert.match(content, /邀请码登录：PV 1 \/ UV 1/);
  // The headline still counts every page view, signed in or not.
  assert.match(content, /页面浏览 PV：4/);
  assert.ok(content.length <= MAX_CONTENT_CHARS);
});

test("weekly range aggregates evaluation counts and distinct people", () => {
  const records = [
    answer("2026-09-15T02:00:00Z", { openId: "before", challengeId: "weekly-1" }),
    answer("2026-09-16T02:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-17T03:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-22T04:00:00Z", { openId: "u1" }),
    answer("2026-09-21T05:00:00Z", { openId: "failed", status: "failed", challengeId: "weekly-1" }),
    answer("2026-09-23T06:00:00Z", { openId: "after" }),
  ];
  const summary = evaluationsInRange(records, "2026-09-16", "2026-09-22");
  assert.deepEqual(summary.pages["/game"], { count: 2, people: 1 });
  assert.deepEqual(summary.pages["/examine"], { count: 1, people: 1 });
  assert.equal(summary.count, 3);
  assert.equal(summary.people, 1);
});

test("an empty weekly range reports missing analytics and recordings data", () => {
  const analyticsSummary = rangeSummary([], "2026-09-16", "2026-09-22");
  const evaluationSummary = evaluationsInRange([], "2026-09-16", "2026-09-22");
  assert.equal(analyticsSummary.dataIntegrity, "missing");
  assert.equal(analyticsSummary.pv, 0);
  assert.equal(evaluationSummary.dataIntegrity, "missing");
  const content = buildDigest({ ...analyticsSummary, evaluations: evaluationSummary });
  assert.match(content, /统计周期内埋点无数据/);
  assert.match(content, /无评价记录数据/);
});

test("daily() ignores the UTC day that shares the same digits", () => {
  const events = [
    pageView("2026-09-13T00:30:00Z", "a"), // 08:30 CST on the 13th
    pageView("2026-09-13T15:59:00Z", "b"), // 23:59 CST on the 13th
    pageView("2026-09-13T16:00:00Z", "c"), // 00:00 CST on the 14th
    pageView("2026-09-12T16:30:00Z", "d"), // 00:30 CST on the 13th
  ];
  const summary = daily(events, "2026-09-13");
  // All four timestamps begin with "2026-09-13" or "2026-09-12" in UTC; only
  // three of them fall inside the China local day.
  assert.equal(summary.pv, 3);
  assert.equal(summary.date, "2026-09-13");
  assert.equal(summary.dataIntegrity, "ok");
});

test("daily() separates first-time visitors from returning ones", () => {
  const events = [
    pageView("2026-09-11T02:00:00Z", "returning", "/game"),
    pageView("2026-09-13T02:00:00Z", "returning", "/examine"),
    pageView("2026-09-13T03:00:00Z", "fresh", "/game"),
    pageView("2026-09-13T04:00:00Z", "fresh", "/game"),
    pageView("2026-09-13T05:00:00Z", "fresh", "/leaderboard"),
  ];
  const summary = daily(events, "2026-09-13");
  assert.equal(summary.pv, 4);
  assert.equal(summary.uv, 2);
  assert.equal(summary.newUsers, 1);
  assert.deepEqual(summary.pageViews, { "/game": 2, "/examine": 1, "/leaderboard": 1 });
});

test("daily() reports a missing dataset instead of a silent zero", () => {
  const summary = daily([], "2026-09-13");
  assert.equal(summary.dataIntegrity, "missing");
  assert.equal(summary.pv, 0);
  assert.equal(summary.uv, 0);
});

test("the digest carries the headline figures and the page breakdown", () => {
  const summary = daily([
    pageView("2026-09-13T02:00:00Z", "a", "/game"),
    pageView("2026-09-13T02:05:00Z", "b", "/game"),
    pageView("2026-09-13T03:00:00Z", "a", "/examine"),
    event("2026-09-13T03:30:00Z", "examine_complete", "a", "/examine"),
  ], "2026-09-13");
  const content = buildDigest(summary);
  assert.match(content, /统计日期：2026-09-13/);
  assert.match(content, /页面浏览 PV：3/);
  assert.match(content, /独立访客 UV：2/);
  assert.match(content, /其中新访客：2/);
  assert.match(content, /\/game 2/);
  assert.match(content, /examine_complete 1/);
  // page_view is already the PV headline; it must not be repeated as an event.
  assert.doesNotMatch(content, /page_view/);
  assert.ok(content.length <= MAX_CONTENT_CHARS);
});

test("an empty day still produces a readable, flagged digest", () => {
  const content = buildDigest(daily([], "2026-09-13"));
  assert.match(content, /页面浏览 PV：0/);
  assert.match(content, /页面 PV：无记录/);
  assert.match(content, /注意：统计周期内埋点无数据/);
});

test("the weekly digest displays the full reporting period", () => {
  const summary = rangeSummary([
    pageView("2026-09-16T02:00:00Z", "a"),
    pageView("2026-09-22T03:00:00Z", "b"),
  ], "2026-09-16", "2026-09-22");
  const content = buildDigest(summary);
  assert.match(content, /统计日期：2026-09-16 至 2026-09-22（北京时间）/);
  assert.ok(content.length <= MAX_CONTENT_CHARS);
});

test("a busy day degrades within the DING character budget", () => {
  const events = [];
  for (let page = 0; page < 40; page += 1) {
    for (let hit = 0; hit < 3; hit += 1) events.push(pageView("2026-09-13T02:00:00Z", `v${page}`, `/very-long-page-name-${page}`));
  }
  for (let kind = 0; kind < 30; kind += 1) events.push(event("2026-09-13T03:00:00Z", `event_kind_number_${kind}`, "v0", "/game"));
  // One of the busy day's page views was made by a signed-in visitor; it still
  // counts once in the headline PV.
  events[0] = loginView("2026-09-13T02:00:00Z", "ding-1", "dingtalk", "/very-long-page-name-0");
  const content = buildDigest(daily(events, "2026-09-13"));
  assert.ok(content.length <= MAX_CONTENT_CHARS, `digest was ${content.length} characters`);
  // The headline figures survive degradation; the tail is what gets folded away.
  assert.match(content, /页面浏览 PV：120/);
  assert.match(content, /其余 \d+ 个页面合计 \d+/);
  // The logged-in split is part of the fixed head, so it is never folded away.
  assert.match(content, /登录用户：PV 1 \/ UV 1/);
  assert.match(content, /钉钉登录：PV 1 \/ UV 1/);
  assert.match(content, /邀请码登录：PV 0 \/ UV 0/);
});

// The saved answer does not carry the page; only the weekly game records a
// `challengeId` on its question, so that marker is the whole attribution rule.
const answer = (finishedAt, { openId = "u1", status = "completed", challengeId = "" } = {}) => ({
  finishedAt,
  openId,
  evaluation: { status },
  question: challengeId ? { challengeId, challengeTitle: "Sharing household chores" } : { question: "Tell me about your week." },
});

test("evaluations() splits the weekly game from examine runs", () => {
  const summary = evaluations([
    answer("2026-09-13T02:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-13T03:00:00Z", { openId: "u2", challengeId: "weekly-1" }),
    answer("2026-09-13T04:00:00Z", { openId: "u1" }),
    answer("2026-09-12T04:00:00Z", { openId: "u9", challengeId: "weekly-1" }), // previous local day
  ], "2026-09-13");
  assert.deepEqual(summary.pages["/game"], { count: 2, people: 2 });
  assert.deepEqual(summary.pages["/examine"], { count: 1, people: 1 });
  assert.equal(summary.count, 3);
  assert.equal(summary.dataIntegrity, "ok");
});

test("evaluations() counts people once and ignores runs that never finished", () => {
  const summary = evaluations([
    answer("2026-09-13T02:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-13T03:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-13T04:00:00Z", { openId: "u1", challengeId: "weekly-1" }),
    answer("2026-09-13T05:00:00Z", { openId: "u2", status: "failed", challengeId: "weekly-1" }),
    answer("2026-09-13T06:00:00Z", { openId: "u3", status: "skipped" }),
    answer("", { openId: "u4", challengeId: "weekly-1" }), // no timestamp -> no day
  ], "2026-09-13");
  assert.deepEqual(summary.pages["/game"], { count: 3, people: 1 });
  assert.deepEqual(summary.pages["/examine"], { count: 0, people: 0 });
  assert.equal(summary.count, 3);
  assert.equal(summary.people, 1);
});

test("an empty recordings file is flagged rather than reported as a quiet day", () => {
  const summary = evaluations([], "2026-09-13");
  assert.equal(summary.dataIntegrity, "missing");
  assert.equal(summary.count, 0);
});

test("the digest reports finished evaluations per page, in times and in people", () => {
  const summary = daily([
    pageView("2026-09-13T02:00:00Z", "a", "/game"),
    pageView("2026-09-13T02:05:00Z", "b", "/examine"),
  ], "2026-09-13");
  summary.evaluations = evaluations([
    answer("2026-09-13T02:30:00Z", { openId: "a", challengeId: "weekly-1" }),
    answer("2026-09-13T04:30:00Z", { openId: "a" }),
  ], "2026-09-13");
  const content = buildDigest(summary);
  assert.match(content, /评价完成：/);
  assert.match(content, /\/game 1 次 \/ 1 人/);
  assert.match(content, /\/examine 1 次 \/ 1 人/);
  assert.ok(content.length <= MAX_CONTENT_CHARS);
});

test("the evaluation section survives a busy day's degradation", () => {
  const events = [];
  for (let page = 0; page < 40; page += 1) {
    for (let hit = 0; hit < 3; hit += 1) events.push(pageView("2026-09-13T02:00:00Z", `v${page}`, `/very-long-page-name-${page}`));
  }
  for (let kind = 0; kind < 30; kind += 1) events.push(event("2026-09-13T03:00:00Z", `event_kind_number_${kind}`, "v0", "/game"));
  const summary = daily(events, "2026-09-13");
  summary.evaluations = evaluations([answer("2026-09-13T02:30:00Z", { openId: "a", challengeId: "weekly-1" })], "2026-09-13");
  const content = buildDigest(summary);
  assert.ok(content.length <= MAX_CONTENT_CHARS, `digest was ${content.length} characters`);
  assert.match(content, /\/game 1 次 \/ 1 人/);
  assert.match(content, /\/examine 0 次 \/ 0 人/);
});

test("a day without an evaluations summary omits the section entirely", () => {
  const content = buildDigest(daily([pageView("2026-09-13T02:00:00Z", "a", "/game")], "2026-09-13"));
  assert.doesNotMatch(content, /评价完成/);
  assert.doesNotMatch(content, /无评价记录数据/);
});
