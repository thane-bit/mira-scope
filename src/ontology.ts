/**
 * ontology.ts — the switchable vocabularies.
 *
 * An ontology is just data: the node classes the extractor may emit and the
 * legal (subject → object) shape of every relation. Everything downstream
 * (prompt, classification pass, web editor, exporter) reads the ACTIVE one, so
 * switching ontology is a single parameter, not a fork of the pipeline.
 *
 *   discourse — the MIRA / Discourse Graphs vocabulary (inherited unchanged
 *               from the upstream extractor): Question, Claim, Evidence, Study,
 *               Protocol, SourceDocument, Request. Output: MIRA JSON-LD.
 *   outcomes  — the DSV Outcomes Graph vocabulary: an Outcome pursued by
 *               Solutions, blocked by Constraints, unblocked by deeper
 *               Solutions, with open questions / evidence / requirements /
 *               competitors / tactics hanging off the nodes. Output: an
 *               Obsidian vault.
 *
 * Pure data — no network, no file I/O, no Node imports (the browser uses it too).
 */

export type OntologyId = "discourse" | "outcomes";

export interface EdgeRule {
  subj: readonly string[];
  obj: readonly string[];
}

export interface Ontology {
  id: OntologyId;
  label: string;
  /** one line for the UI toggle */
  blurb: string;
  nodeClasses: readonly string[];
  /** relation → the only legal { subject classes, object classes }. */
  edgeGrammar: Readonly<Record<string, EdgeRule>>;
  /** the one class that may carry doi/url (discourse: SourceDocument). */
  docClass?: string;
  /** what the export button produces */
  exportKind: "mira-jsonld" | "obsidian-vault";
}

export const DISCOURSE: Ontology = {
  id: "discourse",
  label: "Discourse graph",
  blurb: "Questions, claims, evidence, studies and protocols (MIRA schema). Exports JSON-LD.",
  nodeClasses: ["Question", "Claim", "Evidence", "Study", "Protocol", "SourceDocument", "Request"],
  edgeGrammar: {
    addresses: { subj: ["Claim"], obj: ["Question"] },
    supports: { subj: ["Evidence", "Claim"], obj: ["Claim"] },
    opposes: { subj: ["Evidence", "Claim"], obj: ["Claim"] },
    describesActivity: { subj: ["SourceDocument"], obj: ["Study"] },
    grounds: { subj: ["Study"], obj: ["Evidence"] },
    follows: { subj: ["Study"], obj: ["Protocol"] },
    request_for: { subj: ["Request"], obj: ["Study"] },
    request_target: { subj: ["Request"], obj: ["Claim"] },
  },
  docClass: "SourceDocument",
  exportKind: "mira-jsonld",
};

/** Structural outcomes classes — each becomes its own Obsidian file. */
export const OUTCOMES_STRUCTURAL = [
  "Outcome",
  "Solution",
  "HypothesizedSolution",
  "Constraint",
  "HypothesizedConstraint",
] as const;

/** Tagged-value classes — written as `text #tag` lines, no file of their own.
 *  (Question and Evidence reuse the discourse class names on purpose: same
 *  idea, same colour in the UI.) */
export const OUTCOMES_TAGGED = ["Question", "Evidence", "Requirement", "Competitor", "Tactic"] as const;

const SOL = ["Solution", "HypothesizedSolution"] as const;
const CON = ["Constraint", "HypothesizedConstraint"] as const;

export const OUTCOMES: Ontology = {
  id: "outcomes",
  label: "Outcomes graph",
  blurb: "Outcome → Solution → Constraint → deeper Solution chains (DSV). Exports an Obsidian vault.",
  nodeClasses: [...OUTCOMES_STRUCTURAL, ...OUTCOMES_TAGGED],
  edgeGrammar: {
    // child → parent, so every edge points "up" the tree
    pursues: { subj: SOL, obj: ["Outcome"] }, //            a solution pursues an outcome
    blocks: { subj: CON, obj: SOL }, //                     a constraint blocks a solution
    resolves: { subj: SOL, obj: CON }, //                   a (deeper) solution addresses a constraint
    annotates: { subj: OUTCOMES_TAGGED, obj: OUTCOMES_STRUCTURAL }, // a tagged value hangs off a node
  },
  exportKind: "obsidian-vault",
};

export const ONTOLOGIES: Readonly<Record<OntologyId, Ontology>> = {
  discourse: DISCOURSE,
  outcomes: OUTCOMES,
};

export function getOntology(id: OntologyId | undefined): Ontology {
  return ONTOLOGIES[id ?? "discourse"] ?? DISCOURSE;
}

export function isOntologyId(v: unknown): v is OntologyId {
  return v === "discourse" || v === "outcomes";
}

/** Relations that legally connect a (subject class → object class) pair. */
export function legalRelations(o: Ontology, subj: string, obj: string): string[] {
  return Object.keys(o.edgeGrammar).filter(
    (r) => o.edgeGrammar[r].subj.includes(subj) && o.edgeGrammar[r].obj.includes(obj),
  );
}
