const { createClient } = require("@supabase/supabase-js");

// Server-side only -- uses the SERVICE ROLE key, which bypasses Row
// Level Security. Never import this into anything that ships to the
// browser. Points at THIS project's own Supabase project (see
// .env.example) -- entirely separate from the Anya project's database.
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
