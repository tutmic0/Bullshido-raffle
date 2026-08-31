const jwt = require("jsonwebtoken");

const SESSION_TTL = "24h";

function getSecret() {
  const secret = process.env.SESSION_JWT_SECRET;
  if (!secret) {
    throw new Error("Missing SESSION_JWT_SECRET environment variable.");
  }
  return secret;
}

/// Issued right after a wallet proves control via signature (see
/// api/auth/verify.js). Signed with THIS project's own secret --
/// generate a fresh one for .env, do not reuse Anya's.
function issueSessionToken(wallet) {
  return jwt.sign({ wallet: wallet.toLowerCase() }, getSecret(), {
    expiresIn: SESSION_TTL,
  });
}

/// Throws (with .statusCode = 401) if the token is missing, malformed,
/// or expired. Returns the lowercased wallet address it was issued for.
function requireSession(req) {
  const header = req.headers["authorization"] || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    const err = new Error("missing_session");
    err.statusCode = 401;
    throw err;
  }

  try {
    const payload = jwt.verify(token, getSecret());
    return payload.wallet;
  } catch (err) {
    const wrapped = new Error("invalid_session");
    wrapped.statusCode = 401;
    throw wrapped;
  }
}

module.exports = { issueSessionToken, requireSession };
