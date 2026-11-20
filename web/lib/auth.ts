/**
 * "Sign in with GitHub": a popup to GitHub's own login page, finished by the
 * small Cloudflare Worker in ../worker (GitHub won't let a browser page do the
 * code→token step itself). The token comes back to this page via postMessage
 * and is held in memory only — this site shares an origin with the owner's
 * other GitHub Pages sites, so it must never sit in browser storage.
 *
 * Set the Worker's URL below (or NEXT_PUBLIC_AUTH_WORKER at build time). Left
 * empty, the site falls back to pasting a token by hand.
 */
const DEFAULT_AUTH_WORKER = "https://mira-scope-auth.thane-c65.workers.dev";

export const AUTH_WORKER = (process.env.NEXT_PUBLIC_AUTH_WORKER || DEFAULT_AUTH_WORKER).replace(/\/+$/, "");

export const authConfigured = () => AUTH_WORKER.length > 0;

/** Open the GitHub sign-in popup; resolves with the access token. */
export function signInWithGitHub(): Promise<string> {
  if (!authConfigured()) return Promise.reject(new Error("Sign-in isn't configured on this site yet."));
  const workerOrigin = new URL(AUTH_WORKER).origin;
  const popup = window.open(`${AUTH_WORKER}/login`, "mira-scope-github", "width=620,height=760");
  if (!popup) return Promise.reject(new Error("The sign-in window was blocked — allow pop-ups for this site and try again."));

  return new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      clearInterval(watch);
      fn();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== workerOrigin || e.source !== popup) return; // only our Worker's popup
      const d = e.data as { type?: string; token?: string; error?: string } | null;
      if (!d || d.type !== "mira-scope-auth") return;
      finish(() => (d.token ? resolve(d.token) : reject(new Error(d.error || "Sign-in failed."))));
    };
    window.addEventListener("message", onMessage);
    // the user closed the window without finishing
    const watch = setInterval(() => {
      if (popup.closed) setTimeout(() => finish(() => reject(new Error("Sign-in window closed before finishing."))), 400);
    }, 600);
  });
}

/** Who the token belongs to (for the "Signed in as …" label). */
export async function githubLogin(token: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return ((await res.json()) as { login?: string }).login ?? null;
  } catch {
    return null;
  }
}
