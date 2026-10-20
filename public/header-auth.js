const headerLogin = document.querySelector("[data-header-login]");
const authChip = document.querySelector("[data-auth-chip]");
const authUserName = document.querySelector("[data-auth-user-name]");
const logoutButton = document.querySelector("[data-logout-button]");
const invitationLink = document.querySelector("[data-invitation-link]");
const teacherLink = document.querySelector("[data-teacher-link]");

function showHeaderUser(user, canTeach = false, canInvite = false) {
  const hasAccess = window.VisitorSession.hasAccess;
  // An invited guest is signed in too: hide the sign-in entry and offer logout.
  headerLogin.hidden = hasAccess;
  authChip.hidden = !hasAccess;
  logoutButton.hidden = !hasAccess;
  // Only designated administrators see the invitation-management entry. The
  // page route and every API enforce the same allow-list server-side.
  if (invitationLink) invitationLink.hidden = !canInvite;
  // The teacher console link is strictly allow-listed server-side too.
  if (teacherLink) teacherLink.hidden = !canTeach;
  const canCopyLoginLink = hasAccess && user?.identityType === "guest";
  if (authUserName) authUserName.title = canCopyLoginLink ? "Click to copy your personal login link" : "";
  window.VisitorSession.renderIdentityName(authUserName, user?.name, {
    activate: canCopyLoginLink ? window.VisitorSession.copyLoginLink : null,
  });
}

async function checkHeaderAuth() {
  headerLogin.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;

  try {
    const response = await window.VisitorSession.fetch("/api/me");
    if (!response.ok) {
      throw new Error("Unable to check authentication");
    }

    const data = await response.json();
    showHeaderUser(data.user || null, data.teacherAccess === true, data.invitationAdminAccess === true);
  } catch {
    showHeaderUser(null);
  }
}

logoutButton.addEventListener("click", async () => {
  try {
    const response = await window.VisitorSession.fetch("/auth/logout", { method: "POST" });
    if (!response.ok) {
      throw new Error("Unable to sign out");
    }
    await window.VisitorSession.announce();
    showHeaderUser(window.VisitorSession.user);
  } catch {
    window.location.reload();
  }
});

checkHeaderAuth();
window.addEventListener("visitoridentitychange", () => { void checkHeaderAuth(); });
