const headerLogin = document.querySelector("[data-header-login]");
const authChip = document.querySelector("[data-auth-chip]");
const authUserName = document.querySelector("[data-auth-user-name]");
const logoutButton = document.querySelector("[data-logout-button]");

function showHeaderUser(user) {
  const isSignedIn = Boolean(user) && user.identityType !== "guest";
  headerLogin.hidden = isSignedIn;
  authChip.hidden = !user;
  authChip.classList.toggle("is-guest", user?.identityType === "guest");
  logoutButton.hidden = !isSignedIn;
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
    showHeaderUser(data.user || null);
    if (!data.configured) headerLogin.hidden = true;
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
