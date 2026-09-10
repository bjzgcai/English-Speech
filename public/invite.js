const invitationCode = new URLSearchParams(location.hash.slice(1)).get("code");
if (invitationCode) window.__invitationCode = invitationCode;
// The code rides in the fragment so it never reaches the server or the referrer;
// once it is in memory the address bar no longer needs it.
if (location.hash) history.replaceState(null, "", location.pathname + location.search);
async function enterInvitation({ force = false } = {}) {
  // An invitation link signs in with the code alone, so DingTalk stays out of the way.
  const granted = await window.VisitorSession.ensureAccess({ force, invitationOnly: Boolean(invitationCode) });
  if (granted) location.href = "/examine";
}
async function hasAccess() {
  try { return (await window.VisitorSession.refresh()).hasAccess === true; } catch { return false; }
}
const enter = document.querySelector("#enter");
// Show the invitee the code they arrived with, so the prefilled field is never a surprise.
if (invitationCode) {
  document.querySelector("#invite-code-value").textContent = invitationCode;
  document.querySelector("#invite-code-line").hidden = false;
}
enter.addEventListener("click", enterInvitation);
async function start() {
  if (invitationCode) {
    enter.disabled = true;
    try {
      // Reading the fragment never redeems it. A browser that already has access keeps it;
      // anyone else must supply the name bound to this code.
      const granted = (await hasAccess()) || (await window.VisitorSession.ensureAccess({ force: true, invitationOnly: true }));
      if (granted) location.replace("/examine");
    } finally { enter.disabled = false; }
    return;
  }
  await enterInvitation();
}
void start();
