const state = {
  profile: null,
  question: null,
  stream: null,
  recorder: null,
  chunks: [],
  startedAt: null,
  mimeType: "",
  autoStopTimer: null,
};

const MAX_RECORDING_MS = 2 * 60 * 1000;
const profileForm = document.querySelector("#profileForm");
const generateButton = document.querySelector("#generateButton");
const finishButton = document.querySelector("#finishButton");
const preview = document.querySelector("#preview");
const videoPlaceholder = document.querySelector("#videoPlaceholder");
const recordingBadge = document.querySelector("#recordingBadge");
const questionText = document.querySelector("#questionText");
const questionMeta = document.querySelector("#questionMeta");
const saveResult = document.querySelector("#saveResult");
const evaluationResult = document.querySelector("#evaluationResult");
const connectionStatus = document.querySelector("#connectionStatus");
const historyList = document.querySelector("#historyList");

function setStatus(message) {
  connectionStatus.textContent = message;
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
  const data = await response.json();
  const recordings = data.recordings || [];

  if (recordings.length === 0) {
    historyList.innerHTML = '<p class="empty-history">No saved answers yet.</p>';
    return;
  }

  historyList.innerHTML = recordings
    .map((item) => {
      const title = item.question?.question || "Saved answer";
      const name = item.profile?.name || "Unnamed candidate";
      const date = new Date(item.finishedAt).toLocaleString();
      const score =
        item.evaluation?.status === "completed"
          ? ` · Score ${Math.round(item.evaluation.overallScore || 0)}`
          : "";
      return `
        <article class="history-item">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p>${escapeHtml(name)} · ${escapeHtml(date)} · ${Math.round((item.bytes || 0) / 1024 / 1024)} MB${escapeHtml(score)}</p>
          </div>
          <a href="/recordings/${encodeURIComponent(item.filename)}" target="_blank" rel="noreferrer">Open video</a>
        </article>
      `;
    })
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

function renderEvaluation(evaluation) {
  if (!evaluation) {
    evaluationResult.innerHTML = "";
    return;
  }

  if (evaluation.status === "skipped") {
    evaluationResult.innerHTML = `
      <section class="evaluation-card">
        <h3>Evaluation skipped</h3>
        <p>${escapeHtml(evaluation.reason || "Evaluation is not configured.")}</p>
      </section>
    `;
    return;
  }

  if (evaluation.status === "failed") {
    evaluationResult.innerHTML = `
      <section class="evaluation-card evaluation-error">
        <h3>Evaluation failed</h3>
        <p>${escapeHtml(evaluation.reason || "The recording was saved, but evaluation did not complete.")}</p>
      </section>
    `;
    return;
  }

  const rubric = evaluation.rubric || {};
  const dimensions = [
    rubric.pronunciation,
    rubric.fluency,
    rubric.grammar,
    rubric.vocabulary,
    rubric.coherence,
    rubric.visualDelivery,
  ].filter(Boolean);
  const tips = evaluation.improvements || [];
  const strengths = evaluation.strengths || [];

  evaluationResult.innerHTML = `
    <section class="evaluation-card">
      <div class="evaluation-header">
        <div>
          <span class="muted-label">Evaluation</span>
          <h3>${Math.round(evaluation.overallScore || 0)} / 100</h3>
        </div>
        <span class="status-pill compact">${escapeHtml(evaluation.model?.evaluate || "LLM")}</span>
      </div>
      <p class="evaluation-summary">${escapeHtml(evaluation.summary || "")}</p>
      <div class="score-grid">
        ${dimensions
          .map(
            (item) => `
              <article class="score-row">
                <div>
                  <strong>${escapeHtml(item.label || "Dimension")}</strong>
                  <span>${Number(item.weight || 0)}%</span>
                </div>
                <meter min="0" max="100" value="${Number(item.score || 0)}"></meter>
                <p>${escapeHtml(item.feedback || "")}</p>
              </article>
            `,
          )
          .join("")}
      </div>
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
        evaluation.transcript
          ? `
            <details class="transcript-block">
              <summary>Transcript</summary>
              <p>${escapeHtml(evaluation.transcript)}</p>
            </details>
          `
          : ""
      }
    </section>
  `;
}

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (state.recorder && state.recorder.state !== "inactive") {
    saveResult.textContent = "Finish and save the current recording before generating another question.";
    return;
  }

  state.profile = getProfileFromForm();
  generateButton.disabled = true;
  finishButton.disabled = true;
  saveResult.textContent = "";
  setStatus("Generating");
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
    await startRecording();
  } catch (error) {
    setStatus("Error");
    questionText.textContent = "Question generation failed.";
    questionMeta.textContent = error.message;
  } finally {
    if (!state.recorder || state.recorder.state === "inactive") {
      generateButton.disabled = false;
    }
  }
});

async function startRecording() {
  if (!state.question) return;

  try {
    state.mimeType = getSupportedMimeType();
    state.chunks = [];
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true,
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

    state.recorder.start(1000);
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
    saveResult.textContent = `Unable to start camera: ${error.message}`;
    stopStream();
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

  const stopped = new Promise((resolve) => {
    state.recorder.addEventListener("stop", resolve, { once: true });
  });

  state.recorder.stop();
  await stopped;

  const blobType = state.mimeType || state.chunks[0]?.type || "video/webm";
  const extension = blobType.includes("mp4") ? "mp4" : "webm";
  const videoBlob = new Blob(state.chunks, { type: blobType });
  const formData = new FormData();
  formData.append("video", videoBlob, `answer.${extension}`);
  formData.append("profile", JSON.stringify(state.profile));
  formData.append("question", JSON.stringify(state.question));
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

    saveResult.innerHTML = `Saved as <a href="/recordings/${encodeURIComponent(data.filename)}" target="_blank" rel="noreferrer">${escapeHtml(data.filename)}</a>. Generate the next question when ready.`;
    renderEvaluation(data.evaluation);
    setStatus(data.evaluation?.status === "completed" ? "Evaluated" : "Saved");
    generateButton.disabled = false;
    await loadHistory();
  } catch (error) {
    setStatus("Save failed");
    saveResult.textContent = error.message;
    finishButton.disabled = false;
  } finally {
    recordingBadge.classList.remove("visible");
    stopStream();
    state.recorder = null;
    state.chunks = [];
  }
}

finishButton.addEventListener("click", finishRecording);

window.addEventListener("beforeunload", () => {
  if (state.autoStopTimer) {
    window.clearTimeout(state.autoStopTimer);
  }
  stopStream();
});
loadHistory().catch(() => {
  historyList.innerHTML = '<p class="empty-history">Unable to load saved answers.</p>';
});
