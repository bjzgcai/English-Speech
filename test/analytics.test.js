const test = require("node:test");
const assert = require("node:assert/strict");
const { daily, evaluations, localDay, previousDay } = require("../src/analytics");
const { buildDigest, MAX_CONTENT_CHARS } = require("../src/daily-digest");

const event = (ts, name, visitorId, page) => ({ ts, event: name, visitorId, page });
const pageView = (ts, visitorId, page = "/game") => event(ts, "page_view", visitorId, page);

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
  assert.match(content, /注意：当日埋点无数据/);
});

test("a busy day degrades within the DING character budget", () => {
  const events = [];
  for (let page = 0; page < 40; page += 1) {
    for (let hit = 0; hit < 3; hit += 1) events.push(pageView("2026-09-13T02:00:00Z", `v${page}`, `/very-long-page-name-${page}`));
  }
  for (let kind = 0; kind < 30; kind += 1) events.push(event("2026-09-13T03:00:00Z", `event_kind_number_${kind}`, "v0", "/game"));
  const content = buildDigest(daily(events, "2026-09-13"));
  assert.ok(content.length <= MAX_CONTENT_CHARS, `digest was ${content.length} characters`);
  // The headline figures survive degradation; the tail is what gets folded away.
  assert.match(content, /页面浏览 PV：120/);
  assert.match(content, /其余 \d+ 个页面合计 \d+/);
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
