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
  mediaRetryPending: false,
  mediaRetryAction: null,
  requiredDeviceInterrupted: null,
  mediaRequestInProgress: false,
  wakeLock: null,
  authUser: null,
  authReady: false,
  privacyConsent: null,
  privacyConsentResolve: null,
  shareEvaluations: new Map(),
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
const nameInput = document.querySelector("#name");
const generateButton = document.querySelector("#generateButton");
const finishButton = document.querySelector("#finishButton");
const preview = document.querySelector("#preview");
const preparePreview = document.querySelector("#preparePreview");
const preparePreviewWrap = document.querySelector("#preparePreviewWrap");
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
const prepareDialog = prepareModal.querySelector(".prepare-dialog");
const prepareSpinner = document.querySelector("#prepareSpinner");
const prepareModalKicker = document.querySelector("#prepareModalKicker");
const prepareModalTitle = document.querySelector("#prepareModalTitle");
const prepareModalMessage = document.querySelector("#prepareModalMessage");
const countdownDisplay = document.querySelector("#countdownDisplay");
const countdownSeconds = document.querySelector("#countdownSeconds");
const prepareCameraGuidance = document.querySelector("#prepareCameraGuidance");
const prepareGuidanceTitle = document.querySelector("#prepareGuidanceTitle");
const prepareGuidanceMessage = document.querySelector("#prepareGuidanceMessage");
const prepareActions = document.querySelector("#prepareActions");
const speakDirectlyButton = document.querySelector("#speakDirectlyButton");
const deviceStatus = document.querySelector("#deviceStatus");
const privacyConsentModal = document.querySelector("#privacyConsentModal");
const privacyPolicyAgree = document.querySelector("#privacyPolicyAgree");
const sensitiveInfoAgree = document.querySelector("#sensitiveInfoAgree");
const privacyConsentError = document.querySelector("#privacyConsentError");
const declinePrivacyButton = document.querySelector("#declinePrivacyButton");
const acceptPrivacyButton = document.querySelector("#acceptPrivacyButton");

function updatePrivacyAcceptButton() {
  acceptPrivacyButton.disabled = !(privacyPolicyAgree.checked && sensitiveInfoAgree.checked);
}

function closePrivacyConsentModal(agreed) {
  privacyConsentModal.hidden = true;
  document.body.classList.remove("modal-open");
  const resolve = state.privacyConsentResolve;
  state.privacyConsentResolve = null;
  if (!agreed) {
    privacyPolicyAgree.checked = false;
    sensitiveInfoAgree.checked = false;
    updatePrivacyAcceptButton();
  }
  resolve?.(agreed);
}

function requestPrivacyConsent() {
  privacyConsentError.hidden = true;
  privacyConsentError.textContent = "";
  privacyConsentModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => privacyPolicyAgree.focus(), 0);
  return new Promise((resolve) => {
    state.privacyConsentResolve = resolve;
  });
}

async function ensurePrivacyConsent() {
  if (state.privacyConsent === true) return true;

  try {
    const response = await fetch("/api/privacy-consent", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to check privacy consent.");
    state.privacyConsent = data.agreed === true;
  } catch (error) {
    saveResult.textContent = error.message;
    return false;
  }

  return state.privacyConsent || requestPrivacyConsent();
}

function updateDeviceStatus(status, message) {
  deviceStatus.dataset.status = status;
  deviceStatus.querySelectorAll("span").forEach((item) => {
    item.classList.toggle("is-ready", status === "ready");
    item.classList.toggle("is-error", status === "error");
    const label = item.dataset.device === "camera" ? "Camera" : "Microphone";
    const stateLabel = status === "ready"
      ? "ready"
      : status === "error"
        ? "needs attention"
        : status === "checking"
          ? "checking…"
          : "not checked";
    item.textContent = `${label} ${stateLabel}`;
  });
  if (message) {
    deviceStatus.setAttribute("aria-label", message);
  }
}

function getMediaErrorMessage(error) {
  if (!window.isSecureContext && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "Camera and microphone access requires a secure HTTPS connection.";
  }

  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Access was blocked. Open this site in your browser settings, allow Camera and Microphone, then return and try again.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "This phone could not find both a working camera and microphone.";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "Another app or browser tab may be using your camera or microphone. Close it, then try again.";
    case "OverconstrainedError":
      return "Your camera does not support the requested video settings. Try another browser or camera.";
    default:
      return error?.message || "Check your browser and phone privacy settings, then try again.";
  }
}

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
  nameInput.value = state.authUser?.name || "";
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
  document.body.classList.remove("modal-open");
}

function showGeneratingModal() {
  stopPrepareCountdown();
  prepareDialog.classList.remove("is-countdown");
  prepareModalKicker.textContent = "Generating";
  prepareModalTitle.textContent = "Preparing your question...";
  prepareModalMessage.textContent = "Please wait while the assessment question is generated.";
  prepareSpinner.hidden = false;
  preparePreviewWrap.hidden = !state.stream;
  prepareCameraGuidance.hidden = true;
  countdownDisplay.hidden = true;
  prepareActions.hidden = true;
  prepareModal.hidden = false;
  document.body.classList.add("modal-open");
  prepareDialog.scrollTop = 0;
}

function showCountdownModal(question) {
  state.mediaRetryPending = false;
  state.mediaRetryAction = null;
  prepareDialog.classList.add("is-countdown");
  prepareModalKicker.textContent = "Question ready";
  prepareModalTitle.textContent = question.question;
  prepareModalMessage.textContent = "Take a moment to plan your answer. Recording starts when the timer reaches zero.";
  prepareSpinner.hidden = true;
  preparePreviewWrap.hidden = !state.stream;
  prepareCameraGuidance.hidden = false;
  countdownDisplay.hidden = false;
  prepareActions.hidden = false;
  speakDirectlyButton.textContent = "Speak directly";
  countdownSeconds.textContent = String(PREPARE_COUNTDOWN_SECONDS);
  prepareModal.hidden = false;
  document.body.classList.add("modal-open");
  prepareDialog.scrollTop = 0;
}

function showMediaRequiredModal(error, retryAction = "record") {
  state.mediaRetryPending = true;
  state.mediaRetryAction = retryAction;
  prepareDialog.classList.remove("is-countdown");
  prepareModalKicker.textContent = "Devices required";
  prepareModalTitle.textContent = "Turn on your camera and microphone to continue";
  prepareModalMessage.textContent =
    "EnglishEval needs both devices to record and evaluate your answer. Allow camera and microphone access in your browser, then try again.";
  prepareSpinner.hidden = true;
  preparePreviewWrap.hidden = true;
  prepareCameraGuidance.hidden = false;
  prepareGuidanceTitle.textContent = "Camera and microphone are required";
  prepareGuidanceMessage.textContent = getMediaErrorMessage(error);
  countdownDisplay.hidden = true;
  prepareActions.hidden = false;
  speakDirectlyButton.textContent = "Try camera and microphone again";
  prepareModal.hidden = false;
  document.body.classList.add("modal-open");
  prepareDialog.scrollTop = 0;
}

function resetPrepareGuidance() {
  prepareGuidanceTitle.textContent = "Set up your camera and microphone";
  prepareGuidanceMessage.textContent =
    "Both must stay on for the entire answer. Stand about one metre away and make sure your full upper body and posture are visible.";
}

function getUnavailableRequiredDevice() {
  const audioTrack = state.stream?.getAudioTracks()[0];
  const videoTrack = state.stream?.getVideoTracks()[0];

  if (!audioTrack || audioTrack.readyState !== "live" || audioTrack.muted || !audioTrack.enabled) {
    return "microphone";
  }
  if (!videoTrack || videoTrack.readyState !== "live" || videoTrack.muted || !videoTrack.enabled) {
    return "camera";
  }
  return null;
}

async function acquireRequiredMedia() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser cannot access a camera and microphone. Use a supported browser and try again.");
  }

  if (state.stream && !getUnavailableRequiredDevice()) {
    return;
  }

  if (state.mediaRequestInProgress) {
    throw new Error("The camera and microphone request is already open. Respond to the browser prompt first.");
  }

  stopStream();
  state.mediaRequestInProgress = true;
  updateDeviceStatus("checking", "Waiting for camera and microphone permission");
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        aspectRatio: { ideal: 16 / 9 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } finally {
    state.mediaRequestInProgress = false;
  }

  const unavailableDevice = getUnavailableRequiredDevice();
  if (unavailableDevice) {
    throw new Error(`No usable ${unavailableDevice} was provided. Check its browser permission and try again.`);
  }

  preview.srcObject = state.stream;
  preparePreview.srcObject = state.stream;
  videoPlaceholder.classList.add("hidden");
  preparePreviewWrap.hidden = false;
  await Promise.allSettled([preview.play(), preparePreview.play()]);
  updateDeviceStatus("ready", "Camera and microphone are ready");
}

async function requireMediaBeforeQuestion() {
  setStatus("Checking camera & mic");
  try {
    if (!window.MediaRecorder) {
      throw new Error("This browser can open the camera but cannot record video. Update your browser or use current Safari or Chrome.");
    }
    await acquireRequiredMedia();
    state.mediaRetryPending = false;
    state.mediaRetryAction = null;
    resetPrepareGuidance();
    closePrepareModal();
    return true;
  } catch (error) {
    stopStream();
    updateDeviceStatus("error", "Camera and microphone need attention");
    finishButton.disabled = true;
    generateButton.disabled = true;
    setStatus("Camera & mic required");
    saveResult.textContent = "Turn on your camera and microphone before generating a question.";
    showMediaRequiredModal(error, "generate");
    return false;
  }
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

  if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") return "";
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
  preparePreview.srcObject = null;
  preparePreviewWrap.hidden = true;
  videoPlaceholder.classList.remove("hidden");
}

async function requestWakeLock() {
  if (!navigator.wakeLock?.request || state.wakeLock) return;
  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
    }, { once: true });
  } catch {
    // Wake Lock is optional; recording still works when it is unavailable.
  }
}

async function releaseWakeLock() {
  if (!state.wakeLock) return;
  const lock = state.wakeLock;
  state.wakeLock = null;
  await lock.release().catch(() => {});
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

function renderEvaluationContent(evaluation, shareId = "") {
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
      ${
        shareId
          ? `
            <div class="evaluation-share">
              <div class="evaluation-share-actions">
                <button
                  type="button"
                  class="secondary-button share-evaluation"
                  data-share-id="${escapeHtml(shareId)}"
                >
                  Share image
                </button>
                <button
                  type="button"
                  class="copy-image-button copy-evaluation"
                  data-share-id="${escapeHtml(shareId)}"
                >
                  Copy image
                </button>
              </div>
              <span class="share-feedback" role="status" aria-live="polite"></span>
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

  const shareId = evaluation.status === "completed" ? "latest" : "";
  if (shareId) state.shareEvaluations.set(shareId, evaluation);
  evaluationResult.innerHTML = renderEvaluationContent(evaluation, shareId);
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

function scoreBand(score) {
  if (score >= 90) return "Exceptional";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Competent";
  if (score >= 60) return "Developing";
  return "Keep building";
}

function shareDimensionLabel(label) {
  const labels = {
    "Pronunciation / intelligibility": "Pronunciation",
    "Coherence / task relevance": "Coherence",
  };
  return labels[label] || label || "Dimension";
}

function roundedRect(context, x, y, width, height, radius) {
  const corner = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + corner, y);
  context.arcTo(x + width, y, x + width, y + height, corner);
  context.arcTo(x + width, y + height, x, y + height, corner);
  context.arcTo(x, y + height, x, y, corner);
  context.arcTo(x, y, x + width, y, corner);
  context.closePath();
}

function loadShareImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to create the QR code."));
    image.src = src;
  });
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Unable to create the share image."));
    }, "image/png");
  });
}

async function createEvaluationShareImage(evaluation) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1350;
  const context = canvas.getContext("2d");
  const font = '"Avenir Next", Avenir, "Segoe UI", sans-serif';
  const score = Math.round(Number(evaluation.overallScore || 0));
  const dimensions = getEvaluationDimensions(evaluation);
  const qrImage = await loadShareImage(`/api/share-qr?v=1`);

  context.fillStyle = "#F2F4EF";
  context.fillRect(0, 0, canvas.width, canvas.height);

  roundedRect(context, 54, 54, 972, 1242, 24);
  context.fillStyle = "#FBFCF8";
  context.fill();

  roundedRect(context, 104, 104, 58, 58, 12);
  context.fillStyle = "#17201B";
  context.fill();
  context.fillStyle = "#FFFFFF";
  context.font = `800 28px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText("E", 133, 134);

  context.textAlign = "left";
  context.fillStyle = "#17201B";
  context.font = `750 27px ${font}`;
  context.fillText("EnglishEval", 184, 135);
  context.fillStyle = "#5D685F";
  context.font = `650 20px ${font}`;
  context.fillText("SPEAKING EVALUATION", 104, 226);

  context.fillStyle = "#17201B";
  context.font = `800 154px ${font}`;
  context.textBaseline = "alphabetic";
  context.fillText(String(score), 96, 410);
  const scoreWidth = context.measureText(String(score)).width;
  context.fillStyle = "#5D685F";
  context.font = `700 35px ${font}`;
  context.fillText("/ 100", 110 + scoreWidth, 404);

  roundedRect(context, 735, 286, 198, 62, 12);
  context.fillStyle = "#E4E9E2";
  context.fill();
  context.fillStyle = "#0D4E3B";
  context.font = `800 23px ${font}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(scoreBand(score), 834, 318);

  context.textAlign = "left";
  context.textBaseline = "alphabetic";
  context.fillStyle = "#CCD4CC";
  context.fillRect(104, 458, 872, 2);

  dimensions.forEach((dimension, index) => {
    const y = 518 + index * 82;
    const dimensionScore = Math.max(0, Math.min(100, Number(dimension.score || 0)));
    context.fillStyle = "#17201B";
    context.font = `700 24px ${font}`;
    context.fillText(shareDimensionLabel(dimension.label), 104, y);
    context.fillStyle = "#5D685F";
    context.font = `750 22px ${font}`;
    context.textAlign = "right";
    context.fillText(String(Math.round(dimensionScore)), 976, y);
    context.textAlign = "left";

    roundedRect(context, 104, y + 20, 872, 12, 6);
    context.fillStyle = "#E4E9E2";
    context.fill();
    if (dimensionScore > 0) {
      roundedRect(context, 104, y + 20, 872 * (dimensionScore / 100), 12, 6);
      context.fillStyle = "#176B53";
      context.fill();
    }
  });

  context.fillStyle = "#CCD4CC";
  context.fillRect(104, 1030, 872, 2);
  context.fillStyle = "#17201B";
  context.font = `800 34px ${font}`;
  context.fillText("How clear is your English?", 104, 1104);
  context.fillStyle = "#5D685F";
  context.font = `600 23px ${font}`;
  context.fillText("Scan to examine your spoken response.", 104, 1146);
  context.fillStyle = "#0D4E3B";
  context.font = `750 22px ${font}`;
  context.fillText(window.location.host, 104, 1194);

  roundedRect(context, 774, 1063, 202, 202, 12);
  context.fillStyle = "#FFFFFF";
  context.fill();
  context.drawImage(qrImage, 785, 1074, 180, 180);

  return canvasBlob(canvas);
}

function saveShareImage(file) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareEvaluation(button) {
  const evaluation = state.shareEvaluations.get(button.dataset.shareId);
  const feedback = button.closest(".evaluation-share")?.querySelector(".share-feedback");
  if (!evaluation) {
    if (feedback) feedback.textContent = "This evaluation is no longer available.";
    return;
  }

  const actionButtons = button.closest(".evaluation-share")?.querySelectorAll("button") || [button];
  actionButtons.forEach((item) => { item.disabled = true; });
  if (feedback) feedback.textContent = "Creating image…";
  try {
    const blob = await createEvaluationShareImage(evaluation);
    const score = Math.round(Number(evaluation.overallScore || 0));
    const file = new File([blob], `english-evaluation-${score}.png`, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      if (feedback) feedback.textContent = "Image shared.";
    } else {
      saveShareImage(file);
      if (feedback) feedback.textContent = "Image saved. You can share it anywhere.";
    }
  } catch (error) {
    if (error?.name !== "AbortError" && feedback) {
      feedback.textContent = error.message || "Unable to share this evaluation.";
    } else if (feedback) {
      feedback.textContent = "";
    }
  } finally {
    actionButtons.forEach((item) => { item.disabled = false; });
  }
}

async function copyEvaluation(button) {
  const evaluation = state.shareEvaluations.get(button.dataset.shareId);
  const shareBlock = button.closest(".evaluation-share");
  const feedback = shareBlock?.querySelector(".share-feedback");
  if (!evaluation) {
    if (feedback) feedback.textContent = "This evaluation is no longer available.";
    return;
  }

  const actionButtons = shareBlock?.querySelectorAll("button") || [button];
  actionButtons.forEach((item) => { item.disabled = true; });
  if (feedback) feedback.textContent = "Creating image…";
  try {
    const blob = await createEvaluationShareImage(evaluation);
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      const score = Math.round(Number(evaluation.overallScore || 0));
      saveShareImage(new File([blob], `english-evaluation-${score}.png`, { type: "image/png" }));
      if (feedback) feedback.textContent = "Clipboard images are not supported here, so the image was saved instead.";
      return;
    }

    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    if (feedback) feedback.textContent = "One image copied.";
  } catch (error) {
    if (feedback) feedback.textContent = error.message || "Unable to copy this evaluation.";
  } finally {
    actionButtons.forEach((item) => { item.disabled = false; });
  }
}

function normalizeRoute(pathname) {
  return pathname === "/" || pathname === "/practice" ? "/examine" : pathname;
}

function setRoute(pathname) {
  const route = normalizeRoute(pathname);
  const isHistory = route === "/history";

  playView.hidden = !state.authUser || isHistory;
  historyView.hidden = !state.authUser || !isHistory;
  loginPanel.hidden = Boolean(state.authUser);
  connectionStatus.hidden = isHistory;
  document.title = isHistory ? "History | EnglishEval" : "Examine | EnglishEval";
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
  window.history.pushState({}, "", normalized === "/examine" ? "/" : normalized);
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

  generateButton.disabled = true;
  const privacyReady = await ensurePrivacyConsent();
  if (!privacyReady) {
    generateButton.disabled = false;
    setStatus("Privacy consent required");
    return;
  }

  finishButton.disabled = true;
  saveResult.textContent = "";
  const mediaReady = await requireMediaBeforeQuestion();
  if (!mediaReady) return;

  state.profile = getProfileFromForm();
  setStatus("Generating");
  showGeneratingModal();
  questionText.textContent = "Generating a question...";
  questionMeta.textContent = "Calling the internally deployed model through the local server.";

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
    await waitForPreparationCountdown(data.question);
    closePrepareModal();
    await startRecording();
  } catch (error) {
    closePrepareModal();
    stopStream();
    setStatus("Error");
    questionText.textContent = "Question generation failed.";
    questionMeta.textContent = error.message;
  } finally {
    if ((!state.recorder || state.recorder.state === "inactive") && !state.mediaRetryPending) {
      generateButton.disabled = false;
    }
  }
});

async function startRecording() {
  if (!state.question) return;

  try {
    state.mimeType = getSupportedMimeType();
    state.chunks = [];
    state.requiredDeviceInterrupted = null;
    setVideoLoading(false);
    await acquireRequiredMedia();

    const requiredTracks = [
      ...state.stream.getAudioTracks(),
      ...state.stream.getVideoTracks(),
    ];
    const handleRequiredDeviceUnavailable = () => {
      if (!state.recorder || state.recorder.state === "inactive") return;
      const unavailableTrack = requiredTracks.find(
        (track) => track.readyState !== "live" || track.muted || !track.enabled,
      );
      if (!unavailableTrack) return;

      state.requiredDeviceInterrupted = unavailableTrack.kind === "audio" ? "microphone" : "camera";
      saveResult.textContent = `${unavailableTrack.kind === "audio" ? "Microphone" : "Camera"} turned off. Turn it back on, then record the answer again.`;
      setStatus("Device turned off");
    };
    requiredTracks.forEach((track) => {
      track.addEventListener("mute", handleRequiredDeviceUnavailable);
      track.addEventListener("ended", handleRequiredDeviceUnavailable);
    });

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
    await requestWakeLock();
    state.mediaRetryPending = false;
    state.mediaRetryAction = null;
    resetPrepareGuidance();
    closePrepareModal();
    finishButton.disabled = false;
    generateButton.disabled = true;
    logoutButton.disabled = true;
    recordingBadge.classList.add("visible");
    setStatus("Recording");
    saveResult.textContent = "Recording in progress. Answer the question in English. Recording is limited to 2 minutes.";
    state.autoStopTimer = window.setTimeout(() => {
      finishRecording();
    }, MAX_RECORDING_MS);
  } catch (error) {
    setStatus("Camera & mic required");
    stopStream();
    await releaseWakeLock();
    updateDeviceStatus("error", "Camera and microphone need attention");
    finishButton.disabled = true;
    generateButton.disabled = true;
    logoutButton.disabled = false;
    saveResult.textContent = "Turn on your camera and microphone to record this answer.";
    showMediaRequiredModal(error, "record");
  }
}

async function finishRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;

  const unavailableDevice = state.requiredDeviceInterrupted || getUnavailableRequiredDevice();
  if (unavailableDevice) {
    if (state.autoStopTimer) {
      window.clearTimeout(state.autoStopTimer);
      state.autoStopTimer = null;
    }

    finishButton.disabled = true;
    const stopped = new Promise((resolve) => {
      state.recorder.addEventListener("stop", resolve, { once: true });
    });
    state.recorder.stop();
    await stopped;
    stopStream();
    await releaseWakeLock();
    state.recorder = null;
    state.chunks = [];
    logoutButton.disabled = false;
    recordingBadge.classList.remove("visible");
    showMediaRequiredModal(new Error(
      `Your ${unavailableDevice} is off. Turn it on and record the answer again; this incomplete recording will not be saved.`,
    ));
    setStatus("Record again");
    saveResult.textContent = `Your ${unavailableDevice} was turned off, so the incomplete recording was not saved.`;
    return;
  }

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
  await releaseWakeLock();

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
    logoutButton.disabled = false;
  }
}

finishButton.addEventListener("click", finishRecording);

logoutButton.addEventListener("click", async () => {
  await fetch("/auth/logout", { method: "POST" });
  state.authUser = null;
  state.privacyConsent = null;
  stopStream();
  navigateTo("/examine");
  updateAuthView();
  setStatus("Sign in");
});

privacyPolicyAgree.addEventListener("change", updatePrivacyAcceptButton);
sensitiveInfoAgree.addEventListener("change", updatePrivacyAcceptButton);

declinePrivacyButton.addEventListener("click", () => {
  closePrivacyConsentModal(false);
});

acceptPrivacyButton.addEventListener("click", async () => {
  if (!privacyPolicyAgree.checked || !sensitiveInfoAgree.checked) return;

  acceptPrivacyButton.disabled = true;
  declinePrivacyButton.disabled = true;
  privacyConsentError.hidden = true;
  try {
    const response = await fetch("/api/privacy-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }),
    });
    const data = await response.json();
    if (!response.ok || data.agreed !== true) {
      throw new Error(data.error || "Unable to save your privacy consent.");
    }
    state.privacyConsent = true;
    closePrivacyConsentModal(true);
  } catch (error) {
    privacyConsentError.textContent = error.message;
    privacyConsentError.hidden = false;
    acceptPrivacyButton.disabled = false;
  } finally {
    declinePrivacyButton.disabled = false;
  }
});

speakDirectlyButton.addEventListener("click", () => {
  if (state.mediaRetryPending) {
    if (state.mediaRetryAction === "generate") {
      state.mediaRetryPending = false;
      state.mediaRetryAction = null;
      profileForm.requestSubmit();
    } else {
      startRecording();
    }
    return;
  }
  if (state.prepareCountdownResolve) {
    state.prepareCountdownResolve("record");
  }
});

navLinks.forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    if (state.recorder && state.recorder.state !== "inactive") {
      setStatus("Recording");
      saveResult.textContent = "Finish and save before leaving the recording screen.";
      return;
    }
    navigateTo(link.getAttribute("href"));
  });
});

evaluationResult.addEventListener("click", (event) => {
  const shareButton = event.target.closest(".share-evaluation");
  if (shareButton) {
    shareEvaluation(shareButton);
    return;
  }

  const copyButton = event.target.closest(".copy-evaluation");
  if (copyButton) copyEvaluation(copyButton);
});

historyList.addEventListener("click", (event) => {
  const button = event.target.closest(".video-link");
  if (!button) return;

  openVideoModal(button.dataset.videoSrc, button.dataset.videoTitle);
});

closeVideoModal.addEventListener("click", closeHistoryVideo);

window.addEventListener("popstate", () => {
  if (state.recorder && state.recorder.state !== "inactive") {
    window.history.pushState({}, "", "/");
    setRoute("/examine");
    saveResult.textContent = "Finish and save before leaving the recording screen.";
    return;
  }
  setRoute(window.location.pathname);
});

window.addEventListener("beforeunload", (event) => {
  if (state.recorder && state.recorder.state !== "inactive") {
    event.preventDefault();
    event.returnValue = "";
    return;
  }
  if (state.autoStopTimer) {
    window.clearTimeout(state.autoStopTimer);
  }
  stopPrepareCountdown();
  stopStream();
});

document.addEventListener("visibilitychange", () => {
  if (!state.recorder || state.recorder.state === "inactive") return;
  if (document.hidden) {
    setStatus("Keep page open");
    saveResult.textContent = "Keep this page in the foreground. Mobile browsers may pause the camera when you switch apps or lock the screen.";
  } else if (!getUnavailableRequiredDevice()) {
    setStatus("Recording");
    requestWakeLock();
  }
});

setRoute(window.location.pathname);
checkAuth();
