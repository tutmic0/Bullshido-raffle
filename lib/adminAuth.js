/// Simple shared-secret check for the admin endpoints (create/cancel a
/// campaign, export winners CSV). Not wallet-based -- this is you
/// running the raffle, not a holder -- so a single long random secret
/// (ADMIN_SECRET in env) sent as a header is enough. Keep it out of
/// any client-side JS; only admin.html's fetch calls send it, typed in
/// by you at the top of that page and held in memory only.
function requireAdmin(req) {
  const configured = process.env.ADMIN_SECRET;
  if (!configured) {
    const err = new Error("server_misconfigured");
    err.statusCode = 500;
    throw err;
  }
  const provided = req.headers["x-admin-secret"] || req.query.key;
  if (provided !== configured) {
    const err = new Error("unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

module.exports = { requireAdmin };
