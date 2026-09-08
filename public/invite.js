async function enterInvitation() {
  if (await window.VisitorSession.ensureAccess()) location.href = "/examine";
}
document.querySelector("#enter").addEventListener("click", enterInvitation);
void enterInvitation();
