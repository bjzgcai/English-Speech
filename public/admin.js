const accessPanel = document.querySelector("#accessPanel");
const accessForm = document.querySelector("#accessForm");
const accessTokenInput = document.querySelector("#accessToken");
const accessError = document.querySelector("#accessError");
const unlockButton = document.querySelector("#unlockButton");
const toggleTokenButton = document.querySelector("#toggleTokenButton");
const dashboard = document.querySelector("#dashboard");
const dashboardStatus = document.querySelector("#dashboardStatus");
const loadingState = document.querySelector("#loadingState");
const statisticsContent = document.querySelector("#statisticsContent");
const refreshButton = document.querySelector("#refreshButton");
const lockButton = document.querySelector("#lockButton");
const logoutButton = document.querySelector("#logoutButton");

let adminAccessToken = "";

const numberFormatter = new Intl.NumberFormat("en-US");
const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  dateStyle: "medium",
  timeStyle: "short",
});
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  month: "short",
  day: "numeric",
});

function setText(id, value) {
  const element = document.querySelector(`#${id}`);
  if (element) element.textContent = value;
}

function formatNumber(value) {
  const number = Number(value);
  return numberFormatter.format(Number.isFinite(number) ? number : 0);
}

function formatPercent(value) {
  const number = Number(value);
  return `${Number.isFinite(number) ? number.toFixed(1).replace(/\.0$/, "") : "0"}%`;
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function pluralizedCount(value, singular, plural = `${singular}s`) {
  const count = Number(value);
  return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}

function formatDate(value, formatter = dateTimeFormatter) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : formatter.format(date);
}

function setLoading(isLoading) {
  loadingState.hidden = !isLoading;
  if (isLoading) statisticsContent.hidden = true;
  refreshButton.disabled = isLoading;
  unlockButton.disabled = isLoading;
  unlockButton.textContent = isLoading ? "Checking access..." : "View statistics";
}

function showDashboardError(message) {
  dashboardStatus.textContent = message;
  dashboardStatus.classList.add("error");
}

function clearDashboardStatus(message = "") {
  dashboardStatus.textContent = message;
  dashboardStatus.classList.remove("error");
}

function appendFunnelStep(container, label, value, note) {
  const step = document.createElement("article");
  step.className = "funnel-step";
  const labelElement = document.createElement("span");
  const valueElement = document.createElement("strong");
  const noteElement = document.createElement("small");
  labelElement.textContent = label;
  valueElement.textContent = formatNumber(value);
  noteElement.textContent = note;
  step.append(labelElement, valueElement, noteElement);
  container.append(step);
}

function renderFunnel(overview) {
  const funnel = document.querySelector("#currentWeekFunnel");
  funnel.replaceChildren();
  appendFunnelStep(
    funnel,
    "Entered",
    overview.currentWeekEntrants,
    "Generated a weekly game question",
  );
  appendFunnelStep(
    funnel,
    "Submitted",
    overview.currentWeekSubmitters,
    `${formatPercent(
      overview.currentWeekEntrants
        ? (overview.currentWeekSubmitters / overview.currentWeekEntrants) * 100
        : 0,
    )} of entrants`,
  );
  appendFunnelStep(
    funnel,
    "Scored",
    overview.currentWeekScoredParticipants,
    `${formatPercent(
      overview.currentWeekSubmitters
        ? (overview.currentWeekScoredParticipants / overview.currentWeekSubmitters) * 100
        : 0,
    )} of submitters`,
  );
}

function renderActivity(days) {
  const chart = document.querySelector("#activityChart");
  chart.replaceChildren();
  const maximum = Math.max(
    1,
    ...days.flatMap((day) => [Number(day.attemptsSubmitted), Number(day.activeParticipants)]),
  );

  days.forEach((day) => {
    const wrapper = document.createElement("div");
    wrapper.className = "activity-day";
    const bars = document.createElement("div");
    bars.className = "activity-bars";

    const attempts = document.createElement("span");
    attempts.className = "activity-bar";
    attempts.style.setProperty(
      "--bar-height",
      `${day.attemptsSubmitted ? Math.max(7, (day.attemptsSubmitted / maximum) * 100) : 0}%`,
    );
    attempts.title = pluralizedCount(day.attemptsSubmitted, "submitted attempt");

    const participants = document.createElement("span");
    participants.className = "activity-bar participants";
    participants.style.setProperty(
      "--bar-height",
      `${day.activeParticipants ? Math.max(7, (day.activeParticipants / maximum) * 100) : 0}%`,
    );
    participants.title = pluralizedCount(day.activeParticipants, "active participant");

    const date = document.createElement("time");
    date.dateTime = day.date;
    date.textContent = formatDate(`${day.date}T12:00:00+08:00`, dateFormatter);
    bars.append(attempts, participants);
    wrapper.append(bars, date);
    chart.append(wrapper);
  });
}

function renderScoreBands(bands) {
  const container = document.querySelector("#scoreBands");
  container.replaceChildren();
  const maximum = Math.max(1, ...bands.map((band) => Number(band.count)));

  bands.forEach((band) => {
    const row = document.createElement("div");
    row.className = "score-band";
    const label = document.createElement("span");
    label.textContent = band.label;
    const bar = document.createElement("span");
    bar.className = "score-band-bar";
    bar.style.setProperty("--band-width", `${(band.count / maximum) * 100}%`);
    const count = document.createElement("strong");
    count.textContent = formatNumber(band.count);
    row.append(label, bar, count);
    container.append(row);
  });
}

function renderAttemptOutcomes(attemptStatus) {
  const container = document.querySelector("#attemptOutcomes");
  container.replaceChildren();
  const labels = {
    completed: "Completed",
    failed: "Evaluation failed",
    skipped: "No recording",
    other: "Other status",
  };
  Object.entries(labels).forEach(([key, label]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = formatNumber(attemptStatus[key]);
    row.append(term, detail);
    container.append(row);
  });
}

function renderWeeklyTable(weeks) {
  const body = document.querySelector("#weeklyTableBody");
  const empty = document.querySelector("#weeklyEmpty");
  body.replaceChildren();
  empty.hidden = weeks.length > 0;

  weeks.forEach((week) => {
    const row = document.createElement("tr");
    const challengeCell = document.createElement("td");
    challengeCell.className = "challenge-cell";
    const title = document.createElement("strong");
    title.textContent = week.title;
    const date = document.createElement("span");
    date.textContent = week.startsAt ? `Started ${formatDate(week.startsAt, dateFormatter)}` : week.challengeId;
    challengeCell.append(title, date);
    row.append(challengeCell);

    [
      formatNumber(week.entrants),
      formatNumber(week.submitters),
      formatNumber(week.scoredParticipants),
      formatNumber(week.attempts),
      formatPercent(week.completionRate),
      week.averageBestScore === null ? "Not available" : Number(week.averageBestScore).toFixed(1),
    ].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
}

function renderExperienceRatings(ratings = []) {
  const list = document.querySelector("#experienceRatingsList");
  const empty = document.querySelector("#experienceRatingsEmpty");
  const scroll = document.querySelector("#experienceRatingsScroll");
  const rated = ratings.filter(
    (rating) => rating.outcome === "RATED" && Number.isFinite(Number(rating.score)),
  );
  const dismissed = ratings.filter((rating) => rating.outcome === "DISMISSED");
  const average = rated.length
    ? rated.reduce((total, rating) => total + Number(rating.score), 0) / rated.length
    : null;

  setText("ratingResponseCount", formatNumber(rated.length));
  setText("ratingAverage", average === null ? "—" : `${average.toFixed(1)}/5`);
  setText("ratingDismissedCount", formatNumber(dismissed.length));
  setText(
    "experienceRatingsSummary",
    `${formatNumber(ratings.length)} total records; ${formatNumber(rated.length)} include a score.`,
  );
  list.replaceChildren();
  empty.hidden = ratings.length > 0;
  scroll.hidden = ratings.length === 0;

  ratings.forEach((rating) => {
    const row = document.createElement("article");
    row.className = "rating-row";

    const identity = document.createElement("div");
    identity.className = "rating-identity";
    const name = document.createElement("strong");
    name.textContent = rating.userName || "DingTalk user";
    const jobNumber = document.createElement("span");
    jobNumber.textContent = rating.jobNumber
      ? `Employee ${rating.jobNumber}`
      : "Employee number unavailable";
    identity.append(name, jobNumber);

    const score = document.createElement("div");
    score.className = "rating-value";
    if (rating.outcome === "RATED") {
      const value = document.createElement("strong");
      value.textContent = Number.isFinite(Number(rating.score)) ? rating.score : "—";
      const maximum = document.createElement("span");
      maximum.textContent = "/5";
      value.append(maximum);
      const badge = document.createElement("span");
      badge.className = "rating-badge rated";
      badge.textContent = "Rated";
      score.append(value, badge);
    } else {
      const badge = document.createElement("span");
      badge.className = "rating-badge";
      badge.textContent = "Dismissed";
      score.append(badge);
    }

    const details = document.createElement("div");
    details.className = "rating-details";
    const context = document.createElement("span");
    context.className = "rating-context";
    context.textContent = "Speaking evaluation";
    details.append(context);
    if (Array.isArray(rating.tags) && rating.tags.length > 0) {
      const tags = document.createElement("div");
      tags.className = "rating-tags";
      tags.setAttribute("aria-label", "Rating reasons");
      rating.tags.forEach((tag) => {
        const item = document.createElement("span");
        item.textContent = tag;
        tags.append(item);
      });
      details.append(tags);
    } else {
      const noTags = document.createElement("span");
      noTags.className = "rating-no-tags";
      noTags.textContent = "No rating reasons selected";
      details.append(noTags);
    }

    const time = document.createElement("time");
    time.dateTime = rating.createdAt;
    time.textContent = formatDate(rating.createdAt);
    row.append(identity, score, details, time);
    list.append(row);
  });
}

function renderStatistics(statistics) {
  const overview = statistics.overview;
  const challenge = statistics.currentChallenge;
  setText(
    "challengeSummary",
    `${challenge.title}. ${formatDate(challenge.startsAt, dateFormatter)} to ${formatDate(
      challenge.endsAt,
      dateFormatter,
    )}.`,
  );
  setText("currentWeekSubmitters", formatNumber(overview.currentWeekSubmitters));
  setText("currentWeekEntrants", formatNumber(overview.currentWeekEntrants));
  setText("allTimeEntrants", formatNumber(overview.allTimeEntrants));
  setText("totalGameAttempts", formatNumber(overview.totalGameAttempts));
  setText("currentWeekScored", formatNumber(overview.currentWeekScoredParticipants));
  setText(
    "averageBestScore",
    overview.currentWeekAverageBestScore === null
      ? "Not available"
      : Number(overview.currentWeekAverageBestScore).toFixed(1),
  );
  setText("completionRate", formatPercent(overview.gameCompletionRate));
  setText("repeatParticipants", formatNumber(overview.repeatParticipants));
  setText("noSubmission", formatNumber(overview.entrantsWithoutSubmission));
  setText(
    "storedMedia",
    `${formatBytes(overview.totalStoredBytes)} in ${pluralizedCount(
      overview.storedMediaFiles,
      "file",
    )}`,
  );
  setText("generatedAt", `Data refreshed ${formatDate(statistics.generatedAt)}`);

  renderFunnel(overview);
  renderActivity(statistics.dailyActivity);
  renderScoreBands(statistics.currentWeekScoreBands);
  renderAttemptOutcomes(statistics.attemptStatus);
  renderWeeklyTable(statistics.weeklyBreakdown);
}

async function requestStatistics() {
  setLoading(true);
  clearDashboardStatus("Loading aggregate statistics...");
  try {
    const response = await fetch("/api/admin/statistics", {
      headers: { "x-admin-access-token": adminAccessToken },
      cache: "no-store",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || "Unable to load admin statistics.");
      error.code = body.code || "";
      error.status = response.status;
      throw error;
    }
    renderStatistics(body.statistics);
    renderExperienceRatings(body.ratings || []);
    await loadQueueMetrics();
    await loadMonitorMetrics();
    statisticsContent.hidden = false;
    clearDashboardStatus("Statistics are up to date.");
    return true;
  } catch (error) {
    statisticsContent.hidden = true;
    showDashboardError(error.message);
    if (error.status === 401) {
      window.location.assign("/auth/dingtalk?redirect=%2Fadmin");
    }
    throw error;
  } finally {
    setLoading(false);
  }
}

async function loadQueueMetrics() {
  const response = await fetch("/api/admin/queue", { headers: { "x-admin-access-token": adminAccessToken } });
  if (!response.ok) return;
  const data = await response.json();
  setText("queueSummary", `${data.admissions.map(item => `${item.count} ${item.state}`).join(", ") || "No active sessions"}. Capacity: ${data.capacity}. ${data.pressure || "Worker available."}`);
  document.querySelector("#queuePaused").checked = data.paused;
  setText("queueTimings", data.stages.filter(item => item.stage !== "release").map(item => `${item.stage} (${item.category}, ${item.pipeline}, n=${item.samples}): P50 ${(item.p50Ms / 1000).toFixed(1)}s, P90 ${(item.p90Ms / 1000).toFixed(1)}s`).join(". "));
  document.querySelector("#modelBudgets").replaceChildren(...(data.models || []).map(item => {
    const row = document.createElement("li");
    const label = { internal: "Internal gateway", question: "Questions", transcription: "ASR", scoring: "Scoring" }[item.scope] || item.scope;
    row.textContent = `${label}: ${item.active}/${item.limits.concurrent} active, ${item.requests}/${item.limits.rpm} requests/min${item.limits.tpm ? `, ${item.tokens.toLocaleString()}/${item.limits.tpm.toLocaleString()} tokens reserved or used` : ""}${item.circuitUntil > Date.now() ? ", cooling down" : ""}`;
    return row;
  }));
}
document.querySelector("#queuePaused").addEventListener("change", async event => {
  try {
    const response = await fetch("/api/admin/queue", { method: "POST", headers: { "Content-Type": "application/json", "x-admin-access-token": adminAccessToken }, body: JSON.stringify({ paused: event.target.checked }) });
    if (!response.ok) throw new Error("Unable to change admissions.");
    await loadQueueMetrics();
  } catch (error) { showDashboardError(error.message); }
});
async function loadMonitorMetrics() {
  try {
    const response = await fetch("/api/admin/monitor", { headers: { "x-admin-access-token": adminAccessToken }, cache: "no-store" });
    if (!response.ok) throw new Error("Monitor unavailable");
    const data = await response.json();
    const maintenance = data.maintenanceUntil > Date.now();
    setText("monitorSummary", `${data.stale ? "Monitor unavailable or heartbeat overdue" : "Monitor running"}. DING ${data.notificationsEnabled ? "enabled" : "disabled"}${data.heartbeat ? `. Last sample: ${new Date(data.heartbeat).toLocaleString()}` : ""}${maintenance ? `. Maintenance until ${new Date(data.maintenanceUntil).toLocaleString()}` : ""}`);
    const sample = data.sample;
    setText("monitorResources", sample ? `Available memory: ${sample.memoryAvailable == null ? "Unknown" : `${Math.round(sample.memoryAvailable / 1024 ** 2)} MiB`}. CPU: ${sample.cpuPercent == null ? "Calculating" : `${sample.cpuPercent.toFixed(1)}%`}. ${sample.disks.map(disk => `Disk: ${disk.usedPercent.toFixed(1)}% used, ${(disk.available / 1024 ** 3).toFixed(1)} GiB available`).join(". ")}` : "");
    const list = document.querySelector("#monitorAlerts");
    list.replaceChildren();
    for (const alert of data.alerts) {
      const item = document.createElement("li");
      item.textContent = `${alert.level === 2 ? "Critical" : "Warning"}: ${alert.label}. ${alert.detail}`;
      item.style.overflowWrap = "anywhere";
      list.append(item);
    }
    const problems = data.deliveries.filter(event => event.status !== "sent");
    setText("monitorDelivery", problems.length ? problems.map(event => `${new Date(event.created).toLocaleString()}: DING ${event.status} (${event.key})`).join(". ") : data.deliveries.length ? "Recent DING notifications accepted." : "No notifications.");
  } catch { setText("monitorSummary", "Unable to read resource monitor status."); }
}
setInterval(() => { if (adminAccessToken && !document.hidden) { loadQueueMetrics().catch(() => {}); loadMonitorMetrics(); } }, 10000);

async function loadSignedInUser() {
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    const body = await response.json();
    if (body.user?.name) setText("adminUserName", body.user.name);
  } catch {
    setText("adminUserName", "DingTalk user");
  }
}

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  accessError.hidden = true;
  adminAccessToken = accessTokenInput.value.trim();
  if (!adminAccessToken) {
    accessError.textContent = "Enter the admin access token.";
    accessError.hidden = false;
    accessTokenInput.focus();
    return;
  }

  dashboard.hidden = false;
  try {
    await requestStatistics();
    accessPanel.hidden = true;
    accessTokenInput.value = "";
    dashboard.scrollIntoView({ block: "start" });
  } catch (error) {
    dashboard.hidden = true;
    accessError.textContent =
      error.code === "ADMIN_ACCESS_NOT_CONFIGURED"
        ? "The server administrator must set ADMIN_ACCESS_TOKEN before this page can be used."
        : error.message;
    accessError.hidden = false;
    adminAccessToken = "";
    accessTokenInput.select();
  }
});

toggleTokenButton.addEventListener("click", () => {
  const shouldShow = accessTokenInput.type === "password";
  accessTokenInput.type = shouldShow ? "text" : "password";
  toggleTokenButton.textContent = shouldShow ? "Hide" : "Show";
  accessTokenInput.focus();
});

refreshButton.addEventListener("click", () => {
  requestStatistics().catch(() => {});
});

lockButton.addEventListener("click", () => {
  adminAccessToken = "";
  statisticsContent.hidden = true;
  dashboard.hidden = true;
  accessPanel.hidden = false;
  accessError.hidden = true;
  accessTokenInput.value = "";
  accessTokenInput.type = "password";
  toggleTokenButton.textContent = "Show";
  accessTokenInput.focus();
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await fetch("/auth/logout", { method: "POST" });
  } finally {
    window.location.assign("/auth/dingtalk?redirect=%2Fadmin");
  }
});

loadSignedInUser();
