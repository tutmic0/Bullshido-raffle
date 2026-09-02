"use strict";

/**
 * Wires up raffle.html. Depends on wallet-auth.js being loaded first.
 *
 * Flow: load public campaign info -> if a session already exists,
 * load personal status too -> connect button starts a fresh sign-in
 * -> entry form posts to /api/enter -> once the campaign is drawn,
 * /api/status tells us if this wallet won, and if so we render the
 * winner card onto a canvas and wire up copy/share.
 */

const X_TAG = "@Bullshidooje";
const BASE_IMAGE_SRC = "img/_social_base.jpg";

let campaignState = null;
let countdownTimer = null;
let pollTimer = null;

const el = {
  connectBtn: document.getElementById("connect-btn"),
  walletLabel: document.getElementById("wallet-label"),

  noCampaignPanel: document.getElementById("no-campaign-panel"),
  campaignPanel: document.getElementById("campaign-panel"),
  campaignEyebrow: document.getElementById("campaign-eyebrow"),
  partnerName: document.getElementById("partner-name"),
  campaignSub: document.getElementById("campaign-sub"),
  countdown: document.getElementById("countdown"),
  gtdSpots: document.getElementById("gtd-spots"),
  entryCount: document.getElementById("entry-count"),
  ticketTotal: document.getElementById("ticket-total"),

  connectPrompt: document.getElementById("connect-prompt"),
  noBalanceBlock: document.getElementById("no-balance-block"),
  entryBlock: document.getElementById("entry-block"),
  balanceCount: document.getElementById("balance-count"),
  balanceTickets: document.getElementById("balance-tickets"),
  xUsernameInput: document.getElementById("x-username-input"),
  enterBtn: document.getElementById("enter-btn"),
  enterError: document.getElementById("enter-error"),

  enteredBlock: document.getElementById("entered-block"),
  enteredUsername: document.getElementById("entered-username"),
  enteredTickets: document.getElementById("entered-tickets"),

  drawnNotEnteredBlock: document.getElementById("drawn-not-entered-block"),
  lostBlock: document.getElementById("lost-block"),

  connectError: document.getElementById("connect-error"),
  walletPicker: document.getElementById("wallet-picker"),
  walletPickerList: document.getElementById("wallet-picker-list"),

  winnerPanel: document.getElementById("winner-panel"),
  winnerCanvas: document.getElementById("winner-canvas"),
  shareXBtn: document.getElementById("share-x-btn"),
  copyImageBtn: document.getElementById("copy-image-btn"),
  copyFallback: document.getElementById("copy-fallback"),
};

function hideAllStateBlocks() {
  [
    el.connectPrompt,
    el.noBalanceBlock,
    el.entryBlock,
    el.enteredBlock,
    el.drawnNotEnteredBlock,
    el.lostBlock,
  ].forEach((node) => (node.hidden = true));
}

function formatDuration(ms) {
  if (ms <= 0) return "Drawing…";
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function shortWallet(wallet) {
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function startCountdown(endsAtIso) {
  clearInterval(countdownTimer);
  const endsAt = new Date(endsAtIso).getTime();
  function tick() {
    const remaining = endsAt - Date.now();
    el.countdown.textContent = formatDuration(remaining);
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      startDrawPolling();
    }
  }
  tick();
  countdownTimer = setInterval(tick, 1000);
}

// Once the clock hits zero, pg_cron may take up to ~60s to actually
// run the draw -- poll gently until the campaign flips to "drawn".
function startDrawPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    await loadCampaign();
    if (campaignState && campaignState.status !== "active") {
      clearInterval(pollTimer);
      if (getSession().wallet) await loadStatus();
    }
  }, 10000);
}

async function loadCampaign() {
  try {
    const res = await fetch("/api/campaign");
    const body = await res.json();
    campaignState = body.campaign;
    renderCampaign();
  } catch (err) {
    console.error("Failed to load campaign", err);
  }
}

function renderCampaign() {
  if (!campaignState) {
    el.noCampaignPanel.hidden = false;
    el.campaignPanel.hidden = true;
    return;
  }
  el.noCampaignPanel.hidden = true;
  el.campaignPanel.hidden = false;

  el.partnerName.textContent = campaignState.partnerName;
  el.campaignSub.textContent =
    campaignState.status === "active"
      ? "Every ticket below is one entry into the automatic draw -- more Bullshido held, more tickets, no guarantees."
      : "This raffle has been drawn. Winners were selected automatically.";
  el.gtdSpots.textContent = campaignState.gtdSpots;
  el.entryCount.textContent = campaignState.entryCount;
  el.ticketTotal.textContent = campaignState.ticketTotal;

  if (campaignState.status === "active") {
    startCountdown(campaignState.endsAt);
  } else {
    clearInterval(countdownTimer);
    el.countdown.textContent = campaignState.status === "drawn" ? "Drawn" : "Cancelled";
  }
}

async function loadStatus() {
  try {
    const res = await callWithSession("/api/status", { method: "GET" });
    if (!res.ok) return;
    const body = await res.json();
    renderStatus(body);
  } catch (err) {
    if (err.message === "session_expired" || err.message === "not_signed_in") {
      hideAllStateBlocks();
      el.connectPrompt.hidden = false;
    } else {
      console.error("Failed to load status", err);
    }
  }
}

function renderStatus(status) {
  hideAllStateBlocks();
  el.winnerPanel.hidden = true;

  if (!status.campaign) {
    // No campaign exists at all -- the top-level no-campaign-panel
    // (driven by loadCampaign()) already covers this.
    return;
  }

  if (status.campaign.status === "active") {
    if (status.currentBalance === null) {
      el.noBalanceBlock.hidden = false;
      el.noBalanceBlock.querySelector("p:last-child").textContent =
        "Couldn't confirm your on-chain balance just now -- reload and try again.";
      return;
    }
    if (!status.currentBalance) {
      el.noBalanceBlock.hidden = false;
      return;
    }
    if (status.entered) {
      el.enteredUsername.textContent = "@" + status.xUsername;
      el.enteredTickets.textContent = status.ticketCount;
      el.enteredBlock.hidden = false;
    } else {
      el.balanceCount.textContent = status.currentBalance;
      el.balanceTickets.textContent = status.currentBalance;
      el.entryBlock.hidden = false;
    }
    return;
  }

  // Campaign is drawn (or cancelled).
  if (status.winner && status.winner.won) {
    renderWinnerCard({
      partnerName: status.winner.partnerName,
      wallet: status.wallet,
      xUsername: status.winner.xUsername,
      drawnAt: status.winner.drawnAt,
    });
  } else if (status.entered) {
    el.lostBlock.hidden = false;
  } else {
    el.drawnNotEnteredBlock.hidden = false;
  }
}

// ---------------- Entry form ----------------

el.enterBtn.addEventListener("click", async () => {
  el.enterError.hidden = true;
  const xUsername = el.xUsernameInput.value.trim();
  if (!/^@?[A-Za-z0-9_]{1,15}$/.test(xUsername)) {
    el.enterError.textContent = "Enter a valid X username (letters, numbers, underscore, up to 15 characters).";
    el.enterError.hidden = false;
    return;
  }

  el.enterBtn.disabled = true;
  try {
    const res = await callWithSession("/api/enter", {
      method: "POST",
      body: JSON.stringify({ xUsername }),
    });
    const body = await res.json();
    if (!res.ok) {
      const messages = {
        already_entered: "This wallet already entered this raffle.",
        campaign_ended: "This raffle just closed -- the draw is starting.",
        no_active_campaign: "No raffle is currently open.",
        no_bullshido_held: "This wallet doesn't hold any Bullshido.",
        invalid_x_username: "Enter a valid X username.",
      };
      el.enterError.textContent = messages[body.error] || `Could not enter: ${body.error}`;
      el.enterError.hidden = false;
      return;
    }
    await loadStatus();
    await loadCampaign();
  } catch (err) {
    el.enterError.textContent = "Something went wrong -- try again.";
    el.enterError.hidden = false;
  } finally {
    el.enterBtn.disabled = false;
  }
});

// ---------------- Winner card (canvas) ----------------

function drawSpacedText(ctx, text, x, y, letterSpacing) {
  let cursor = x;
  for (const ch of text) {
    ctx.fillText(ch, cursor, y);
    cursor += ctx.measureText(ch).width + letterSpacing;
  }
  return cursor;
}

async function ensureFontsReady() {
  await Promise.all([
    document.fonts.load('800 90px "Shippori Mincho"'),
    document.fonts.load('700 20px "Zen Kaku Gothic New"'),
    document.fonts.load('400 26px "Zen Kaku Gothic New"'),
    document.fonts.load('700 24px "JetBrains Mono"'),
  ]);
  await document.fonts.ready;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function renderWinnerCard(data) {
  await ensureFontsReady();
  const canvas = el.winnerCanvas;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const base = await loadImage(BASE_IMAGE_SRC);
  ctx.drawImage(base, 0, 0, W, H);

  // Eyebrow: red dot + gold uppercase label, top-left.
  ctx.fillStyle = "#d4453f";
  ctx.beginPath();
  ctx.arc(64, 76, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#e6c47c";
  ctx.font = "700 20px 'Zen Kaku Gothic New', sans-serif";
  ctx.textBaseline = "middle";
  drawSpacedText(ctx, "BULLSHIDO RAFFLE — WINNER", 84, 78, 2.2);

  // Headline.
  ctx.fillStyle = "#ece3d2";
  ctx.font = "800 92px 'Shippori Mincho', serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("YOU'RE IN", 64, 610);

  // Subtitle.
  ctx.fillStyle = "#b0a692";
  ctx.font = "400 27px 'Zen Kaku Gothic New', sans-serif";
  const partnerLine = `GTD spot secured for ${data.partnerName}, via ${X_TAG}`;
  ctx.fillText(partnerLine, 64, 660);

  // Divider.
  ctx.strokeStyle = "rgba(236,227,210,0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(64, 706);
  ctx.lineTo(W - 64, 706);
  ctx.stroke();
  ctx.fillStyle = "#c9a259";
  ctx.beginPath();
  ctx.moveTo(64, 702);
  ctx.lineTo(71, 706);
  ctx.lineTo(64, 710);
  ctx.closePath();
  ctx.fill();

  // Stat row: X username / wallet / date.
  const cols = [
    { label: "X", value: "@" + data.xUsername },
    { label: "WALLET", value: shortWallet(data.wallet) },
    { label: "DATE", value: new Date(data.drawnAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) },
  ];
  const colWidth = (W - 128) / cols.length;
  cols.forEach((col, i) => {
    const cx = 64 + i * colWidth;
    ctx.fillStyle = "#7a7060";
    ctx.font = "700 16px 'Zen Kaku Gothic New', sans-serif";
    ctx.fillText(col.label, cx, 742);
    ctx.fillStyle = "#ece3d2";
    ctx.font = "700 30px 'JetBrains Mono', monospace";
    ctx.fillText(col.value, cx, 782);
  });

  el.winnerPanel.hidden = false;
}

el.shareXBtn.addEventListener("click", () => {
  const partnerName = el.partnerName.textContent || "our partner";
  const text = `Just secured a GTD spot for the ${partnerName} raffle through ${X_TAG} 🐂⚔️`;
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank", "noopener,noreferrer,width=600,height=520");
});

el.copyImageBtn.addEventListener("click", () => {
  el.copyFallback.hidden = true;
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
    el.copyFallback.hidden = false;
    return;
  }
  el.winnerCanvas.toBlob(async (blob) => {
    if (!blob) {
      el.copyFallback.hidden = false;
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      el.copyImageBtn.textContent = "Copied ✓";
      setTimeout(() => (el.copyImageBtn.textContent = "Copy image"), 2000);
    } catch (err) {
      el.copyFallback.hidden = false;
    }
  }, "image/png");
});

// ---------------- Wallet connect ----------------

// Talks to one specific provider object (already resolved -- either
// the only wallet found, or the one the holder picked below).
async function runConnect(provider) {
  el.connectError.hidden = true;
  el.connectBtn.disabled = true;
  try {
    const session = await connectWithProvider(provider);
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = shortWallet(session.wallet);
    await loadStatus();
  } catch (err) {
    el.connectError.textContent = err.message || "Something went wrong connecting your wallet.";
    el.connectError.hidden = false;
  } finally {
    el.connectBtn.disabled = false;
  }
}

function showWalletPicker(wallets) {
  el.walletPickerList.innerHTML = "";
  wallets.forEach((wallet) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost wallet-picker-btn";
    if (wallet.icon) {
      const icon = document.createElement("img");
      icon.src = wallet.icon;
      icon.alt = "";
      icon.className = "wallet-picker-icon";
      btn.appendChild(icon);
    }
    btn.appendChild(document.createTextNode(wallet.name));
    btn.addEventListener("click", () => {
      el.walletPicker.hidden = true;
      runConnect(wallet.provider);
    });
    el.walletPickerList.appendChild(btn);
  });
  el.walletPicker.hidden = false;
}

el.connectBtn.addEventListener("click", () => {
  el.connectError.hidden = true;
  el.walletPicker.hidden = true;

  const wallets = listWallets();
  if (wallets.length === 0) {
    el.connectError.textContent = "No wallet extension found -- install a wallet extension (e.g. OKX Wallet or MetaMask) and reload the page.";
    el.connectError.hidden = false;
    return;
  }
  if (wallets.length === 1) {
    runConnect(wallets[0].provider);
    return;
  }
  showWalletPicker(wallets);
});

(async function init() {
  await loadCampaign();
  const { wallet } = getSession();
  if (wallet) {
    el.connectBtn.hidden = true;
    el.walletLabel.hidden = false;
    el.walletLabel.textContent = shortWallet(wallet);
    await loadStatus();
  } else {
    el.connectPrompt.hidden = false;
  }
})();
