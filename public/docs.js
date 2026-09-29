const dimensions = {
  pronunciation: {
    weight: "20%",
    category: "Speech clarity",
    title: "Pronunciation and intelligibility",
    description: "Measures sound clarity, stress, rhythm, and whether pronunciation issues interfere with meaning.",
    reason: "Intelligibility remains essential: a strong idea cannot land if the listener cannot reliably understand the words. Its weight keeps speech clarity central without outweighing the structure and relevance of the response.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "Heard as \"I wan to sey abou my las pro-jek\" — the transcript drops the key words, so the listener never receives the claim.",
        why: "Blurred word endings and flat stress make the words the meaning depends on unrecoverable.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "\"I want to say about my last project\" comes through, but \"project\" and \"result\" ask for a second listen.",
        why: "Word endings are unstable on the exact nouns the listener needs.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "\"I want to describe my last project and its result\" arrives on the first listen, with stress on the words that carry the point.",
        why: "Clear consonants and sentence stress let the listener catch the message immediately.",
      },
    ],
  },
  grammar: {
    weight: "20%",
    category: "Language control",
    title: "Grammar",
    description: "Measures control of sentence structure, tense, agreement, and word order without demanding a particular accent or speaking style.",
    reason: "Grammar carries a substantial share because it protects meaning. Consistent errors can change relationships between ideas, time, ownership, and intent.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "Yesterday I go to office and my manager he tell me about the project, and I not understand what he saying.",
        audio: "/assets/audio/examples/grammar-needs-improvement.mp3",
        why: "Tense and agreement errors stack up until the timeline is unclear.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "I explained the issue to my manager and he agreed to give more time. Then we finish the report on Friday.",
        audio: "/assets/audio/examples/grammar-developing.mp3",
        why: "Mostly clear, but one tense shift to \"finish\" breaks the sequence.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "I explained the issue to my manager, and he agreed to give us more time. By Friday we had finished the report.",
        audio: "/assets/audio/examples/grammar-strong.mp3",
        why: "Consistent tense and clean clause structure carry the whole answer.",
      },
    ],
  },
  fluency: {
    weight: "10%",
    category: "Speech flow",
    title: "Fluency",
    description: "Measures pacing, hesitation, pauses, self-correction, and the ability to sustain an answer without long breakdowns.",
    reason: "Fluency matters to real-time communication, but speed is not the goal. Its weight rewards an understandable flow while leaving room for thoughtful pauses and different speaking styles.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "I... I think the... um... the project, it was, um... it was... good? I don't know... maybe... yeah.",
        audio: "/assets/audio/examples/fluency-needs-improvement.mp3",
        why: "Long pauses and restarts break the answer into disconnected pieces.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "So the project was, um, quite hard at the beginning. And then, you know, we, we managed to, to finish it.",
        audio: "/assets/audio/examples/fluency-developing.mp3",
        why: "Fillers and repeated words slow the answer, though the thread still holds.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "The project was hard at the beginning. We re-planned the timeline and finished ahead of schedule.",
        audio: "/assets/audio/examples/fluency-strong.mp3",
        why: "Steady pacing with pauses at clause boundaries instead of mid-phrase.",
      },
    ],
  },
  vocabulary: {
    weight: "15%",
    category: "Language range",
    title: "Vocabulary",
    description: "Measures the range, precision, and appropriateness of word choice, including the ability to avoid vague or repetitive language.",
    reason: "Vocabulary receives equal weight with fluency because precise words make ideas useful. It supports nuance without over-rewarding rare or unnecessarily complex language.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "It was very good and very nice and we did many things, so everything was good.",
        audio: "/assets/audio/examples/vocabulary-needs-improvement.mp3",
        why: "Only vague, repeated words, so the listener learns nothing specific.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "The project was difficult but we solved the problem. It took a long time and it was useful for me.",
        audio: "/assets/audio/examples/vocabulary-developing.mp3",
        why: "Correct but generic: \"difficult\" and \"useful\" could describe almost anything.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "The project was understaffed, so we narrowed the scope and shipped a smaller release on time.",
        audio: "/assets/audio/examples/vocabulary-strong.mp3",
        why: "Precise words such as \"understaffed\" and \"narrowed the scope\" carry the real story.",
      },
    ],
  },
  visual: {
    weight: "10%",
    category: "Presentation",
    title: "Visual delivery",
    description: "Measures posture, eye contact, facial engagement, and professional presence in camera-facing communication.",
    reason: "Presentation is part of the project goal, so delivery must count. Ten percent makes presence meaningful without allowing appearance to outweigh the substance of the speech.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "Described behaviour: reads from off-camera notes, looks down for most of the answer, and the framing cuts off the top of the head.",
        why: "The audience sees a reader, not a speaker.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "Described behaviour: finds the camera at the start and the end, but drifts back to the notes and sways through the middle.",
        why: "Contact is intermittent, so presence comes and goes.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "Described behaviour: holds eye contact with the lens, keeps a stable upright frame, and lets facial expression follow the message.",
        why: "Steady framing and eye contact keep attention on the message.",
      },
    ],
  },
  coherence: {
    weight: "25%",
    category: "Message structure",
    title: "Coherence and speech consistency",
    description: "Measures whether ideas connect logically, the speaker remains internally consistent, and the listener can follow the main point.",
    reason: "Coherence has the largest share because effective speech needs a stable main point, consistent claims, and ideas connected in an order the listener can follow.",
    examples: [
      {
        band: "needs_improvement",
        label: "Needs improvement",
        score: 40,
        snippet: "I like sports. Sports is good. Also I have many thing. Yes that's all.",
        audio: "/assets/audio/examples/coherence-needs-improvement.mp3",
        why: "Three unrelated fragments; no main point a listener can hold.",
      },
      {
        band: "developing",
        label: "Developing",
        score: 65,
        snippet: "I like sports because it's healthy. Sometimes I play basketball with friends, but I don't have much time now.",
        audio: "/assets/audio/examples/coherence-developing.mp3",
        why: "One clear reason, then the idea trails off without a close.",
      },
      {
        band: "strong",
        label: "Strong",
        score: 85,
        snippet: "I like sports mainly because it keeps me steady. I play basketball twice a week, and that routine carries into how I plan my work.",
        audio: "/assets/audio/examples/coherence-strong.mp3",
        why: "A stated main point, a supporting detail, and a link back to the claim.",
      },
    ],
  },
};

const evaluatorForm = document.querySelector("#videoEvaluatorForm");
const videoInput = document.querySelector("#evaluationVideo");
const publiclyShareVideo = document.querySelector("#publiclyShareVideo");
function resetSharingConsent() {
  publiclyShareVideo.checked = false;
  document.querySelector("#publicShareChoice").hidden = window.VisitorSession.user?.identityType !== "dingtalk";
}
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
        <p>Public evaluations will appear here.</p>
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
  publiclyShareVideo.checked = false;
  const file = videoInput.files?.[0];
  selectedVideoName.textContent = file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : "No file selected";
});

evaluatorForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (evaluateVideoButton.disabled) return;
  const requestedFile = videoInput.files?.[0];
  evaluateVideoButton.disabled = true;
  const accessReady = await window.VisitorSession.ensureAccess();
  evaluateVideoButton.disabled = false;
  if (!accessReady || !requestedFile || videoInput.files?.[0] !== requestedFile) {
    evaluateVideoButton.focus();
    return;
  }
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
    body.append("publiclyShared", String(publiclyShareVideo.checked));

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
window.VisitorSession.fetch("/api/me").then(response => response.json()).then(data => {
  resetSharingConsent();
  if (data.hasAccess) window.EvaluationQueue.restore().catch(() => {});
}).catch(() => {});
window.addEventListener("visitoridentitychange", event => {
  resetSharingConsent();
  evaluatorResult.innerHTML = "";
  evaluatorStatus.textContent = "";
  if (!event.detail.accessGranted) videoInput.value = "";
  if (window.VisitorSession.hasAccess) window.EvaluationQueue.restore().catch(() => {});
});
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

const detailExamples = document.querySelector("#detailExamples");

// One shared player: starting a card stops whichever card was playing, and the
// re-render that follows a dimension switch tears the old cards down, so the
// element is stopped with them.
const examplePlayer = new Audio();
let playingExampleButton = null;

function stopExamplePlayback() {
  examplePlayer.pause();
  if (examplePlayer.src) examplePlayer.removeAttribute("src");
  if (!playingExampleButton) return;
  playingExampleButton.classList.remove("is-playing");
  playingExampleButton.setAttribute("aria-pressed", "false");
  const label = playingExampleButton.querySelector(".example-play-label");
  if (label) label.textContent = "Play example";
  playingExampleButton = null;
}

examplePlayer.addEventListener("ended", stopExamplePlayback);
examplePlayer.addEventListener("error", stopExamplePlayback);

function toggleExamplePlayback(button) {
  if (playingExampleButton === button && !examplePlayer.paused) {
    stopExamplePlayback();
    return;
  }

  stopExamplePlayback();
  examplePlayer.src = button.dataset.audio;
  const started = examplePlayer.play();
  if (started && typeof started.catch === "function") started.catch(() => stopExamplePlayback());
  button.classList.add("is-playing");
  button.setAttribute("aria-pressed", "true");
  const label = button.querySelector(".example-play-label");
  if (label) label.textContent = "Pause example";
  playingExampleButton = button;
}

function renderExamples(dimension) {
  if (!detailExamples) return;
  stopExamplePlayback();
  detailExamples.innerHTML = (dimension.examples || [])
    .map(
      (example) => `
        <article class="example-card" data-band="${escapeHtml(example.band)}">
          <div class="example-band">
            <span class="example-band-label">${escapeHtml(example.label)}</span>
            <strong class="example-band-score">≈${escapeHtml(String(example.score))}</strong>
          </div>
          <p class="example-snippet">${escapeHtml(example.snippet)}</p>
          ${
            example.audio
              ? `<button type="button" class="example-play" data-audio="${escapeHtml(example.audio)}" aria-pressed="false" aria-label="Play the ${escapeHtml(example.label)} example">
                   <span class="example-play-icon" aria-hidden="true"></span>
                   <span class="example-play-label">Play example</span>
                 </button>`
              : ""
          }
          <p class="example-why">${escapeHtml(example.why)}</p>
        </article>
      `,
    )
    .join("");
}

detailExamples?.addEventListener("click", (event) => {
  const button = event.target.closest(".example-play");
  if (button) toggleExamplePlayback(button);
});

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

    renderExamples(selected);
  });
});

const activeSegment = document.querySelector(".weight-segment.is-active") || document.querySelector(".weight-segment");
if (activeSegment) renderExamples(dimensions[activeSegment.dataset.dimension]);

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
