const { getSupabaseAdmin } = require("../lib/supabaseAdmin");

/**
 * TEMPORARY diagnostic endpoint -- returns which env vars are present
 * (booleans only, never the actual values) and tries one real
 * Supabase query, reporting back the exact error message if it fails.
 * Delete this file once things are working -- it's not meant to stay
 * in production long-term, it's just here to sidestep needing to dig
 * through the Vercel dashboard's log viewer.
 */
module.exports = async function handler(req, res) {
  const envs = {
    SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    ROBINHOOD_RPC_URL: Boolean(process.env.ROBINHOOD_RPC_URL),
    CONTRACT_ADDRESS: Boolean(process.env.CONTRACT_ADDRESS),
    SESSION_JWT_SECRET: Boolean(process.env.SESSION_JWT_SECRET),
    ADMIN_SECRET: Boolean(process.env.ADMIN_SECRET),
  };

  let supabaseConnectError = null;
  let queryError = null;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("campaigns").select("id").limit(1);
    if (error) queryError = error.message;
  } catch (err) {
    supabaseConnectError = err.message;
  }

  res.status(200).json({ envs, supabaseConnectError, queryError });
};
