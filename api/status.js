const { getSupabaseAdmin } = require("../lib/supabaseAdmin");
const { requireSession } = require("../lib/session");
const { getBullshidoBalance } = require("../lib/chain");

/**
 * GET /api/status
 * headers: Authorization: Bearer <session token>
 *
 * Everything the page needs about the connected wallet for the
 * current campaign: their live Bullshido balance (shown before they
 * enter, as "you hold N -> N entries"), whether they've already
 * entered (and with how many tickets), and -- once the campaign has
 * been drawn -- whether they won, plus the data needed to render the
 * winner card.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
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

  const supabase = getSupabaseAdmin();

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, partner_name, x_tag, gtd_spots, ends_at, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (campaignError) {
    res.status(500).json({ error: "database_error" });
    return;
  }

  let currentBalance = 0;
  try {
    currentBalance = await getBullshidoBalance(wallet);
  } catch (err) {
    // Non-fatal -- the page can still show entry/winner status even if
    // a single RPC call hiccups; it just won't show a live balance.
    currentBalance = null;
  }

  if (!campaign) {
    res.status(200).json({ wallet, currentBalance, campaign: null });
    return;
  }

  const { data: entry } = await supabase
    .from("entries")
    .select("ticket_count, x_username, entered_at")
    .eq("campaign_id", campaign.id)
    .eq("wallet_address", wallet)
    .maybeSingle();

  let winner = null;
  if (campaign.status === "drawn") {
    const { data: winnerRow } = await supabase
      .from("winners")
      .select("x_username, drawn_at")
      .eq("campaign_id", campaign.id)
      .eq("wallet_address", wallet)
      .maybeSingle();
    if (winnerRow) {
      winner = {
        won: true,
        xUsername: winnerRow.x_username,
        drawnAt: winnerRow.drawn_at,
        partnerName: campaign.partner_name,
      };
    } else if (entry) {
      winner = { won: false };
    }
  }

  res.status(200).json({
    wallet,
    currentBalance,
    campaign: {
      id: campaign.id,
      partnerName: campaign.partner_name,
      xTag: campaign.x_tag,
      gtdSpots: campaign.gtd_spots,
      endsAt: campaign.ends_at,
      status: campaign.status,
    },
    entered: Boolean(entry),
    ticketCount: entry ? entry.ticket_count : null,
    xUsername: entry ? entry.x_username : null,
    enteredAt: entry ? entry.entered_at : null,
    winner,
  });
};
