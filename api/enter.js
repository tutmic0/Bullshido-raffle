const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { getBullshidoBalance } = require("../lib/chain");

// 1-15 chars, letters/digits/underscore -- X's own handle rules.
// Leading "@" is accepted and stripped before storing.
const X_USERNAME_RE = /^@?([A-Za-z0-9_]{1,15})$/;

/**
 * POST /api/enter
 * headers: Authorization: Bearer <session token>
 * body: { xUsername }
 *
 * Reads the wallet's CURRENT on-chain Bullshido balance (server-side,
 * never trusts the client) and locks that in as the ticket count for
 * this campaign -- selling the NFT afterwards does not remove the
 * entry. One entry per wallet per campaign, enforced in the database
 * (see perform_enter in database/001_init.sql).
 */
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  let wallet;
  try {
    wallet = requireSession(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  const rawUsername = String((req.body || {}).xUsername || "").trim();
  const match = X_USERNAME_RE.exec(rawUsername);
  if (!match) {
    res.status(400).json({ error: "invalid_x_username" });
    return;
  }
  const xUsername = match[1];

  const supabase = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, status, ends_at")
    .eq("status", "active")
    .maybeSingle();

  if (campaignError) {
    console.error("campaign fetch error", campaignError);
    res.status(500).json({ error: "database_error", detail: campaignError.message });
    return;
  }
  if (!campaign) {
    res.status(409).json({ error: "no_active_campaign" });
    return;
  }

  let ticketCount;
  try {
    ticketCount = await getBullshidoBalance(wallet);
  } catch (err) {
    res.status(502).json({ error: "chain_read_failed" });
    return;
  }

  if (ticketCount < 1) {
    res.status(403).json({ error: "no_bullshido_held" });
    return;
  }

  const { data, error } = await supabase.rpc("perform_enter", {
    p_campaign_id: campaign.id,
    p_wallet: wallet,
    p_x_username: xUsername,
    p_ticket_count: ticketCount,
  });

  if (error) {
    const message = error.message || "";
    if (message.includes("already_entered")) {
      res.status(409).json({ error: "already_entered" });
      return;
    }
    if (message.includes("campaign_ended")) {
      res.status(409).json({ error: "campaign_ended" });
      return;
    }
    if (message.includes("campaign_not_active")) {
      res.status(409).json({ error: "campaign_not_active" });
      return;
    }
    console.error("perform_enter error", error);
    res.status(500).json({ error: "database_error", detail: error.message });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  res.status(200).json({
    campaignId: campaign.id,
    ticketCount: row ? row.ticket_count : ticketCount,
    xUsername,
    enteredAt: row ? row.entered_at : new Date().toISOString(),
  });
};
