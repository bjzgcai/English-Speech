(() => {
  const list = document.querySelector("#list");
  const message = document.querySelector("#new");
  const panel = document.querySelector("#qr-panel");
  const campaignList = document.querySelector("#campaign-list");
  const campaignPanel = document.querySelector("#campaign-qr-panel");
  const campaignForm = document.querySelector("#campaign-form");
  const campaignBuilderToggle = document.querySelector("#campaign-create-toggle");
  const accountsPanel = document.querySelector("#campaign-accounts-panel");
  const accountsList = document.querySelector("#campaign-accounts-list");
  const records = new Map();
  const campaigns = new Map();
  let selected;
  let selectedCampaign;
  let selectedAccounts = [];

  const esc = value => String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
  const eyeIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOffIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19.5C5.6 19.5 2 13 2 13a19.9 19.9 0 0 1 4.06-4.94"/><path d="M9.9 5.24A9.6 9.6 0 0 1 12 5c6.4 0 10 6.5 10 6.5a19.8 19.8 0 0 1-2.16 3.19"/><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

  const toastHost = document.createElement("div");
  toastHost.className = "toast-host";
  document.body.appendChild(toastHost);
  function toast(text, type = "success") {
    toastHost.replaceChildren();
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.setAttribute("role", "status");
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = type === "error" ? "✕" : "✓";
    const label = document.createElement("span");
    label.textContent = text;
    item.append(icon, label);
    toastHost.appendChild(item);
    setTimeout(() => {
      item.classList.add("leave");
      setTimeout(() => item.remove(), 350);
    }, 2600);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat([], {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  function shanghaiInputValue(date = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  }

  function shanghaiIso(value) {
    return new Date(`${value}:00+08:00`).toISOString();
  }

  function defaultCampaignWindow() {
    const now = new Date();
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    document.querySelector("#campaign-start").value = shanghaiInputValue(now);
    document.querySelector("#campaign-end").value = shanghaiInputValue(end);
  }

  async function copyText(text, successMessage) {
    try {
      await navigator.clipboard.writeText(text);
      toast(successMessage);
      return true;
    } catch {
      return false;
    }
  }

  const qrUrl = id => `/api/invitation-codes/${encodeURIComponent(id)}/qr`;
  const campaignQrUrl = id => `/api/invitation-campaigns/${encodeURIComponent(id)}/qr`;
  const linkFor = record => record.shareUrl || new URL(`/invite#code=${encodeURIComponent(record.code)}`, location.origin).toString();
  const campaignLinkFor = record => record.shareUrl || new URL(`/invite#code=${encodeURIComponent(record.code)}`, location.origin).toString();

  function preview(record) {
    selected = record;
    panel.hidden = false;
    document.querySelector("#qr-preview").src = qrUrl(record.id);
    document.querySelector("#qr-code").textContent = record.code;
    document.querySelector("#invite-link").value = linkFor(record);
    document.querySelector("#download-qr").href = qrUrl(record.id);
  }

  function campaignStatusLabel(status) {
    return ({
      upcoming: "Upcoming",
      open: "Open",
      full: "Full",
      expired: "Ended",
    })[status] || status;
  }

  function previewCampaign(record) {
    selectedCampaign = record;
    campaignPanel.hidden = false;
    document.querySelector("#campaign-qr-preview").src = campaignQrUrl(record.id);
    document.querySelector("#campaign-code").textContent = record.code;
    document.querySelector("#campaign-qr-name").textContent = record.name;
    const status = document.querySelector("#campaign-qr-status");
    status.textContent = `${campaignStatusLabel(record.status)} · ${record.registered}/${record.max_uses} registered`;
    status.className = `campaign-status-line is-${record.status}`;
    document.querySelector("#campaign-qr-window").textContent = `${formatDate(record.start_time)} → ${formatDate(record.end_time)}`;
    document.querySelector("#campaign-link").value = campaignLinkFor(record);
    document.querySelector("#campaign-download-qr").href = campaignQrUrl(record.id);
  }

  async function copyLink(record) {
    preview(record);
    const url = linkFor(record);
    if (await copyText(url, "Invitation link copied. Send it to your invitee.")) return;
    const field = document.querySelector("#invite-link");
    field.focus();
    field.select();
    message.textContent = "Unable to copy automatically. Select and copy the invitation link shown below.";
    toast("Unable to copy automatically. Select and copy the invitation link shown below.", "error");
  }

  async function copyCampaignLink(record) {
    previewCampaign(record);
    if (await copyText(campaignLinkFor(record), "Campaign link copied. Share it with all invited learners.")) return;
    const field = document.querySelector("#campaign-link");
    field.focus();
    field.select();
    message.textContent = "Unable to copy automatically. Select and copy the campaign link shown below.";
    toast("Unable to copy automatically. Select and copy the campaign link shown below.", "error");
  }

  async function copyCode(record) {
    try {
      await navigator.clipboard.writeText(record.code);
      toast("Code copied to clipboard.");
    } catch {
      preview(record);
      message.textContent = "Unable to copy automatically. Select and copy the invitation code shown below.";
      toast("Unable to copy automatically. Select and copy the invitation code shown below.", "error");
    }
  }

  async function copyQr(record, campaign = false) {
    if (campaign) previewCampaign(record);
    else preview(record);
    const source = campaign ? campaignQrUrl(record.id) : qrUrl(record.id);
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") throw new Error("unsupported");
      const png = VisitorSession.fetch(source).then(response => {
        if (!response.ok) throw new Error("Unable to load QR code");
        return response.blob();
      });
      void png.catch(() => {});
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      toast("QR code copied to clipboard.");
    } catch {
      toast("Unable to copy the QR image in this browser. Use Download QR code below.", "error");
    }
  }

  async function load() {
    const response = await VisitorSession.fetch("/api/invitation-codes");
    if (!response.ok) throw new Error("Unable to load invitation codes.");
    const data = await response.json();
    records.clear();
    data.codes.forEach(record => records.set(record.id, record));
    list.innerHTML = data.codes.length
      ? data.codes.map(record => `<tr><td class="code-value" data-code="${esc(record.id)}">••••${esc(record.codePreview)}</td><td><span class="status ${record.usedAt ? "used" : ""}">${record.usedAt ? "Used" : "Available"}</span></td><td>${esc(record.guestName || "")}</td><td>${formatDate(record.createdAt)}</td><td class="code-actions"><button class="icon-button toggle" data-id="${esc(record.id)}" title="Show or hide code" aria-label="Show or hide code">${eyeIcon}</button><button class="icon-button copy-qr" data-id="${esc(record.id)}" title="Copy QR code" aria-label="Copy QR code">QR</button><button class="icon-button copy-link" data-id="${esc(record.id)}" title="Copy invitation link" aria-label="Copy invitation link">Link</button><button class="icon-button copy" data-id="${esc(record.id)}" title="Copy invitation code" aria-label="Copy invitation code">⧉</button>${!record.usedAt ? `<button class="delete" data-id="${esc(record.id)}">Delete</button>` : ""}</td></tr>`).join("")
      : '<tr><td colspan="5" class="empty">No single-use invitation codes yet.</td></tr>';
  }

  async function loadCampaigns() {
    const response = await VisitorSession.fetch("/api/invitation-campaigns");
    if (!response.ok) throw new Error("Unable to load QR campaigns.");
    const data = await response.json();
    campaigns.clear();
    data.campaigns.forEach(record => campaigns.set(record.id, record));
    campaignList.innerHTML = data.campaigns.length
      ? data.campaigns.map(record => `<tr><td class="campaign-name-cell"><strong>${esc(record.name)}</strong><span>••••${esc(record.codePreview)}</span></td><td><span class="status ${record.status === "full" || record.status === "expired" ? "used" : ""}">${campaignStatusLabel(record.status)}</span></td><td class="campaign-count">${record.registered}<span> / ${record.max_uses}</span></td><td class="campaign-window">${formatDate(record.start_time)}<br>→ ${formatDate(record.end_time)}</td><td><div class="campaign-table-actions"><button class="campaign-preview" data-id="${esc(record.id)}">QR</button><button class="campaign-copy" data-id="${esc(record.id)}">Link</button><button class="campaign-accounts" data-id="${esc(record.id)}">Learners</button></div></td></tr>`).join("")
      : '<tr><td colspan="5" class="empty">No QR campaigns yet.</td></tr>';
  }

  async function openAccounts(record) {
    const response = await VisitorSession.fetch(`/api/invitation-campaigns/${encodeURIComponent(record.id)}/accounts`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load registered learners.");
    selectedAccounts = data.accounts;
    document.querySelector("#campaign-accounts-title").textContent = record.name;
    accountsList.innerHTML = data.accounts.length
      ? data.accounts.map((account, index) => `<tr><td class="account-name">${esc(account.name)}</td><td>${formatDate(account.createdAt)}</td><td><button class="account-copy" data-index="${index}">Copy login link</button></td></tr>`).join("")
      : '<tr><td colspan="3" class="empty">No learners have scanned this campaign yet.</td></tr>';
    accountsPanel.hidden = false;
    accountsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  list.addEventListener("click", async event => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const record = records.get(button.dataset.id);
    if (!record) return;
    try {
      if (button.classList.contains("toggle")) {
        const cell = button.closest("tr").querySelector(".code-value");
        const showing = cell.textContent.startsWith("••••");
        cell.textContent = showing ? record.code : `••••${record.codePreview}`;
        button.innerHTML = showing ? eyeOffIcon : eyeIcon;
        button.title = button.ariaLabel = showing ? "Hide code" : "Show code";
        toast(showing ? "Code shown." : "Code hidden.");
      } else if (button.classList.contains("copy-qr")) await copyQr(record);
      else if (button.classList.contains("copy-link")) await copyLink(record);
      else if (button.classList.contains("copy")) await copyCode(record);
      else if (button.classList.contains("delete")) {
        if (!window.confirm("Delete this invitation code? This cannot be undone.")) return;
        button.disabled = true;
        const response = await VisitorSession.fetch(`/api/invitation-codes/${encodeURIComponent(record.id)}`, { method: "DELETE" });
        if (!response.ok) throw new Error((await response.json()).error || "Unable to delete code.");
        if (selected?.id === record.id) {
          panel.hidden = true;
          selected = null;
        }
        toast("Invitation code deleted.");
        await load();
      }
    } catch (error) {
      message.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  campaignList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;
    const record = campaigns.get(button.dataset.id);
    if (!record) return;
    try {
      button.disabled = true;
      if (button.classList.contains("campaign-preview")) previewCampaign(record);
      else if (button.classList.contains("campaign-copy")) await copyCampaignLink(record);
      else if (button.classList.contains("campaign-accounts")) await openAccounts(record);
    } catch (error) {
      message.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  });

  accountsList.addEventListener("click", async event => {
    const button = event.target.closest(".account-copy");
    const account = button && selectedAccounts[Number(button.dataset.index)];
    if (!account) return;
    try {
      button.disabled = true;
      if (!await copyText(account.loginUrl, "Personal login link copied.")) {
        window.prompt("Copy this personal login link:", account.loginUrl);
      }
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector("#copy-qr").onclick = () => selected && copyQr(selected);
  document.querySelector("#copy-link").onclick = () => selected && copyLink(selected);
  document.querySelector("#copy-code").onclick = () => selected && copyCode(selected);
  document.querySelector("#campaign-copy-qr").onclick = () => selectedCampaign && copyQr(selectedCampaign, true);
  document.querySelector("#campaign-copy-link").onclick = () => selectedCampaign && copyCampaignLink(selectedCampaign);
  document.querySelector("#campaign-accounts-close").onclick = () => { accountsPanel.hidden = true; };
  document.querySelector("#qr-preview").onerror = () => {
    message.textContent = "Unable to load the QR code. Try selecting Copy QR code again.";
    toast(message.textContent, "error");
  };
  document.querySelector("#campaign-qr-preview").onerror = () => {
    message.textContent = "Unable to load the campaign QR code.";
    toast(message.textContent, "error");
  };

  campaignBuilderToggle.onclick = () => {
    campaignForm.hidden = !campaignForm.hidden;
    if (!campaignForm.hidden) {
      if (!document.querySelector("#campaign-start").value) defaultCampaignWindow();
      document.querySelector("#campaign-name").focus();
    }
  };
  document.querySelector("#campaign-cancel").onclick = () => { campaignForm.hidden = true; };

  campaignForm.onsubmit = async event => {
    event.preventDefault();
    const button = event.submitter || campaignForm.querySelector("[type=submit]");
    button.disabled = true;
    try {
      const body = {
        name: document.querySelector("#campaign-name").value.trim(),
        max_uses: Number(document.querySelector("#campaign-max").value),
        start_time: shanghaiIso(document.querySelector("#campaign-start").value),
        end_time: shanghaiIso(document.querySelector("#campaign-end").value),
      };
      const response = await VisitorSession.fetch("/api/invitation-campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to create the QR campaign.");
      previewCampaign(data.record);
      campaignForm.hidden = true;
      message.textContent = "Campaign created. Share the QR with your invited learners.";
      toast(message.textContent);
      await loadCampaigns();
      campaignPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      message.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

  document.querySelector("#create").onclick = async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const response = await VisitorSession.fetch("/api/invitation-codes", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to generate code.");
      preview(data.record);
      message.textContent = "Invitation created. Copy the invitation link to share it.";
      toast(message.textContent);
      await load();
    } catch (error) {
      message.textContent = error.message;
      toast(error.message, "error");
    } finally {
      button.disabled = false;
    }
  };

  defaultCampaignWindow();
  Promise.all([load(), loadCampaigns()]).catch(error => {
    message.textContent = error.message;
    toast(error.message, "error");
  });
})();
