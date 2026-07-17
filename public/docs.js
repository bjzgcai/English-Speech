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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderVideoEvaluation(evaluation) {
  const dimensions = Object.values(evaluation.rubric || {});
  const notice = evaluation.mediaValidation?.notice;
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
  `;
  evaluatorResult.hidden = false;
  evaluatorResult.scrollIntoView({ behavior: "smooth", block: "start" });
}

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
    const response = await fetch("/api/evaluate-video", { method: "POST", body });
    const data = await response.json();
    if (response.status === 401) {
      window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent("/methodology")}`;
      return;
    }
    if (!response.ok) throw new Error(data.error || "The video could not be evaluated.");

    evaluatorStatus.textContent = "Evaluation complete.";
    evaluatorStatus.className = "is-success";
    renderVideoEvaluation(data.evaluation);
  } catch (error) {
    evaluatorStatus.textContent = error.message;
    evaluatorStatus.className = "is-error";
  } finally {
    evaluateVideoButton.disabled = false;
    evaluateVideoButton.textContent = "Validate and evaluate";
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
