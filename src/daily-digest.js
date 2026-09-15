// Renders one day of page-visit analytics as the body of an in-app DingTalk
// DING. The DING API rejects content over 500 characters, so the message is
// assembled against an explicit budget and degrades from the least important
// section down (full page list -> fewer pages -> event breakdown dropped)
// instead of being cut mid-line by the platform.
const { EVALUATION_PAGES } = require("./analytics");

const MAX_CONTENT_CHARS = 500;
const DEFAULT_LABEL = "EnglishEval 页面访问统计";

// Highest count first, then by name so equal counts render in a stable order.
const byCountThenName = entries => [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
const total = entries => entries.reduce((sum, [, count]) => sum + count, 0);

function render(summary, head, pageEntries, eventEntries, pageLimit, eventLimit) {
  const parts = [...head];
  if (pageEntries.length) {
    parts.push("", "页面 PV：");
    pageEntries.slice(0, pageLimit).forEach(([page, count]) => parts.push(`${page} ${count}`));
    const rest = pageEntries.slice(pageLimit);
    if (rest.length) parts.push(`其余 ${rest.length} 个页面合计 ${total(rest)}`);
  } else {
    parts.push("", "页面 PV：无记录");
  }
  // Finished evaluations are the section the digest exists for, so it keeps its
  // place and the page/event breakdowns degrade around it.
  if (summary.evaluations) {
    parts.push("", "评价完成：");
    EVALUATION_PAGES.forEach(page => {
      const item = summary.evaluations.pages?.[page] || { count: 0, people: 0 };
      parts.push(`${page} ${item.count} 次 / ${item.people} 人`);
    });
  }
  if (eventEntries.length && eventLimit > 0) {
    parts.push("", "关键事件：");
    eventEntries.slice(0, eventLimit).forEach(([event, count]) => parts.push(`${event} ${count}`));
    const rest = eventEntries.slice(eventLimit);
    if (rest.length) parts.push(`其余 ${rest.length} 类事件合计 ${total(rest)}`);
  }
  if (summary.dataIntegrity !== "ok") parts.push("", "注意：当日埋点无数据，请检查 analytics/events.jsonl。");
  if (summary.evaluations && summary.evaluations.dataIntegrity !== "ok") {
    parts.push("", "注意：无评价记录数据，请检查 recordings/metadata.jsonl。");
  }
  return parts.join("\n");
}

function buildDigest(summary, { label = DEFAULT_LABEL } = {}) {
  const head = [
    label,
    `统计日期：${summary.date}（北京时间 00:00-24:00）`,
    "",
    `页面浏览 PV：${summary.pv}`,
    `独立访客 UV：${summary.uv}`,
    `其中新访客：${summary.newUsers}`,
  ];
  const pageEntries = byCountThenName(Object.entries(summary.pageViews || {}));
  // `page_view` is already reported as PV; the breakdown covers everything else.
  const eventEntries = byCountThenName(Object.entries(summary.events || {}).filter(([event]) => event !== "page_view"));

  const layouts = [[pageEntries.length, eventEntries.length], [8, 4], [5, 0], [3, 0], [1, 0], [0, 0]];
  for (const [pageLimit, eventLimit] of layouts) {
    const content = render(summary, head, pageEntries, eventEntries, pageLimit, eventLimit);
    if (content.length <= MAX_CONTENT_CHARS) return content;
  }
  // Unreachable for realistic input (the last layout is six lines), but never
  // hand the platform an oversized body.
  return head.join("\n").slice(0, MAX_CONTENT_CHARS);
}

module.exports = { buildDigest, MAX_CONTENT_CHARS, DEFAULT_LABEL };
