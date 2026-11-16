const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// Recorded answers playable from the leaderboard. Anything that is not a known
// audio extension is treated as video (normalized recordings are MP4).
const LEADERBOARD_AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".m4a", ".ogg"]);

function leaderboardAnswerMediaType(filename) {
  if (typeof filename !== "string" || !filename) return null;
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!LEADERBOARD_AUDIO_EXTENSIONS.has(extension)) return "video";
  return "audio";
}
// Academic English weekly course: lesson 1 launches Monday 2026-09-28 (UTC+8) and
// spans two weeks. As a one-time handover, lesson 1 was extended by 24 hours (to
// 2026-10-13 00:00 UTC+8) and lesson 2 starts then, running to 2026-10-20 00:00
// UTC+8 (one extra day so lesson 2 stays live through Monday 2026-10-19). From
// 2026-10-26 onward the weekly topic switch is scheduled at Monday 12:00 (noon)
// UTC+8: lesson 3 runs to 2026-10-26 12:00 UTC+8 and every later lesson runs one
// week from one Monday noon to the next. Topic selection wraps using each
// group's own schedule length.
const COURSE_ANCHOR_MS = Date.parse("2026-09-28T00:00:00+08:00");
const LAUNCH_END_MS = COURSE_ANCHOR_MS + 2 * WEEK_MS;
// One-time handover on 2026-10-12: previous lesson extended to 24:00, current
// lesson starts 2026-10-13 00:00 UTC+8.
const HANDOVER_EXTENSION_MS = 24 * 60 * 60 * 1000;
const HANDOVER_END_MS = LAUNCH_END_MS + HANDOVER_EXTENSION_MS;
// Lesson 2 keeps running until the end of Monday 2026-10-19 (23:59:59.999
// UTC+8); its exclusive end boundary is midnight going into 2026-10-20.
const LAST_MIDNIGHT_BOUNDARY_MS = HANDOVER_END_MS + 7 * 24 * 60 * 60 * 1000;
// Weekly topic updates move to Monday 12:00 (noon) UTC+8 from 2026-10-26
// onward. The noon boundary keeps the same calendar date as the old midnight
// boundary, so date-keyed challenge IDs (`weekly-YYYY-MM-DD`) stay stable.
const FIRST_NOON_BOUNDARY_MS =
  LAST_MIDNIGHT_BOUNDARY_MS + 6 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000;

const DEFAULT_GAME_GROUP = "g1";

// Challenge ids are derived from each slot's start date, so the schedule
// adjustments (the one-time handover extension and the later move to Monday
// noon switches) also changed some ids. Answers submitted under the older
// schedules carry those legacy ids and would otherwise disappear from every
// board and export. Each legacy id maps to the canonical slot it was
// submitted in (its question matches that slot's weekly topic).
const LEGACY_CHALLENGE_SLOT_IDS = Object.freeze({
  // Lesson 2 before the handover extension moved its start to 2026-10-13.
  "weekly-2026-10-12": 1,
  "weekly-2026-10-12-g2": 1,
  // Lesson 3 before lesson 2 gained its extra day (canonical id weekly-2026-10-20).
  "weekly-2026-10-19": 2,
  "weekly-2026-10-19-g2": 2,
});

function normalizeGameGroup(value) {
  if (typeof value !== "string" && typeof value !== "number") return DEFAULT_GAME_GROUP;
  // Accepts "g2", "2", "group 2", and "group-2" alike so hand-written or shared
  // links keep working.
  const token = String(value).trim().toLowerCase().replace(/^group[\s_-]*/, "");
  const group = /^[1-9]$/.test(token) ? `g${token}` : token;
  return Object.prototype.hasOwnProperty.call(GAME_GROUPS, group) ? group : DEFAULT_GAME_GROUP;
}

const weeklyTopics = Object.freeze([
  // Unit 1 — Course launch & research survival communication (Liu Junli)
  {
    unitNumber: 1,
    unitTitle: "Course launch & research survival communication",
    instructor: "Liu Junli",
    title: "Introducing yourself as a researcher",
    question:
      "Introduce yourself as a researcher: the problem you care about, your research direction and methods, and your current progress.",
    focus: "Clear problem, direction, method, and a concrete progress update",
    followUp: "What will you do next, and why?",
  },
  {
    unitNumber: 1,
    unitTitle: "Course launch & research survival communication",
    instructor: "Liu Junli",
    title: "Structuring an academic presentation",
    question:
      "Walk through this talk outline's sections in order, then explain one design or body-language technique you would adopt, and why.",
    focus: "Logical talk structure plus one specific delivery technique",
    followUp: "How would you open your talk in one sentence?",
    figure: {
      src: "/assets/figures/l02-presentation-structure.png",
      alt: "Annotated sample talk outline for an AI study: title slide, then motivation, method, results and conclusion sections, with design, delivery and timing cues.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  // Unit 2 — Academic listening, notes & questions (Liu Junli)
  {
    unitNumber: 2,
    unitTitle: "Academic listening, notes & questions",
    instructor: "Liu Junli",
    title: "Finding the main line of a talk",
    question:
      "Name the signpost that introduces each stage of this road map, then state the talk's main line in one sentence.",
    focus: "Concrete signposts and one real example",
    followUp: "What was the speaker's key message?",
    figure: {
      src: "/assets/figures/l03-talk-mainline.png",
      alt: "Road-map diagram for an AI talk, linking problem, method, result and limitation with the signpost phrase that introduces each stage.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  {
    unitNumber: 2,
    unitTitle: "Academic listening, notes & questions",
    instructor: "Liu Junli",
    title: "Asking questions at a seminar",
    question:
      "Think of a question you would ask after a seminar talk. State your open or clarifying question, explain why it matters, and phrase it politely and professionally.",
    focus: "A well-phrased question with a clear motivation",
    followUp: "How would you follow up if the answer is unclear?",
  },
  // Unit 3 — AI paper structure & efficient reading (He Yuan)
  {
    unitNumber: 3,
    unitTitle: "AI paper structure & efficient reading",
    instructor: "He Yuan",
    title: "Three-pass reading of an AI paper",
    question:
      "Explain what each of the three reading passes tells you about this paper, from the title and abstract to the figure and the conclusion.",
    focus: "Method explained plus one applied example",
    followUp: "What did the figures tell you before you read the text?",
    figure: {
      src: "/assets/figures/l05-paper-three-pass.png",
      alt: "Front page of an AI paper on retrieval-augmented question answering, with title, abstract block, a Figure 1 bar-chart thumbnail and the conclusion, beside three numbered reading passes.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  {
    unitNumber: 3,
    unitTitle: "AI paper structure & efficient reading",
    instructor: "He Yuan",
    title: "From research question to contribution",
    question:
      "Summarize one AI paper's narrative: its research question, claimed contribution, and supporting evidence — and point out one assumption or limitation.",
    focus: "Question, contribution, evidence, and a boundary",
    followUp: "Which claim is weakest, and why?",
  },
  // Unit 4 — Explaining figures, methods & experiments (Wang Xudong)
  {
    unitNumber: 4,
    unitTitle: "Explaining figures, methods & experiments",
    instructor: "Wang Xudong",
    title: "Explaining an experimental figure",
    question:
      "State the conclusion first, compare the proposed method with the baseline, cite the evidence, and name the boundary — including one trend or anomaly and one uncertainty.",
    focus: "Conclusion first, then comparison, evidence, and limits",
    followUp: "How does it compare with the baseline?",
    figure: {
      src: "/assets/figures/l07-experimental-figure.png",
      alt: "Grouped bar chart of exact match with error bars, comparing Ours (RAG-8B) with a Baseline (Dense-8B) across four question-answering benchmarks, including one outlier run where the baseline wins.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  {
    unitNumber: 4,
    unitTitle: "Explaining figures, methods & experiments",
    instructor: "Wang Xudong",
    title: "Walking through your method",
    question:
      "Explain your method as input-process-output: what goes in, what each stage does, what comes out, and how someone could reproduce it.",
    focus: "Clear pipeline with reproducible details",
    followUp: "Which stage is hardest to reproduce?",
  },
  // Unit 5 — Contributions, result boundaries & responsible claims (Hu Chen)
  {
    unitNumber: 5,
    unitTitle: "Contributions, result boundaries & responsible claims",
    instructor: "Hu Chen",
    title: "Stating contributions without overclaiming",
    question:
      "State your research question, your evidence, and your contribution in one careful paragraph, and name one common overclaiming trap you deliberately avoid.",
    focus: "Precise claim matched to evidence",
    followUp: "Where could your claim be misunderstood?",
  },
  {
    unitNumber: 5,
    unitTitle: "Contributions, result boundaries & responsible claims",
    instructor: "Hu Chen",
    title: "Managing the boundaries of your results",
    question:
      "Explain what these results can and cannot support, and hedge two rows deliberately with contrast and probability language — one significant, one not.",
    focus: "Hedged, well-bounded statements",
    followUp: "What evidence would strengthen your claim?",
    figure: {
      src: "/assets/figures/l10-results-boundaries.png",
      alt: "Results table with exact-match means, confidence intervals and a mix of significant and clearly non-significant rows.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  // Unit 6 — Group-meeting updates & core academic writing (Gao Kun)
  {
    unitNumber: 6,
    unitTitle: "Group-meeting updates & core academic writing",
    instructor: "Gao Kun",
    title: "Two-minute group-meeting update",
    question:
      "Give a two-minute update on your research: your progress since last time, the evidence for it, one obstacle, and your next step.",
    focus: "Progress, evidence, obstacle, next step",
    followUp: "What would unblock your obstacle?",
  },
  {
    unitNumber: 6,
    unitTitle: "Group-meeting updates & core academic writing",
    instructor: "Gao Kun",
    title: "Title and abstract information structure",
    question:
      "Read this title and abstract aloud, explain the information order of the numbered sentences, and finish with one line from an academic email asking for collaboration.",
    focus: "Audience-aware information order",
    followUp: "What would you cut for a general audience?",
    figure: {
      src: "/assets/figures/l12-title-abstract.png",
      alt: "Title and abstract of an AI paper whose five abstract sentences are numbered to show information order, with callouts on order, title and audience.",
      caption: "Illustrative figure — synthetic data",
    },
  },
  // Unit 7 — Research statements & conference Q&A (Wang Xudong)
  {
    unitNumber: 7,
    unitTitle: "Research statements & conference Q&A",
    instructor: "Wang Xudong",
    title: "Three-minute research statement around one figure",
    question:
      "Deliver a 3-minute research statement on your work, structured around the five-beat framework below and accompanied by one uploaded figure. Follow the beat order and timing:\n\n" +
      "1. Context/problem: why anyone should care (~30s). Explain the issue in plain terms, no jargon. Make clear why a non-specialist should find it important.\n" +
      "2. Gap/question: what is not yet known or not yet working (~20s). State precisely what the field currently lacks, and the specific question your work addresses.\n" +
      "3. What we did: the approach (~40s). Describe your method at roughly 30 seconds' worth of conceptual depth: enough for the audience to follow the logic, not a full technical walkthrough.\n" +
      "4. The figure: the evidence (~60s). Upload one figure and walk the audience through it. This is the centre of the talk: spend the most time here, orienting the audience to what the figure shows and what it demonstrates.\n" +
      "5. So-what + boundary: what it enables and where it stops (~30s). State what your result makes possible and be explicit about the limits of your claim.\n\n" +
      "Keep the total to 3 minutes, respect the timings, and make sure the figure carries the evidential weight of the talk.",
    focus: "Five-beat structure, figure evidence, and claim boundaries",
    expectedDurationSeconds: 180,
    requiresFigureUpload: true,
    followUp: "What is the one sentence you want remembered?",
  },
  {
    unitNumber: 7,
    unitTitle: "Research statements & conference Q&A",
    instructor: "Wang Xudong",
    title: "Handling hard questions",
    question:
      "Answer a hard question about your work: give a direct answer first, bridge to a related strength, clarify the question if needed, and honestly acknowledge what you do not know.",
    focus: "Direct answer, bridging, honest limits",
    followUp: "When should you say 'I don't know'?",
  },
  // Unit 8 — Integrated rehearsal, round table & post-test (Course faculty)
  {
    unitNumber: 8,
    unitTitle: "Integrated rehearsal, round table & post-test",
    instructor: "Course faculty",
    title: "Rehearsal after feedback",
    question:
      "Re-deliver your research statement after feedback: state what feedback you received, what you changed, and perform the improved version.",
    focus: "Feedback to revision to performance",
    followUp: "Which change helped the most?",
  },
  {
    unitNumber: 8,
    unitTitle: "Integrated rehearsal, round table & post-test",
    instructor: "Course faculty",
    title: "Round-table defense",
    question:
      "Present one core claim from your work, respond to a challenge against it, and describe your plan for continuing to use academic English after this course.",
    focus: "Claim, defense, and a forward plan",
    followUp: "What is your next English milestone?",
  },
]);

// The 山东大学 group starts in the middle of the academic course calendar. Its
// topics are intentionally lighter than the research-communication track, use
// the same two-minute weekly format, and cycle after the first nine weeks.
const SHANDONG_GROUP_START_SLOT = 2;
const shandongTopics = Object.freeze([
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "How do you use AI everyday?",
    question:
      "How do you use AI in your everyday life? Give two or three real examples, explain which one helps you most, and finish with one funny or surprising problem you have had with AI.",
    focus: "Concrete examples, a real benefit, and one honest limitation",
    expectedDurationSeconds: 120,
    followUp: "What is one thing you would never trust AI to do?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "The canteen dish I would defend in court",
    question:
      "Pick one canteen dish you would defend in court. Explain what it tastes like, why it deserves more respect, and exactly when a hungry student should order it.",
    focus: "Vivid description, clear reasons, and a practical recommendation",
    expectedDurationSeconds: 120,
    followUp: "What is the most underrated thing on your campus menu?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "A survival guide for an 8 a.m. class",
    question:
      "Create a survival guide for an 8 a.m. class. Give three practical tips, describe one mistake you keep making, and end with your emergency backup plan.",
    focus: "Clear tips, an honest mistake, and a useful backup plan",
    expectedDurationSeconds: 120,
    followUp: "What is the hardest part of getting to class on time?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "My class group chat has a personality",
    question:
      "Describe your class group chat as if it were a person. What is it like, what makes it funny or annoying, and how do you survive it?",
    focus: "Personification, specific examples, and a balanced opinion",
    expectedDurationSeconds: 120,
    followUp: "Which group chat habit should be banned forever?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "The package I waited for like a movie premiere",
    question:
      "Tell the story of a package you waited for like a movie premiere. Build up the wait, describe the tiny problem, and explain how it finally ended.",
    focus: "A dramatic build-up, a concrete complication, and a satisfying ending",
    expectedDurationSeconds: 120,
    followUp: "What is the strangest thing you have ever ordered online?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "How to win the library seat battle",
    question:
      "Turn your method for finding a library seat into a friendly tutorial. Explain your timing, your secret strategy, and your backup plan when every seat is gone.",
    focus: "Useful steps, one insider tip, and a realistic backup",
    expectedDurationSeconds: 120,
    followUp: "Reserved seat or lucky free seat: which is better?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "The one item in my dorm with main-character energy",
    question:
      "Choose an ordinary item in your dorm and describe it as the main character of a short movie. Why is it essential, what drama does it create, and how would the story end?",
    focus: "Creative description, one real dorm story, and a clear ending",
    expectedDurationSeconds: 120,
    followUp: "Which dorm item could never be replaced?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "The app I open for no reason",
    question:
      "Name an app you open even when you have no reason to. Explain when you do it, what it gives you, and what you would change about it.",
    focus: "A specific habit, an honest reason, and one improvement",
    expectedDurationSeconds: 120,
    followUp: "Could you survive one day without that app?",
  },
  {
    unitNumber: 1,
    unitTitle: "Everyday English for university life",
    instructor: "",
    title: "If AI planned my campus day",
    question:
      "Imagine AI plans your entire campus day. Describe the schedule, predict what would go wrong, and decide whether you would try it again.",
    focus: "A clear scenario, funny consequences, and a reasoned verdict",
    expectedDurationSeconds: 120,
    followUp: "Which part of your day should always stay human-controlled?",
  },
]);

// Groups 1 and 2 use separate fifteen-topic rotations from the shared academic
// pool. They omit their respective Nov 9-16 topics permanently, so later topics
// and teachers move one week earlier and each rotation wraps after fifteen
// lessons. 山东大学 uses its own pool and begins at its original course slot.
const GAME_GROUPS = Object.freeze({
  g1: Object.freeze({
    label: "Group 1",
    topicPool: weeklyTopics,
    // Parallel-class chapter order: 1, 1, 2, 2, 3, 3, 4, 4, 7, 7, 6, 6, 5, 5, 8, 8.
    topicSchedule: Object.freeze([0, 1, 2, 3, 4, 6, 7, 12, 13, 10, 11, 8, 9, 14, 15]),
    startSlot: 0,
    // One-week, group-specific replacements are keyed by the Monday date that
    // starts the challenge. They leave the shared topic pool and other groups
    // untouched.
    weekOverrides: Object.freeze({
      "2026-10-26": Object.freeze({
        instructor: "He Yuan",
        title: "Writing a paper title and abstract for your research project",
        question:
          "Write and present an English paper title and abstract for your own research project.\n\n" +
          "Title requirements:\n" +
          "- Use no more than 18 English words.\n" +
          "- Reflect the research question and main findings accurately.\n" +
          "- Avoid vague phrases such as “A novel method,” “An effective framework,” and “A comprehensive study.”\n\n" +
          "Abstract requirements:\n" +
          "- Write 180–220 words.\n" +
          "- Include the research background.\n" +
          "- Explain the problem that remains unresolved.\n" +
          "- State what your study compared.\n" +
          "- Report the most important result.\n" +
          "- Discuss the trade-off between performance and inference cost.\n" +
          "- End with a cautious, accurate conclusion.",
        focus:
          "A precise title, a complete 180–220-word abstract, and a cautious performance–cost trade-off",
        followUp:
          "Which sentence in your abstract most clearly states the main finding, and what limitation must qualify it?",
      }),
      "2026-11-02": Object.freeze({
        instructor: "He Yuan",
        title: "Writing an academic paper in English",
        question:
          "Task requirements:\n" +
          "1. Choose one paper you know well or your own current project. State its research question and main contribution in one or two sentences.\n" +
          "2. Explain how you would organize the paper in English. Describe the purpose and order of its main sections, from introduction and methods to results and conclusion.\n" +
          "3. Point to two English-writing choices that matter most for a research paper—for example, precise verbs, cautious claims, topic sentences, or linking ideas—and explain why each improves clarity or accuracy.\n" +
          "4. Describe one revision step you would use to improve the paper, and identify the feedback or evidence you would need before submitting it.\n" +
          "5. Keep your response to about two minutes.",
        focus:
          "A clear paper structure, precise English-writing choices, and a concrete revision plan",
        followUp: "Which sentence or section would you revise first, and why?",
        figure: null,
      }),
    }),
  }),
  g2: Object.freeze({
    label: "Group 2",
    topicPool: weeklyTopics,
    topicSchedule: Object.freeze([6, 7, 12, 13, 8, 10, 11, 4, 5, 0, 1, 2, 3, 14, 15]),
    startSlot: 0,
    weekOverrides: Object.freeze({
      "2026-10-26": Object.freeze({
        instructor: "Hu Chen",
        title: "Draft a short research abstract",
        question:
          "Task requirements:\n" +
          "1. Draft a short research abstract. Write around 150-180 words about your own research or a paper you know well. Introduce the question, approach, main findings and why the work matters.\n" +
          "2. Try a different opening. Write an alternative opening of about 40 words for a broader academic audience. Keep the research itself unchanged, but reconsider the background and details your readers need.\n" +
          "3. Look closely at two key sentences. Choose two sentences about the findings or contribution. Briefly note what supports each sentence and why you chose that wording.\n" +
          "4. Choose one sentence for feedback. Mark a sentence you would like to discuss or improve. We will use it in the next meeting to explore research claims and clear writing.\n" +
          "5. Bring your draft and notes. Have relevant results or sources available. If you use AI for revision, keep the original and revised versions so we can compare the changes.",
        focus:
          "A concise abstract, an audience-aware opening, evidence notes, and one sentence selected for feedback",
        followUp:
          "Which sentence did you choose for feedback, and what evidence supports it?",
      }),
    }),
  }),
  g3: Object.freeze({
    label: "山东大学",
    topicPool: shandongTopics,
    topicSchedule: null,
    startSlot: SHANDONG_GROUP_START_SLOT,
  }),
});

const GAME_GROUP_IDS = Object.freeze(Object.keys(GAME_GROUPS));
const CAMERA_REQUIRED_GROUPS = Object.freeze(["g1", "g2"]);

function requiresCameraForGroup(group) {
  return CAMERA_REQUIRED_GROUPS.includes(normalizeGameGroup(group));
}

function challengeGroupFromId(challengeId) {
  const match = String(challengeId || "").match(/-g([1-9])$/);
  return match ? normalizeGameGroup(`g${match[1]}`) : DEFAULT_GAME_GROUP;
}

function requiresCameraForQuestion(question) {
  if (typeof question?.requiresCamera === "boolean") return question.requiresCamera;
  if (question?.group) return requiresCameraForGroup(question.group);
  if (!question?.challengeId) return false;
  return requiresCameraForGroup(challengeGroupFromId(question.challengeId));
}

const structuralGuide = Object.freeze([
  { key: "answer", label: "Answer", prompt: "State your main point in one sentence." },
  { key: "reasons", label: "Reasons", prompt: "Add two reasons or useful details." },
  { key: "example", label: "Example", prompt: "Choose one real moment that makes it concrete." },
  { key: "close", label: "Close", prompt: "Finish with the result, lesson, or recommendation." },
]);

// Lesson-slot index: slot 0 is the two-week launch lesson (2026-09-28 to
// 2026-10-13 00:00 UTC+8 after the one-time handover extension); slot 1 runs
// 2026-10-13 00:00 to 2026-10-20 00:00 UTC+8; slot 2 runs to the first Monday
// noon boundary (2026-10-26 12:00 UTC+8); every later slot is one week starting
// Monday 12:00 (noon) UTC+8. Times before the launch clamp to slot 0.
function challengeIndexAt(now = new Date()) {
  const t = Math.max(0, now.getTime());
  if (t < HANDOVER_END_MS) return 0;
  if (t < LAST_MIDNIGHT_BOUNDARY_MS) return 1;
  if (t < FIRST_NOON_BOUNDARY_MS) return 2;
  return 3 + Math.floor((t - FIRST_NOON_BOUNDARY_MS) / WEEK_MS);
}

function slotStartMs(index) {
  if (index <= 0) return COURSE_ANCHOR_MS;
  if (index === 1) return HANDOVER_END_MS;
  if (index === 2) return LAST_MIDNIGHT_BOUNDARY_MS;
  return FIRST_NOON_BOUNDARY_MS + (index - 3) * WEEK_MS;
}

function slotEndMs(index) {
  if (index === 0) return LAUNCH_END_MS + HANDOVER_EXTENSION_MS;
  return slotStartMs(index + 1);
}

function challengeForIndex(index, group = DEFAULT_GAME_GROUP) {
  const normalizedGroup = normalizeGameGroup(group);
  const groupConfig = GAME_GROUPS[normalizedGroup];
  const cycleIndex = groupConfig.topicSchedule
    ? (
        ((index % groupConfig.topicSchedule.length) + groupConfig.topicSchedule.length)
        % groupConfig.topicSchedule.length
      )
    : index;
  const topicIndex = groupConfig.topicSchedule
    ? groupConfig.topicSchedule[cycleIndex]
    : (
        ((cycleIndex - groupConfig.startSlot) % groupConfig.topicPool.length)
        + groupConfig.topicPool.length
      ) % groupConfig.topicPool.length;
  const startMs = slotStartMs(index);
  const endMs = slotEndMs(index);
  const dateKey = new Date(startMs).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const topic = {
    ...groupConfig.topicPool[topicIndex],
    ...groupConfig.weekOverrides?.[dateKey],
  };
  // Group 1 keeps its historical identifier so existing answers, boards, and
  // analytics remain valid; every other group gets its own board identifier.
  const id = normalizedGroup === DEFAULT_GAME_GROUP
    ? `weekly-${dateKey}`
    : `weekly-${dateKey}-${normalizedGroup}`;
  const aliasIds = Object.entries(LEGACY_CHALLENGE_SLOT_IDS)
    .filter(([legacyId, legacySlotIndex]) =>
      legacySlotIndex === index && legacyIdGroup(legacyId) === normalizedGroup)
    .map(([legacyId]) => legacyId);

  return {
    id,
    aliasIds,
    group: normalizedGroup,
    groupLabel: groupConfig.label,
    topicIndex,
    lessonNumber: cycleIndex - groupConfig.startSlot + 1,
    unitNumber: topic.unitNumber,
    unitTitle: topic.unitTitle,
    instructor: topic.instructor,
    title: topic.title,
    question: topic.question,
    focus: topic.focus,
    expectedDurationSeconds: topic.expectedDurationSeconds || 120,
    requiresFigureUpload: topic.requiresFigureUpload === true,
    requiresCamera: requiresCameraForGroup(normalizedGroup),
    followUp: topic.followUp,
    figure: topic.figure || null,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    structuralGuide,
  };
}

function currentChallenge(now = new Date(), group = DEFAULT_GAME_GROUP) {
  return challengeForIndex(challengeIndexAt(now), group);
}

function availableChallenges(now = new Date(), limit = 10, group = DEFAULT_GAME_GROUP) {
  const normalizedGroup = normalizeGameGroup(group);
  const groupConfig = GAME_GROUPS[normalizedGroup];
  const currentIndex = challengeIndexAt(now);
  if (currentIndex < groupConfig.startSlot) return [];
  return Array.from(
    { length: Math.min(limit, currentIndex - groupConfig.startSlot + 1) },
    (_, offset) => challengeForIndex(currentIndex - offset, normalizedGroup),
  );
}

function challengeQuestion(challenge) {
  return {
    question: challenge.question,
    focus: challenge.focus,
    expectedDurationSeconds: challenge.expectedDurationSeconds,
    requiresFigureUpload: challenge.requiresFigureUpload === true,
    requiresCamera: requiresCameraForQuestion(challenge),
    followUp: challenge.followUp,
    challengeId: challenge.id,
    challengeTitle: challenge.title,
    challengeStartsAt: challenge.startsAt,
    challengeEndsAt: challenge.endsAt,
    figure: challenge.figure || null,
  };
}

function legacyIdGroup(legacyId) {
  return /-g[1-9]$/.test(legacyId) ? legacyId.slice(-2) : DEFAULT_GAME_GROUP;
}

// Records may carry a canonical challenge id or one of its schedule-era
// legacy ids; boards, exports, and API resolution must accept both.
function matchesChallengeId(challenge, challengeId) {
  if (typeof challengeId !== "string" || !challengeId) return false;
  return challengeId === challenge?.id || Boolean(challenge?.aliasIds?.includes(challengeId));
}

function leaderboardForChallenge(records, challenge, viewerOpenId, identities = new Map()) {
  const bestByUser = new Map();

  records.forEach((record) => {
    if (
      !matchesChallengeId(challenge, record?.question?.challengeId) ||
      record?.evaluation?.status !== "completed" ||
      !Number.isFinite(Number(record?.evaluation?.overallScore))
    ) {
      return;
    }

    const openId = record?.openId || record?.user?.openId;
    if (!openId) return;

    const entry = {
      openId,
      name: record?.user?.name || record?.profile?.name || "DingTalk user",
      score: Math.round(Number(record.evaluation.overallScore)),
      finishedAt: record.finishedAt || "",
      attempts: 1,
      answerId: typeof record.id === "string" && record.id ? record.id : "",
      mediaType: leaderboardAnswerMediaType(record.filename),
    };
    const current = bestByUser.get(openId);
    if (!current) {
      bestByUser.set(openId, entry);
      return;
    }

    current.attempts += 1;
    if (
      entry.score > current.score ||
      (entry.score === current.score && entry.finishedAt < current.finishedAt)
    ) {
      current.score = entry.score;
      current.finishedAt = entry.finishedAt;
      current.name = entry.name;
      current.answerId = entry.answerId;
      current.mediaType = entry.mediaType;
    }
  });

  const entries = [...bestByUser.values()]
    .sort((left, right) => right.score - left.score || left.finishedAt.localeCompare(right.finishedAt))
    .map((entry, index) => {
      const identity = identities.get(entry.openId);
      return {
        rank: index + 1,
        // Anonymity was removed: the board always shows the real name.
        name: identity?.actualName || entry.name,
        score: entry.score,
        attempts: entry.attempts,
        isViewer: entry.openId === viewerOpenId,
        // Best attempt's recording so the board can offer inline playback.
        answerId: entry.answerId || undefined,
        mediaType: entry.mediaType || undefined,
      };
    });

  return {
    entries,
    viewerRank: entries.find((entry) => entry.isViewer)?.rank || null,
    participantCount: entries.length,
  };
}

module.exports = {
  GAME_GROUPS,
  GAME_GROUP_IDS,
  availableChallenges,
  challengeForIndex,
  challengeIndexAt,
  challengeQuestion,
  currentChallenge,
  leaderboardForChallenge,
  leaderboardAnswerMediaType,
  matchesChallengeId,
  normalizeGameGroup,
  requiresCameraForGroup,
  requiresCameraForQuestion,
  shandongTopics,
  structuralGuide,
  weeklyTopics,
};
