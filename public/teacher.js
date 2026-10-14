// Teacher console: weekly standings with playback, AI integrity flags, and
// CSV export. Mirrors the learner leaderboard UI but reads /api/teacher/*,
// which is allow-listed server-side.
(function () {
  "use strict";

  var GROUP_STORAGE_KEY = "oscanner-game-group";

  var topic = document.getElementById("teacherTopic");
  var weekSelect = document.getElementById("teacherWeek");
  var groupPicker = document.getElementById("teacherGroupPicker");
  var summary = document.getElementById("teacherSummary");
  var list = document.getElementById("teacherList");
  var exportCurrent = document.getElementById("exportCurrent");
  var exportAll = document.getElementById("exportAll");

  var videoModal = document.getElementById("videoModal");
  var videoModalTitle = document.getElementById("videoModalTitle");
  var historyVideo = document.getElementById("historyVideo");
  var videoModalTranscript = document.getElementById("videoModalTranscript");
  var videoModalTranscriptQuestion = document.getElementById("videoModalTranscriptQuestion");
  var videoModalTranscriptText = document.getElementById("videoModalTranscriptText");
  var closeVideoModal = document.getElementById("closeVideoModal");

  var state = { group: "g1", challenges: [] };

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (char) {
      var map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[char];
    });
  }

  function formatChallengeRange(challenge) {
    if (!challenge || !challenge.startsAt || !challenge.endsAt) return "Weekly challenge";
    var options = { month: "short", day: "numeric", timeZone: "Asia/Shanghai" };
    var start = new Intl.DateTimeFormat("en-US", options).format(new Date(challenge.startsAt));
    var end = new Intl.DateTimeFormat("en-US", options).format(new Date(challenge.endsAt));
    var year = new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(challenge.startsAt));
    return start + " - " + end + ", " + year;
  }

  function readStoredGroup() {
    try {
      var stored = window.localStorage.getItem(GROUP_STORAGE_KEY);
      return stored === "g2" ? "g2" : stored === "g1" ? "g1" : null;
    } catch { return null; }
  }

  function storeGroup(group) {
    try { window.localStorage.setItem(GROUP_STORAGE_KEY, group); } catch { /* Private mode. */ }
  }

  function setGroup(group, touchStorage) {
    state.group = group === "g2" ? "g2" : "g1";
    var input = groupPicker.querySelector('input[value="' + state.group + '"]');
    if (input) input.checked = true;
    if (touchStorage) storeGroup(state.group);
  }

  // The AI verdict is a one-time heuristic LLM inference, never acoustic
  // proof; the icon says "possibly AI-generated", not "cheated".
  function suspiciousBadge(entry) {
    var verdict = entry.aiSuspicious;
    if (!verdict || verdict.state === "none" || verdict.state === "failed") return "";
    if (verdict.state === "pending") {
      return '<span class="teacher-ai teacher-ai-pending" title="AI check pending" role="img" aria-label="AI check pending">⏳</span>';
    }
    if (verdict.suspicious) {
      var reason = escapeHtml(verdict.reason || "Possibly AI-generated");
      return '<span class="teacher-ai teacher-ai-flag" title="' + reason + '" role="img" aria-label="Possibly AI-generated">⚠</span>';
    }
    return "";
  }

  // Challenge ids are group-scoped (g2 ids carry a "-g2" suffix), so keep the
  // selected week across a group switch by start date, which both groups share.
  // The selected week rides in ?challengeId= so a reload or a shared link
  // keeps the choice; /teacher without the param still means the current week.
  function syncWeekUrl(challengeId) {
    try {
      var url = new URL(window.location.href);
      if (challengeId) url.searchParams.set("challengeId", challengeId);
      else url.searchParams.delete("challengeId");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* Older browsers keep the plain URL. */ }
  }

  function readWeekParam() {
    try {
      return new URLSearchParams(window.location.search).get("challengeId") || null;
    } catch { return null; }
  }

  function selectedStartsAt() {
    var challenge = state.challenges.find(function (item) { return item.id === weekSelect.value; });
    return challenge ? challenge.startsAt : null;
  }

  function render(data) {
    topic.textContent = (data.challenge.title || "") + ". " + formatChallengeRange(data.challenge) + ".";

    state.challenges = data.challenges || [];
    var previous = weekSelect.value;
    weekSelect.innerHTML = state.challenges
      .map(function (challenge, index) {
        var prefix = index === 0 ? "Current: " : "";
        return '<option value="' + escapeHtml(challenge.id) + '">' + escapeHtml(prefix + formatChallengeRange(challenge) + " | " + challenge.title) + "</option>";
      })
      .join("");
    if (state.challenges.some(function (challenge) { return challenge.id === previous; })) {
      weekSelect.value = previous;
    } else {
      weekSelect.value = data.challenge.id;
    }
    // No param means the current week, so only older weeks (and the kept
    // week after a group switch) need to be encoded in the URL.
    var currentId = state.challenges[0] ? state.challenges[0].id : data.challenge.id;
    syncWeekUrl(weekSelect.value && weekSelect.value !== currentId ? weekSelect.value : null);

    exportCurrent.href = "/api/teacher/export?group=" + encodeURIComponent(state.group) + "&challengeId=" + encodeURIComponent(weekSelect.value || data.challenge.id);

    var count = data.participantCount || 0;
    summary.textContent = count
      ? count + (count === 1 ? " player" : " players") + " completed this task."
      : "No completed answers yet for this task.";
    list.title = summary.textContent;

    if (!data.entries || !data.entries.length) {
      list.innerHTML = '<li class="leaderboard-empty">The board is ready for its first completed answer.</li>';
      return;
    }

    list.innerHTML = data.entries
      .map(function (entry) {
        var play = entry.answerId
          ? '<button type="button" class="leaderboard-play" data-answer-id="' + escapeHtml(entry.answerId) + '" data-answer-name="' + escapeHtml(entry.name) + '" aria-label="Play ' + escapeHtml(entry.name) + '\'s answer" title="Play answer"><span aria-hidden="true">▶</span></button>'
          : "";
        return '<li class="leaderboard-row' + (entry.answerId ? " has-media" : "") + '">' +
          '<span class="leaderboard-rank" aria-label="Rank ' + entry.rank + '">' +
            '<span aria-hidden="true">' + (entry.rank <= 3 ? "★" : "#") + "</span>" +
            "<strong>" + entry.rank + "</strong>" +
          "</span>" +
          '<span class="leaderboard-person" title="' + escapeHtml(entry.attempts) + " " + (entry.attempts === 1 ? "attempt" : "attempts") + ' submitted">' +
            "<strong>" + escapeHtml(entry.name) + "</strong>" +
          "</span>" +
          '<span class="teacher-score-cell">' +
            suspiciousBadge(entry) +
            '<span class="leaderboard-score" aria-label="' + escapeHtml(entry.score) + ' points"><strong>' + escapeHtml(entry.score) + "</strong><small>pts</small></span>" +
          "</span>" +
          play +
          "</li>";
      })
      .join("");
  }

  async function load(challengeId, restoreStartsAt) {
    list.setAttribute("aria-busy", "true");
    summary.textContent = "Loading weekly standings...";
    list.innerHTML = '<li class="leaderboard-loading">Loading leaderboard...</li>';
    try {
      var params = new URLSearchParams({ group: state.group });
      if (challengeId) params.set("challengeId", challengeId);
      var response = await window.VisitorSession.fetch("/api/teacher/leaderboard?" + params.toString(), { cache: "no-store" });
      var data = await response.json();
      if (response.status === 401 || response.status === 403) {
        summary.textContent = "";
        list.innerHTML = '<li class="leaderboard-error">The teacher console is not available for your account.</li>';
        return;
      }
      if (!response.ok) throw new Error(data.error || "Unable to load the leaderboard.");
      var restored = restoreStartsAt
        ? (data.challenges || []).find(function (challenge) { return challenge.startsAt === restoreStartsAt; })
        : null;
      // The default payload is the current week; an older restored week needs
      // one more request so the board matches the kept selection.
      if (restored && restored.id !== data.challenge.id) return load(restored.id);
      // A ?challengeId= the group no longer has (stale link, or an id that
      // belongs to the other group) falls back to the current week instead
      // of surfacing the 400 error.
      if (!restored && challengeId && !(data.challenges || []).some(function (challenge) { return challenge.id === challengeId; })) {
        syncWeekUrl(null);
        return load(null, restoreStartsAt);
      }
      render(data);
    } catch (error) {
      summary.textContent = "";
      list.innerHTML = '<li class="leaderboard-error">' + escapeHtml(error.message) + "</li>";
    } finally {
      list.setAttribute("aria-busy", "false");
    }
  }

  function openVideoModal(src, title) {
    historyVideo.src = src;
    videoModalTitle.textContent = title || "Saved answer";
    videoModalTranscript.hidden = true;
    videoModalTranscriptQuestion.hidden = true;
    videoModalTranscriptQuestion.textContent = "";
    videoModalTranscriptText.textContent = "";
    videoModal.hidden = false;
  }

  function showTranscript(transcript, question) {
    var text = typeof transcript === "string" ? transcript.trim() : "";
    if (!text) {
      videoModalTranscript.hidden = true;
      return;
    }
    videoModalTranscriptQuestion.textContent = typeof question === "string" ? question.trim() : "";
    videoModalTranscriptQuestion.hidden = !videoModalTranscriptQuestion.textContent;
    videoModalTranscriptText.textContent = text;
    videoModalTranscript.hidden = false;
  }

  async function openAnswer(button) {
    var answerId = button.dataset.answerId;
    if (!answerId) return;
    openVideoModal(
      "/api/game/leaderboard-answers/" + encodeURIComponent(answerId) + "/media",
      (button.dataset.answerName || "Saved answer") + " — saved answer",
    );
    try {
      var response = await window.VisitorSession.fetch(
        "/api/game/leaderboard-answers/" + encodeURIComponent(answerId) + "/transcript",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Transcript unavailable.");
      var data = await response.json();
      showTranscript(data.transcript, data.question);
    } catch {
      showTranscript("");
    }
  }

  list.addEventListener("click", function (event) {
    var button = event.target instanceof Element ? event.target.closest(".leaderboard-play") : null;
    if (button) openAnswer(button);
  });

  weekSelect.addEventListener("change", function () {
    exportCurrent.href = "/api/teacher/export?group=" + encodeURIComponent(state.group) + "&challengeId=" + encodeURIComponent(weekSelect.value);
    load(weekSelect.value);
  });

  groupPicker.addEventListener("change", function (event) {
    var input = event.target.closest("input[type=radio]");
    if (!input || input.disabled) return;
    // Capture the week before switching: its id belongs to the old group.
    var startsAt = selectedStartsAt();
    setGroup(input.value, true);
    load(null, startsAt);
  });

  closeVideoModal.addEventListener("click", function () {
    historyVideo.pause();
    historyVideo.removeAttribute("src");
    historyVideo.load();
    videoModal.hidden = true;
    videoModalTranscript.hidden = true;
  });

  setGroup(readStoredGroup() || "g1", false);
  load(readWeekParam());
})();
