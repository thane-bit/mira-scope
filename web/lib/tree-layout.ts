/**
 * Tree layout for OUTCOMES graphs: the Outcome is the root on the LEFT and each
 * step of the chain sits one column further RIGHT — Outcome → Solution →
 * Constraint → deeper Solution … — so nesting reads as depth.
 *
 * Outcomes edges are stored child → parent (a Solution "pursues" an Outcome),
 * so for layout we feed dagre the REVERSE (parent → child) and rank
 * left-to-right. Arrows are still drawn child → parent, pointing back up the tree.
 */
import dagre from "@dagrejs/dagre";
import type { StageNode, StageEdge, Validation } from "./staging.ts";
import { drawableEdges } from "./layout.ts";

export const CARD_W = 280;
const CHARS_PER_LINE = 36;
const LINE_H = 17;
const MAX_LINES = 5;

export interface TreeBox {
  x: number; // top-left
  y: number;
  w: number;
  h: number;
}

/** How many text lines a card shows (clamped) — drives its height. */
export const cardLines = (text: string) => Math.min(MAX_LINES, Math.max(1, Math.ceil((text || " ").length / CHARS_PER_LINE)));
export const cardHeight = (text: string) => 40 + cardLines(text) * LINE_H;

/** Re-layout key: structure plus each card's line count (text edits that
 *  change a card's height re-flow; typos that don't, don't). */
export function treeKey(nodes: StageNode[], edges: StageEdge[], v: Validation): string {
  const live = nodes.filter((n) => !n.dropped);
  return (
    live.map((n) => `${n.id}:${cardLines(n.text)}`).join(",") +
    "|" +
    drawableEdges(nodes, edges, v).map((e) => `${e.subject}>${e.object}`).join(",")
  );
}

export function computeTreeBoxes(nodes: StageNode[], edges: StageEdge[], v: Validation): Map<string, TreeBox> {
  const live = nodes.filter((n) => !n.dropped);
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 22, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of live) g.setNode(n.id, { width: CARD_W, height: cardHeight(n.text) });
  for (const e of drawableEdges(nodes, edges, v)) {
    if (e.subject !== e.object) g.setEdge(e.object, e.subject); // parent → child
  }
  dagre.layout(g);
  const out = new Map<string, TreeBox>();
  for (const n of live) {
    const p = g.node(n.id);
    out.set(n.id, { x: p.x - p.width / 2, y: p.y - p.height / 2, w: p.width, h: p.height });
  }
  return out;
}
