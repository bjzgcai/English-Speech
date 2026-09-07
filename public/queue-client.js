(() => {
  let owner = null;
  let heartbeat = null;
  let panel;
  let currentController;
  let acceptedId = null;
  let volatileDraft = null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const terminal = state => ["completed", "failed", "canceled"].includes(state);
  async function request(url, options = {}) {
    const response = await fetch(url, { cache: "no-store", ...options });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error || "Request failed."), { status: response.status, retryAfter: Number(response.headers.get("Retry-After")) || 5 });
    return data;
  }
  function mount() {
    if (panel) return panel;
    panel = document.createElement("section");
    panel.className = "queue-progress";
    panel.hidden = true;
    panel.innerHTML = '<div role="status" aria-live="polite"><strong data-queue-title></strong><p data-queue-detail></p></div><progress aria-label="Processing progress"></progress><div class="queue-actions"><button type="button" data-queue-cancel>Leave queue</button><button type="button" data-queue-resume hidden>Resume upload</button></div>';
    const anchor = document.querySelector("#videoEvaluatorForm");
    if (anchor) anchor.before(panel); else document.querySelector("main")?.prepend(panel);
    panel.querySelector("[data-queue-cancel]").onclick = async () => {
      try {
      if (acceptedId && !window.confirm("Discard this recording and its evaluation?")) return;
      if (acceptedId) await request(`/api/save-answer/${acceptedId}/cancel`, { method: "POST" });
      currentController?.abort(new DOMException("Canceled", "AbortError"));
      await draft("delete").catch(() => {});
      await release();
      acceptedId = null;
      panel.hidden = true;
      } catch (error) {
        show({ state: acceptedId ? "processing" : "draft", delayed: `Cancellation not confirmed. ${error.message}` });
      }
    };
    return panel;
  }
  function duration(seconds) {
    return seconds < 60 ? `${Math.max(1, Math.round(seconds))} sec` : `${Math.ceil(seconds / 60)} min`;
  }
  function show(data) {
    mount().hidden = false;
    const labels = { draft: "Upload saved on this device", waiting: "Waiting to start", admitted: "Ready", uploading: "Uploading recording", queued: "Recording saved. Waiting for evaluation", processing: "Evaluating your answer", completed: "Evaluation complete", failed: "Evaluation unavailable", canceled: "Recording discarded" };
    const stage = { normalized: "Preparing video", media: "Preparing speech and frames", transcription: "Transcribing speech", scoring: "Generating feedback" };
    panel.querySelector("[data-queue-title]").textContent = labels[data.state] || "Preparing your session";
    const details = [];
    if (data.queuePosition) details.push(`Position ${data.queuePosition}`);
    if (data.state === "processing") details.push(stage[data.stage] || "Processing");
    if (data.elapsedSeconds) details.push(`Elapsed ${Math.floor(data.elapsedSeconds / 60)}:${String(data.elapsedSeconds % 60).padStart(2, "0")}`);
    if (data.delayed) details.push(`Delayed: ${data.delayed}`);
    else if (data.estimatedRemainingSeconds) details.push(`About ${duration(data.estimatedRemainingSeconds.low)} to ${duration(data.estimatedRemainingSeconds.high)} remaining`);
    else if (!terminal(data.state) && !["admitted", "uploading", "draft"].includes(data.state)) details.push("Calculating estimate");
    if (data.state === "uploading" && data.percent !== undefined) details.push(`${data.percent}% uploaded`);
    if (terminal(data.state)) details.push(data.evaluation?.reason || "");
    panel.querySelector("[data-queue-detail]").textContent = details.filter(Boolean).join(". ");
    const progress = panel.querySelector("progress");
    progress.hidden = terminal(data.state) || ["admitted", "draft"].includes(data.state);
    progress.max = 100;
    if (data.percent !== undefined) progress.value = data.percent; else progress.removeAttribute("value");
    const cancel = panel.querySelector("[data-queue-cancel]");
    cancel.hidden = terminal(data.state) || data.state === "admitted";
    cancel.textContent = acceptedId ? "Discard recording" : data.state === "waiting" ? "Leave queue" : data.state === "draft" ? "Discard pending upload" : "Cancel";
  }
  async function identity() {
    if (!owner) owner = (await request("/api/me")).user?.openId;
    if (!owner) { location.assign(`/auth/dingtalk?redirect=${encodeURIComponent(location.pathname)}`); throw new Error("Sign in required."); }
    return owner;
  }
  async function consent() {
    if ((await request("/api/privacy-consent")).agreed) return;
    const dialog = document.createElement("dialog");
    dialog.className = "queue-consent";
    dialog.innerHTML = '<form method="dialog"><h2>Privacy consent</h2><p>Evaluation processes your profile, recording, transcript, sampled frames, and feedback.</p><label><input type="checkbox" required> I agree to the <a href="/privacy" target="_blank" rel="noreferrer">privacy policy</a>.</label><label><input type="checkbox" required> I consent to processing sensitive personal information in my audio and video.</label><div class="queue-actions"><button value="cancel" formnovalidate>Cancel</button><button value="accept">Accept and continue</button></div></form>';
    document.body.append(dialog);
    const accepted = new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue === "accept"), { once: true }));
    dialog.showModal();
    const agreed = await accepted;
    dialog.remove();
    if (!agreed) throw new DOMException("Consent required", "AbortError");
    await request("/api/privacy-consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ privacyAgreed: true, sensitiveInfoAgreed: true }) });
  }
  async function draft(operation, value) {
    if (operation === "put") volatileDraft = value;
    if (operation === "delete") volatileDraft = null;
    if (!owner || !window.indexedDB) return volatileDraft;
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("englisheval-pending", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("recordings");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("recordings", operation === "get" ? "readonly" : "readwrite");
        const store = transaction.objectStore("recordings");
        const action = operation === "get" ? store.get(owner) : operation === "put" ? store.put(value, owner) : store.delete(owner);
        transaction.oncomplete = () => resolve(action.result);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally { db.close(); }
  }
  function keepAlive() {
    if (!heartbeat) heartbeat = setInterval(() => request("/api/admission/heartbeat", { method: "POST" }).catch(() => {}), 20000);
  }
  async function release() {
    clearInterval(heartbeat); heartbeat = null;
    await request("/api/admission", { method: "DELETE" }).catch(() => {});
  }
  async function admit(signal) {
    await identity();
    currentController ||= new AbortController();
    const combined = signal ? AbortSignal.any([signal, currentController.signal]) : currentController.signal;
    keepAlive();
    while (true) {
      combined.throwIfAborted();
      const { admission } = await request("/api/admission", { method: "POST", signal: combined });
      if (admission.state === "submitted") {
        await follow(admission.jobId, combined);
        keepAlive();
        continue;
      }
      show(admission);
      if (admission.state === "admitted") return admission;
      await sleep((document.hidden ? 20000 : 5000) + Math.random() * 1000);
    }
  }
  async function follow(id, signal) {
    acceptedId = id;
    clearInterval(heartbeat); heartbeat = null;
    while (true) {
      signal?.throwIfAborted();
      let data;
      try { data = await request(`/api/jobs/${id}`, { signal }); }
      catch (error) {
        if (signal?.aborted || [401, 403, 404].includes(error.status)) throw error;
        show({ state: "processing", delayed: "Connection interrupted. Your saved recording is still queued." });
        await sleep(5000); continue;
      }
      show(data);
      if (terminal(data.state)) {
        acceptedId = null;
        window.dispatchEvent(new CustomEvent("evaluation-job-completed", { detail: data }));
        return data;
      }
      await sleep((document.hidden ? 20000 : 5000) + Math.random() * 1000);
    }
  }
  function transfer(saved, grant, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", saved.url);
      xhr.timeout = 300000;
      xhr.setRequestHeader("X-Submission-Id", saved.id);
      xhr.setRequestHeader("X-Upload-Grant", grant);
      if (saved.questionId) xhr.setRequestHeader("X-Question-Id", saved.questionId);
      const abort = () => xhr.abort();
      signal.addEventListener("abort", abort, { once: true });
      xhr.upload.onprogress = event => show({ state: "uploading", percent: event.lengthComputable ? Math.round(event.loaded / event.total * 100) : undefined });
      xhr.onloadend = () => signal.removeEventListener("abort", abort);
      xhr.onerror = xhr.ontimeout = () => reject(new Error("Upload interrupted. Your recording is retained on this device."));
      xhr.onabort = () => reject(new DOMException("Canceled", "AbortError"));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { return reject(new Error("Upload response unavailable. Your recording is retained on this device.")); }
        if (xhr.status < 200 || xhr.status >= 300) reject(Object.assign(new Error(data.error || "Upload failed."), { status: xhr.status })); else resolve(data);
      };
      const form = new FormData();
      form.append("video", saved.blob, saved.filename);
      form.append("submissionId", saved.id);
      if (saved.questionId) form.append("questionId", saved.questionId);
      form.append("startedAt", saved.startedAt || "");
      signal.throwIfAborted();
      xhr.send(form);
    });
  }
  async function send(saved, { signal, onAccepted } = {}) {
    currentController = new AbortController();
    const combined = signal ? AbortSignal.any([signal, currentController.signal]) : currentController.signal;
    mount().querySelector("[data-queue-resume]").hidden = true;
    try {
      let existing;
      try { existing = await request(`/api/jobs/${saved.id}`, { signal: combined }); } catch (error) { if (error.status !== 404) throw error; }
      if (!existing) {
        await admit(combined);
        while (true) {
          combined.throwIfAborted();
          try {
            const { grant } = await request("/api/admission/upload-grant", { method: "POST", signal: combined });
            existing = await transfer(saved, grant, combined);
            break;
          } catch (error) {
            if (![409, 429].includes(error.status)) throw error;
            if (error.status === 409) {
              const existing = await request(`/api/jobs/${saved.id}`, { signal: combined }).catch(() => null);
              if (existing?.state === "canceled") throw new Error("This recording was discarded.");
              await admit(combined);
            }
            show({ state: "queued", delayed: "Waiting for an upload slot. Your recording is saved on this device." });
            await sleep(5000 + Math.random() * 1000);
          }
        }
      }
      await draft("delete").catch(() => {});
      onAccepted?.(existing);
      return await follow(existing.id, combined);
    } catch (error) {
      if (error.name !== "AbortError") {
        show({ state: "draft", delayed: error.message });
        const resume = mount().querySelector("[data-queue-resume]");
        resume.hidden = false;
        resume.onclick = () => send(saved).catch(() => {});
      }
      throw error;
    }
  }
  async function submit(form, options = {}) {
    await identity();
    await consent();
    const blob = form.get("video");
    const saved = { id: form.get("submissionId") || crypto.randomUUID(), url: options.url || "/api/save-answer", questionId: form.get("questionId"), startedAt: form.get("startedAt"), blob, filename: blob.name || "answer.webm" };
    try { await draft("put", saved); }
    catch {
      // The in-memory draft remains retryable even when browser storage is full.
      window.addEventListener("beforeunload", event => {
        if (volatileDraft) { event.preventDefault(); event.returnValue = ""; }
      });
    }
    return send(saved, options);
  }
  async function restore() {
    await identity();
    const saved = await draft("get");
    if (saved) {
      show({ state: "draft" });
      const resume = mount().querySelector("[data-queue-resume]");
      resume.hidden = false;
      resume.onclick = () => send(saved).catch(() => {});
      return;
    }
    const { admission } = await request("/api/admission");
    if (admission?.jobId) await follow(admission.jobId);
  }
  window.EvaluationQueue = { admit: async signal => {
    await identity();
    if (volatileDraft || await draft("get")) throw new Error("Resume or discard the pending upload before starting another answer.");
    currentController = new AbortController(); return admit(signal);
  }, submit, release, restore, show, follow, discardDraft: () => draft("delete") };
})();
