(() => {
  const nativeFetch = window.fetch.bind(window);
  let current = null;
  let pending = null;
  let accessPending = null;
  let redeeming = false;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("englisheval-identity") : null;
  // Invitation names are capped on the server; the header shows a short preview of longer ones.
  const NAME_MAX_LENGTH = 30;
  const NAME_PREVIEW_LENGTH = 7;
  function truncateName(name, limit = NAME_PREVIEW_LENGTH) {
    const value = typeof name === "string" ? name.trim() : "";
    return value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
  }
  // Desktop reveals the full name on hover, touch on tap/click (see .identity-name in
  // access-modal.css). The chip keeps the short preview either way, so the navigation
  // beside it is never squeezed out while the full name is open.
  function renderIdentityName(element, name) {
    if (!element) return;
    const full = typeof name === "string" ? name.trim() : "";
    const short = truncateName(full);
    element.classList.add("identity-name");
    element.dataset.fullName = full;
    element.textContent = short;
    element.classList.toggle("is-truncated", short !== full);
    if (full) element.setAttribute("aria-label", full);
    else element.removeAttribute("aria-label");
    if (short === full) {
      element.dataset.expanded = "false";
      element.removeAttribute("role");
      element.removeAttribute("tabindex");
      element.removeAttribute("aria-expanded");
      return;
    }
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-expanded", element.dataset.expanded === "true" ? "true" : "false");
    if (element.dataset.nameBound === "true") return;
    element.dataset.nameBound = "true";
    const toggle = () => {
      const expanded = element.dataset.expanded === "true";
      element.dataset.expanded = expanded ? "false" : "true";
      element.setAttribute("aria-expanded", expanded ? "false" : "true");
    };
    element.addEventListener("click", toggle);
    element.addEventListener("keydown", event => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      toggle();
    });
  }

  function update(data) {
    const previous = current?.user?.openId;
    const previousAccess = current?.hasAccess;
    current = data;
    if (previous && (previous !== data.user?.openId || previousAccess !== data.hasAccess)) {
      window.dispatchEvent(new CustomEvent("visitoridentitychange", { detail: { previous, user: data.user, accessGranted: redeeming } }));
    }
    return data;
  }

  function refresh() {
    if (!pending) {
      const read = async () => {
        const response = await nativeFetch("/api/me", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to establish your session.");
        return update(data);
      };
      // Serialize first-time cookie creation across tabs where Web Locks is available.
      pending = (navigator.locks ? navigator.locks.request("englisheval-session", read) : read())
        .finally(() => { pending = null; });
    }
    return pending;
  }

  async function request(url, options = {}) {
    const target = new URL(url, location.href);
    const learner = target.origin === location.origin && target.pathname.startsWith("/api/") &&
      !/^\/api\/(game\/(leaderboard|challenge)$|invitation\/redeem$)/.test(target.pathname) &&
      !/^\/api\/(admin(?:\/|$)|v1(?:\/|$)|public-evaluations(?:\/|$)|share-qr$|health$)/.test(target.pathname);
    if (target.pathname === "/api/me" && target.origin === location.origin) {
      return new Response(JSON.stringify(await refresh()), { headers: { "Content-Type": "application/json" } });
    }
    const headers = new Headers(options.headers);
    if (learner) {
      if (!current) await refresh();
      if (!headers.has("X-Expected-Owner")) headers.set("X-Expected-Owner", current.user.openId);
    }
    const response = await nativeFetch(url, { ...options, headers });
    if (learner && response.status === 401) {
      const body = await response.clone().json().catch(() => ({}));
      if (body.code === "AUTH_REQUIRED") {
        if (current) update({ ...current, hasAccess: false });
        void ensureAccess();
      }
    }
    if (learner && response.status === 409) {
      const body = await response.clone().json().catch(() => ({}));
      if (body.code === "IDENTITY_CHANGED") await refresh();
    }
    if (learner && headers.get("X-Expected-Owner") !== current?.user?.openId) {
      throw Object.assign(new Error("Your active identity changed. Please try again."), { code: "IDENTITY_CHANGED" });
    }
    return response;
  }

  async function announce() {
    // A read started before redemption may still describe the old cookies.
    if (pending) await pending.catch(() => {});
    await refresh();
    channel?.postMessage("changed");
  }
  const occupiedMessage = "Your invitation code is occupied. Ask Beijing zhongguancun Academy's friend for one exclusive invitation code";
  function showOccupiedWarning(message) {
    return new Promise(resolve => {
      const previousFocus = document.activeElement;
      const dialog = document.createElement("dialog");
      dialog.className = "access-dialog occupied-dialog";
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-labelledby", "occupied-title");
      dialog.setAttribute("aria-describedby", "occupied-message");
      dialog.innerHTML = '<h2 id="occupied-title">Invitation code occupied</h2><p id="occupied-message"></p><button class="access-submit" type="button">Close</button>';
      dialog.querySelector("p").textContent = message;
      dialog.addEventListener("cancel", event => event.preventDefault());
      dialog.querySelector("button").onclick = () => dialog.close();
      dialog.addEventListener("close", () => { dialog.remove(); previousFocus?.focus(); resolve(); }, { once: true });
      document.body.append(dialog);
      dialog.showModal();
    });
  }

  // Celebration for invitation-code sign-ins only. DingTalk sign-in never calls
  // redeem(), so this toast cannot appear for DingTalk users. It is non-blocking:
  // it floats above the page, dismisses on click, and removes itself after a while.
  function showCongratulations(name) {
    const toast = document.createElement("div");
    toast.className = "congrats-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = '<strong class="congrats-title">祝贺！</strong><p class="congrats-text"></p><p class="congrats-sub">Welcome aboard — your invitation access is ready. Good luck!</p>';
    const who = typeof name === "string" ? name.trim() : "";
    toast.querySelector(".congrats-text").textContent = who
      ? `${who}，邀请码登录成功，开始你的英语口语挑战吧。`
      : "邀请码登录成功，开始你的英语口语挑战吧。";
    toast.addEventListener("click", () => toast.remove());
    document.body.append(toast);
    setTimeout(() => toast.remove(), 8000);
  }

  async function redeem(code, name = "") {
    const response = await nativeFetch("/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }) });
    const data = await response.json();
    if (!response.ok) {
      // An occupied code only tells a stranger that the name is missing or wrong, never the stored name.
      if (response.status === 409 && (data.code === "INVITATION_NAME_REQUIRED" || data.code === "INVITATION_NAME_MISMATCH")) {
        await showOccupiedWarning(occupiedMessage);
      }
      throw Object.assign(new Error(data.error || "Unable to redeem invitation code."), { code: data.code });
    }
    redeeming = true;
    try {
      await announce();
      if (!current?.hasAccess) throw new Error("Unable to verify access. Please try signing in.");
      if (current.user?.identityType === "guest") showCongratulations(current.user.name);
    } finally { redeeming = false; }
    return true;
  }
  // Invitation QR images encode <share-url>/invite#code=<CODE>. The small client-side
  // reader (public/vendor/jsQR.js, MIT-licensed) is fetched only when an image is used.
  let qrReaderPromise = null;
  function loadQrReader() {
    if (!qrReaderPromise) {
      qrReaderPromise = new Promise((resolve, reject) => {
        if (typeof window.jsQR === "function") return resolve(window.jsQR);
        const script = document.createElement("script");
        script.src = "/vendor/jsQR.js";
        script.onload = () => (typeof window.jsQR === "function" ? resolve(window.jsQR) : reject(new Error("Unable to load the QR reader.")));
        script.onerror = () => { qrReaderPromise = null; reject(new Error("Unable to load the QR reader.")); };
        document.head.append(script);
      });
    }
    return qrReaderPromise;
  }
  function invitationCodeFromQr(text) {
    const value = String(text || "").trim();
    if (!value) return null;
    // A bare code, or the code parameter of the shared invite link.
    if (/^[0-9A-Fa-f]{6,}$/.test(value)) return value.toUpperCase();
    try {
      const url = new URL(value);
      const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
      const candidate = fragment.get("code") || url.searchParams.get("code");
      if (candidate && /^[0-9A-Fa-f]{6,}$/.test(candidate.trim())) return candidate.trim().toUpperCase();
    } catch { /* Not a URL; fall through to a token search. */ }
    const token = value.match(/[0-9A-Fa-f]{6,}/);
    return token ? token[0].toUpperCase() : null;
  }
  async function decodeQrImage(file) {
    if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Please choose an image file.");
    const jsQR = await loadQrReader();
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0);
      const found = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
      const code = found && invitationCodeFromQr(found.data);
      if (!code) throw new Error("Could not find an invitation code in this image. Try another image or type the code.");
      return code;
    } finally { bitmap.close?.(); }
  }
  function ensureAccess({ force = false } = {}) {
    if (accessPending) return accessPending;
    accessPending = (async () => {
      try { if ((await refresh()).hasAccess && !force) return true; } catch { /* The modal offers a retry. */ }
      return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.className = "access-dialog";
        dialog.setAttribute("aria-labelledby", "access-title");
        dialog.innerHTML = `<form class="access-form"><button type="button" class="access-close" aria-label="Close">&times;</button><h2 id="access-title">Sign in to continue</h2><a class="access-login">Sign in with DingTalk</a><p class="access-divider">or use an invitation code</p><label class="access-label" for="access-code">Invitation code <button class="access-help" type="button" aria-label="How to get an invitation code" aria-expanded="false" aria-controls="access-code-help">?</button><span class="access-help-tip" id="access-code-help" role="tooltip">Get a code from your invitation provider. Each code grants one access.</span></label><span class="access-code-zone"><span class="access-input-wrap"><input id="access-code" name="code" required autocomplete="one-time-code" maxlength="200" placeholder="Enter code or upload QR image"><button class="access-qr-button" type="button" aria-label="Upload invitation QR image" title="Upload invitation QR image">▧</button></span><input id="access-qr-file" type="file" accept="image/*" hidden><span class="access-qr-status" role="status"></span></span><label class="access-label" for="access-name">Your name <button class="access-help" type="button" aria-label="How to sign in on another browser" aria-expanded="false" aria-controls="access-name-help">?</button><span class="access-help-tip" id="access-name-help" role="tooltip">Use this same name and invitation code when signing in from another browser.</span></label><input id="access-name" name="name" required autocomplete="name" maxlength="30" placeholder="Enter a name to remember"><p class="access-error" role="alert"></p><button class="access-submit" type="submit">Continue</button></form>`;
        const previousFocus = document.activeElement;
        const login = dialog.querySelector(".access-login");
        if (window.__invitationCode) dialog.querySelector("[name=code]").value = window.__invitationCode;
        login.href = `/auth/dingtalk?redirect=${encodeURIComponent(location.pathname + location.search)}`;
        login.hidden = current?.configured === false;
        if (login.hidden) {
          dialog.querySelector("h2").textContent = "Enter invitation code";
          dialog.querySelector(".access-divider").hidden = true;
        }
        let busy = false;
        let granted = false;
        // The invitation-code field doubles as the QR-image uploader: clicking it (or
        // dropping an image on it) reads the code out of the picture and fills the input.
        const codeInput = dialog.querySelector("[name=code]");
        const codeZone = dialog.querySelector(".access-code-zone");
        const qrFile = dialog.querySelector("#access-qr-file");
        dialog.querySelector(".access-qr-button").addEventListener("click", event => { event.stopPropagation(); if (!busy) qrFile.click(); });
        dialog.querySelectorAll(".access-help").forEach(help => {
          help.addEventListener("click", event => { event.stopPropagation(); const expanded = help.getAttribute("aria-expanded") === "true"; help.setAttribute("aria-expanded", String(!expanded)); help.dataset.expanded = String(!expanded); });
        });
        dialog.addEventListener("click", event => {
          if (!event.target.closest(".access-help")) dialog.querySelectorAll(".access-help").forEach(help => { help.setAttribute("aria-expanded", "false"); delete help.dataset.expanded; });
        });
        const qrStatus = dialog.querySelector(".access-qr-status");
        const nameInput = dialog.querySelector("[name=name]");
        const showQrStatus = (message, ok = false) => {
          qrStatus.textContent = message;
          qrStatus.classList.toggle("is-ok", ok);
        };
        const useQrImage = async file => {
          if (!file) return;
          showQrStatus("Reading the QR image...");
          try {
            const code = await decodeQrImage(file);
            codeInput.value = code;
            showQrStatus(`Invitation code ${code} added from the QR image.`, true);
            nameInput.focus();
          } catch (failure) {
            showQrStatus(failure?.message || "Could not read the QR image. Try another image or type the code.");
          }
        };
        codeZone.addEventListener("click", event => { if (!busy && event.target !== codeInput && !event.target.closest(".access-qr-button")) qrFile.click(); });
        codeZone.addEventListener("dragover", event => { event.preventDefault(); codeZone.classList.add("is-dragover"); });
        codeZone.addEventListener("dragleave", () => codeZone.classList.remove("is-dragover"));
        codeZone.addEventListener("drop", event => {
          event.preventDefault();
          codeZone.classList.remove("is-dragover");
          void useQrImage(event.dataTransfer?.files?.[0]);
        });
        // A drop that misses the zone must not navigate the page away to the image file.
        dialog.addEventListener("dragover", event => event.preventDefault());
        dialog.addEventListener("drop", event => event.preventDefault());
        qrFile.addEventListener("change", () => {
          const file = qrFile.files?.[0];
          qrFile.value = "";
          void useQrImage(file);
        });
        const changed = () => {
          if (!busy && current?.hasAccess) { granted = true; dialog.close(); }
        };
        window.addEventListener("visitoridentitychange", changed);
        dialog.addEventListener("cancel", event => { if (busy) event.preventDefault(); });
        dialog.querySelector(".access-close").onclick = () => { if (!busy) dialog.close(); };
        dialog.addEventListener("close", () => {
          window.removeEventListener("visitoridentitychange", changed);
          dialog.remove();
          previousFocus?.focus();
          resolve(granted);
        }, { once: true });
        dialog.querySelector("form").onsubmit = async event => {
          event.preventDefault();
          if (busy) return;
          const code = dialog.querySelector("[name=code]").value.trim();
          const name = dialog.querySelector("[name=name]").value.trim();
          if (!code || !name) return;
          busy = true;
          const button = dialog.querySelector(".access-submit");
          button.disabled = true;
          button.textContent = "Checking...";
          const error = dialog.querySelector(".access-error");
          error.textContent = "";
          try {
            await redeem(code, name);
            granted = true;
            dialog.close();
          } catch (failure) { error.textContent = failure.message; }
          finally { redeeming = false; busy = false; button.disabled = false; button.textContent = "Continue"; }
        };
        document.body.append(dialog);
        dialog.showModal();
      });
    })().finally(() => { accessPending = null; });
    return accessPending;
  }
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "/access-modal.css";
  document.head.append(style);
  document.addEventListener("click", event => {
    if (!event.target.closest("#loginButton, [data-header-login]")) return;
    event.preventDefault();
    void ensureAccess({ force: true });
  });
  channel?.addEventListener("message", () => refresh().catch(() => {}));
  window.addEventListener("focus", () => refresh().catch(() => {}));
  window.VisitorSession = { fetch: request, refresh, announce, ensureAccess, redeem, renderIdentityName, truncateName, NAME_MAX_LENGTH, NAME_PREVIEW_LENGTH, get hasAccess() { return current?.hasAccess === true; }, get user() { return current?.user; } };
})();
