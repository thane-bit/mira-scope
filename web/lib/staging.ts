/**
 * The editable staging model + its mutation ops, validation, and export.
 *
 * After extraction we hold the graph as ONE in-memory, mutable draft. Every edit goes
 * through `ops.*` (each returns a NEW model — React-friendly), and `validate()` re-derives
 * what's broken (empty-text nodes, dangling/ungrammatical edges) without ever deleting
 * anything. Drop is a soft-delete (restorable). Nothing leaves the browser until export.
 *
 * The grammar here MIRRORS src/grammar.ts (kept in lock-step by hand — it's a small,
 * stable table) so editing can be validated live in the client. Export produces the
 * canonical MIRA JSON-LD via the parent library's own projection (src/to-mira-jsonld.ts).
 */
import type { NodeType, ExtractResponse, Edge, PaperInfo } from "./types.ts";
import { toMiraJsonld } from "../../src/to-mira-jsonld.ts";
import { toObsidianOutcomes, type VaultReport, type VaultFile } from "../../src/to-obsidian-outcomes.ts";
import { getOntology, legalRelations, type OntologyId } from "../../src/ontology.ts";
import type { CleanEdge, CleanNode } from "../../src/grammar.ts";

// The vocabulary is the ACTIVE ontology's (src/ontology.ts) — one table shared
// with the server-side engine, so the editor can never drift from the grammar.
export const nodeTypesOf = (o: OntologyId): NodeType[] => [...getOntology(o).nodeClasses] as NodeType[];
export const grammarOf = (o: OntologyId) => getOntology(o).edgeGrammar;

export interface StageNode {
  id: string;
  type: NodeType;
  text: string;
  description?: string;
  doi?: string; // SourceDocument only
  url?: string; // SourceDocument only
  anchor?: string;
  dropped?: boolean;
  added?: boolean; // authored by the user, not the model
}
export interface StageEdge {
  id: string;
  relation: string;
  subject: string;
  object: string;
  anchor?: string;
  dropped?: boolean;
  added?: boolean;
}
export type StagePaper = PaperInfo;
export interface StageMeta {
  source: string;
  models: string[];
  pieces: number;
  flakes: { piece: number; why: string }[];
  fullChars: number;
  extractedText: string;
  /** malformed records the grammar check dropped before this draft */
  droppedNodes: number;
  /** duplicates folded (mechanical + consolidation) and cross-piece relations added */
  folded: number;
  edgesAdded: number;
}
export interface StageModel {
  ontology: OntologyId;
  nodes: StageNode[];
  edges: StageEdge[];
  paper: StagePaper | null;
  meta: StageMeta;
  seq: number; // monotonic counter for new node/edge ids (n0/e1/…), collision-free vs extractor ids (g0…)
}

/** Build the editable model from the extractor response. All edges (legal + dangling +
 *  ungrammatical) come in together — validate() re-derives their status live, so a
 *  rejected edge is fixable rather than lost. */
export function buildStageModel(r: ExtractResponse): StageModel {
  const nodes: StageNode[] = r.nodes.map((n) => ({
    id: n.id,
    type: n.type,
    text: n.text,
    description: n.description,
    doi: n.doi,
    url: n.url,
    anchor: n.anchor,
  }));
  let seq = 0;
  const mk = (e: Edge): StageEdge => ({ id: `x${seq++}`, relation: e.relation, subject: e.subject, object: e.object, anchor: e.anchor });
  const edges: StageEdge[] = [
    ...r.edges.map(mk),
    ...r.dropped.danglingEdges.map((d) => mk(d.edge)),
    ...r.dropped.ungrammaticalEdges.map((d) => mk(d.edge)),
  ];
  return {
    ontology: r.ontology ?? "discourse",
    nodes,
    edges,
    paper: r.paper,
    meta: {
      source: r.source,
      models: r.models ?? [],
      pieces: r.pieces ?? 1,
      flakes: r.flakes ?? [],
      fullChars: r.extractedText?.length ?? 0,
      extractedText: r.extractedText ?? "",
      droppedNodes: r.dropped?.nodes?.length ?? 0,
      folded: (r.mergeFolded ?? 0) + (r.consolidation?.recordsFolded ?? 0),
      edgesAdded: r.consolidation?.edgesAdded ?? 0,
    },
    seq: seq + 1,
  };
}

export interface Validation {
  nodeNeedsText: Set<string>;
  edgeStatus: Map<string, { valid: boolean; reason?: string }>;
  publishable: boolean;
  liveNodeCount: number;
  liveEdgeCount: number; // valid, non-dropped
}

/** Re-derive what's broken. Pure — depends only on the model. */
export function validate(m: StageModel): Validation {
  const live = new Map<string, StageNode>();
  for (const n of m.nodes) if (!n.dropped) live.set(n.id, n);

  const nodeNeedsText = new Set<string>();
  for (const n of live.values()) if (!n.text.trim()) nodeNeedsText.add(n.id);

  const edgeStatus = new Map<string, { valid: boolean; reason?: string }>();
  let liveEdgeCount = 0;
  for (const e of m.edges) {
    if (e.dropped) continue;
    const s = live.get(e.subject);
    const o = live.get(e.object);
    let valid = true;
    let reason: string | undefined;
    if (!s || !o) {
      valid = false;
      reason = !s && !o ? "both endpoints are missing/dropped" : !s ? "subject is missing/dropped" : "object is missing/dropped";
    } else {
      const g = getOntology(m.ontology).edgeGrammar[e.relation];
      if (!g) {
        valid = false;
        reason = `unknown relation "${e.relation}"`;
      } else if (!g.subj.includes(s.type) || !g.obj.includes(o.type)) {
        valid = false;
        reason = `${e.relation} wants ${g.subj.join("|")}→${g.obj.join("|")}, got ${s.type}→${o.type}`;
      }
    }
    edgeStatus.set(e.id, { valid, reason });
    if (valid) liveEdgeCount++;
  }

  return {
    nodeNeedsText,
    edgeStatus,
    publishable: live.size > 0 && nodeNeedsText.size === 0,
    liveNodeCount: live.size,
    liveEdgeCount,
  };
}

/** Relations whose grammar allows this exact directed (subject → object) pair. */
export function legalRelationsForPair(ontology: OntologyId, subj: NodeType, obj: NodeType): string[] {
  return legalRelations(getOntology(ontology), subj, obj);
}

// ids the NEXT addNode/addEdge will mint — lets a caller select the new item after applying.
export const peekNodeId = (m: StageModel) => `n${m.seq}`;
export const peekEdgeId = (m: StageModel) => `e${m.seq}`;

const clone = (m: StageModel): StageModel => ({ ...m, nodes: [...m.nodes], edges: [...m.edges] });

export const ops = {
  editNode(m: StageModel, id: string, patch: Partial<StageNode>): StageModel {
    const out = clone(m);
    out.nodes = out.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n));
    return out;
  },
  addNode(m: StageModel, type: NodeType, fields: Partial<StageNode> = {}): StageModel {
    const out = clone(m);
    out.nodes = [...out.nodes, { id: `n${out.seq}`, type, text: "", ...fields, added: true, dropped: false }];
    out.seq = out.seq + 1;
    return out;
  },
  dropNode(m: StageModel, id: string): StageModel {
    return this.editNode(m, id, { dropped: true });
  },
  restoreNode(m: StageModel, id: string): StageModel {
    return this.editNode(m, id, { dropped: false });
  },
  editEdge(m: StageModel, id: string, patch: Partial<StageEdge>): StageModel {
    const out = clone(m);
    out.edges = out.edges.map((e) => (e.id === id ? { ...e, ...patch } : e));
    return out;
  },
  addEdge(m: StageModel, relation: string, subject: string, object: string): StageModel {
    const out = clone(m);
    out.edges = [...out.edges, { id: `e${out.seq}`, relation, subject, object, added: true, dropped: false }];
    out.seq = out.seq + 1;
    return out;
  },
  dropEdge(m: StageModel, id: string): StageModel {
    return this.editEdge(m, id, { dropped: true });
  },
  restoreEdge(m: StageModel, id: string): StageModel {
    return this.editEdge(m, id, { dropped: false });
  },
  editPaper(m: StageModel, patch: Partial<StagePaper>): StageModel {
    return { ...m, paper: { ...(m.paper ?? {}), ...patch } };
  },
};

function slugify(source: string): string {
  return source.replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "paper";
}

/**
 * Export the EDITED graph: only kept, non-empty nodes and only kept, VALID edges.
 * What comes out depends on the draft's ontology:
 *   - discourse → `jsonld`: canonical MIRA JSON-LD from the library's own
 *     projection (the same code the CLI and CI use), plus its honesty report;
 *   - outcomes  → `vault`: the Obsidian vault files (+ placement report).
 * Both also return `graph`, the plain working graph (debug artifact).
 */
export function exportGraph(m: StageModel, v: Validation, createdAt: string) {
  const slug = slugify(m.meta.source);
  const docClass = getOntology(m.ontology).docClass;
  const nodes: CleanNode[] = m.nodes
    .filter((n) => !n.dropped && n.text.trim())
    .map((n) => ({
      id: n.id,
      type: n.type,
      text: n.text.trim(),
      ...(n.description?.trim() ? { description: n.description.trim() } : {}),
      ...(docClass && n.type === docClass && n.doi ? { doi: n.doi } : {}),
      ...(docClass && n.type === docClass && n.url ? { url: n.url } : {}),
      ...(n.anchor?.trim() ? { anchor: n.anchor.trim() } : {}),
    }));
  const keptIds = new Set(nodes.map((n) => n.id));
  const edges: CleanEdge[] = m.edges
    .filter((e) => !e.dropped && v.edgeStatus.get(e.id)?.valid && keptIds.has(e.subject) && keptIds.has(e.object))
    .map((e) => ({ relation: e.relation, subject: e.subject, object: e.object, ...(e.anchor ? { anchor: e.anchor } : {}) }));

  const graph = { ontology: m.ontology, source: m.meta.source, models: m.meta.models, edited: true, paper: m.paper, nodes, edges };

  if (m.ontology === "outcomes") {
    const vault = toObsidianOutcomes({ nodes, edges });
    return { kind: "vault" as const, slug, vault, graph };
  }
  const { jsonld, report } = toMiraJsonld(
    { nodes, edges, paper: m.paper },
    { slug, generatedAt: createdAt, creatorName: "graph-toggle web editor" },
  );
  return { kind: "jsonld" as const, slug, jsonld, report, graph };
}

export type { VaultReport, VaultFile };
