const { getSupabaseAdmin } = require("../../lib/supabaseAdmin");
const { requireAdmin } = require("../../lib/adminAuth");

/**
 * GET  /api/admin/campaign          -- list recent campaigns (newest first)
 * POST /api/admin/campaign          -- create a new campaign, or cancel the active one
 *   body { action: "create", partnerName, xTag, gtdSpots, durationHours }
 *   body { action: "cancel" }        -- cancels whichever campaign is currently active
 *
 * header: x-admin-secret: <ADMIN_SECRET>
 *
 * This is the whole "swap to the next partner" workflow: no site
 * re-edit needed, no redeploy -- create a new campaign here and
 * raffle.html picks it up automatically on next load.
 */
module.exports = async function handler(req, res) {
  try {
    requireAdmin(req);
  } catch (err) {
    res.status(err.statusCode || 401).json({ error: err.message });
    return;
  }

  const supabase = getSupabaseAdmin();

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, partner_name, x_tag, gtd_spots, starts_at, ends_at, status, created_at")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) {
      res.status(500).json({ error: "database_error" });
      return;
    }
    res.status(200).json({ campaigns: data });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const body = req.body || {};

  if (body.action === "cancel") {
    const { error } = await supabase
      .from("campaigns")
      .update({ status: "cancelled" })
      .eq("status", "active");
    if (error) {
      res.status(500).json({ error: "database_error" });
      return;
    }
    res.status(200).json({ ok: true });
    return;
  }

  const partnerName = String(body.partnerName || "").trim();
  const xTag = body.xTag ? String(body.xTag).trim() : null;
  const gtdSpots = Number(body.gtdSpots);
  const durationHours = Number(body.durationHours);

  if (!partnerName) {
    res.status(400).json({ error: "missing_partner_name" });
    return;
  }
  if (!Number.isInteger(gtdSpots) || gtdSpots < 1) {
    res.status(400).json({ error: "invalid_gtd_spots" });
    return;
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    res.status(400).json({ error: "invalid_duration_hours" });
    return;
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + durationHours * 60 * 60 * 1000);

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      partner_name: partnerName,
      x_tag: xTag,
      gtd_spots: gtdSpots,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      status: "active",
    })
    .select()
    .single();

  if (error) {
    // The DB's partial unique index (one_active_campaign) is what
    // actually enforces "only one partner at a time" -- this is the
    // error it raises if one's already running.
    if (String(error.message || "").includes("one_active_campaign")) {
      res.status(409).json({ error: "campaign_already_active" });
      return;
    }
    res.status(500).json({ error: "database_error" });
    return;
  }

  res.status(200).json({ campaign: data });
};
