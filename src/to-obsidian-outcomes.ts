/**
 * to-obsidian-outcomes.ts — serialize a classified OUTCOMES extraction into a
 * DSV-style Obsidian vault: one flat folder of .md files.
 *
 *   _Outcome - {name}.md   one root file per Outcome (frontmatter + the whole
 *                          tree, recursively expanded)
 *   Sol - … .md, HSol - … .md, Con - … .md, HCon - … .md
 *                          one file per structural node, holding that node's
 *                          full expanded subtree
 *   _Unplaced.md           anything that could not be placed in a tree (so
 *                          nothing is silently lost)
 *
 * Format rules (from the DSV outcomes-graph method):
 *   - hierarchy is TAB indentation inside files, never directories, never "- " bullets;
 *   - the very first wikilink of a ROOT file starts with exactly one leading space;
 *   - a node file starts with its own [[wikilink]] at column 0;
 *   - tagged values are `text #tag` lines and get no file of their own.
 *
 * Pure: no file I/O, no network. Returns the files; callers write or zip them.
 */
import type { CleanEdge, CleanNode } from "./grammar.ts";

export interface VaultFile {
  name: string; // file name, including .md
  content: string;
}

export interface VaultReport {
  outcomes: number;
  structuralNodes: number;
  taggedValues: number;
  files: number;
  /** nodes that could not be reached from any Outcome (listed in _Unplaced.md) */
  unplaced: { id: string; type: string; text: string; why: string }[];
  /** structural nodes that appear under more than one parent (expanded under each) */
  multiParent: string[];
  /** edges skipped because following them would create a cycle */
  cyclesSkipped: number;
  notes: string[];
}

export interface Vault {
  files: VaultFile[];
  report: VaultReport;
}

const PREFIX: Record<string, string> = {
  Outcome: "Outcome: ",
  Solution: "Sol - ",
  HypothesizedSolution: "HSol - ",
  Constraint: "Con - ",
  HypothesizedConstraint: "HCon - ",
};

const TAG: Record<string, string> = {
  Question: "#question",
  Evidence: "#EVD",
  Requirement: "#req",
  Competitor: "#comp",
  Tactic: "#tactic",
};

const isStructural = (t: string) => t in PREFIX;

/** One line, no characters that break a wikilink or a filename. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
function linkText(s: string): string {
  return oneLine(s).replace(/[\[\]|#^]/g, "_");
}
/** Filename-safe: the illegal characters < > : " / \ | ? * become _ (per the method). */
export function fileSafe(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "_");
}

export function toObsidianOutcomes(input: { nodes: CleanNode[]; edges: CleanEdge[] }): Vault {
  const { nodes, edges } = input;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // ---- unique titles for structural nodes (each is a file) ------------------
  const title = new Map<string, string>(); // id → wikilink text
  const used = new Set<string>();
  for (const n of nodes) {
    if (!isStructural(n.type)) continue;
    const base = PREFIX[n.type] + linkText(n.text);
    let t = base;
    for (let i = 2; used.has(fileSafe(t).toLowerCase()); i++) t = `${base} (${i})`;
    used.add(fileSafe(t).toLowerCase());
    title.set(n.id, t);
  }

  // ---- parent → children, derived from the child→parent edges ---------------
  const structKids = new Map<string, string[]>();
  const tagKids = new Map<string, string[]>();
  const hasParent = new Set<string>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k) ?? [];
    if (!a.includes(v)) a.push(v);
    m.set(k, a);
  };
  for (const e of edges) {
    const child = byId.get(e.subject);
    const parent = byId.get(e.object);
    if (!child || !parent) continue;
    // every outcomes relation is child → parent
    if (isStructural(child.type)) push(structKids, parent.id, child.id);
    else push(tagKids, parent.id, child.id);
    hasParent.add(child.id);
  }

  const report: VaultReport = {
    outcomes: 0,
    structuralNodes: 0,
    taggedValues: 0,
    files: 0,
    unplaced: [],
    multiParent: [],
    cyclesSkipped: 0,
    notes: [],
  };

  // ---- rendering ------------------------------------------------------------
  const tabs = (d: number) => "\t".repeat(d);

  /** Body + tagged values + structural children of `id`, indented from `depth`. */
  function renderBody(id: string, depth: number, path: Set<string>, reached: Set<string>): string[] {
    const out: string[] = [];
    const n = byId.get(id)!;
    if (n.description) {
      for (const line of n.description.split(/\r?\n/)) {
        const t = line.trim();
        if (t) out.push(tabs(depth) + t);
      }
    }
    for (const tid of tagKids.get(id) ?? []) {
      const t = byId.get(tid)!;
      reached.add(tid);
      out.push(`${tabs(depth)}${oneLine(t.text)} ${TAG[t.type]}`);
      if (t.description) {
        for (const line of t.description.split(/\r?\n/)) {
          const x = line.trim();
          if (x) out.push(tabs(depth + 1) + x);
        }
      }
    }
    for (const cid of structKids.get(id) ?? []) {
      if (path.has(cid)) {
        report.cyclesSkipped++;
        continue;
      }
      reached.add(cid);
      out.push(`${tabs(depth)}[[${title.get(cid)}]]`);
      path.add(cid);
      out.push(...renderBody(cid, depth + 1, path, reached));
      path.delete(cid);
    }
    return out;
  }

  const files: VaultFile[] = [];
  const reached = new Set<string>();

  // one root per Outcome
  const outcomes = nodes.filter((n) => n.type === "Outcome");
  report.outcomes = outcomes.length;
  const usedRootNames = new Set<string>();
  for (const o of outcomes) {
    reached.add(o.id);
    const name = oneLine(o.text);
    const lines = [
      "---",
      `outcome: "${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
      "type: root",
      "---",
      ` [[${title.get(o.id)}]]`, // exactly ONE leading space
      ...renderBody(o.id, 1, new Set([o.id]), reached),
    ];
    let fname = `_Outcome - ${fileSafe(linkText(name))}.md`;
    for (let i = 2; usedRootNames.has(fname.toLowerCase()); i++) fname = `_Outcome - ${fileSafe(linkText(name))} (${i}).md`;
    usedRootNames.add(fname.toLowerCase());
    files.push({ name: fname, content: lines.join("\n") + "\n" });
  }

  // one file per structural non-outcome node reachable from an Outcome
  for (const n of nodes) {
    if (!isStructural(n.type) || n.type === "Outcome" || !reached.has(n.id)) continue;
    report.structuralNodes++;
    const lines = [`[[${title.get(n.id)}]]`, ...renderBody(n.id, 1, new Set([n.id]), new Set())];
    files.push({ name: `${fileSafe(title.get(n.id)!)}.md`, content: lines.join("\n") + "\n" });
  }

  // multi-parent report
  const parentCount = new Map<string, number>();
  for (const kids of structKids.values()) for (const k of kids) parentCount.set(k, (parentCount.get(k) ?? 0) + 1);
  for (const [id, c] of parentCount) if (c > 1) report.multiParent.push(title.get(id) ?? id);

  report.taggedValues = nodes.filter((n) => !isStructural(n.type) && reached.has(n.id)).length;
  // tagged values reached only via render of non-root node files were added to a throwaway set; recompute from the tree
  const placedTags = new Set<string>();
  const walk = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const t of tagKids.get(id) ?? []) placedTags.add(t);
    for (const c of structKids.get(id) ?? []) walk(c, seen);
  };
  for (const o of outcomes) walk(o.id, new Set());
  report.taggedValues = placedTags.size;

  // ---- unplaced -------------------------------------------------------------
  const placed = new Set<string>(reached);
  for (const t of placedTags) placed.add(t);
  for (const n of nodes) {
    if (placed.has(n.id)) continue;
    report.unplaced.push({
      id: n.id,
      type: n.type,
      text: n.text,
      why: !outcomes.length
        ? "no Outcome in the graph"
        : !hasParent.has(n.id)
          ? "no edge connects it upward"
          : "its parent chain never reaches an Outcome",
    });
  }
  if (!outcomes.length) report.notes.push("No Outcome node was extracted — add one in the editor and re-export.");
  if (report.unplaced.length) {
    const lines = [
      "These records were extracted but could not be placed under an Outcome. Connect them in the editor and re-export.",
      "",
      ...report.unplaced.map((u) => `${u.type}: ${oneLine(u.text)} (${u.why})`),
    ];
    files.push({ name: "_Unplaced.md", content: lines.join("\n") + "\n" });
  }

  report.files = files.length;
  return { files, report };
}
