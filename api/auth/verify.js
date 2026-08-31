const { ethers } = require("ethers");
const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { issueSessionToken } = require("../../lib/session");

const NONCE_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes to complete the sign-in

/**
 * POST /api/auth/verify
 * body: { wallet, signature }
 *
 * Step 2: the wallet has signed the message from /api/auth/nonce. We
 * recover the signer address from the signature and check it matches
 * the wallet the nonce was issued to, and that the nonce hasn't
 * already been used or expired. If all that holds, issue a session
 * token good for 24h.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const { wallet, signature } = req.body || {};
  if (!ethers.isAddress(wallet) || typeof signature !== "string") {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const walletLower = wallet.toLowerCase();

  const supabase = getSupabaseAdmin();
  const { data: nonceRow, error: fetchError } = await supabase
    .from("auth_nonces")
    .select("*")
    .eq("wallet", walletLower)
    .maybeSingle();

  if (fetchError || !nonceRow) {
    res.status(400).json({ error: "no_nonce_issued" });
    return;
  }

  if (nonceRow.used) {
    res.status(400).json({ error: "nonce_already_used" });
    return;
  }

  const age = Date.now() - new Date(nonceRow.created_at).getTime();
  if (age > NONCE_MAX_AGE_MS) {
    res.status(400).json({ error: "nonce_expired" });
    return;
  }

  let recoveredAddress;
  try {
    recoveredAddress = ethers.verifyMessage(nonceRow.message, signature);
  } catch (err) {
    res.status(400).json({ error: "bad_signature" });
    return;
  }

  if (recoveredAddress.toLowerCase() !== walletLower) {
    res.status(401).json({ error: "signature_mismatch" });
    return;
  }

  // Burn the nonce so this exact signature can't be replayed later.
  await supabase.from("auth_nonces").update({ used: true }).eq("wallet", walletLower);

  let token;
  try {
    token = issueSessionToken(walletLower);
  } catch (err) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  res.status(200).json({ token, wallet: walletLower });
};
