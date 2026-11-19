/** Shapes the client consumes from /api/extract (mirrors the parent library's output). */

import type { OntologyId } from "../../src/ontology.ts";

/** Every node class across both ontologies (discourse + outcomes). Which are
 *  legal for a given draft is decided by its ontology (lib/staging.ts). */
export type NodeType =
  | "Question"
  | "Claim"
  | "Evidence"
  | "Study"
  | "Protocol"
  | "SourceDocument"
  | "Request"
  | "Outcome"
  | "Solution"
  | "HypothesizedSolution"
  | "Constraint"
  | "HypothesizedConstraint"
  | "Requirement"
  | "Competitor"
  | "Tactic";

export interface PaperInfo {
  title?: string;
  doi?: string;
  license?: string;
  authors?: { name: string; orcid?: string }[];
}

export interface ExtractNode {
  id: string;
  type: NodeType;
  text: string;
  description?: string;
  doi?: string; // SourceDocument only
  url?: string; // SourceDocument only
  anchor?: string;
}

export interface Edge {
  relation: string;
  subject: string;
  object: string;
  anchor?: string;
}

export interface ExtractResponse {
  /** which vocabulary the server extracted into (absent in old payloads = discourse) */
  ontology?: OntologyId;
  source: string;
  models: string[];
  pieces: number;
  piecesDecomposed: number;
  flakes: { piece: number; why: string }[];
  paper: PaperInfo | null;
  nodes: ExtractNode[];
  edges: Edge[];
  dropped: {
    nodes: { node: unknown; why: string }[];
    danglingEdges: { edge: Edge; why: string }[];
    ungrammaticalEdges: { edge: Edge; why: string }[];
  };
  extractedText: string;
  /** sha-256 of the paper text (identifies the paper in the library) */
  textHash?: string;
  chars?: number;
  /** true when loaded from the GitHub library instead of extracted */
  fromLibrary?: boolean;
  /** exact duplicates folded mechanically at merge time */
  mergeFolded?: number;
  /** the consolidation pass's stats (multi-piece papers) */
  consolidation?: {
    recordsFolded: number;
    edgesAdded: number;
    groupsRejected: number;
    proposedRejected: number;
    skipped?: string;
  };
  error?: string;
}

/**
 * Does the anchor quote appear in the source text?
 * "exact" → verbatim substring; "normalized" → matches once whitespace is collapsed
 * (PDF extraction often differs only in spacing); "missing" → not found.
 */
export type AnchorMatch = "exact" | "normalized" | "missing";
export function checkAnchor(text: string, anchor: string | undefined): AnchorMatch | null {
  if (!anchor) return null;
  if (!text) return null;
  if (text.includes(anchor)) return "exact";
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return norm(text).includes(norm(anchor)) ? "normalized" : "missing";
}
