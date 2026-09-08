(() => {
  const nativeFetch = window.fetch.bind(window);
  let current = null;
  let pending = null;
  let accessPending = null;
  let redeeming = false;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("englisheval-identity") : null;

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
  function ensureAccess({ force = false } = {}) {
    if (accessPending) return accessPending;
    accessPending = (async () => {
      try { if ((await refresh()).hasAccess && !force) return true; } catch { /* The modal offers a retry. */ }
      return new Promise(resolve => {
        const dialog = document.createElement("dialog");
        dialog.className = "access-dialog";
        dialog.setAttribute("aria-labelledby", "access-title");
        dialog.innerHTML = `<form class="access-form"><button type="button" class="access-close" aria-label="Close">&times;</button><h2 id="access-title">Sign in to continue</h2><a class="access-login">Sign in with DingTalk</a><p class="access-divider">or use an invitation code</p><label for="access-code">Invitation code</label><input id="access-code" name="code" required autocomplete="one-time-code" maxlength="200"><p class="access-error" role="alert"></p><button class="access-submit" type="submit">Continue</button></form>`;
        const previousFocus = document.activeElement;
        const login = dialog.querySelector(".access-login");
        login.href = `/auth/dingtalk?redirect=${encodeURIComponent(location.pathname + location.search)}`;
        login.hidden = current?.configured === false;
        if (login.hidden) {
          dialog.querySelector("h2").textContent = "Enter invitation code";
          dialog.querySelector(".access-divider").hidden = true;
        }
        let busy = false;
        let granted = false;
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
          const code = dialog.querySelector("input").value.trim();
          if (!code) return;
          busy = true;
          const button = dialog.querySelector(".access-submit");
          button.disabled = true;
          button.textContent = "Checking...";
          const error = dialog.querySelector(".access-error");
          error.textContent = "";
          try {
            const response = await nativeFetch("/api/invitation/redeem", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to redeem invitation code.");
            redeeming = true;
            await announce();
            granted = Boolean(current?.hasAccess);
            if (!granted) throw new Error("Unable to verify access. Please try signing in.");
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
  window.VisitorSession = { fetch: request, refresh, announce, ensureAccess, get hasAccess() { return current?.hasAccess === true; }, get user() { return current?.user; } };
})();
