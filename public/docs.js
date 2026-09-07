const dimensions = {
  pronunciation: {
    weight: "20%",
    category: "Speech clarity",
    title: "Pronunciation and intelligibility",
    description: "Measures sound clarity, stress, rhythm, and whether pronunciation issues interfere with meaning.",
    reason: "Intelligibility remains essential: a strong idea cannot land if the listener cannot reliably understand the words. Its weight keeps speech clarity central without outweighing the structure and relevance of the response.",
  },
  grammar: {
    weight: "20%",
    category: "Language control",
    title: "Grammar",
    description: "Measures control of sentence structure, tense, agreement, and word order without demanding a particular accent or speaking style.",
    reason: "Grammar carries a substantial share because it protects meaning. Consistent errors can change relationships between ideas, time, ownership, and intent.",
  },
  fluency: {
    weight: "10%",
    category: "Speech flow",
    title: "Fluency",
    description: "Measures pacing, hesitation, pauses, self-correction, and the ability to sustain an answer without long breakdowns.",
    reason: "Fluency matters to real-time communication, but speed is not the goal. Its weight rewards an understandable flow while leaving room for thoughtful pauses and different speaking styles.",
  },
  vocabulary: {
    weight: "15%",
    category: "Language range",
    title: "Vocabulary",
    description: "Measures the range, precision, and appropriateness of word choice, including the ability to avoid vague or repetitive language.",
    reason: "Vocabulary receives equal weight with fluency because precise words make ideas useful. It supports nuance without over-rewarding rare or unnecessarily complex language.",
  },
  visual: {
    weight: "10%",
    category: "Presentation",
    title: "Visual delivery",
    description: "Measures posture, eye contact, facial engagement, and professional presence in camera-facing communication.",
    reason: "Presentation is part of the project goal, so delivery must count. Ten percent makes presence meaningful without allowing appearance to outweigh the substance of the speech.",
  },
  coherence: {
    weight: "25%",
    category: "Message structure",
    title: "Coherence and speech consistency",
    description: "Measures whether ideas connect logically, the speaker remains internally consistent, and the listener can follow the main point.",
    reason: "Coherence has the largest share because effective speech needs a stable main point, consistent claims, and ideas connected in an order the listener can follow.",
  },
};

const evaluatorForm = document.querySelector("#videoEvaluatorForm");
const videoInput = document.querySelector("#evaluationVideo");
const selectedVideoName = document.querySelector("#selectedVideoName");
const evaluatorStatus = document.querySelector("#videoEvaluatorStatus");
const evaluatorResult = document.querySelector("#videoEvaluationResult");
const evaluateVideoButton = document.querySelector("#evaluateVideoButton");
const evaluationGallery = document.querySelector("#evaluationGallery");
const evaluationGalleryStatus = document.querySelector("#evaluationGalleryStatus");
const evaluationModal = document.querySelector("#evaluationModal");
const closeEvaluationModalButton = document.querySelector("#closeEvaluationModal");
const evaluationModalVideo = document.querySelector("#evaluationModalVideo");
const evaluationModalPoster = document.querySelector("#evaluationModalPoster");
const evaluationModalPosterFallback = document.querySelector("#evaluationModalPosterFallback");
const evaluationModalDate = document.querySelector("#evaluationModalDate");
const evaluationModalTitle = document.querySelector("#evaluationModalTitle");
const evaluationModalScore = document.querySelector("#evaluationModalScore");
const evaluationModalSummary = document.querySelector("#evaluationModalSummary");
const evaluationModalDimensions = document.querySelector("#evaluationModalDimensions");
let publicEvaluations = [];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatEvaluationDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Shared evaluation";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function posterMarkup(evaluation, className) {
  if (!evaluation.posterPath) {
    return `<div class="${className}-fallback" aria-hidden="true"><span>E</span></div>`;
  }
  return `<img src="${escapeHtml(evaluation.posterPath)}" alt="First frame from ${escapeHtml(evaluation.title)}" loading="lazy" />`;
}

function renderEvaluationGallery() {
  evaluationGallery.setAttribute("aria-busy", "false");
  evaluationGalleryStatus.classList.remove("is-error");
  if (!publicEvaluations.length) {
    evaluationGallery.innerHTML = `
      <div class="evaluation-gallery-empty">
        <span aria-hidden="true">01</span>
        <h3>The first shared evaluation will appear here.</h3>
        <p>Upload a video above to add its poster and dimension scores to this collection.</p>
      </div>
    `;
    evaluationGalleryStatus.textContent = "No shared evaluations yet.";
    return;
  }

  evaluationGalleryStatus.textContent = `${publicEvaluations.length} shared ${publicEvaluations.length === 1 ? "evaluation" : "evaluations"}`;
  evaluationGallery.innerHTML = publicEvaluations
    .map(
      (evaluation, index) => `
        <article class="evaluation-card" style="--card-index: ${index}">
          <button class="evaluation-card-poster" type="button" data-evaluation-id="${escapeHtml(evaluation.id)}" aria-label="Open ${escapeHtml(evaluation.title)} evaluation">
            ${posterMarkup(evaluation, "evaluation-card-poster")}
            <span class="evaluation-card-score">${Math.round(Number(evaluation.overallScore || 0))}</span>
          </button>
          <div class="evaluation-card-caption">
            <button type="button" data-evaluation-id="${escapeHtml(evaluation.id)}" title="${escapeHtml(evaluation.title)}">${escapeHtml(evaluation.title)}</button>
            <time datetime="${escapeHtml(evaluation.finishedAt)}">${escapeHtml(formatEvaluationDate(evaluation.finishedAt))}</time>
          </div>
        </article>
      `,
    )
    .join("");
}

async function loadPublicEvaluations() {
  try {
    const response = await fetch("/api/public-evaluations", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Shared evaluations could not be loaded.");
    publicEvaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
    renderEvaluationGallery();
  } catch (error) {
    evaluationGallery.setAttribute("aria-busy", "false");
    evaluationGalleryStatus.textContent = error.message;
    evaluationGalleryStatus.classList.add("is-error");
    evaluationGallery.innerHTML = "";
  }
}

function openEvaluationModal(evaluation) {
  const rubric = Object.values(evaluation.rubric || {});
  evaluationModalDate.textContent = formatEvaluationDate(evaluation.finishedAt);
  evaluationModalTitle.textContent = evaluation.title;
  evaluationModalScore.innerHTML = `${Math.round(Number(evaluation.overallScore || 0))}<span>/100</span>`;
  evaluationModalSummary.textContent = evaluation.summary || "Evaluation completed.";
  evaluationModalDimensions.innerHTML = rubric
    .map((dimension) => {
      const available = dimension.available !== false && Number.isFinite(Number(dimension.score));
      return `
        <article>
          <div class="evaluation-modal-dimension-heading">
            <h3>${escapeHtml(dimension.label || "Dimension")}</h3>
            <strong>${available ? `${Math.round(Number(dimension.score))}<span>/100</span>` : "Not scored"}</strong>
          </div>
          ${available ? `<div class="evaluation-modal-meter" aria-hidden="true"><span style="--score: ${Math.max(0, Math.min(100, Number(dimension.score)))}%"></span></div>` : ""}
          <p>${escapeHtml(dimension.feedback || "No feedback was provided.")}</p>
        </article>
      `;
    })
    .join("");

  const hasVideo = Boolean(evaluation.videoPath);
  const hasPoster = Boolean(evaluation.posterPath);
  evaluationModalVideo.hidden = !hasVideo;
  evaluationModalPoster.hidden = hasVideo || !hasPoster;
  evaluationModalPosterFallback.hidden = hasVideo || hasPoster;

  if (hasVideo) {
    evaluationModalVideo.src = evaluation.videoPath;
    evaluationModalVideo.setAttribute("aria-label", `Play ${evaluation.title}`);
    if (hasPoster) evaluationModalVideo.poster = evaluation.posterPath;
    else evaluationModalVideo.removeAttribute("poster");
    evaluationModalVideo.load();
  } else {
    evaluationModalVideo.removeAttribute("src");
    evaluationModalVideo.removeAttribute("poster");
    evaluationModalVideo.removeAttribute("aria-label");
  }

  if (hasPoster) {
    evaluationModalPoster.src = evaluation.posterPath;
    evaluationModalPoster.alt = `First frame from ${evaluation.title}`;
  } else {
    evaluationModalPoster.removeAttribute("src");
    evaluationModalPoster.alt = "";
  }

  document.body.classList.add("modal-open");
  if (typeof evaluationModal.showModal === "function") evaluationModal.showModal();
  else evaluationModal.setAttribute("open", "");
  closeEvaluationModalButton.focus();
}

function closeEvaluationModal() {
  evaluationModalVideo.pause();
  if (typeof evaluationModal.close === "function") evaluationModal.close();
  else evaluationModal.removeAttribute("open");
  document.body.classList.remove("modal-open");
}

evaluationGallery.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-evaluation-id]");
  if (!trigger) return;
  const evaluation = publicEvaluations.find((item) => item.id === trigger.dataset.evaluationId);
  if (evaluation) openEvaluationModal(evaluation);
});

evaluationGallery.addEventListener(
  "error",
  (event) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    const fallback = document.createElement("div");
    fallback.className = "evaluation-card-poster-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.innerHTML = "<span>E</span>";
    event.target.replaceWith(fallback);
  },
  true,
);

closeEvaluationModalButton.addEventListener("click", closeEvaluationModal);
evaluationModalPoster.addEventListener("error", () => {
  evaluationModalPoster.hidden = true;
  evaluationModalPosterFallback.hidden = false;
});
evaluationModalVideo.addEventListener("error", () => {
  evaluationModalVideo.hidden = true;
  if (evaluationModalPoster.src) evaluationModalPoster.hidden = false;
  else evaluationModalPosterFallback.hidden = false;
});
evaluationModal.addEventListener("click", (event) => {
  if (event.target === evaluationModal) closeEvaluationModal();
});
evaluationModal.addEventListener("close", () => document.body.classList.remove("modal-open"));

function renderVideoEvaluation(evaluation) {
  const dimensions = Object.values(evaluation.rubric || {});
  const notice = evaluation.mediaValidation?.notice;
  const shareId = "methodology-latest";
  window.EvaluationShare.register(shareId, evaluation);
  evaluatorResult.innerHTML = `
    <div class="result-overview">
      <p>Speech evaluation</p>
      <strong>${Math.round(Number(evaluation.overallScore || 0))}<span>/100</span></strong>
      <p>${escapeHtml(evaluation.summary || "Evaluation completed.")}</p>
    </div>
    ${notice ? `<p class="media-notice ${evaluation.mediaValidation.visualEvaluated && !evaluation.mediaValidation.truncated ? "" : "is-limited"}">${escapeHtml(notice)}</p>` : ""}
    <div class="result-dimensions">
      ${dimensions
        .map(
          (item) => `
            <article>
              <div>
                <h3>${escapeHtml(item.label || "Dimension")}</h3>
                <strong>${item.available === false ? "Not scored" : `${Number(item.score || 0)} / 100`}</strong>
              </div>
              ${item.available === false ? "" : `<meter min="0" max="100" value="${Number(item.score || 0)}"></meter>`}
              <p>${escapeHtml(item.feedback || "")}</p>
            </article>
          `,
        )
        .join("")}
    </div>
    ${
      evaluation.transcript
        ? `<details class="result-transcript"><summary>Read transcript</summary><p>${escapeHtml(evaluation.transcript)}</p></details>`
        : ""
    }
    <div class="evaluation-share">
      <div class="evaluation-share-actions">
        <button type="button" class="share-evaluation" data-share-id="${shareId}">Share image</button>
        <button type="button" class="copy-evaluation" data-share-id="${shareId}">Copy image</button>
      </div>
      <span class="share-feedback" role="status" aria-live="polite"></span>
    </div>
  `;
  evaluatorResult.hidden = false;
  evaluatorResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

evaluatorResult.addEventListener("click", (event) => {
  window.EvaluationShare.handleClick(event);
});

videoInput.addEventListener("change", () => {
  const file = videoInput.files?.[0];
  selectedVideoName.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "No file selected";
});

evaluatorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  evaluatorResult.hidden = true;
  evaluatorStatus.className = "";

  const file = videoInput.files?.[0];
  if (file?.size > 250 * 1024 * 1024) {
    evaluatorStatus.textContent = "Choose a file smaller than 250 MB.";
    evaluatorStatus.className = "is-error";
    return;
  }

  evaluateVideoButton.disabled = true;
  evaluateVideoButton.textContent = "Evaluating…";
  evaluatorStatus.textContent = "Validating the video…";

  try {
    const body = new FormData();
    body.append("video", file);

    evaluatorStatus.textContent = "Extracting speech and preparing the evaluation…";
    const data = await window.EvaluationQueue.submit(body, { url: "/api/evaluate-video" });
    if (data.evaluation?.status !== "completed") throw new Error(data.evaluation?.reason || "Evaluation did not complete.");

    evaluatorStatus.textContent = "Evaluation complete.";
    evaluatorStatus.className = "is-success";
    renderVideoEvaluation(data.evaluation);
    await loadPublicEvaluations();
  } catch (error) {
    evaluatorStatus.textContent = error.message;
    evaluatorStatus.className = "is-error";
  } finally {
    evaluateVideoButton.disabled = false;
    evaluateVideoButton.textContent = "Validate and evaluate";
  }
});

loadPublicEvaluations();
fetch("/api/me").then(response => response.json()).then(data => {
  if (data.user) window.EvaluationQueue.restore().catch(() => {});
}).catch(() => {});
window.addEventListener("evaluation-job-completed", event => {
  if (event.detail.evaluation?.status === "completed") {
    renderVideoEvaluation(event.detail.evaluation);
    loadPublicEvaluations();
  }
});

const detail = {
  weight: document.querySelector("#detailWeight"),
  category: document.querySelector("#detailCategory"),
  title: document.querySelector("#detailTitle"),
  description: document.querySelector("#detailDescription"),
  reason: document.querySelector("#detailReason"),
};

document.querySelectorAll(".weight-segment").forEach((button) => {
  button.addEventListener("click", () => {
    const selected = dimensions[button.dataset.dimension];
    document.querySelectorAll(".weight-segment").forEach((item) => {
      const isActive = item === button;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", String(isActive));
    });

    Object.entries(detail).forEach(([key, element]) => {
      element.textContent = selected[key];
    });
  });
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (reducedMotion || !("IntersectionObserver" in window)) {
  document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 },
  );

  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}
