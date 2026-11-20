# mira-scope-auth — the sign-in helper

A ~100-line Cloudflare Worker that finishes "Sign in with GitHub" for the static site (GitHub won't let a browser page swap the login code for a token). It stores nothing and logs nothing; the token goes straight back to the site's popup, addressed to one origin only. The logic is all in `index.js`.

## One-time setup

1. **Deploy the Worker.** Cloudflare dashboard → Workers & Pages → Create → Worker → name it `mira-scope-auth` → Deploy, then Edit code → paste `index.js` → Deploy. Note its address: `https://mira-scope-auth.<your-subdomain>.workers.dev`.
2. **Register a GitHub App** (github.com → Settings → Developer settings → GitHub Apps → New GitHub App):
   - Homepage URL: `https://thane-bit.github.io/mira-scope/`
   - Callback URL: `https://mira-scope-auth.<your-subdomain>.workers.dev/callback`
   - Untick *Webhook → Active*. Untick *Request user authorization (OAuth) during installation* is fine either way.
   - Repository permissions → **Contents: Read and write**. Nothing else.
   - Where can this app be installed: *Only on this account*.
   - Create it, then **Generate a new client secret** and copy it (shown once). Copy the **Client ID** too.
   - **Install App** → install on **only** `mira-scope`. (This is what limits the token to that one repo.)
3. **Give the Worker its settings** (Worker → Settings → Variables and Secrets):
   - `GITHUB_CLIENT_ID` = the Client ID (text)
   - `GITHUB_CLIENT_SECRET` = the client secret (**Secret**)
   - `ALLOWED_ORIGIN` = `https://thane-bit.github.io` (text, no path, no trailing slash)
4. **Point the site at the Worker:** set `DEFAULT_AUTH_WORKER` in `web/lib/auth.ts` to the Worker address, commit and push.

Tokens from a GitHub App last 8 hours; after that the site asks you to sign in again.
