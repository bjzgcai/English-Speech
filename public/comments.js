(() => {
  const section = document.querySelector("[data-comments-page], [data-comments-pages]");
  if (!section) return;

  const pageOptions = String(section.dataset.commentsPages || section.dataset.commentsPage || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestedPage = new URLSearchParams(window.location.search).get("comments");
  let page = pageOptions.includes(requestedPage) ? requestedPage : pageOptions[0];
  const list = section.querySelector("[data-comment-list]");
  const form = section.querySelector("[data-comment-form]");
  const textarea = section.querySelector("[data-comment-input]");
  const submitButton = section.querySelector("[data-comment-submit]");
  const imageInput = section.querySelector("[data-comment-images]");
  const previews = section.querySelector("[data-comment-previews]");
  const replyContext = section.querySelector("[data-reply-context]");
  const replyName = section.querySelector("[data-reply-name]");
  const cancelReply = section.querySelector("[data-cancel-reply]");
  const feedback = section.querySelector("[data-comment-feedback]");
  const floatingButton = document.querySelector("[data-comment-fab]");
  const pageButtons = [...section.querySelectorAll("[data-comments-page-target]")];
  let authUser = null;
  let comments = [];
  let parentId = null;
  let loadSequence = 0;

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  function formatTimestamp(value) {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(value));
  }

  function commentMarkup(comment, isReply = false) {
    return `<article class="comment-item${isReply ? " comment-reply" : ""}">
      <div class="comment-meta"><strong>${escapeHtml(comment.username)}</strong><time datetime="${escapeHtml(comment.createdAt)}">${escapeHtml(formatTimestamp(comment.createdAt))}</time></div>
      <p>${escapeHtml(comment.content)}</p>${(comment.images || []).length ? `<div class="comment-image-previews">${comment.images.map(image => `<img src="${escapeHtml(image.url)}" alt="${escapeHtml(image.alt || "Comment image")}" loading="lazy">`).join("")}</div>` : ""}
      <button type="button" class="comment-reply-button" data-reply-id="${escapeHtml(comment.id)}" data-reply-name="${escapeHtml(comment.username)}">Reply</button>
    </article>`;
  }

  function render() {
    if (!comments.length) {
      list.innerHTML = '<p class="comments-empty">No comments yet. Start the conversation.</p>';
      return;
    }
    const roots = comments.filter((comment) => !comment.parentId);
    list.innerHTML = roots.map((root) => {
      const replies = comments.filter((comment) => comment.parentId === root.id);
      return `<div class="comment-thread">${commentMarkup(root)}${replies.length ? `<div class="comment-replies">${replies.map((reply) => commentMarkup(reply, true)).join("")}</div>` : ""}</div>`;
    }).join("");
  }

  function clearReply() {
    parentId = null;
    replyContext.hidden = true;
    replyName.textContent = "";
  }

  async function load() {
    const requestId = ++loadSequence;
    list.setAttribute("aria-busy", "true");
    try {
      const [commentsResponse, authResponse] = await Promise.all([
        window.VisitorSession.fetch(`/api/comments?page=${encodeURIComponent(page)}`),
        window.VisitorSession.fetch("/api/me"),
      ]);
      if (!commentsResponse.ok) throw new Error("Unable to load comments.");
      comments = (await commentsResponse.json()).comments || [];
      authUser = authResponse.ok ? (await authResponse.json()).user : null;
      if (requestId !== loadSequence) return;
      textarea.placeholder = authUser ? "Share a thought or useful tip" : "Sign in to join the conversation";
      textarea.disabled = !authUser;
      submitButton.textContent = authUser ? "Comment" : "Sign in to comment";
      render();
    } catch (error) {
      if (requestId !== loadSequence) return;
      list.innerHTML = `<p class="comments-error">${escapeHtml(error.message)}</p>`;
    } finally {
      if (requestId === loadSequence) list.removeAttribute("aria-busy");
    }
  }

  function selectPage(nextPage) {
    if (!pageOptions.includes(nextPage) || nextPage === page) return;
    page = nextPage;
    pageButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.commentsPageTarget === page));
    });
    comments = [];
    clearReply();
    feedback.textContent = "";
    list.innerHTML = '<p class="comments-empty">Loading comments...</p>';
    void load();
  }

  pageButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.commentsPageTarget === page));
    button.addEventListener("click", () => selectPage(button.dataset.commentsPageTarget));
  });

  function commentsReturnUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("comments", page);
    url.hash = "comments";
    return `${url.pathname}${url.search}${url.hash}`;
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reply-id]");
    if (!button) return;
    if (!authUser) {
      window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent(commentsReturnUrl())}`;
      return;
    }
    const target = comments.find((comment) => comment.id === button.dataset.replyId);
    parentId = target?.parentId || target?.id || null;
    replyName.textContent = button.dataset.replyName;
    replyContext.hidden = false;
    textarea.focus();
  });

  cancelReply.addEventListener("click", clearReply);

  floatingButton?.addEventListener("click", () => {
    window.setTimeout(() => textarea.focus({ preventScroll: true }), 450);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authUser) {
      window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent(commentsReturnUrl())}`;
      return;
    }
    const content = textarea.value.trim();
    if (!content) return;
    submitButton.disabled = true;
    feedback.textContent = "Posting...";
    try {
      const body = new FormData(); body.append("page", page); body.append("content", content); if (parentId) body.append("parentId", parentId);
      for (const file of imageInput?.files || []) body.append("images", file, file.name);
      const response = await window.VisitorSession.fetch("/api/comments", {
        method: "POST",
        body,
      });
      const data = await response.json().catch(() => {
        throw new Error(`Unable to post comment (HTTP ${response.status}). Please try again later.`);
      });
      if (!response.ok) throw new Error(data.error || "Unable to post comment.");
      comments.push(data.comment);
      textarea.value = "";
      if (imageInput) imageInput.value = "";
      if (previews) previews.innerHTML = "";
      clearReply();
      feedback.textContent = "Comment posted.";
      render();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  imageInput?.addEventListener("change", () => {
    const files = [...imageInput.files].slice(0, 4);
    previews.innerHTML = files.map(file => `<img src="${escapeHtml(URL.createObjectURL(file))}" alt="Selected image preview">`).join("");
  });

  load();
  window.addEventListener("visitoridentitychange", () => {
    authUser = window.VisitorSession.user;
    textarea.value = "";
    clearReply();
    void load();
  });
})();
