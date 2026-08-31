const { getSupabaseAdmin } = require("../lib/supabaseAdmin");

/**
 * GET /api/campaign
 *
 * Public, no wallet session needed -- just "what's the current raffle
 * status". Returns the most recent campaign (active or already drawn)
 * so the page can render either "raffle open, ends in..." or "raffle
 * closed, winners drawn" without a connected wallet yet.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("id, partner_name, x_tag, gtd_spots, starts_at, ends_at, status")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    res.status(500).json({ error: "database_error" });
    return;
  }

  if (!campaign) {
    res.status(200).json({ campaign: null });
    return;
  }

  const { count: entryCount } = await supabase
    .from("entries")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign.id);

  const { data: ticketRows } = await supabase
    .from("entries")
    .select("ticket_count")
    .eq("campaign_id", campaign.id);
  const ticketTotal = (ticketRows || []).reduce((sum, r) => sum + r.ticket_count, 0);

  res.status(200).json({
    campaign: {
      id: campaign.id,
      partnerName: campaign.partner_name,
      xTag: campaign.x_tag,
      gtdSpots: campaign.gtd_spots,
      startsAt: campaign.starts_at,
      endsAt: campaign.ends_at,
      status: campaign.status, // 'active' | 'drawn' | 'cancelled'
      entryCount: entryCount || 0,
      ticketTotal,
    },
  });
};
