const EXPERIENCE_RATING_COOLDOWN_DAYS = 90;
const EXPERIENCE_RATING_COOLDOWN_MS =
  EXPERIENCE_RATING_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

const POSITIVE_TAGS = Object.freeze([
  "Clear workflow",
  "Fast and responsive",
  "Helpful feedback",
  "Recording was easy",
]);

const NEGATIVE_TAGS = Object.freeze([
  "Workflow was unclear",
  "Page felt slow",
  "Feedback was not useful",
  "Recording had issues",
]);

const ALLOWED_TAGS = new Set([...POSITIVE_TAGS, ...NEGATIVE_TAGS]);

class ExperienceRatingValidationError extends Error {}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function experienceRatingStatus(ratings, openId, now = Date.now()) {
  const owner = text(openId);
  const latestTimestamp = ratings.reduce((latest, rating) => {
    if (text(rating?.openId) !== owner) return latest;
    const timestamp = Date.parse(rating?.createdAt);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, Number.NEGATIVE_INFINITY);

  return {
    eligible:
      Boolean(owner) &&
      (latestTimestamp === Number.NEGATIVE_INFINITY ||
        now - latestTimestamp >= EXPERIENCE_RATING_COOLDOWN_MS),
    cooldownDays: EXPERIENCE_RATING_COOLDOWN_DAYS,
  };
}

function parseExperienceRating(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ExperienceRatingValidationError("A valid rating response is required.");
  }

  const outcome = text(input.outcome).toUpperCase();
  if (!["RATED", "DISMISSED"].includes(outcome)) {
    throw new ExperienceRatingValidationError("Rating outcome must be RATED or DISMISSED.");
  }

  if (outcome === "DISMISSED") {
    if (input.score !== undefined || input.tags !== undefined) {
      throw new ExperienceRatingValidationError(
        "A dismissed rating cannot include a score or tags.",
      );
    }
    return { outcome, score: null, tags: [] };
  }

  const score = input.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
    throw new ExperienceRatingValidationError("Choose a rating from 1 to 5.");
  }
  if (input.tags !== undefined && !Array.isArray(input.tags)) {
    throw new ExperienceRatingValidationError("Rating tags must be an array.");
  }
  if ((input.tags || []).some((tag) => typeof tag !== "string")) {
    throw new ExperienceRatingValidationError("Every rating tag must be text.");
  }

  const tags = [...new Set((input.tags || []).map(text).filter(Boolean))];
  if (tags.length > 4) {
    throw new ExperienceRatingValidationError("Choose no more than four rating tags.");
  }
  const scoreTags = score >= 4 ? new Set(POSITIVE_TAGS) : new Set(NEGATIVE_TAGS);
  if (tags.some((tag) => !ALLOWED_TAGS.has(tag) || !scoreTags.has(tag))) {
    throw new ExperienceRatingValidationError(
      "One or more rating tags do not match the selected score.",
    );
  }

  return { outcome, score, tags };
}

function experienceRatingForAdmin(rating) {
  const outcome = text(rating?.outcome).toUpperCase();
  if (!rating?.id || !["RATED", "DISMISSED"].includes(outcome)) return null;

  const score = outcome === "RATED" ? Number(rating.score) : null;
  return {
    id: text(rating.id),
    userName: text(rating.userName) || "DingTalk user",
    jobNumber: text(rating.jobNumber),
    context: "EVALUATION",
    outcome,
    score: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
    tags: Array.isArray(rating.tags)
      ? rating.tags.map(text).filter((tag) => ALLOWED_TAGS.has(tag)).slice(0, 4)
      : [],
    createdAt: text(rating.createdAt),
  };
}

function listExperienceRatingsForAdmin(ratings) {
  return ratings
    .map(experienceRatingForAdmin)
    .filter(Boolean)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

module.exports = {
  EXPERIENCE_RATING_COOLDOWN_DAYS,
  ExperienceRatingValidationError,
  NEGATIVE_TAGS,
  POSITIVE_TAGS,
  experienceRatingStatus,
  listExperienceRatingsForAdmin,
  parseExperienceRating,
};
