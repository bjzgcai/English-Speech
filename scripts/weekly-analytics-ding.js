#!/usr/bin/env node
"use strict";
// Weekly page-visit digest: aggregates the seven China-local calendar days
// ending Tuesday from first-party analytics events plus saved-answer records,
// and delivers it to the group robot webhook in DINGTALK_GROUP_WEBHOOK_URL.
//
// Driven by the englisheval-weekly-analytics systemd timer every Wednesday at
// 09:30 Asia/Shanghai. It runs independently of the web process on purpose: a
// stopped, restarting or overloaded service must not be able to silently skip
// the digest.
//
// Usage:
//   node scripts/weekly-analytics-ding.js [--dry-run]
//   node scripts/weekly-analytics-ding.js [--dry-run] --start=YYYY-MM-DD --end=YYYY-MM-DD
const config = require("../src/config");
const analytics = require("../src/analytics");
const { buildDigest } = require("../src/weekly-digest");

// A once-weekly message is worth a couple of retries on a transient failure.
const ATTEMPTS = 3;
const RETRY_BASE_MS = 30000;
const DAY_MS = 24 * 60 * 60 * 1000;

function argumentValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

async function main() {
  let { startDate, endDate } = analytics.previousWeek();
  const startArgument = argumentValue("--start");
  const endArgument = argumentValue("--end");
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00+08:00`));
  if (startArgument && endArgument) {
    if (!validDate(startArgument) || !validDate(endArgument)) throw new Error("start and end must be YYYY-MM-DD dates");
    if (startArgument > endArgument) throw new Error("start must not be after end");
    if (analytics.localDay(Date.parse(`${endArgument}T00:00:00+08:00`) - 6 * DAY_MS) !== startArgument) {
      throw new Error("start and end must span exactly seven China-local calendar days");
    }
    ({ startDate, endDate } = { startDate: startArgument, endDate: endArgument });
  } else if (endArgument) {
    if (!validDate(endArgument)) throw new Error("end must be a YYYY-MM-DD date");
    endDate = endArgument;
    startDate = analytics.localDay(Date.parse(`${endArgument}T00:00:00+08:00`) - 6 * DAY_MS);
  } else if (startArgument) {
    if (!validDate(startArgument)) throw new Error("start must be a YYYY-MM-DD date");
    startDate = startArgument;
    endDate = analytics.localDay(Date.parse(`${startArgument}T00:00:00+08:00`) + 6 * DAY_MS);
  }

  // readEvents answers [] for a missing or empty file, which rangeSummary()
  // reports as dataIntegrity "missing" — an empty period is a signal, not an
  // error.
  const summary = analytics.rangeSummary(analytics.readEvents(config.analyticsEventsFile), startDate, endDate);
  // Finished evaluations are read from the saved answers, not from the events:
  // /game and /examine share one save pipeline, so the recorded question's
  // `challengeId` is what attributes a run to a page.
  summary.evaluations = analytics.evaluationsInRange(analytics.readEvents(config.metadataFile), startDate, endDate);
  const content = buildDigest(summary);

  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`${content}\n`);
    return 0;
  }

  const url = process.env.DINGTALK_GROUP_WEBHOOK_URL;
  if (!url) throw new Error("DINGTALK_GROUP_WEBHOOK_URL is unset");
  let webhook;
  try {
    webhook = new URL(url);
  } catch {
    throw new Error("DINGTALK_GROUP_WEBHOOK_URL is not a valid URL");
  }
  if (
    webhook.protocol !== "https:" ||
    webhook.hostname !== "oapi.dingtalk.com" ||
    webhook.pathname !== "/robot/send" ||
    !webhook.searchParams.get("access_token")
  ) {
    throw new Error("DINGTALK_GROUP_WEBHOOK_URL is not a supported DingTalk group robot URL");
  }

  let result;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msgtype: "text", text: { content } }),
        signal: AbortSignal.timeout(10000),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.errcode === 0) {
        result = { status: "sent" };
        break;
      }
      result = {
        status: response.status === 429 || response.status >= 500 ? "retry" : "failed",
        code: body.errcode === undefined ? null : String(body.errcode),
      };
    } catch {
      result = { status: "retry", code: "network_or_timeout" };
    }
    if (result.status !== "retry" || attempt === ATTEMPTS) break;
    await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * attempt));
  }

  // Journald-friendly one-line outcome. Never echo the body or webhook URL/token.
  console.log(JSON.stringify({ startDate, endDate, pv: summary.pv, uv: summary.uv, newUsers: summary.newUsers, evaluations: summary.evaluations.pages, evaluationsIntegrity: summary.evaluations.dataIntegrity, dataIntegrity: summary.dataIntegrity, delivery: result.status, code: result.code || null }));
  return result.status === "sent" ? 0 : 1;
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(`weekly analytics digest failed: ${error?.message || error}`);
  process.exitCode = 1;
});
