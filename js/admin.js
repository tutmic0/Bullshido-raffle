"use strict";

const el = {
  keyInput: document.getElementById("admin-key-input"),
  refreshBtn: document.getElementById("refresh-btn"),
  campaignList: document.getElementById("campaign-list"),
  partnerNameInput: document.getElementById("partner-name-input"),
  xTagInput: document.getElementById("x-tag-input"),
  gtdSpotsInput: document.getElementById("gtd-spots-input"),
  durationInput: document.getElementById("duration-input"),
  createBtn: document.getElementById("create-btn"),
  createStatus: document.getElementById("create-status"),
  cancelBtn: document.getElementById("cancel-btn"),
  cancelStatus: document.getElementById("cancel-status"),
  csvBtn: document.getElementById("csv-btn"),
};

function adminHeaders() {
  return { "x-admin-secret": el.keyInput.value, "Content-Type": "application/json" };
}

async function refreshCampaigns() {
  el.campaignList.textContent = "Loading…";
  try {
    const res = await fetch("/api/admin/campaign", { headers: adminHeaders() });
    const body = await res.json();
    if (!res.ok) {
      el.campaignList.textContent = `Error: ${body.error}`;
      return;
    }
    if (!body.campaigns || !body.campaigns.length) {
      el.campaignList.textContent = "No campaigns yet.";
      return;
    }
    el.campaignList.textContent = body.campaigns
      .map(
        (c) =>
          `${c.status.toUpperCase().padEnd(10)} ${c.partner_name}  |  ${c.gtd_spots} spots  |  ends ${new Date(c.ends_at).toLocaleString()}  |  ${c.id}`
      )
      .join("\n");
  } catch (err) {
    el.campaignList.textContent = "Request failed -- check the admin key and your connection.";
  }
}

el.refreshBtn.addEventListener("click", refreshCampaigns);

el.createBtn.addEventListener("click", async () => {
  el.createStatus.hidden = true;
  el.createBtn.disabled = true;
  try {
    const res = await fetch("/api/admin/campaign", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        action: "create",
        partnerName: el.partnerNameInput.value.trim(),
        xTag: el.xTagInput.value.trim() || null,
        gtdSpots: Number(el.gtdSpotsInput.value),
        durationHours: Number(el.durationInput.value),
      }),
    });
    const body = await res.json();
    el.createStatus.hidden = false;
    if (!res.ok) {
      el.createStatus.classList.add("error");
      el.createStatus.textContent = `Could not create campaign: ${body.error}`;
      return;
    }
    el.createStatus.classList.remove("error");
    el.createStatus.textContent = `Campaign created -- ends ${new Date(body.campaign.ends_at).toLocaleString()}.`;
    el.partnerNameInput.value = "";
    el.xTagInput.value = "";
    await refreshCampaigns();
  } catch (err) {
    el.createStatus.hidden = false;
    el.createStatus.classList.add("error");
    el.createStatus.textContent = "Request failed.";
  } finally {
    el.createBtn.disabled = false;
  }
});

el.cancelBtn.addEventListener("click", async () => {
  if (!confirm("Cancel the currently active campaign? This does not delete entries, it just stops the draw from running for it.")) return;
  el.cancelStatus.hidden = true;
  try {
    const res = await fetch("/api/admin/campaign", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ action: "cancel" }),
    });
    const body = await res.json();
    el.cancelStatus.hidden = false;
    el.cancelStatus.classList.toggle("error", !res.ok);
    el.cancelStatus.textContent = res.ok ? "Active campaign cancelled." : `Error: ${body.error}`;
    await refreshCampaigns();
  } catch (err) {
    el.cancelStatus.hidden = false;
    el.cancelStatus.classList.add("error");
    el.cancelStatus.textContent = "Request failed.";
  }
});

el.csvBtn.addEventListener("click", async () => {
  try {
    const res = await fetch("/api/admin/winners?format=csv", { headers: adminHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(`Could not fetch winners CSV: ${body.error || res.status}`);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bullshido_raffle_winners.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Request failed.");
  }
});

refreshCampaigns();
