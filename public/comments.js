(() => {
  const section = document.querySelector("[data-comments-page]");
  if (!section) return;

  const page = section.dataset.commentsPage;
  const list = section.querySelector("[data-comment-list]");
  const form = section.querySelector("[data-comment-form]");
  const textarea = section.querySelector("[data-comment-input]");
  const submitButton = section.querySelector("[data-comment-submit]");
  const replyContext = section.querySelector("[data-reply-context]");
  const replyName = section.querySelector("[data-reply-name]");
  const cancelReply = section.querySelector("[data-cancel-reply]");
  const feedback = section.querySelector("[data-comment-feedback]");
  let authUser = null;
  let comments = [];
  let parentId = null;

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
      <p>${escapeHtml(comment.content)}</p>
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
    list.setAttribute("aria-busy", "true");
    try {
      const [commentsResponse, authResponse] = await Promise.all([
        fetch(`/api/comments?page=${encodeURIComponent(page)}`),
        fetch("/api/me"),
      ]);
      if (!commentsResponse.ok) throw new Error("Unable to load comments.");
      comments = (await commentsResponse.json()).comments || [];
      authUser = authResponse.ok ? (await authResponse.json()).user : null;
      textarea.placeholder = authUser ? "Share a thought or useful tip" : "Sign in to join the conversation";
      textarea.disabled = !authUser;
      submitButton.textContent = authUser ? "Comment" : "Sign in to comment";
      render();
    } catch (error) {
      list.innerHTML = `<p class="comments-error">${escapeHtml(error.message)}</p>`;
    } finally {
      list.removeAttribute("aria-busy");
    }
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-reply-id]");
    if (!button) return;
    if (!authUser) {
      window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname + "#comments")}`;
      return;
    }
    const target = comments.find((comment) => comment.id === button.dataset.replyId);
    parentId = target?.parentId || target?.id || null;
    replyName.textContent = button.dataset.replyName;
    replyContext.hidden = false;
    textarea.focus();
  });

  cancelReply.addEventListener("click", clearReply);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!authUser) {
      window.location.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname + "#comments")}`;
      return;
    }
    const content = textarea.value.trim();
    if (!content) return;
    submitButton.disabled = true;
    feedback.textContent = "Posting...";
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page, content, parentId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to post comment.");
      comments.push(data.comment);
      textarea.value = "";
      clearReply();
      feedback.textContent = "Comment posted.";
      render();
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  load();
})();
