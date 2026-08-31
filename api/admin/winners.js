const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireAdmin } = require("../../lib/adminAuth");

function csvEscape(value) {
  const s = String(value == null ? "" : value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * GET /api/admin/winners?campaignId=<uuid>&format=csv
 * GET /api/admin/winners?campaignId=<uuid>          (JSON, default)
 *
 * Omit campaignId to get the most recently drawn campaign's winners.
 * header: x-admin-secret: <ADMIN_SECRET>   (or ?key=<ADMIN_SECRET> for
 * a plain download link you can paste into a browser tab)
 */
module.exports = async function handler(req, res) {
  try {
    requireAdmin(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const supabase = getSupabaseAdmin();
  let campaignId = req.query.campaignId;

  if (!campaignId) {
    const { data: latest } = await supabase
      .from("campaigns")
      .select("id")
      .eq("status", "drawn")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) {
      res.status(404).json({ error: "no_drawn_campaign" });
      return;
    }
    campaignId = latest.id;
  }

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("partner_name")
    .eq("id", campaignId)
    .maybeSingle();

  const { data: winners, error } = await supabase
    .from("winners")
    .select("wallet_address, x_username, drawn_at")
    .eq("campaign_id", campaignId)
    .order("drawn_at", { ascending: true });

  if (error) {
    res.status(500).json({ error: "database_error" });
    return;
  }

  if (req.query.format === "csv") {
    const header = "Wallet address,X username,Drawn at (UTC)";
    const rows = (winners || []).map((w) =>
      [csvEscape(w.wallet_address), csvEscape("@" + w.x_username), csvEscape(w.drawn_at)].join(",")
    );
    const csv = [header, ...rows].join("\n") + "\n";
    const safeName = (campaign?.partner_name || "campaign").replace(/[^a-z0-9]+/gi, "_");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="bullshido_raffle_winners_${safeName}.csv"`);
    res.status(200).send(csv);
    return;
  }

  res.status(200).json({ campaignId, partnerName: campaign?.partner_name || null, winners });
};
