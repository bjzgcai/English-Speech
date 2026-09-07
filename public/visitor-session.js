(() => {
  const nativeFetch = window.fetch.bind(window);
  let current = null;
  let pending = null;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("englisheval-identity") : null;

  function update(data) {
    const previous = current?.user?.openId;
    current = data;
    if (previous && previous !== data.user?.openId) {
      window.dispatchEvent(new CustomEvent("visitoridentitychange", { detail: { previous, user: data.user } }));
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
    await refresh();
    channel?.postMessage("changed");
  }
  channel?.addEventListener("message", () => refresh().catch(() => {}));
  window.addEventListener("focus", () => refresh().catch(() => {}));
  window.VisitorSession = { fetch: request, refresh, announce, get user() { return current?.user; } };
})();
