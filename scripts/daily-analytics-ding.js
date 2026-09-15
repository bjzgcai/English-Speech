#!/usr/bin/env node
"use strict";
// Daily page-visit digest: aggregates the previous China local calendar day
// from the first-party analytics events plus the saved-answer records, and
// delivers it as an in-app DingTalk DING to DINGTALK_DIGEST_USER_ID (falling
// back to the resource-alert recipient).
//
// Driven by the englisheval-daily-analytics systemd timer at 09:30 Asia/Shanghai.
// It runs independently of the web process on purpose: a stopped, restarting or
// overloaded service must not be able to silently skip the digest.
//
// Usage: node scripts/daily-analytics-ding.js [--dry-run] [--date=YYYY-MM-DD]
const config = require("../src/config");
const analytics = require("../src/analytics");
const { buildDigest } = require("../src/daily-digest");
const { DingSender } = require("../src/ding-alerts");

// A once-daily message is worth a couple of retries on an explicit rate limit.
const ATTEMPTS = 3;
const RETRY_BASE_MS = 30000;

function argumentValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : "";
}

async function main() {
  const date = argumentValue("--date") || analytics.previousDay();
  // readEvents answers [] for a missing or empty file, which daily() reports as
  // dataIntegrity "missing" — an empty day is a signal, not an error.
  const summary = analytics.daily(analytics.readEvents(config.analyticsEventsFile), date);
  // Finished evaluations are read from the saved answers, not from the events:
  // /game and /examine share one save pipeline, so the recorded question's
  // `challengeId` is what attributes a run to a page.
  summary.evaluations = analytics.evaluations(analytics.readEvents(config.metadataFile), date);
  const content = buildDigest(summary);

  if (process.argv.includes("--dry-run")) {
    process.stdout.write(`${content}\n`);
    return 0;
  }

  const sender = new DingSender({
    clientId: process.env.DINGTALK_CLIENT_ID,
    clientSecret: process.env.DINGTALK_CLIENT_SECRET,
    robotCode: process.env.DINGTALK_DIGEST_ROBOT_CODE || process.env.DINGTALK_ALERT_ROBOT_CODE,
    userId: process.env.DINGTALK_DIGEST_USER_ID || process.env.DINGTALK_ALERT_USER_ID,
  });

  let result;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    result = await sender.send(content);
    if (result.status !== "retry" || attempt === ATTEMPTS) break;
    await new Promise(resolve => setTimeout(resolve, RETRY_BASE_MS * attempt));
  }

  // Journald-friendly one-line outcome. Never echo the DING body or a credential.
  console.log(JSON.stringify({ date, pv: summary.pv, uv: summary.uv, newUsers: summary.newUsers, evaluations: summary.evaluations.pages, evaluationsIntegrity: summary.evaluations.dataIntegrity, dataIntegrity: summary.dataIntegrity, delivery: result.status, code: result.code || null }));
  return result.status === "sent" ? 0 : 1;
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(`daily analytics digest failed: ${error?.message || error}`);
  process.exitCode = 1;
});
