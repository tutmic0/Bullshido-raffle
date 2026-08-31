const { createClient } = require("@supabase/supabase-js");

// Server-side only -- uses the SERVICE ROLE key, which bypasses Row
// Level Security. Never import this into anything that ships to the
// browser. Points at THIS project's own Supabase project (see
// .env.example) -- entirely separate from the Anya project's database.
function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  // SUPABASE_SERVICE_ROLE_KEY is the name used when you paste the key
  // in by hand (see .env.example). SUPABASE_SECRET_KEY is the name
  // the Vercel<->Supabase marketplace integration auto-injects instead
  // (Supabase's newer "secret key" naming) -- same value, either works.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
