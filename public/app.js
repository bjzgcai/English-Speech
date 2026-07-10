const state = {
  profile: null,
  question: null,
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: null,
  mimeType: "",
  autoStopTimer: null,
  prepareCountdownTimer: null,
  prepareCountdownResolve: null,
  authUser: null,
  authReady: false,
};

const MAX_RECORDING_MS = 2 * 60 * 1000;
const PREPARE_COUNTDOWN_SECONDS = 60;
const dimensionDetails = {
  "Pronunciation / intelligibility":
    "Measures how easily the answer can be understood, including sound clarity, word stress, rhythm, and whether pronunciation issues interfere with meaning.",
  Fluency:
    "Measures how smoothly the answer is delivered, including pacing, hesitation, pauses, self-correction, and ability to keep speaking without long breakdowns.",
  Grammar:
    "Measures control of sentence structure, tense, agreement, word order, and how often errors distract from or obscure the intended meaning.",
  Vocabulary:
    "Measures range, precision, and appropriateness of word choice, including whether the speaker can use specific language instead of vague or repeated terms.",
  "Coherence / task relevance":
    "Measures how clearly the answer is organized, whether ideas connect logically, and whether the response directly addresses the question.",
  "Visual delivery":
    "Measures camera-facing communication cues such as posture, eye contact, facial engagement, and overall professional presence during the spoken answer.",
};
const profileForm = document.querySelector("#profileForm");
const generateButton = document.querySelector("#generateButton");
const finishButton = document.querySelector("#finishButton");
const preview = document.querySelector("#preview");
const videoFrame = document.querySelector(".video-frame");
const videoPlaceholder = document.querySelector("#videoPlaceholder");
const recordingBadge = document.querySelector("#recordingBadge");
const questionText = document.querySelector("#questionText");
const questionMeta = document.querySelector("#questionMeta");
const saveResult = document.querySelector("#saveResult");
const evaluationResult = document.querySelector("#evaluationResult");
const connectionStatus = document.querySelector("#connectionStatus");
const historyList = document.querySelector("#historyList");
const playView = document.querySelector("#playView");
const historyView = document.querySelector("#historyView");
const loginPanel = document.querySelector("#loginPanel");
const loginButton = document.querySelector("#loginButton");
const loginPanelButton = document.querySelector(".login-panel .login-button");
const authChip = document.querySelector("#authChip");
const authUserName = document.querySelector("#authUserName");
const logoutButton = document.querySelector("#logoutButton");
const navLinks = document.querySelectorAll("[data-route]");
const videoModal = document.querySelector("#videoModal");
const videoModalTitle = document.querySelector("#videoModalTitle");
const historyVideo = document.querySelector("#historyVideo");
const closeVideoModal = document.querySelector("#closeVideoModal");
const prepareModal = document.querySelector("#prepareModal");
const prepareSpinner = document.querySelector("#prepareSpinner");
const prepareModalKicker = document.querySelector("#prepareModalKicker");
const prepareModalTitle = document.querySelector("#prepareModalTitle");
const prepareModalMessage = document.querySelector("#prepareModalMessage");
const countdownDisplay = document.querySelector("#countdownDisplay");
const countdownSeconds = document.querySelector("#countdownSeconds");
const prepareCameraGuidance = document.querySelector("#prepareCameraGuidance");
const prepareActions = document.querySelector("#prepareActions");
const speakDirectlyButton = document.querySelector("#speakDirectlyButton");
const skipVideoButton = document.querySelector("#skipVideoButton");

function setStatus(message) {
  connectionStatus.textContent = message;
}

function setVideoLoading(isLoading) {
  videoFrame.classList.toggle("is-loading", isLoading);
  videoFrame.setAttribute("aria-busy", String(isLoading));
}

function updateAuthView() {
  const isSignedIn = Boolean(state.authUser);

  loginPanel.hidden = isSignedIn;
  loginButton.hidden = isSignedIn;
  authChip.hidden = !isSignedIn;
  playView.hidden = !isSignedIn || normalizeRoute(window.location.pathname) === "/history";
  historyView.hidden = !isSignedIn || normalizeRoute(window.location.pathname) !== "/history";
  authUserName.textContent = state.authUser?.name || "DingTalk user";
  const loginHref = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;
  loginButton.href = loginHref;
  loginPanelButton.href = loginHref;
}

async function checkAuth() {
  try {
    const response = await fetch("/api/me");
    const data = await response.json();
    state.authUser = data.user || null;
    state.authReady = true;

    if (!data.configured) {
      setStatus("Auth missing");
      loginPanel.hidden = false;
      loginPanel.querySelector("h2").textContent = "DingTalk authentication is not configured";
      loginPanel.querySelector("p:last-child").textContent =
        "Set DINGTALK_APP_KEY and DINGTALK_APP_SECRET in the server environment.";
      loginButton.hidden = true;
      loginPanelButton.hidden = true;
      playView.hidden = true;
      historyView.hidden = true;
      return;
    }

    setStatus(state.authUser ? "Signed in" : "Sign in");
    updateAuthView();
    if (state.authUser && normalizeRoute(window.location.pathname) === "/history") {
      await loadHistory();
    }
  } catch {
    setStatus("Auth error");
    loginPanel.hidden = false;
    playView.hidden = true;
    historyView.hidden = true;
  }
}

function stopPrepareCountdown() {
  if (state.prepareCountdownTimer) {
    window.clearInterval(state.prepareCountdownTimer);
    state.prepareCountdownTimer = null;
  }
}

function closePrepareModal() {
  stopPrepareCountdown();
  state.prepareCountdownResolve = null;
  prepareModal.hidden = true;
}

function showGeneratingModal() {
  stopPrepareCountdown();
  prepareModalKicker.textContent = "Generating";
  prepareModalTitle.textContent = "Preparing your question...";
  prepareModalMessage.textContent = "Please wait while the assessment question is generated.";
  prepareSpinner.hidden = false;
  prepareCameraGuidance.hidden = true;
  countdownDisplay.hidden = true;
  prepareActions.hidden = true;
  prepareModal.hidden = false;
}

function showCountdownModal(question) {
  prepareModalKicker.textContent = "Question ready";
  prepareModalTitle.textContent = question.question;
  prepareModalMessage.textContent = "Take a moment to plan your answer. Recording starts when the timer reaches zero.";
  prepareSpinner.hidden = true;
  prepareCameraGuidance.hidden = false;
  countdownDisplay.hidden = false;
  prepareActions.hidden = false;
  countdownSeconds.textContent = String(PREPARE_COUNTDOWN_SECONDS);
  prepareModal.hidden = false;
}

function waitForPreparationCountdown(question) {
  showCountdownModal(question);

  return new Promise((resolve) => {
    let remainingSeconds = PREPARE_COUNTDOWN_SECONDS;

    state.prepareCountdownResolve = (action = "record") => {
      stopPrepareCountdown();
      state.prepareCountdownResolve = null;
      resolve(action);
    };

    state.prepareCountdownTimer = window.setInterval(() => {
      remainingSeconds -= 1;
      countdownSeconds.textContent = String(Math.max(remainingSeconds, 0));

      if (remainingSeconds <= 0 && state.prepareCountdownResolve) {
        state.prepareCountdownResolve();
      }
    }, 1000);
  });
}

function getProfileFromForm() {
  const formData = new FormData(profileForm);
  return Object.fromEntries(formData.entries());
}

function getSupportedMimeType() {
  const candidates = [
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function setQuestion(question) {
  state.question = question;
  questionText.textContent = question.question;
  questionMeta.textContent = [
    question.focus ? `Focus: ${question.focus}` : "",
    question.expectedDurationSeconds
      ? `Target: ${question.expectedDurationSeconds} seconds`
      : "",
    question.followUp ? `Follow-up: ${question.followUp}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  saveResult.textContent = "";
  evaluationResult.innerHTML = "";
}

function stopStream() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
  }
  state.stream = null;
  preview.srcObject = null;
  videoPlaceholder.classList.remove("hidden");
}

async function loadHistory() {
  const response = await fetch("/api/recordings");
  if (response.status === 401) {
    state.authUser = null;
    updateAuthView();
    return;
  }
  const data = await response.json();
  const recordings = data.recordings || [];

  if (recordings.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No saved answers yet.</p>';
    return;
  }

  historyList.innerHTML = recordings
    .map((item, index) => renderHistoryItem(item, index))
    .join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[char];
  });
}

function dimensionTooltip(item) {
  const label = item.label || "Dimension";
  const weight = Number(item.weight || 0);
  const explanation =
    dimensionDetails[label] ||
    "Measures this part of speaking performance and how much it contributes to the total evaluation score.";

  return `
    <span class="tooltip-wrap">
      <button class="tooltip-trigger" type="button" aria-label="${escapeHtml(`${label} details`)}">?</button>
      <span class="dimension-tooltip" role="tooltip">
        <strong>Weight: ${weight}%</strong>
        <span>${escapeHtml(explanation)}</span>
      </span>
    </span>
  `;
}

function getEvaluationDimensions(evaluation) {
  const rubric = evaluation?.rubric || {};
  return [
    rubric.pronunciation,
    rubric.fluency,
    rubric.grammar,
    rubric.vocabulary,
    rubric.coherence,
    rubric.visualDelivery,
  ].filter(Boolean);
}

function renderScoreRows(evaluation) {
  return getEvaluationDimensions(evaluation)
    .map(
      (item) => `
        <article class="score-row">
          <div>
            <strong>${escapeHtml(item.label || "Dimension")}${dimensionTooltip(item)}</strong>
            <span>${Number(item.score || 0)} / 100</span>
          </div>
          <meter min="0" max="100" value="${Number(item.score || 0)}"></meter>
          <p>${escapeHtml(item.feedback || "")}</p>
        </article>
      `,
    )
    .join("");
}

function renderEvaluationContent(evaluation) {
  if (evaluation.status === "skipped") {
    return `
      <section class="evaluation-card">
        <h3>Evaluation skipped</h3>
        <p>${escapeHtml(evaluation.reason || "Evaluation is not configured.")}</p>
      </section>
    `;
  }

  if (evaluation.status === "failed") {
    return `
      <section class="evaluation-card evaluation-error">
        <h3>Evaluation failed</h3>
        <p>${escapeHtml(evaluation.reason || "The recording was saved, but evaluation did not complete.")}</p>
      </section>
    `;
  }

  const tips = evaluation.improvements || [];
  const strengths = evaluation.strengths || [];

  return `
    <section class="evaluation-card">
      <div class="evaluation-header">
        <div>
          <span class="muted-label">Evaluation</span>
          <h3>${Math.round(evaluation.overallScore || 0)} / 100</h3>
        </div>
        <span class="status-pill compact">${escapeHtml(evaluation.model?.evaluate || "LLM")}</span>
      </div>
      ${
        evaluation.transcript
          ? `
            <details class="transcript-block">
              <summary>Transcript</summary>
              <p>${escapeHtml(evaluation.transcript)}</p>
            </details>
          `
          : ""
      }
      <p class="evaluation-summary">${escapeHtml(evaluation.summary || "")}</p>
      <div class="score-grid">${renderScoreRows(evaluation)}</div>
      ${
        strengths.length || tips.length
          ? `
            <div class="feedback-columns">
              <div>
                <h4>Strengths</h4>
                <ul>${strengths.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
              <div>
                <h4>Improve next</h4>
                <ul>${tips.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
              </div>
            </div>
          `
          : ""
      }
    </section>
  `;
}

function renderEvaluation(evaluation) {
  if (!evaluation) {
    evaluationResult.innerHTML = "";
    return;
  }

  evaluationResult.innerHTML = renderEvaluationContent(evaluation);
}

function renderHistoryItem(item, index) {
  const title = item.question?.question || "Saved answer";
  const name = item.profile?.name || "Unnamed candidate";
  const date = item.finishedAt ? new Date(item.finishedAt).toLocaleString() : "Unknown date";
  const score =
    item.evaluation?.status === "completed"
      ? `${Math.round(item.evaluation.overallScore || 0)} / 100`
      : item.hasVideo === false
        ? "No video"
        : "Pending";
  const videoPath = item.path || "";

  return `
    <details class="history-collapse" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="history-title">${escapeHtml(title)}</span>
        <span class="history-meta">${escapeHtml(name)} · ${escapeHtml(date)} · ${escapeHtml(score)}</span>
      </summary>
      <div class="history-detail">
        ${
          item.hasVideo !== false && videoPath
            ? `
              <div class="history-actions">
                <button
                  type="button"
                  class="secondary-button video-link"
                  data-video-src="${escapeHtml(videoPath)}"
                  data-video-title="${escapeHtml(title)}"
                >
                  Open video
                </button>
              </div>
            `
            : '<p class="no-video-label">No video was recorded for this question.</p>'
        }
        ${item.evaluation ? renderEvaluationContent(item.evaluation) : '<p class="empty-history">No evaluation saved for this answer.</p>'}
      </div>
    </details>
  `;
}

function normalizeRoute(pathname) {
  return pathname === "/" ? "/play" : pathname;
}

function setRoute(pathname) {
  const route = normalizeRoute(pathname);
  const isHistory = route === "/history";

  playView.hidden = !state.authUser || isHistory;
  historyView.hidden = !state.authUser || !isHistory;
  loginPanel.hidden = Boolean(state.authUser);
  connectionStatus.hidden = isHistory;
  document.title = isHistory ? "History | EnglishEval" : "Practice | EnglishEval";
  navLinks.forEach((link) => {
    link.classList.toggle("active", normalizeRoute(link.dataset.route) === route);
  });

  if (!state.authUser) {
    setStatus(state.authReady ? "Sign in" : "Checking auth");
  } else if (isHistory) {
    setStatus("History");
    loadHistory().catch(() => {
      historyList.innerHTML = '<p class="empty-history">Unable to load saved answers.</p>';
    });
  } else {
    setStatus("Signed in");
  }
}

function navigateTo(pathname) {
  const normalized = normalizeRoute(pathname);
  window.history.pushState({}, "", normalized === "/play" ? "/" : normalized);
  setRoute(normalized);
}

function openVideoModal(src, title) {
  historyVideo.src = src;
  videoModalTitle.textContent = title || "Saved answer";
  videoModal.hidden = false;
}

function closeHistoryVideo() {
  historyVideo.pause();
  historyVideo.removeAttribute("src");
  historyVideo.load();
  videoModal.hidden = true;
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!state.authUser) {
    window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;
    return;
  }

  if (state.recorder && state.recorder.state !== "inactive") {
    saveResult.textContent = "Finish and save the current recording before generating another question.";
    return;
  }

  state.profile = getProfileFromForm();
  generateButton.disabled = true;
  finishButton.disabled = true;
  saveResult.textContent = "";
  setStatus("Generating");
  showGeneratingModal();
  questionText.textContent = "Generating a question...";
  questionMeta.textContent = "Calling OpenRouter through the local server.";

  try {
    const response = await fetch("/api/generate-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: state.profile }),
    });
    const data = await response.json();

    if (!response.ok && !data.question) {
      throw new Error(data.error || "Question generation failed.");
    }

    setQuestion(data.question);
    setStatus(response.ok ? "Question ready" : "Fallback ready");
    if (data.error) {
      saveResult.textContent = `LLM fallback used: ${data.error}`;
    }
    setStatus("Thinking time");
    const preparationAction = await waitForPreparationCountdown(data.question);
    closePrepareModal();
    if (preparationAction === "skip-video") {
      await saveAnswerWithoutVideo("Saved without a video recording.");
    } else {
      await startRecording();
    }
  } catch (error) {
    closePrepareModal();
    setStatus("Error");
    questionText.textContent = "Question generation failed.";
    questionMeta.textContent = error.message;
  } finally {
    if (!state.recorder || state.recorder.state === "inactive") {
      generateButton.disabled = false;
    }
  }
});

async function saveAnswerWithoutVideo(message) {
  if (!state.question) return;

  finishButton.disabled = true;
  generateButton.disabled = true;
  setStatus("Saving");
  saveResult.textContent = "Saving this question without a video recording...";
  evaluationResult.innerHTML = "";

  const formData = new FormData();
  formData.append("questionId", state.question.id);
  formData.append("startedAt", state.startedAt || new Date().toISOString());

  try {
    const response = await fetch("/api/save-answer", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Save failed.");
    }

    saveResult.textContent = `${message} It is available in your history.`;
    renderEvaluation(data.evaluation);
    setStatus("Saved without video");
    await loadHistory();
  } catch (error) {
    setStatus("Save failed");
    saveResult.textContent = error.message;
  } finally {
    generateButton.disabled = false;
  }
}

async function startRecording() {
  if (!state.question) return;

  try {
    state.mimeType = getSupportedMimeType();
    state.chunks = [];
    setVideoLoading(false);
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
    });

    if (state.stream.getAudioTracks().length === 0) {
      throw new Error("No microphone audio track was provided. Check the browser's microphone permission and try again.");
    }

    preview.srcObject = state.stream;
    videoPlaceholder.classList.add("hidden");

    const options = state.mimeType ? { mimeType: state.mimeType } : undefined;
    state.recorder = new MediaRecorder(state.stream, options);
    state.startedAt = new Date().toISOString();

    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        state.chunks.push(event.data);
      }
    });

    // Timed MP4 chunks are not reliably concatenable across MediaRecorder
    // implementations. Let the recorder finalize one complete file on stop.
    state.recorder.start();
    finishButton.disabled = false;
    generateButton.disabled = true;
    recordingBadge.classList.add("visible");
    setStatus("Recording");
    saveResult.textContent = "Recording in progress. Answer the question in English. Recording is limited to 2 minutes.";
    state.autoStopTimer = window.setTimeout(() => {
      finishRecording();
    }, MAX_RECORDING_MS);
  } catch (error) {
    setStatus("Camera blocked");
    stopStream();
    await saveAnswerWithoutVideo(`Unable to start the camera: ${error.message}`);
  }
}

async function finishRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;

  if (state.autoStopTimer) {
    window.clearTimeout(state.autoStopTimer);
    state.autoStopTimer = null;
  }

  finishButton.disabled = true;
  setStatus("Saving");
  saveResult.textContent = "Finalizing recording, uploading it, and evaluating the answer...";
  evaluationResult.innerHTML = "";
  setVideoLoading(true);

  const stopped = new Promise((resolve) => {
    state.recorder.addEventListener("stop", resolve, { once: true });
  });

  state.recorder.stop();
  await stopped;
  recordingBadge.classList.remove("visible");
  stopStream();

  const blobType = state.mimeType || state.chunks[0]?.type || "video/webm";
  const extension = blobType.includes("mp4") ? "mp4" : "webm";
  const videoBlob = new Blob(state.chunks, { type: blobType });
  const formData = new FormData();
  formData.append("video", videoBlob, `answer.${extension}`);
  formData.append("questionId", state.question.id);
  formData.append("startedAt", state.startedAt);

  try {
    const response = await fetch("/api/save-answer", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Save failed.");
    }

    saveResult.innerHTML = `Saved as <a href="${escapeHtml(data.path)}" target="_blank" rel="noreferrer">${escapeHtml(data.filename)}</a>. Generate the next question when ready.`;
    renderEvaluation(data.evaluation);
    setStatus(data.evaluation?.status === "completed" ? "Evaluated" : "Saved");
    generateButton.disabled = false;
    await loadHistory();
  } catch (error) {
    setStatus("Save failed");
    saveResult.textContent = error.message;
    generateButton.disabled = false;
  } finally {
    setVideoLoading(false);
    state.recorder = null;
    state.chunks = [];
  }
}

finishButton.addEventListener("click", finishRecording);

logoutButton.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  state.authUser = null;
  stopStream();
  navigateTo("/play");
  updateAuthView();
  setStatus("Sign in");
});

speakDirectlyButton.addEventListener("click", () => {
  if (state.prepareCountdownResolve) {
    state.prepareCountdownResolve("record");
  }
});

if (skipVideoButton) {
  skipVideoButton.addEventListener("click", () => {
    if (state.prepareCountdownResolve) {
      state.prepareCountdownResolve("skip-video");
    }
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    navigateTo(link.getAttribute("href"));
  });
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest(".video-link");
  if (!button) return;

  openVideoModal(button.dataset.videoSrc, button.dataset.videoTitle);
});

closeVideoModal.addEventListener("click", closeHistoryVideo);

window.addEventListener("popstate", () => {
  setRoute(window.location.pathname);
});

window.addEventListener("beforeunload", () => {
  if (state.autoStopTimer) {
    window.clearTimeout(state.autoStopTimer);
  }
  stopPrepareCountdown();
  stopStream();
});

setRoute(window.location.pathname);
checkAuth();
