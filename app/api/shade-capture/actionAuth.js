// Password check for actions that change what users see: making products live and verifying them.
// The password lives in the ACTION_PASSWORD environment variable (.env.local locally, Vercel env in production).
import crypto from "crypto";

// Returns null when the password is right, otherwise a 401/500 Response to send back.
export function rejectUnlessActionPassword(password) {
  const expected = process.env.ACTION_PASSWORD;
  if (!expected) {
    return new Response(JSON.stringify({ success: false, error: "ACTION_PASSWORD is not configured on the server" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const a = crypto.createHash("sha256").update(String(password || "")).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  if (password && crypto.timingSafeEqual(a, b)) return null;
  return new Response(JSON.stringify({ success: false, error: "Wrong password", passwordRequired: true }), {
    status: 401, headers: { "Content-Type": "application/json" },
  });
}
