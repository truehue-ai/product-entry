// Client side: which user name to show (display-only th_user cookie) and logging out.
// Access is decided on the server from the signed, HttpOnly th_auth cookie — never from this.

export function readUser() {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)th_user=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function logout() {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch {}
  try { localStorage.removeItem("th_user"); } catch {}
  window.location.href = "/login";
}
