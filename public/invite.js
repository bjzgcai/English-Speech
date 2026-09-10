const invitationCode = new URLSearchParams(location.hash.slice(1)).get("code");
if (invitationCode) window.__invitationCode = invitationCode;
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
async function enterInvitation({ force = false } = {}) {
  if (await window.VisitorSession.ensureAccess({ force })) location.href = "/examine";
}
async function hasAccess() {
  try { return (await window.VisitorSession.refresh()).hasAccess === true; } catch { return false; }
}
const enter = document.querySelector("#enter");
enter.addEventListener("click", enterInvitation);
async function start() {
  if (invitationCode) {
    enter.disabled = true;
    try {
      // Reading the fragment never redeems it. A browser that already has access keeps it;
      // anyone else must supply the name bound to this code.
      const granted = (await hasAccess()) || (await window.VisitorSession.ensureAccess({ force: true }));
      if (granted) location.replace("/examine");
    } finally { enter.disabled = false; }
    return;
  }
  await enterInvitation();
}
void start();
