const { createClient } = require("@supabase/supabase-js");

// Server-side only -- uses the SERVICE ROLE key, which bypasses Row
// Level Security. Never import this into anything that ships to the
// browser. Points at THIS project's own Supabase project (see
// .env.example) -- entirely separate from the Anya project's database.
function getSupabaseAdmin() {
  // The Vercel<->Supabase marketplace integration manages its own copy
  // of SUPABASE_URL and can end up pointing it at the wrong thing (or
  // reset a manual fix back). NEXT_PUBLIC_SUPABASE_URL is the value it
  // sets for client-side use and is reliably the real
  // https://xxxx.supabase.co API URL, so prefer that if present.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  // SUPABASE_SERVICE_ROLE_KEY is the name used when you paste the key
  // in by hand (see .env.example). SUPABASE_SECRET_KEY is the name
  // the integration auto-injects instead (Supabase's newer "secret
  // key" naming) -- same value, either works.
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_SECRET_KEY environment variables."
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

module.exports = { getSupabaseAdmin };
