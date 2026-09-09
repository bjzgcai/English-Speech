const state = {
  profile: null,
  question: null,
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: null,
  mimeType: "",
  autoStopTimer: null,
  recordingTimer: null,
  recordingStartedAtMs: null,
  prepareCountdownTimer: null,
  prepareCountdownResolve: null,
  mediaRetryPending: false,
  mediaRetryAction: null,
  requiredDeviceInterrupted: null,
  mediaRequestInProgress: false,
  wakeLock: null,
  authUser: null,
  authReady: false,
  inAppAuthAttempted: false,
  privacyConsent: null,
  privacyConsentResolve: null,
  saveAbortController: null,
  activeSaveId: null,
  discardTargetSaveId: null,
  discardRequested: false,
  discardInProgress: false,
  gameChallenge: null,
  gameChallenges: [],
  leaderboardIdentity: null,
  activeMode: null,
  experienceRatingScore: null,
  experienceRatingTags: [],
  experienceRatingSubmitting: false,
};

const MAX_RECORDING_MS = 2 * 60 * 1000;
const PREPARE_COUNTDOWN_SECONDS = 120;
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
const nameField = document.querySelector("#nameField");
const generateButton = document.querySelector("#generateButton");
const finishButton = document.querySelector("#finishButton");
const discardButton = document.querySelector("#discardButton");
const controlRow = document.querySelector(".control-row");
const recorderPanel = document.querySelector(".recorder-panel");
const recorderPanelHome = recorderPanel.parentNode;
const recorderPanelHomeNextSibling = recorderPanel.nextSibling;
const preview = document.querySelector("#preview");
const preparePreview = document.querySelector("#preparePreview");
const preparePreviewWrap = document.querySelector("#preparePreviewWrap");
const videoFrame = document.querySelector(".video-frame");
const videoPlaceholder = document.querySelector("#videoPlaceholder");
const recordingBadge = document.querySelector("#recordingBadge");
const recordingElapsed = document.querySelector("#recordingElapsed");
const recordingRemaining = document.querySelector("#recordingRemaining");
const recordingProgress = document.querySelector("#recordingProgress");
const questionText = document.querySelector("#questionText");
const questionMeta = document.querySelector("#questionMeta");
const saveResult = document.querySelector("#saveResult");
const evaluationResult = document.querySelector("#evaluationResult");
const experienceRatingPrompt = document.querySelector("#experienceRatingPrompt");
const experienceRatingDetails = document.querySelector("#experienceRatingDetails");
const experienceRatingTagQuestion = document.querySelector("#experienceRatingTagQuestion");
const experienceRatingTags = document.querySelector("#experienceRatingTags");
const experienceRatingError = document.querySelector("#experienceRatingError");
const submitExperienceRatingButton = document.querySelector("#submitExperienceRating");
const dismissExperienceRatingButton = document.querySelector("#dismissExperienceRating");
const experienceRatingScoreButtons = document.querySelectorAll("[data-rating-score]");
const connectionStatus = document.querySelector("#connectionStatus");
const playEyebrow = document.querySelector("#playEyebrow");
const playTitle = document.querySelector("#playTitle");
const playSummary = document.querySelector("#playSummary");
const gameOverview = document.querySelector("#gameOverview");
const gameWeekLabel = document.querySelector("#gameWeekLabel");
const gameTopicTitle = document.querySelector("#gameTopicTitle");
const gameTopicQuestion = document.querySelector("#gameTopicQuestion");
const profileHeading = document.querySelector("#profileHeading");
const profileSummary = document.querySelector("#profileSummary");
const roleField = document.querySelector("#roleField");
const leaderboardTopic = document.querySelector("#leaderboardTopic");
const leaderboardWeek = document.querySelector("#leaderboardWeek");
const leaderboardSummary = document.querySelector("#leaderboardSummary");
const leaderboardList = document.querySelector("#leaderboardList");
const leaderboardIdentitySettings = document.querySelector("#leaderboardIdentitySettings");
const prizeDraft = document.querySelector("#prizeDraft");
const historyList = document.querySelector("#historyList");
const playView = document.querySelector("#playView");
const leaderboardView = document.querySelector("#leaderboardView");
const historyView = document.querySelector("#historyView");
const loginPanel = document.querySelector("#loginPanel");
const loginButton = document.querySelector("#loginButton");
const loginPanelButton = document.querySelector(".login-panel .login-button");
const authChip = document.querySelector("#authChip");
const authUserName = document.querySelector("#authUserName");
const invitationLink = document.querySelector("[data-invitation-link]");
const logoutButton = document.querySelector("#logoutButton");
const navLinks = document.querySelectorAll(".main-nav [data-route]");
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
const recorderModalSlot = document.querySelector("#recorderModalSlot");
const deviceStatus = document.querySelector("#deviceStatus");
const privacyConsentModal = document.querySelector("#privacyConsentModal");
const privacyPolicyAgree = document.querySelector("#privacyPolicyAgree");
const sensitiveInfoAgree = document.querySelector("#sensitiveInfoAgree");
const privacyConsentError = document.querySelector("#privacyConsentError");
const declinePrivacyButton = document.querySelector("#declinePrivacyButton");
const acceptPrivacyButton = document.querySelector("#acceptPrivacyButton");
const discardModal = document.querySelector("#discardModal");
const discardError = document.querySelector("#discardError");
const keepAnswerButton = document.querySelector("#keepAnswerButton");
const confirmDiscardButton = document.querySelector("#confirmDiscardButton");
const experienceRatingReasons = {
  positive: [
    "Clear workflow",
    "Fast and responsive",
    "Helpful feedback",
    "Recording was easy",
  ],
  negative: [
    "Workflow was unclear",
    "Page felt slow",
    "Feedback was not useful",
    "Recording had issues",
  ],
};

function setExperienceRatingSubmitting(submitting) {
  state.experienceRatingSubmitting = submitting;
  submitExperienceRatingButton.disabled = submitting;
  dismissExperienceRatingButton.disabled = submitting;
  experienceRatingScoreButtons.forEach((button) => {
    button.disabled = submitting;
  });
  experienceRatingTags.querySelectorAll("button").forEach((button) => {
    button.disabled = submitting;
  });
  submitExperienceRatingButton.textContent = submitting ? "Submitting…" : "Submit rating";
}

function hideExperienceRating() {
  experienceRatingPrompt.hidden = true;
  experienceRatingError.hidden = true;
  experienceRatingError.textContent = "";
}

function resetExperienceRating() {
  state.experienceRatingScore = null;
  state.experienceRatingTags = [];
  setExperienceRatingSubmitting(false);
  experienceRatingDetails.hidden = true;
  experienceRatingTags.replaceChildren();
  experienceRatingScoreButtons.forEach((button) => {
    button.classList.remove("selected");
    button.setAttribute("aria-pressed", "false");
  });
  experienceRatingPrompt.querySelector("[data-rating-form]").hidden = false;
  experienceRatingPrompt.querySelector("[data-rating-thanks]").hidden = true;
  experienceRatingError.hidden = true;
  experienceRatingError.textContent = "";
}

function renderExperienceRatingTags() {
  const score = state.experienceRatingScore;
  const tags = score >= 4
    ? experienceRatingReasons.positive
    : experienceRatingReasons.negative;
  experienceRatingTagQuestion.textContent =
    score >= 4 ? "What worked well? (optional)" : "What was the main issue? (optional)";
  experienceRatingTags.replaceChildren();
  tags.forEach((tag) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.dataset.ratingTag = tag;
    button.setAttribute("aria-pressed", "false");
    experienceRatingTags.append(button);
  });
}

function chooseExperienceRatingScore(score) {
  state.experienceRatingScore = score;
  state.experienceRatingTags = [];
  experienceRatingError.hidden = true;
  experienceRatingScoreButtons.forEach((button) => {
    const selected = Number(button.dataset.ratingScore) === score;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderExperienceRatingTags();
  experienceRatingDetails.hidden = false;
}

async function activateExperienceRating() {
  resetExperienceRating();
  hideExperienceRating();
  try {
    const response = await window.VisitorSession.fetch("/api/experience-ratings", { cache: "no-store" });
    const data = await response.json();
    if (response.ok && data.eligible === true) {
      experienceRatingPrompt.hidden = false;
    }
  } catch {
    hideExperienceRating();
  }
}

async function submitExperienceRating(outcome) {
  if (state.experienceRatingSubmitting) return;
  if (outcome === "RATED" && state.experienceRatingScore === null) return;

  setExperienceRatingSubmitting(true);
  experienceRatingError.hidden = true;
  try {
    const body = outcome === "RATED"
      ? {
          outcome,
          score: state.experienceRatingScore,
          tags: state.experienceRatingTags,
        }
      : { outcome };
    const response = await window.VisitorSession.fetch("/api/experience-ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save your rating.");

    if (outcome === "DISMISSED") {
      hideExperienceRating();
      return;
    }
    experienceRatingPrompt.querySelector("[data-rating-form]").hidden = true;
    experienceRatingPrompt.querySelector("[data-rating-thanks]").hidden = false;
  } catch (error) {
    experienceRatingError.textContent = error.message;
    experienceRatingError.hidden = false;
  } finally {
    setExperienceRatingSubmitting(false);
  }
}

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
  privacyPolicyAgree.checked = true;
  sensitiveInfoAgree.checked = true;
  updatePrivacyAcceptButton();
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
    const response = await window.VisitorSession.fetch("/api/privacy-consent", { cache: "no-store" });
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

function setDiscardAvailable(isAvailable) {
  discardButton.hidden = !isAvailable;
  discardButton.disabled = !isAvailable;
  controlRow.classList.toggle("has-discard", isAvailable);
}

function createAnswerSaveId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function openDiscardModal() {
  if (state.discardInProgress) return;
  state.discardTargetSaveId = state.activeSaveId;
  discardError.hidden = true;
  discardError.textContent = "";
  discardModal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => keepAnswerButton.focus(), 0);
}

function closeDiscardModal() {
  if (state.discardInProgress) return;
  state.discardTargetSaveId = null;
  discardModal.hidden = true;
  document.body.classList.toggle("modal-open", !prepareModal.hidden);
  (discardButton.hidden ? generateButton : discardButton).focus();
}

async function requestAnswerCancellation(submissionId) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await window.VisitorSession.fetch(`/api/save-answer/${encodeURIComponent(submissionId)}/cancel`, {
        method: "POST",
        keepalive: true,
      });
      const data = await response.json();
      if (!response.ok || !data.cancellationRequested) {
        throw new Error(data.error || "The server could not discard this answer.");
      }
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("The server could not discard this answer.");
}

function formatRecordingTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateRecordingTimer() {
  if (!state.recordingStartedAtMs) return;

  const elapsedMs = Math.min(Date.now() - state.recordingStartedAtMs, MAX_RECORDING_MS);
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const remainingSeconds = Math.max(0, Math.ceil((MAX_RECORDING_MS - elapsedMs) / 1000));
  const elapsedLabel = formatRecordingTime(elapsedSeconds);
  const remainingLabel = formatRecordingTime(remainingSeconds);

  recordingElapsed.textContent = elapsedLabel;
  recordingRemaining.textContent = remainingLabel;
  recordingProgress.style.transform = `scaleX(${elapsedMs / MAX_RECORDING_MS})`;
  recordingBadge.setAttribute(
    "aria-label",
    `Recording started. ${elapsedLabel} elapsed. ${remainingLabel} remaining.`,
  );
}

function startRecordingTimer() {
  if (state.recordingTimer) window.clearInterval(state.recordingTimer);
  state.recordingStartedAtMs = Date.now();
  updateRecordingTimer();
  state.recordingTimer = window.setInterval(updateRecordingTimer, 1000);
}

function stopRecordingTimer() {
  if (state.recordingTimer) {
    window.clearInterval(state.recordingTimer);
    state.recordingTimer = null;
  }
  state.recordingStartedAtMs = null;
}

function updateAuthView() {
  const isSignedIn = Boolean(state.authUser);
  const route = normalizeRoute(window.location.pathname);

  loginPanel.hidden = true;
  loginButton.hidden = window.VisitorSession.hasAccess && state.authUser?.identityType === "dingtalk";
  logoutButton.hidden = !isSignedIn || state.authUser?.identityType === "guest";
  authChip.hidden = !window.VisitorSession.hasAccess;
  authChip.classList.toggle("is-guest", state.authUser?.identityType === "guest");
  playView.hidden = route === "/history" || route === "/leaderboard";
  leaderboardView.hidden = route !== "/leaderboard";
  historyView.hidden = route !== "/history";
  authUserName.textContent = state.authUser?.name || "DingTalk user";
  if (invitationLink) invitationLink.hidden = !(state.authUser?.identityType === "dingtalk");
  nameInput.value = state.authUser?.name || "";
  const loginHref = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;
  loginButton.href = loginHref;
  loginPanelButton.href = loginHref;
}

function requestDingTalkInAppAuthCode(corpId) {
  return new Promise((resolve, reject) => {
    const requestAuthCode = window.dd?.runtime?.permission?.requestAuthCode;
    if (typeof requestAuthCode !== "function") {
      reject(new Error("The DingTalk in-app API is unavailable."));
      return;
    }

    let settled = false;
    const timeout = window.setTimeout(() => fail(new Error("DingTalk sign-in timed out.")), 4000);
    const succeed = (result) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (result?.code) resolve(result.code);
      else reject(new Error("DingTalk did not return an in-app authorization code."));
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error("DingTalk rejected in-app authentication."));
    };

    try {
      const result = requestAuthCode.call(window.dd.runtime.permission, {
        corpId,
        onSuccess: succeed,
        onFail: fail,
      });
      if (result?.then) result.then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

async function tryDingTalkInAppAuth(inAppAuth) {
  if (state.inAppAuthAttempted || !inAppAuth?.configured || !inAppAuth.corpId) return false;
  state.inAppAuthAttempted = true;

  const dd = window.dd;
  if (!dd || dd.env?.platform === "notInDingTalk") return false;

  try {
    const authCode = await requestDingTalkInAppAuthCode(inAppAuth.corpId);
    const response = await window.VisitorSession.fetch("/auth/dingtalk/in-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authCode }),
      signal: AbortSignal.timeout(4000),
    });
    const data = await response.json();
    if (!response.ok || !data.user) {
      throw new Error(data.error || "DingTalk in-app authentication failed.");
    }
    await window.VisitorSession.announce();
    state.authUser = window.VisitorSession.user;
    state.authReady = true;
    updateAuthView();
    setRoute(window.location.pathname);
    return true;
  } catch (error) {
    return false;
  }
}

async function checkAuth() {
  try {
    const response = await window.VisitorSession.fetch("/api/me");
    const data = await response.json();
    state.authUser = data.user || null;
    state.authReady = true;
    state.dingTalkConfigured = data.configured;
    setStatus(state.authUser?.identityType === "guest" ? "Guest" : "Signed in");
    updateAuthView();
    if (state.authUser) {
      setRoute(window.location.pathname);
      if (window.VisitorSession.hasAccess) window.EvaluationQueue.restore().catch(() => {});
    }
    if (state.authUser?.identityType === "guest") void tryDingTalkInAppAuth(data.inAppAuth);
  } catch {
    setStatus("Session unavailable");
    state.authReady = true;
    updateAuthView();
    setRoute(window.location.pathname);
  }
}

function stopPrepareCountdown() {
  if (state.prepareCountdownTimer) {
    window.clearInterval(state.prepareCountdownTimer);
    state.prepareCountdownTimer = null;
  }
}

function restoreRecorderPanel() {
  if (recorderPanel.parentNode === recorderPanelHome) return;

  recorderPanelHome.insertBefore(recorderPanel, recorderPanelHomeNextSibling);
  recorderModalSlot.hidden = true;
  prepareDialog.classList.remove("is-recording");
  prepareModal.setAttribute("aria-labelledby", "prepareModalTitle");
}

function closePrepareModal() {
  stopPrepareCountdown();
  state.prepareCountdownResolve = null;
  restoreRecorderPanel();
  prepareModal.hidden = true;
  document.body.classList.toggle(
    "modal-open",
    !discardModal.hidden || !privacyConsentModal.hidden,
  );
}

function resetPrepareScroll() {
  prepareDialog.scrollTop = 0;
  prepareDialog.querySelector(".prepare-content").scrollTop = 0;
  recorderPanel.querySelector(".question-block").scrollTop = 0;
}

function showGeneratingModal() {
  stopPrepareCountdown();
  restoreRecorderPanel();
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
  resetPrepareScroll();
}

function showCountdownModal(question) {
  state.mediaRetryPending = false;
  state.mediaRetryAction = null;
  restoreRecorderPanel();
  prepareDialog.classList.add("is-countdown");
  prepareModalKicker.textContent = "Question ready";
  prepareModalTitle.textContent = question.question;
  prepareModalMessage.replaceChildren();
  const answerFlowLabel = document.createElement("strong");
  answerFlowLabel.textContent = "Answer flow";
  const answerFlowSteps = document.createElement("span");
  answerFlowSteps.className = "answer-flow-steps";
  answerFlowSteps.textContent = "Your point → Reasons → Example → Close ending";
  const answerFlowNote = document.createElement("span");
  answerFlowNote.className = "answer-flow-note";
  answerFlowNote.textContent = "Recording starts when the timer reaches zero.";
  prepareModalMessage.append(answerFlowLabel, answerFlowSteps, answerFlowNote);
  prepareSpinner.hidden = true;
  preparePreviewWrap.hidden = !state.stream;
  prepareCameraGuidance.hidden = false;
  countdownDisplay.hidden = false;
  prepareActions.hidden = false;
  speakDirectlyButton.textContent = "Start now";
  countdownSeconds.textContent = String(PREPARE_COUNTDOWN_SECONDS);
  prepareModal.hidden = false;
  document.body.classList.add("modal-open");
  resetPrepareScroll();
}

function showRecorderInPrepareModal() {
  stopPrepareCountdown();
  prepareDialog.classList.remove("is-countdown");
  prepareDialog.classList.add("is-recording");
  recorderModalSlot.hidden = false;
  recorderModalSlot.append(recorderPanel);
  prepareModal.setAttribute("aria-labelledby", "questionText");
  prepareModal.hidden = false;
  document.body.classList.add("modal-open");
  resetPrepareScroll();
  window.setTimeout(() => finishButton.focus({ preventScroll: true }), 0);
}

function showMediaRequiredModal(error, retryAction = "record") {
  state.mediaRetryPending = true;
  state.mediaRetryAction = retryAction;
  restoreRecorderPanel();
  prepareDialog.classList.remove("is-countdown");
  prepareModalKicker.textContent = "Devices required";
  prepareModalTitle.textContent = "Turn on your camera and microphone to continue";
  prepareModalMessage.textContent =
    "OScanner-Eng needs both devices to record and evaluate your answer. Allow camera and microphone access in your browser, then try again.";
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
  resetPrepareScroll();
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
        frameRate: { ideal: 24, max: 30 },
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

let historyOffset = 0;
async function loadHistory(offset = 0) {
  if (!window.VisitorSession.hasAccess) return;
  const response = await window.VisitorSession.fetch(`/api/recordings?limit=20&offset=${offset}`);
  if (response.status === 401) {
    state.authUser = null;
    updateAuthView();
    return;
  }
  const data = await response.json();
  const recordings = data.recordings || [];
  historyOffset = offset;

  if (recordings.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No saved answers yet.</p>';
    return;
  }

  historyList.innerHTML = recordings
    .map((item, index) => renderHistoryItem(item, index))
    .join("");
  const pager = document.createElement("nav");
  pager.className = "queue-actions";
  pager.setAttribute("aria-label", "History pages");
  for (const [label, next, disabled] of [["Previous", offset - 20, offset === 0], ["Next", offset + 20, offset + recordings.length >= (data.pagination?.total || recordings.length)]]) {
    const button = document.createElement("button");
    button.textContent = label;
    button.disabled = disabled;
    button.onclick = () => loadHistory(next);
    pager.append(button);
  }
  historyList.append(pager);
}

function formatChallengeRange(challenge) {
  if (!challenge?.startsAt || !challenge?.endsAt) return "Weekly challenge";
  const options = { month: "short", day: "numeric", timeZone: "Asia/Shanghai" };
  const start = new Intl.DateTimeFormat("en-US", options).format(new Date(challenge.startsAt));
  const end = new Intl.DateTimeFormat("en-US", options).format(new Date(challenge.endsAt));
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(challenge.startsAt));
  return `${start} - ${end}, ${year}`;
}

function showGameChallenge(challenge) {
  state.gameChallenge = challenge;
  gameWeekLabel.textContent = formatChallengeRange(challenge);
  gameTopicTitle.textContent = challenge.title;
  gameTopicQuestion.textContent = challenge.question;
  if (!state.question && normalizeRoute(window.location.pathname) === "/game") {
    questionText.textContent = challenge.question;
    questionMeta.textContent = `Fixed weekly topic. Target: ${challenge.expectedDurationSeconds} seconds.`;
  }
}

function leaderboardIdentityForm(identity, context = "leaderboard") {
  if (!identity) return '<p class="identity-loading">Loading your leaderboard name…</p>';
  const suffix = context === "result" ? "result" : "leaderboard";
  return `
    <form class="leaderboard-identity-form" data-identity-form>
      <div class="identity-copy">
        <span class="identity-icon" aria-hidden="true">✦</span>
        <div>
          <h3>${context === "result" ? "Choose your leaderboard name" : "How you appear"}</h3>
          <p>Your score always stays on the board. Switching names updates every challenge leaderboard.</p>
        </div>
      </div>
      <label class="identity-toggle" for="useLeaderboardAlias-${suffix}">
        <input
          id="useLeaderboardAlias-${suffix}"
          name="useAlias"
          type="checkbox"
          ${identity.useAlias ? "checked" : ""}
        />
        <span>
          <strong>Appear anonymously</strong>
          <small>Show a nickname instead of ${escapeHtml(identity.actualName)}.</small>
        </span>
      </label>
      <label class="identity-alias" for="leaderboardAlias-${suffix}">
        Your one alias
        <input
          id="leaderboardAlias-${suffix}"
          name="alias"
          type="text"
          minlength="2"
          maxlength="32"
          autocomplete="off"
          value="${escapeHtml(identity.alias)}"
          required
        />
        <small>You can rename it anytime. Your current leaderboard name is <strong data-identity-display>${escapeHtml(identity.displayName)}</strong>.</small>
      </label>
      <button class="secondary-button identity-save" type="submit">Save leaderboard name</button>
      <span class="identity-feedback" role="status" aria-live="polite"></span>
    </form>
  `;
}

function renderLeaderboardIdentitySettings() {
  if (state.authUser?.identityType === "guest") {
    leaderboardIdentitySettings.innerHTML = "";
    return;
  }
  leaderboardIdentitySettings.innerHTML = leaderboardIdentityForm(
    state.leaderboardIdentity,
    "leaderboard",
  );
}

function updateIdentityFormPreview(form) {
  const useAlias = form.elements.useAlias.checked;
  const alias = form.elements.alias.value.trim() || state.leaderboardIdentity?.alias || "your alias";
  const displayName = useAlias ? alias : state.leaderboardIdentity?.actualName || "your actual name";
  const target = form.querySelector("[data-identity-display]");
  if (target) target.textContent = displayName;
}

function syncLeaderboardIdentityForms(message = "") {
  document.querySelectorAll("[data-identity-form]").forEach((form) => {
    form.elements.useAlias.checked = state.leaderboardIdentity.useAlias;
    form.elements.alias.value = state.leaderboardIdentity.alias;
    updateIdentityFormPreview(form);
    const feedback = form.querySelector(".identity-feedback");
    if (feedback) feedback.textContent = message;
  });
}

async function loadLeaderboardIdentity() {
  const response = await window.VisitorSession.fetch("/api/game/identity", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load your leaderboard name.");
  state.leaderboardIdentity = data.identity;
  renderLeaderboardIdentitySettings();
  return data.identity;
}

async function saveLeaderboardIdentity(form) {
  const button = form.querySelector(".identity-save");
  const feedback = form.querySelector(".identity-feedback");
  button.disabled = true;
  feedback.textContent = "Saving…";
  try {
    const response = await window.VisitorSession.fetch("/api/game/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        useAlias: form.elements.useAlias.checked,
        alias: form.elements.alias.value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save your leaderboard name.");
    state.leaderboardIdentity = data.identity;
    syncLeaderboardIdentityForms(
      data.identity.useAlias
        ? `Saved. The leaderboard now shows ${data.identity.alias}.`
        : `Saved. The leaderboard now shows ${data.identity.actualName}.`,
    );
    if (normalizeRoute(window.location.pathname) === "/leaderboard") {
      await loadLeaderboard(leaderboardWeek.value);
    }
  } catch (error) {
    feedback.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderPrizeDraft(data) {
  const draft = data.challenge?.prizeDraft;
  if (!draft) {
    prizeDraft.hidden = true;
    prizeDraft.innerHTML = "";
    return;
  }

  const pickLabels = ["First pick", "Second pick", "Final prize"];
  const pickDescriptions = [
    "Chooses any one of the three prizes",
    "Chooses from the two prizes left",
    "Receives the remaining prize",
  ];
  const pickOrder = pickLabels
    .map((label, index) => {
      const player = data.entries?.[index];
      return `
        <li class="prize-pick prize-pick-${index + 1}">
          <span class="prize-rank">${index + 1}</span>
          <span class="prize-pick-copy">
            <small>${label}</small>
            <strong>${player ? escapeHtml(player.name) : "To be decided"}</strong>
            <span>${pickDescriptions[index]}</span>
          </span>
        </li>
      `;
    })
    .join("");

  prizeDraft.innerHTML = `
    <div class="prize-draft-visual">
      <img src="${escapeHtml(draft.imagePath)}" alt="Week 1 prize pool: a Vinda tissue pack, Vaseline hand cream, and anti-fog wipes" />
      <span class="prize-drop-sticker" aria-hidden="true">3<br /><small>PRIZES</small></span>
    </div>
    <div class="prize-draft-content">
      <p class="prize-draft-kicker">✦ ${escapeHtml(draft.eyebrow)}</p>
      <h2 id="prizeDraftTitle">${escapeHtml(draft.title)}</h2>
      <p class="prize-draft-rule">${escapeHtml(draft.rule)}</p>
      <div class="prize-rewards" aria-label="Available prizes">
        ${draft.rewards.map((reward) => `<span>${escapeHtml(reward)}</span>`).join("")}
      </div>
      <ol class="prize-pick-order" aria-label="Prize selection order">${pickOrder}</ol>
      <p class="prize-draft-note">Live ranking shown. Final pick order is locked when Week 1 closes.</p>
      <a class="game-cta" href="/game" data-route="/game">
        Play this week's game
        <span aria-hidden="true">→</span>
      </a>
    </div>
  `;
  prizeDraft.hidden = false;
}

function renderLeaderboard(data) {
  renderPrizeDraft(data);
  leaderboardTopic.textContent = `${data.challenge.title}. ${formatChallengeRange(data.challenge)}.`;
  leaderboardSummary.textContent = data.participantCount
    ? `${data.participantCount} ${data.participantCount === 1 ? "player" : "players"}${data.viewerRank ? `. Your rank: ${data.viewerRank}.` : ". Complete an evaluated answer to join them."}`
    : "No completed answers yet. Record the first one for this topic.";

  if (!data.entries?.length) {
    leaderboardList.innerHTML = '<li class="leaderboard-empty">The board is ready for its first completed answer.</li>';
    return;
  }

  leaderboardList.innerHTML = data.entries
    .map(
      (entry) => `
        <li class="leaderboard-row${entry.isViewer ? " is-viewer" : ""}">
          <span class="leaderboard-rank" aria-label="Rank ${entry.rank}">
            <span aria-hidden="true">${entry.rank <= 3 ? "★" : "#"}</span>
            <strong>${entry.rank}</strong>
          </span>
          <span class="leaderboard-person">
            <strong>${escapeHtml(entry.name)}${entry.isViewer ? " (you)" : ""}</strong>
            <span>${entry.attempts} ${entry.attempts === 1 ? "attempt" : "attempts"}</span>
          </span>
          <span class="leaderboard-score" aria-label="${entry.score} points">
            <strong>${entry.score}</strong>
            <small>pts</small>
          </span>
        </li>
      `,
    )
    .join("");
}

async function loadLeaderboard(challengeId) {
  prizeDraft.hidden = true;
  leaderboardList.setAttribute("aria-busy", "true");
  leaderboardSummary.textContent = "Loading weekly standings...";
  leaderboardList.innerHTML = '<li class="leaderboard-loading">Loading leaderboard...</li>';
  try {
    const query = challengeId ? `?challengeId=${encodeURIComponent(challengeId)}` : "";
    const response = await window.VisitorSession.fetch(`/api/game/leaderboard${query}`, { cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) {
      state.authUser = null;
      state.authReady = true;
      updateAuthView();
      setStatus("Sign in");
      return;
    }
    if (!response.ok) throw new Error(data.error || "Unable to load the leaderboard.");
    renderLeaderboard(data);
  } catch (error) {
    leaderboardSummary.textContent = "";
    leaderboardList.innerHTML = `<li class="leaderboard-error">${escapeHtml(error.message)}</li>`;
  } finally {
    leaderboardList.setAttribute("aria-busy", "false");
  }
}

async function fetchGameChallengeCatalog() {
  const response = await window.VisitorSession.fetch("/api/game/challenge", { cache: "no-store" });
  const data = await response.json();
  if (response.status === 401) {
    state.authUser = null;
    state.authReady = true;
    updateAuthView();
    setStatus("Sign in");
    return null;
  }
  if (!response.ok) throw new Error(data.error || "Unable to load this week's challenge.");

  state.gameChallenges = data.challenges || [];
  showGameChallenge(data.challenge);
  return data;
}

async function loadGameChallenge() {
  try {
    await fetchGameChallengeCatalog();
  } catch (error) {
    gameTopicTitle.textContent = "Weekly topic unavailable";
    gameTopicQuestion.textContent = error.message;
  }
}

async function loadLeaderboardPage() {
  leaderboardList.setAttribute("aria-busy", "true");
  leaderboardSummary.textContent = "Loading this week's challenge…";
  leaderboardList.innerHTML = '<li class="leaderboard-loading">Loading leaderboard…</li>';
  try {
    const [data] = await Promise.all([
      fetchGameChallengeCatalog(),
      window.VisitorSession.hasAccess ? loadLeaderboardIdentity().catch(() => leaderboardIdentitySettings.replaceChildren()) : Promise.resolve(leaderboardIdentitySettings.replaceChildren()),
    ]);
    if (!data) {
      leaderboardList.setAttribute("aria-busy", "false");
      return;
    }

    const previousSelection = leaderboardWeek.value;
    leaderboardWeek.innerHTML = state.gameChallenges
      .map((challenge, index) => {
        const prefix = index === 0 ? "Current: " : "";
        return `<option value="${escapeHtml(challenge.id)}">${escapeHtml(`${prefix}${formatChallengeRange(challenge)} | ${challenge.title}`)}</option>`;
      })
      .join("");
    if (state.gameChallenges.some((challenge) => challenge.id === previousSelection)) {
      leaderboardWeek.value = previousSelection;
    }
    await loadLeaderboard(leaderboardWeek.value || data.challenge.id);
  } catch (error) {
    leaderboardSummary.textContent = "";
    leaderboardList.innerHTML = `<li class="leaderboard-error">${escapeHtml(error.message)}</li>`;
    leaderboardList.setAttribute("aria-busy", "false");
  }
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

function renderAnswerParagraphs(value) {
  return String(value)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function renderEvaluationContent(evaluation, shareId = "") {
  if (["queued", "processing"].includes(evaluation.status)) {
    return '<section class="evaluation-card"><h3>Evaluation pending</h3><p>Your recording is saved. Feedback will appear when processing finishes.</p></section>';
  }
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
      ${
        evaluation.improvedAnswer
          ? `
            <section class="improved-answer" aria-labelledby="improvedAnswerTitle-${escapeHtml(shareId || "current")}">
              <div class="improved-answer-heading">
                <h4 id="improvedAnswerTitle-${escapeHtml(shareId || "current")}">A stronger version</h4>
                <span>Based only on your transcript</span>
              </div>
              <div class="improved-answer-text">
                ${renderAnswerParagraphs(evaluation.improvedAnswer)}
              </div>
            </section>
          `
          : ""
      }
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
  if (shareId) window.EvaluationShare.register(shareId, evaluation);
  const identityChoice =
    shareId && state.activeMode === "/game" && state.leaderboardIdentity
      ? `<section class="post-evaluation-identity">${leaderboardIdentityForm(state.leaderboardIdentity, "result")}</section>`
      : "";
  evaluationResult.innerHTML = `${renderEvaluationContent(evaluation, shareId)}${identityChoice}`;
}

function renderHistoryItem(item, index) {
  const title = item.question?.question || "Saved answer";
  const name = item.profile?.name || "Unnamed candidate";
  const date = item.finishedAt ? new Date(item.finishedAt).toLocaleString() : "Unknown date";
  const score =
    item.evaluation?.status === "completed"
      ? `${Math.round(item.evaluation.overallScore || 0)} / 100`
      : item.pendingJobId
        ? "Queued for evaluation"
        : item.hasVideo === false
        ? "No video"
        : "Pending";
  const videoPath = item.path || "";
  const shareId = item.evaluation?.status === "completed" ? `history-${item.id}` : "";
  if (shareId) window.EvaluationShare.register(shareId, item.evaluation);

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
        ${item.evaluation ? renderEvaluationContent(item.evaluation, shareId) : '<p class="empty-history">No evaluation saved for this answer.</p>'}
      </div>
    </details>
  `;
}

function normalizeRoute(pathname) {
  if (pathname === "/") return "/leaderboard";
  if (pathname === "/practice") return "/examine";
  return pathname;
}

function setPlayMode(route) {
  const isGame = route === "/game";
  gameOverview.hidden = !isGame;
  roleField.hidden = isGame;
  nameField.hidden = isGame;
  playEyebrow.textContent = isGame ? "Weekly speaking challenge" : "Live speaking evaluation";
  playTitle.textContent = isGame ? "The Weekly Game" : "Examine";
  playSummary.textContent = isGame
    ? "Answer one shared everyday topic. Your best evaluated score enters the weekly board."
    : "Get one focused question, record your answer, and receive feedback across all six dimensions.";
  profileHeading.textContent = isGame ? "Enter this week's game" : "Candidate profile";
  profileSummary.textContent = isGame
    ? "The topic is fixed for everyone. Check your devices, plan clearly, and record your answer."
    : "Used by the LLM to generate one targeted speaking question.";
  generateButton.textContent = isGame
    ? "Check camera & start challenge"
    : "Check camera & generate question";

  if (state.activeMode !== route) {
    state.activeMode = route;
    state.question = null;
    evaluationResult.innerHTML = "";
    saveResult.textContent = "";
  }

  if (!state.question) {
    if (isGame && state.gameChallenge) {
      showGameChallenge(state.gameChallenge);
    } else if (isGame) {
      questionText.textContent = "Loading this week's fixed topic...";
      questionMeta.textContent = "Every player receives the same question for the week.";
    } else {
      questionText.textContent = "Enter a profile, then generate one question.";
      questionMeta.textContent = "Recording starts automatically after the question is ready.";
    }
  }
}

function setRoute(pathname) {
  const route = normalizeRoute(pathname);
  const isHistory = route === "/history";
  const isLeaderboard = route === "/leaderboard";
  const isGame = route === "/game";

  playView.hidden = isHistory || isLeaderboard;
  leaderboardView.hidden = !isLeaderboard;
  historyView.hidden = !isHistory;
  loginPanel.hidden = true;
  connectionStatus.hidden = isHistory || isLeaderboard;
  if (!isHistory && !isLeaderboard) setPlayMode(route);
  document.title = isLeaderboard
    ? "Leaderboard | OScanner-Eng"
    : isHistory
      ? "History | OScanner-Eng"
      : isGame
        ? "Weekly Game | OScanner-Eng"
        : "Examine | OScanner-Eng";
  navLinks.forEach((link) => {
    const isActive = normalizeRoute(link.dataset.route) === route;
    link.classList.toggle("active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  if (isHistory) {
    setStatus("History");
    if (!state.authReady) return;
    openProtectedHistory().catch(() => {
      historyList.innerHTML = '<p class="empty-history">Unable to load saved answers.</p>';
    });
  } else if (isLeaderboard) {
    setStatus("Leaderboard");
    loadLeaderboardPage();
  } else if (isGame) {
    setStatus("Weekly topic");
    loadGameChallenge();
  } else {
    setStatus(state.authUser?.identityType === "guest" ? "Guest" : "Signed in");
  }
}

async function openProtectedHistory() {
  historyList.replaceChildren();
  if (!await window.VisitorSession.ensureAccess()) {
    if (normalizeRoute(location.pathname) === "/history") navigateTo("/leaderboard");
    return;
  }
  if (normalizeRoute(location.pathname) === "/history") await loadHistory();
}

function navigateTo(pathname) {
  const normalized = normalizeRoute(pathname);
  window.history.pushState({}, "", normalized);
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
  if (generateButton.disabled) return;
  const requestedRoute = location.pathname;
  generateButton.disabled = true;
  const accessReady = await window.VisitorSession.ensureAccess();
  generateButton.disabled = false;
  if (!accessReady || location.pathname !== requestedRoute) {
    if (location.pathname === requestedRoute) generateButton.focus();
    return;
  }
  state.authUser = window.VisitorSession.user;
  const actionOwner = state.authUser?.openId;

  if (state.recorder && state.recorder.state !== "inactive") {
    saveResult.textContent = "Finish and save the current recording before generating another question.";
    return;
  }

  generateButton.disabled = true;
  const privacyReady = await ensurePrivacyConsent();
  if (actionOwner !== state.authUser?.openId) return;
  if (!privacyReady) {
    generateButton.disabled = false;
    setStatus("Privacy consent required");
    return;
  }

  finishButton.disabled = true;
  saveResult.textContent = "";
  try { await window.EvaluationQueue.admit(); }
  catch (error) {
    generateButton.disabled = false;
    saveResult.textContent = error.name === "AbortError" ? "Waiting canceled." : error.message;
    return;
  }
  const mediaReady = await requireMediaBeforeQuestion();
  if (actionOwner !== state.authUser?.openId) return;
  if (!mediaReady) return;

  state.profile = getProfileFromForm();
  const isGame = normalizeRoute(window.location.pathname) === "/game";
  setStatus("Generating");
  showGeneratingModal();
  prepareModalTitle.textContent = isGame ? "Preparing the weekly topic..." : "Preparing your question...";
  prepareModalMessage.textContent = isGame
    ? "The fixed topic is ready. We are setting up your private planning time."
    : "Please wait while the assessment question is generated.";
  questionText.textContent = isGame ? "Preparing the weekly topic..." : "Generating a question...";
  questionMeta.textContent = isGame
    ? "Creating your owned attempt for this week's challenge."
    : "Calling the internally deployed model through the local server.";

  try {
    const response = await window.VisitorSession.fetch(isGame ? "/api/game/question" : "/api/generate-question", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isGame ? {} : { profile: state.profile }),
    });
    const data = await response.json();

    if (!response.ok && !data.question) {
      throw new Error(data.error || "Question generation failed.");
    }

    setQuestion(data.question);
    setStatus(isGame ? "Topic ready" : response.ok ? "Question ready" : "Fallback ready");
    if (data.error) {
      saveResult.textContent = `LLM fallback used: ${data.error}`;
    }
    setStatus("Thinking time");
    const preparation = await waitForPreparationCountdown(data.question);
    if (preparation !== "record" || actionOwner !== state.authUser?.openId) return;
    await startRecording();
  } catch (error) {
    if (actionOwner !== state.authUser?.openId) return;
    closePrepareModal();
    stopStream();
    setStatus("Error");
    questionText.textContent = isGame ? "Weekly topic setup failed." : "Question generation failed.";
    questionMeta.textContent = error.message;
  } finally {
    if ((!state.recorder || state.recorder.state === "inactive") && !state.mediaRetryPending) {
      generateButton.disabled = false;
    }
  }
});

async function startRecording() {
  if (!state.question) return;
  const actionOwner = state.authUser?.openId;
  if (!await window.VisitorSession.ensureAccess() || actionOwner !== window.VisitorSession.user?.openId || !state.question) return;

  try {
    state.mimeType = getSupportedMimeType();
    state.chunks = [];
    state.requiredDeviceInterrupted = null;
    stopRecordingTimer();
    setVideoLoading(false);
    await acquireRequiredMedia();
    if (actionOwner !== state.authUser?.openId) { stopStream(); return; }

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

    const options = { ...(state.mimeType ? { mimeType: state.mimeType } : {}), videoBitsPerSecond: 1500000, audioBitsPerSecond: 64000 };
    state.recorder = new MediaRecorder(state.stream, options);
    state.startedAt = new Date().toISOString();
    const recordingChunks = state.chunks;

    state.recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    });

    // Timed MP4 chunks are not reliably concatenable across MediaRecorder
    // implementations. Let the recorder finalize one complete file on stop.
    state.recorder.start();
    await requestWakeLock();
    if (actionOwner !== state.authUser?.openId) return;
    state.mediaRetryPending = false;
    state.mediaRetryAction = null;
    resetPrepareGuidance();
    recorderPanel.classList.add("is-recording");
    showRecorderInPrepareModal();
    finishButton.disabled = false;
    setDiscardAvailable(true);
    generateButton.disabled = true;
    logoutButton.disabled = true;
    recordingBadge.classList.add("visible");
    startRecordingTimer();
    setStatus("Recording");
    saveResult.textContent = "Recording in progress. Answer the question in English. Recording is limited to 2 minutes.";
    state.autoStopTimer = window.setTimeout(() => {
      finishRecording();
    }, MAX_RECORDING_MS);
  } catch (error) {
    stopRecordingTimer();
    recorderPanel.classList.remove("is-recording");
    recordingBadge.classList.remove("visible");
    setStatus("Camera & mic required");
    stopStream();
    await releaseWakeLock();
    updateDeviceStatus("error", "Camera and microphone need attention");
    finishButton.disabled = true;
    setDiscardAvailable(false);
    generateButton.disabled = true;
    logoutButton.disabled = false;
    saveResult.textContent = "Turn on your camera and microphone to record this answer.";
    showMediaRequiredModal(error, "record");
  }
}

async function finishRecording() {
  if (!state.recorder || state.recorder.state === "inactive") return;
  const recordingOwner = state.authUser.openId;
  const recordingQuestionId = state.question.id;
  const recordingStartedAt = state.startedAt;
  const recordingChunks = state.chunks;

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
    recorderPanel.classList.remove("is-recording");
    closePrepareModal();
    stopRecordingTimer();
    stopStream();
    await releaseWakeLock();
    state.recorder = null;
    state.chunks = [];
    logoutButton.disabled = false;
    setDiscardAvailable(false);
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

  const submissionId = createAnswerSaveId();
  state.activeSaveId = submissionId;
  state.discardRequested = false;
  state.saveAbortController = new AbortController();
  finishButton.disabled = true;
  finishButton.textContent = "Saving and evaluating…";
  stopRecordingTimer();
  setStatus("Saving");
  saveResult.textContent = "Finalizing recording, uploading it, and evaluating the answer...";
  evaluationResult.innerHTML = "";
  setVideoLoading(true);

  const stopped = new Promise((resolve) => {
    state.recorder.addEventListener("stop", resolve, { once: true });
  });

  state.recorder.stop();
  await stopped;
  recorderPanel.classList.remove("is-recording");
  closePrepareModal();
  recordingBadge.classList.remove("visible");
  stopStream();
  await releaseWakeLock();

  const blobType = state.mimeType || recordingChunks[0]?.type || "video/webm";
  const extension = blobType.includes("mp4") ? "mp4" : "webm";
  const videoBlob = new Blob(recordingChunks, { type: blobType });
  const formData = new FormData();
  formData.append("video", videoBlob, `answer.${extension}`);
  formData.append("questionId", recordingQuestionId);
  formData.append("startedAt", recordingStartedAt);
  formData.append("submissionId", submissionId);

  if (recordingOwner !== state.authUser?.openId) {
    await window.EvaluationQueue.retain(formData, recordingOwner);
    return;
  }

  try {
    const data = await window.EvaluationQueue.submit(formData, {
      owner: recordingOwner,
      signal: state.saveAbortController.signal,
      onAccepted: () => {
        state.activeSaveId = null;
        state.chunks = [];
        setDiscardAvailable(false);
        setStatus("Queued");
        saveResult.textContent = "Recording saved. You can return to History for your feedback.";
      },
    });
    if (state.discardRequested) return;
    if (state.activeSaveId === submissionId) {
      state.activeSaveId = null;
      state.saveAbortController = null;
    }

    saveResult.innerHTML = data.path ? `Saved as <a href="${escapeHtml(data.path)}" target="_blank" rel="noreferrer">${escapeHtml(data.filename)}</a>. Generate the next question when ready.` : escapeHtml(data.evaluation?.reason || "Recording discarded.");
    if (state.activeMode === "/game" && data.evaluation?.status === "completed") {
      await loadLeaderboardIdentity().catch(() => {});
    }
    renderEvaluation(data.evaluation);
    if (data.evaluation?.status === "completed") {
      await activateExperienceRating();
    } else {
      hideExperienceRating();
    }
    setStatus(data.evaluation?.status === "completed" ? "Evaluated" : "Saved");
    generateButton.disabled = false;
    setDiscardAvailable(false);
    await loadHistory();
  } catch (error) {
    if (recordingOwner !== state.authUser?.openId) return;
    if (state.discardRequested) return;
    setStatus(error.name === "AbortError" ? "Discarded" : "Upload needs attention");
    saveResult.textContent = error.name === "AbortError" ? "Recording discarded." : error.message;
    generateButton.disabled = false;
    setDiscardAvailable(false);
  } finally {
    if (recordingOwner === state.authUser?.openId) {
      setVideoLoading(false);
      state.recorder = null;
      state.chunks = [];
      logoutButton.disabled = false;
      finishButton.textContent = "Finish and save";
      if (state.activeSaveId === submissionId && !state.discardRequested) {
        state.activeSaveId = null;
        state.saveAbortController = null;
      }
    }
  }
}

async function discardCurrentAnswer() {
  if (state.discardInProgress) return;

  state.discardInProgress = true;
  confirmDiscardButton.disabled = true;
  keepAnswerButton.disabled = true;
  discardButton.disabled = true;
  finishButton.disabled = true;
  videoFrame.classList.add("is-discarding");
  setVideoLoading(true);
  setStatus("Discarding");
  saveResult.textContent = "Discarding this recording and its evaluation data...";

  if (state.autoStopTimer) {
    window.clearTimeout(state.autoStopTimer);
    state.autoStopTimer = null;
  }

  const submissionId = state.discardTargetSaveId || state.activeSaveId;
    state.discardRequested = true;

  try {
    if (state.recorder && state.recorder.state !== "inactive") {
      const stopped = new Promise((resolve) => {
        state.recorder.addEventListener("stop", resolve, { once: true });
      });
      state.recorder.stop();
      await stopped;
    }

    state.saveAbortController?.abort();
    if (submissionId) {
      await requestAnswerCancellation(submissionId);
    }

    stopRecordingTimer();
    recorderPanel.classList.remove("is-recording");
    closePrepareModal();
    recordingBadge.classList.remove("visible");
    stopStream();
    await releaseWakeLock();
    state.recorder = null;
    state.chunks = [];
    state.startedAt = null;
    state.question = null;
    state.activeSaveId = null;
    state.discardTargetSaveId = null;
    state.saveAbortController = null;
    state.discardRequested = false;
    evaluationResult.innerHTML = "";
    if (normalizeRoute(window.location.pathname) === "/game" && state.gameChallenge) {
      showGameChallenge(state.gameChallenge);
    } else {
      questionText.textContent = "Enter a profile, then generate one question.";
      questionMeta.textContent = "Recording starts automatically after the question is ready.";
    }
    saveResult.textContent = "Answer discarded. No recording, evaluation, or score was saved.";
    await window.EvaluationQueue.discardDraft();
    await window.EvaluationQueue.release();
    finishButton.textContent = "Finish and save";
    generateButton.disabled = false;
    logoutButton.disabled = false;
    setDiscardAvailable(false);
    videoFrame.classList.remove("is-discarding");
    setVideoLoading(false);
    discardModal.hidden = true;
    document.body.classList.remove("modal-open");
    state.discardInProgress = false;
    confirmDiscardButton.disabled = false;
    keepAnswerButton.disabled = false;
    navigateTo("/history");
  } catch (error) {
    state.discardInProgress = false;
    confirmDiscardButton.disabled = false;
    keepAnswerButton.disabled = false;
    discardButton.disabled = false;
    videoFrame.classList.remove("is-discarding");
    setVideoLoading(false);
    setStatus("Discard not confirmed");
    discardError.textContent = `${error.message} Try again before leaving this page.`;
    discardError.hidden = false;
  }
}

finishButton.addEventListener("click", finishRecording);
discardButton.addEventListener("click", openDiscardModal);
keepAnswerButton.addEventListener("click", closeDiscardModal);
confirmDiscardButton.addEventListener("click", discardCurrentAnswer);

logoutButton.addEventListener("click", async () => {
  await window.EvaluationQueue.release();
  await window.VisitorSession.fetch("/auth/logout", { method: "POST" });
  state.inAppAuthAttempted = true;
  await window.VisitorSession.announce();
});

window.addEventListener("visitoridentitychange", (event) => {
  const recorder = state.recorder;
  if (recorder && recorder.state !== "inactive") {
    const chunks = state.chunks;
    const questionId = state.question?.id;
    const startedAt = state.startedAt;
    const valid = !state.requiredDeviceInterrupted && !getUnavailableRequiredDevice();
    recorder.addEventListener("stop", () => {
      if (!valid || !questionId) return;
      const type = chunks[0]?.type || "video/webm";
      const form = new FormData();
      form.append("video", new Blob(chunks, { type }), type.includes("mp4") ? "answer.mp4" : "answer.webm");
      form.append("questionId", questionId);
      form.append("startedAt", startedAt);
      void window.EvaluationQueue.retain(form, event.detail.previous).catch(() => {});
    }, { once: true });
    recorder.stop();
  }
  state.saveAbortController?.abort();
  void releaseWakeLock();
  state.activeSaveId = null;
  state.recorder = null;
  state.chunks = [];
  window.clearTimeout(state.autoStopTimer);
  state.prepareCountdownResolve?.("cancel");
  closePrivacyConsentModal(false);
  closePrepareModal();
  closeHistoryVideo();
  logoutButton.disabled = false;
  generateButton.disabled = false;
  finishButton.disabled = true;
  finishButton.textContent = "Finish and save";
  setVideoLoading(false);
  recorderPanel.classList.remove("is-recording");
  recordingBadge.classList.remove("visible");
  setDiscardAvailable(false);
  state.authUser = event.detail.user;
  state.authReady = true;
  state.privacyConsent = null;
  state.profile = null;
  state.question = null;
  state.leaderboardIdentity = null;
  if (!event.detail.accessGranted) state.activeMode = null;
  evaluationResult.innerHTML = "";
  hideExperienceRating();
  saveResult.textContent = "";
  stopStream();
  stopPrepareCountdown();
  stopRecordingTimer();
  historyList.innerHTML = "";
  if (!event.detail.accessGranted) navigateTo("/leaderboard");
  updateAuthView();
  setStatus(state.authUser?.identityType === "guest" ? "Guest" : "Signed in");
  if (window.VisitorSession.hasAccess) window.EvaluationQueue.restore().catch(() => {});
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
    const response = await window.VisitorSession.fetch("/api/privacy-consent", {
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
      generateButton.disabled = false;
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

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-route]");
  if (!link) return;
  event.preventDefault();
  if ((state.recorder && state.recorder.state !== "inactive") || state.activeSaveId) {
    openDiscardModal();
    return;
  }
  navigateTo(link.getAttribute("href"));
});

evaluationResult.addEventListener("click", (event) => {
  window.EvaluationShare.handleClick(event);
});

experienceRatingScoreButtons.forEach((button) => {
  button.addEventListener("click", () => {
    chooseExperienceRatingScore(Number(button.dataset.ratingScore));
  });
});

experienceRatingTags.addEventListener("click", (event) => {
  const button = event.target.closest("[data-rating-tag]");
  if (!button || state.experienceRatingSubmitting) return;
  const tag = button.dataset.ratingTag;
  const selected = state.experienceRatingTags.includes(tag);
  state.experienceRatingTags = selected
    ? state.experienceRatingTags.filter((item) => item !== tag)
    : [...state.experienceRatingTags, tag];
  button.classList.toggle("selected", !selected);
  button.setAttribute("aria-pressed", String(!selected));
});

submitExperienceRatingButton.addEventListener("click", () => {
  submitExperienceRating("RATED");
});

dismissExperienceRatingButton.addEventListener("click", () => {
  submitExperienceRating("DISMISSED");
});

document.addEventListener("change", (event) => {
  const form = event.target.closest("[data-identity-form]");
  if (form && ["useAlias", "alias"].includes(event.target.name)) {
    updateIdentityFormPreview(form);
  }
});

document.addEventListener("input", (event) => {
  const form = event.target.closest("[data-identity-form]");
  if (form && event.target.name === "alias") updateIdentityFormPreview(form);
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-identity-form]");
  if (!form) return;
  event.preventDefault();
  saveLeaderboardIdentity(form);
});

historyList.addEventListener("click", (event) => {
  if (window.EvaluationShare.handleClick(event)) return;
  const button = event.target.closest(".video-link");
  if (!button) return;

  openVideoModal(button.dataset.videoSrc, button.dataset.videoTitle);
});

leaderboardWeek.addEventListener("change", () => {
  loadLeaderboard(leaderboardWeek.value);
});

closeVideoModal.addEventListener("click", closeHistoryVideo);

window.addEventListener("popstate", () => {
  if ((state.recorder && state.recorder.state !== "inactive") || state.activeSaveId) {
    const activeRoute = state.activeMode === "/game" ? "/game" : "/examine";
    window.history.pushState({}, "", activeRoute);
    setRoute(activeRoute);
    openDiscardModal();
    return;
  }
  setRoute(window.location.pathname);
});

window.addEventListener("beforeunload", (event) => {
  if ((state.recorder && state.recorder.state !== "inactive") || state.activeSaveId) {
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !discardModal.hidden && !state.discardInProgress) {
    closeDiscardModal();
  }
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
window.addEventListener("evaluation-job-completed", event => {
  renderEvaluation(event.detail.evaluation);
  if (window.VisitorSession.hasAccess) loadHistory(historyOffset).catch(() => {});
});
