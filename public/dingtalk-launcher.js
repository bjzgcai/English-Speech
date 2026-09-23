(() => {
  const target = document.body?.dataset?.dingtalkUrl;
  if (!target) return;
  // A top-level navigation started by the sign-in click is allowed to hand off
  // to an installed app in mobile Chrome/Safari. The visible link remains as a
  // fallback when the app is not installed or the browser blocks the scheme.
  window.setTimeout(() => { window.location.href = target; }, 0);
})();
