"use strict";

/**
 * Wallet connect + sign-in for the Bullshido raffle page.
 * Independent copy of the same pattern used elsewhere -- own storage
 * keys, own API paths, own session token. Nothing here talks to any
 * other project's backend.
 *
 * Flow: connect wallet -> ask our API for a one-time message -> sign
 * it (no gas, no transaction) -> send the signature back -> get a
 * session token -> use that token as a Bearer header on every
 * status/enter call afterwards.
 */

const SESSION_KEY = "bullshido_raffle_session_token";
const WALLET_KEY = "bullshido_raffle_wallet";

function getInjectedProvider() {
  // OKX Wallet only injects window.ethereum when "Set as default
  // wallet" is on -- otherwise only window.okxwallet. Check both.
  return window.ethereum || window.okxwallet || null;
}

async function connectAndSignIn() {
  const provider = getInjectedProvider();
  if (!provider) {
    alert("You need a wallet extension like OKX Wallet or MetaMask installed to continue.");
    return null;
  }

  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const wallet = accounts[0];

  const nonceRes = await fetch(`/api/auth/nonce?wallet=${wallet}`);
  if (!nonceRes.ok) {
    console.error("Failed to get sign-in message", await nonceRes.text());
    return null;
  }
  const { message } = await nonceRes.json();

  const signature = await provider.request({
    method: "personal_sign",
    params: [message, wallet],
  });

  const verifyRes = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, signature }),
  });

  if (!verifyRes.ok) {
    console.error("Sign-in verification failed", await verifyRes.text());
    return null;
  }

  const { token } = await verifyRes.json();
  sessionStorage.setItem(SESSION_KEY, token);
  sessionStorage.setItem(WALLET_KEY, wallet);
  return { wallet, token };
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
