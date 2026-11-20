/**
 * The library: every extracted graph is saved as a JSON file in the GitHub repo
 * (library/<slug>-<hash8>.<ontology>.json) so a paper never needs re-extracting.
 *
 *   - READ is public and needs nothing: the repo is public, so the GitHub API
 *     lists and serves the files to any visitor.
 *   - WRITE needs a GitHub token (fine-grained, this repo only, "Contents:
 *     read & write") that the owner pastes into the page. It is held in memory
 *     only — never written to storage — and sent only to api.github.com.
 *
 * What is stored: the graph (nodes, edges, paper metadata, models, anchor
 * quotes) and a hash of the paper text. The paper's FULL TEXT is deliberately
 * not stored — the repo is public and most papers aren't ours to republish.
 * Consequence: a graph loaded from the library has its anchor quotes shown but
 * not re-verified (that needs the text).
 */
import type { OntologyId } from "../../src/ontology.ts";
import type { ExtractResponse } from "./types.ts";

export const LIBRARY_REPO = process.env.NEXT_PUBLIC_LIBRARY_REPO || "thane-bit/mira-scope";
const BRANCH = "main";
const DIR = "library";
const API = "https://api.github.com";

export interface LibraryEntry {
  version: 1;
  ontology: OntologyId;
  source: string;
  textHash: string;
  chars: number;
  savedAt: string;
  models: string[];
  paper: ExtractResponse["paper"];
  nodes: ExtractResponse["nodes"];
  edges: ExtractResponse["edges"];
}

export interface LibraryItem {
  name: string; // file name
  slug: string;
  hash8: string;
  ontology: OntologyId;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function slugFor(source: string, title?: string): string {
  const base = (title || source).replace(/\.[^.]+$/, "");
  return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "paper";
}

export const fileNameFor = (slug: string, hash: string, ontology: OntologyId) =>
  `${slug}-${hash.slice(0, 8)}.${ontology}.json`;

const NAME_RE = /^(.+)-([0-9a-f]{8})\.(discourse|outcomes)\.json$/;

export function parseName(name: string): LibraryItem | null {
  const m = NAME_RE.exec(name);
  return m ? { name, slug: m[1], hash8: m[2], ontology: m[3] as OntologyId } : null;
}

const headers = (token?: string): HeadersInit => ({
  Accept: "application/vnd.github+json",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

/** List saved graphs (public read). An empty/missing library folder is just []. */
export async function listLibrary(): Promise<LibraryItem[]> {
  const res = await fetch(`${API}/repos/${LIBRARY_REPO}/contents/${DIR}?ref=${BRANCH}`, { headers: headers() });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Library unavailable (HTTP ${res.status}).`);
  const files = (await res.json()) as { name: string; type: string }[];
  return files
    .filter((f) => f.type === "file")
    .map((f) => parseName(f.name))
    .filter((x): x is LibraryItem => !!x)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Find an already-extracted graph for this exact text + ontology, if any. */
export async function findCached(hash: string, ontology: OntologyId): Promise<LibraryItem | null> {
  try {
    const items = await listLibrary();
    return items.find((i) => i.hash8 === hash.slice(0, 8) && i.ontology === ontology) ?? null;
  } catch {
    return null; // library unreachable → just extract
  }
}

export async function loadEntry(name: string): Promise<LibraryEntry> {
  const res = await fetch(`${API}/repos/${LIBRARY_REPO}/contents/${DIR}/${encodeURIComponent(name)}?ref=${BRANCH}`, {
    headers: { ...headers(), Accept: "application/vnd.github.raw+json" },
  });
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status}).`);
  const entry = JSON.parse(await res.text()) as LibraryEntry;
  if (!entry || !Array.isArray(entry.nodes) || !Array.isArray(entry.edges)) throw new Error(`${name} is not a saved graph.`);
  return entry;
}

const toBase64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Commit (create or update) one graph file. Needs a write-scoped token. */
export async function saveEntry(token: string, entry: LibraryEntry): Promise<string> {
  const name = fileNameFor(slugFor(entry.source, entry.paper?.title), entry.textHash, entry.ontology);
  const url = `${API}/repos/${LIBRARY_REPO}/contents/${DIR}/${encodeURIComponent(name)}`;
  // update needs the current blob sha, if the file already exists
  let sha: string | undefined;
  const cur = await fetch(`${url}?ref=${BRANCH}`, { headers: headers(token) });
  if (cur.ok) sha = ((await cur.json()) as { sha?: string }).sha;
  else if (cur.status === 401 || cur.status === 403) throw new Error("GitHub rejected the token — it may have expired (sign in again) or lack Contents: read & write on this repo.");
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `library: ${sha ? "update" : "add"} ${name}`,
      content: toBase64(JSON.stringify(entry, null, 2) + "\n"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160);
    throw new Error(`GitHub save failed (HTTP ${res.status}) ${detail}`);
  }
  return name;
}

/** A saved entry back into the shape the editor loads. */
export function entryToResponse(e: LibraryEntry): ExtractResponse {
  return {
    ontology: e.ontology,
    source: e.source,
    models: e.models ?? [],
    pieces: 1,
    piecesDecomposed: 1,
    flakes: [],
    paper: e.paper ?? null,
    nodes: e.nodes,
    edges: e.edges,
    dropped: { nodes: [], danglingEdges: [], ungrammaticalEdges: [] },
    extractedText: "", // full text is never stored
    textHash: e.textHash,
    chars: e.chars,
    fromLibrary: true,
  };
}
