const processing = require("./processing");

// The internal gateway stays primary for every chat-completions call; OpenRouter
// is only a fallback for when that gateway is unavailable. All configuration is
// read lazily so tests (and rotating keys) can change it without a reload.
function openRouterChatCompletionsUrl() {
  return (
    process.env.OPENROUTER_CHAT_COMPLETIONS_URL ||
    "https://openrouter.ai/api/v1/chat/completions"
  );
}

function openRouterModelFor(purpose) {
  const evalModel = process.env.OPENROUTER_EVAL_MODEL || "z-ai/glm-5.3-flash";
  if (purpose === "eval") return evalModel;
  if (purpose === "moderation") return process.env.OPENROUTER_MODERATION_MODEL || evalModel;
  return process.env.OPENROUTER_QUESTION_MODEL || evalModel;
}

// Speech-to-text on OpenRouter is a separate endpoint (POST /audio/transcriptions)
// with its own model catalog; Qwen3 ASR Flash speaks the same languages as the
// internal qwen-asr model, so it is the natural transcription fallback.
function openRouterTranscriptionsUrl() {
  return (
    process.env.OPENROUTER_TRANSCRIPTIONS_URL ||
    "https://openrouter.ai/api/v1/audio/transcriptions"
  );
}

function openRouterTranscribeModel() {
  // qwen3-asr-1.7b is the largest Qwen ASR model actually served on OpenRouter
  // (the -flash slugs 404 there); same Qwen3 ASR family as the internal model.
  return process.env.OPENROUTER_TRANSCRIBE_MODEL || "qwen/qwen3-asr-1.7b";
}

function openRouterAuthHeaders() {
  const headers = {
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY || ""}`,
    "X-OpenRouter-Title": "EnglishEval",
  };
  const referer = process.env.APP_BASE_URL;
  if (typeof referer === "string" && referer.trim()) headers["HTTP-Referer"] = referer.trim();
  return headers;
}

function openRouterHeaders() {
  return { ...openRouterAuthHeaders(), "Content-Type": "application/json" };
}

// A canceled job (task abort or expired worker lease) must never be retried
// against the fallback because the queue re-runs it on another worker.
function isCancellation(error) {
  const task = processing.context.getStore();
  return Boolean(task?.signal?.aborted) || /worker lease expired/i.test(String(error?.message));
}

async function chatCompletionWithFallback({
  url,
  headers,
  body,
  kind,
  fallbackModel,
  internalSignal,
  fallbackSignal,
}) {
  let internalFailure = null;
  try {
    const response = await processing.modelFetch(
      url,
      { method: "POST", signal: internalSignal, headers, body: JSON.stringify(body) },
      kind,
    );
    if (response.ok) return { response, provider: "internal", model: body.model };
    const detail = (await response.text()).slice(0, 500);
    internalFailure = new Error(`internal gateway returned HTTP ${response.status}: ${detail}`);
  } catch (error) {
    if (isCancellation(error)) throw error;
    // Local load-shedding (busy circuit, token budget) must keep its existing
    // degraded behavior — the caller serves the saved fallback question —
    // instead of spending the external fallback key on shed traffic.
    if (error.code === "MODEL_BUSY" || error.code === "MODEL_BUDGET_EXCEEDED") throw error;
    internalFailure = error;
  }

  if (!process.env.OPENROUTER_API_KEY || !fallbackModel) throw internalFailure;
  console.warn(
    `Internal model request failed (${internalFailure.message}); retrying ${kind} through the OpenRouter fallback.`,
  );
  try {
    const response = await processing.modelFetch(
      openRouterChatCompletionsUrl(),
      {
        method: "POST",
        signal: fallbackSignal,
        headers: openRouterHeaders(),
        body: JSON.stringify({ ...body, model: fallbackModel }),
      },
      kind,
      `${kind}:openrouter`,
    );
    if (response.ok) return { response, provider: "openrouter", model: fallbackModel };
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`OpenRouter fallback returned HTTP ${response.status}: ${detail}`);
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (internalFailure?.code && !error.code) error.code = internalFailure.code;
    if (!error.cause) error.cause = internalFailure;
    throw error;
  }
}

// Transcription fallback: the internal gateway stays primary; OpenRouter is
// only consulted after the internal attempt (including its own retry budget)
// has failed with a non-cancellation error. runFallback receives the resolved
// fallback model slug.
async function transcriptionWithFallback({ runInternal, runFallback }) {
  let internalFailure = null;
  try {
    return await runInternal();
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (error.code === "MODEL_BUSY" || error.code === "MODEL_BUDGET_EXCEEDED") throw error;
    internalFailure = error;
  }

  if (!process.env.OPENROUTER_API_KEY) throw internalFailure;
  const fallbackModel = openRouterTranscribeModel();
  console.warn(
    `Internal transcription failed (${internalFailure.message}); retrying through the OpenRouter fallback (${fallbackModel}).`,
  );
  try {
    return await runFallback(fallbackModel);
  } catch (error) {
    if (isCancellation(error)) throw error;
    if (internalFailure?.code && !error.code) error.code = internalFailure.code;
    if (!error.cause) error.cause = internalFailure;
    throw error;
  }
}

module.exports = {
  chatCompletionWithFallback,
  openRouterModelFor,
  openRouterAuthHeaders,
  openRouterTranscribeModel,
  openRouterTranscriptionsUrl,
  transcriptionWithFallback,
};
