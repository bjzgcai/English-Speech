const headerLogin = document.querySelector("[data-header-login]");
const authChip = document.querySelector("[data-auth-chip]");
const authUserName = document.querySelector("[data-auth-user-name]");
const logoutButton = document.querySelector("[data-logout-button]");
const invitationLink = document.querySelector("[data-invitation-link]");

function showHeaderUser(user, memberFlag = user?.isZgcMember) {
  const isSignedIn = Boolean(user) && user.identityType !== "guest";
  headerLogin.hidden = isSignedIn;
  authChip.hidden = !window.VisitorSession.hasAccess;
  authChip.classList.toggle("is-guest", user?.identityType === "guest");
  logoutButton.hidden = !isSignedIn;
  // Keep the management entry discoverable for signed-in DingTalk users; the
  // API still enforces the organization-member check before allowing access.
  if (invitationLink) invitationLink.hidden = !(isSignedIn && user?.identityType === "dingtalk");
  authUserName.textContent = user?.name || "DingTalk user";
}

async function checkHeaderAuth() {
  headerLogin.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;

  try {
    const response = await window.VisitorSession.fetch("/api/me");
    if (!response.ok) {
      throw new Error("Unable to check authentication");
    }

    const data = await response.json();
    showHeaderUser(data.user || null, data.isZgcMember === true || data.user?.isZgcMember === true);
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
