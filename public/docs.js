const dimensions = {
  pronunciation: {
    weight: "25%",
    category: "Speech clarity",
    title: "Pronunciation and intelligibility",
    description: "Measures sound clarity, stress, rhythm, and whether pronunciation issues interfere with meaning.",
    reason: "It has the largest share because intelligibility is the gateway to every other skill. A strong idea cannot land if the listener cannot reliably understand the words.",
  },
  grammar: {
    weight: "20%",
    category: "Language control",
    title: "Grammar",
    description: "Measures control of sentence structure, tense, agreement, and word order without demanding a particular accent or speaking style.",
    reason: "Grammar carries the second-largest share because it protects meaning. Consistent errors can change relationships between ideas, time, ownership, and intent.",
  },
  fluency: {
    weight: "15%",
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
    weight: "15%",
    category: "Presentation",
    title: "Visual delivery",
    description: "Measures posture, eye contact, facial engagement, and professional presence in camera-facing communication.",
    reason: "Presentation is part of the project goal, so delivery must count. Fifteen percent makes presence meaningful without allowing appearance to outweigh the substance of the speech.",
  },
  coherence: {
    weight: "10%",
    category: "Message structure",
    title: "Coherence and task relevance",
    description: "Measures whether ideas connect logically, the response addresses the question, and the listener can follow the main point.",
    reason: "Coherence is essential, but parts of it already appear in fluency, grammar, and vocabulary. A focused 10 percent rewards structure while avoiding double-counting the same strength.",
  },
};

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
