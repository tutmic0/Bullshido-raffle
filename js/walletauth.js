"use strict";

/**
 * Wallet connect + sign-in for the Bullshido raffle page.
 * Independent copy of the same pattern used elsewhere -- own storage
 * keys, own API paths, own session token. Nothing here talks to any
 * other project's backend.
 *
 * Flow: discover injected wallet(s) -> (if more than one) let the
 * holder pick which one -> ask our API for a one-time message -> sign
 * it (no gas, no transaction) -> send the signature back -> get a
 * session token -> use that token as a Bearer header on every
 * status/enter call afterwards.
 *
 * Multi-wallet note: most holders have more than one wallet extension
 * installed. Grabbing window.ethereum blindly is unreliable once two+
 * extensions are present -- they can fight over that slot, and some
 * wallets' own internal "pick a provider" logic can throw or silently
 * hang. EIP-6963 (the modern standard every major wallet supports) has
 * each extension announce itself independently instead, so we talk to
 * the exact provider object the holder picks, never through whatever
 * shim ends up sitting on window.ethereum.
 */

const SESSION_KEY = "bullshido_raffle_session_token";
const WALLET_KEY = "bullshido_raffle_wallet";

// ---------------- Wallet discovery (EIP-6963 + legacy fallback) ----------------

const discovered = new Map(); // uuid -> { uuid, name, icon, provider }

window.addEventListener("eip6963:announceProvider", (event) => {
  const { info, provider } = event.detail;
  discovered.set(info.uuid, { uuid: info.uuid, name: info.name, icon: info.icon, provider });
});

// Ask any already-loaded extensions to (re)announce themselves.
function requestAnnouncements() {
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
requestAnnouncements();

function legacyProviderLabel(p) {
  if (!p) return "Injected Wallet";
  if (p.isOkxWallet || p.isOKExWallet) return "OKX Wallet";
  if (p.isMetaMask) return "MetaMask";
  if (p.isRabby) return "Rabby";
  if (p.isCoinbaseWallet) return "Coinbase Wallet";
  if (p.isCoin98) return "Coin98";
  if (p.isTrust || p.isTrustWallet) return "Trust Wallet";
  return "Injected Wallet";
}

// Returns the list of wallets the holder can choose from. Prefers
// EIP-6963 (accurate, per-wallet provider objects); falls back to
// whatever's on window.ethereum / window.okxwallet for older wallets
// that don't announce themselves yet.
function listWallets() {
  // Give slow-to-announce extensions one more nudge right before we
  // read the map (harmless if they already answered).
  requestAnnouncements();

  if (discovered.size > 0) {
    return Array.from(discovered.values());
  }

  const legacy = [];
  const seen = new Set();
  const add = (provider, name) => {
    if (!provider || seen.has(provider)) return;
    seen.add(provider);
    legacy.push({ uuid: `legacy-${legacy.length}`, name, icon: null, provider });
  };

  if (window.ethereum) {
    if (Array.isArray(window.ethereum.providers) && window.ethereum.providers.length > 0) {
      window.ethereum.providers.forEach((p) => add(p, legacyProviderLabel(p)));
    } else {
      add(window.ethereum, legacyProviderLabel(window.ethereum));
    }
  }
  if (window.okxwallet) {
    add(window.okxwallet, "OKX Wallet");
  }
  return legacy;
}

function withTimeout(promise, ms, timeoutMessage) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs the actual connect + sign-in flow against one specific provider
// object (never against window.ethereum directly -- the caller already
// resolved which exact wallet to use).
async function connectWithProvider(provider) {
  if (!provider) {
    throw new Error("No wallet extension found -- install a wallet extension and reload the page.");
  }

  let accounts;
  try {
    accounts = await withTimeout(
      provider.request({ method: "eth_requestAccounts" }),
      30000,
      "Your wallet extension didn't respond in time -- open it directly, make sure it's unlocked, then try again."
    );
  } catch (err) {
    if (err && err.code === 4001) {
      throw new Error("Connection request was rejected.");
    }
    throw new Error(err && err.message ? err.message : "Could not connect to your wallet.");
  }

  if (!accounts || !accounts[0]) {
    throw new Error("No account was returned by your wallet -- unlock it and try again.");
  }
  const wallet = accounts[0];

  const nonceRes = await fetch(`/api/auth/nonce?wallet=${wallet}`);
  if (!nonceRes.ok) {
    console.error("Failed to get sign-in message", await nonceRes.text());
    throw new Error("Could not start sign-in -- try again in a moment.");
  }
  const { message } = await nonceRes.json();

  let signature;
  try {
    signature = await withTimeout(
      provider.request({ method: "personal_sign", params: [message, wallet] }),
      60000,
      "Signature request timed out -- open your wallet extension and try again."
    );
  } catch (err) {
    if (err && err.code === 4001) {
      throw new Error("Signature request was rejected.");
    }
    throw new Error(err && err.message ? err.message : "Could not get a signature from your wallet.");
  }

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature }),
  });

  if (!verifyRes.ok) {
    console.error("Sign-in verification failed", await verifyRes.text());
    throw new Error("Sign-in verification failed -- try again.");
  }

  const { token } = await verifyRes.json();
  sessionStorage.setItem(SESSION_KEY, token);
  sessionStorage.setItem(WALLET_KEY, wallet);
  return { wallet, token };
}

// Convenience used when there's exactly one candidate wallet -- skips
// the picker UI entirely.
async function connectAndSignIn() {
  const wallets = listWallets();
  if (wallets.length === 0) {
    throw new Error("No wallet extension found -- install a wallet extension (e.g. OKX Wallet or MetaMask) and reload the page.");
  }
  return connectWithProvider(wallets[0].provider);
}

function getSession() {
  return {
    token: sessionStorage.getItem(SESSION_KEY),
    wallet: sessionStorage.getItem(WALLET_KEY),
  };
}

function signOut() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(WALLET_KEY);
}

async function callWithSession(path, options = {}) {
  const { token } = getSession();
  if (!token) {
    throw new Error("not_signed_in");
  }

  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (res.status === 401) {
    signOut();
    throw new Error("session_expired");
  }

  return res;
}
