/**
 * mira-scope-auth — a tiny Cloudflare Worker that finishes "Sign in with GitHub"
 * for the static MIRA Scope site.
 *
 * Why it exists: GitHub won't let a browser page exchange the login code for a
 * token (no CORS, and it needs a client secret). This Worker holds the secret,
 * does that one exchange, and hands the token straight back to the site's
 * popup window via postMessage to ONE fixed origin. It stores nothing and logs
 * nothing.
 *
 * Env (Settings → Variables and Secrets):
 *   GITHUB_CLIENT_ID      (text)    the GitHub App's Client ID
 *   GITHUB_CLIENT_SECRET  (secret)  the GitHub App's client secret
 *   ALLOWED_ORIGIN        (text)    e.g. https://thane-bit.github.io  (no path, no trailing slash)
 *
 * Routes:
 *   GET /login      → redirects to GitHub (sets a short-lived anti-CSRF state cookie)
 *   GET /callback   → verifies state, swaps code → token, posts it to ALLOWED_ORIGIN, closes the popup
 */

const COOKIE = "mira_state";

const page = (script, status = 200, extraHeaders = {}) =>
  new Response(`<!doctype html><meta charset="utf-8"><title>MIRA Scope sign-in</title><body style="font:15px system-ui;background:#0e1316;color:#e9e7dd;padding:2rem"><p id="m">Finishing sign-in…</p><script>${script}</script>`, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
      ...extraHeaders,
    },
  });

// JSON → safe inline-script literal
const lit = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

const clearCookie = `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

function fail(env, message) {
  return page(
    `var o=${lit(env.ALLOWED_ORIGIN)};try{window.opener&&window.opener.postMessage({type:"mira-scope-auth",error:${lit(message)}},o)}catch(e){}document.getElementById("m").textContent=${lit("Sign-in failed: " + message)};`,
    400,
    { "set-cookie": clearCookie },
  );
}

function readCookie(request, name) {
  for (const part of (request.headers.get("cookie") || "").split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return "";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.ALLOWED_ORIGIN) {
      return new Response("Worker is not configured (missing GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / ALLOWED_ORIGIN).", { status: 500 });
    }

    if (url.pathname === "/login") {
      const state = crypto.randomUUID();
      const authorize = new URL("https://github.com/login/oauth/authorize");
      authorize.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      authorize.searchParams.set("redirect_uri", `${url.origin}/callback`);
      authorize.searchParams.set("state", state);
      return new Response(null, {
        status: 302,
        headers: {
          location: authorize.toString(),
          "set-cookie": `${COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/callback") {
      const err = url.searchParams.get("error");
      if (err) return fail(env, url.searchParams.get("error_description") || err);

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const cookie = readCookie(request, COOKIE);
      if (!code || !state || !cookie || state !== cookie) return fail(env, "the sign-in session didn't match — close this window and try again");

      let data;
      try {
        const res = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json", "user-agent": "mira-scope-auth" },
          body: JSON.stringify({
            client_id: env.GITHUB_CLIENT_ID,
            client_secret: env.GITHUB_CLIENT_SECRET,
            code,
            redirect_uri: `${url.origin}/callback`,
          }),
        });
        data = await res.json();
      } catch {
        return fail(env, "couldn't reach GitHub");
      }
      if (!data || !data.access_token) return fail(env, (data && (data.error_description || data.error)) || "GitHub returned no token");

      // The token goes to ONE origin only — never "*".
      return page(
        `var o=${lit(env.ALLOWED_ORIGIN)};if(window.opener){window.opener.postMessage({type:"mira-scope-auth",token:${lit(data.access_token)},expiresIn:${Number(data.expires_in) || 0}},o);document.getElementById("m").textContent="Signed in — you can close this window.";setTimeout(function(){window.close()},300)}else{document.getElementById("m").textContent="Signed in, but this window lost its parent page. Close it and try again."}`,
        200,
        { "set-cookie": clearCookie },
      );
    }

    return new Response("mira-scope-auth", { status: 200, headers: { "content-type": "text/plain" } });
  },
};
