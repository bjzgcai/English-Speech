const headerLogin = document.querySelector("[data-header-login]");
const authChip = document.querySelector("[data-auth-chip]");
const authUserName = document.querySelector("[data-auth-user-name]");
const logoutButton = document.querySelector("[data-logout-button]");

function showHeaderUser(user) {
  const isSignedIn = Boolean(user);
  headerLogin.hidden = isSignedIn;
  authChip.hidden = !isSignedIn;
  authUserName.textContent = user?.name || "DingTalk user";
}

async function checkHeaderAuth() {
  headerLogin.href = `/auth/dingtalk?redirect=${encodeURIComponent(window.location.pathname)}`;

  try {
    const response = await fetch("/api/me");
    if (!response.ok) {
      throw new Error("Unable to check authentication");
    }

    const data = await response.json();
    showHeaderUser(data.user || null);
  } catch {
    showHeaderUser(null);
  }
}

logoutButton.addEventListener("click", async () => {
  try {
    const response = await fetch("/auth/logout", { method: "POST" });
    if (!response.ok) {
      throw new Error("Unable to sign out");
    }
    showHeaderUser(null);
  } catch {
    window.location.reload();
  }
});

checkHeaderAuth();
