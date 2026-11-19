/**
 * Browser-side extraction. The whole pipeline (src/core.ts → OpenRouter) runs in
 * the visitor's browser with THEIR OpenRouter key, so the site is plain static
 * files: no server, no shared key, nothing stored anywhere except OpenRouter
 * receiving the paper text for the model call.
 */
import { decomposeText, PaperTooBigError, type CoreProgress } from "../../src/core.ts";
import type { OntologyId } from "../../src/ontology.ts";
import { pdfToTextInBrowser } from "./pdf-client.ts";
import type { ExtractResponse } from "./types.ts";
import { sha256Hex } from "./library.ts";

const MAX_ECHO_CHARS = 400_000;

function statusLine(e: CoreProgress): string {
  switch (e.phase) {
    case "chunked":
      return "Reading the whole document in one model call…";
    case "decomposing":
      return "Analyzing the paper…";
    case "generating":
      return e.kind === "reasoning"
        ? `The model is reasoning — ${e.chars.toLocaleString()} characters of thinking so far…`
        : `The model is writing the graph — ${e.chars.toLocaleString()} characters so far…`;
    case "decomposed":
      return "Building the graph…";
  }
}

export interface ClientRun {
  text: string;
  file: File | null;
  apiKey: string;
  ontology: OntologyId;
}

/**
 * `cached`, when given, is asked first with the paper text's hash: if the library
 * already holds this paper in this ontology it returns the saved graph and no
 * model call is made.
 */
export async function extractInBrowser(
  p: ClientRun,
  onStatus: (m: string) => void,
  cached?: (hash: string) => Promise<ExtractResponse | null>,
): Promise<ExtractResponse> {
  const apiKey = p.apiKey.trim();
  if (!apiKey) throw new Error("Paste your OpenRouter key first (free at https://openrouter.ai/keys).");

  let text: string;
  let source: string;
  if (p.file) {
    source = p.file.name;
    if (/\.pdf$/i.test(p.file.name)) {
      text = (await pdfToTextInBrowser(p.file, (page, total) => onStatus(`Reading PDF — page ${page} of ${total}…`))).trim();
      if (!text) throw new Error("No readable text in this PDF — a scanned/image-only PDF has no text layer. Try a .txt/.md.");
    } else if (/\.(txt|md)$/i.test(p.file.name) || !p.file.name.includes(".")) {
      text = await p.file.text();
    } else {
      throw new Error("Unsupported file type — use .pdf, .txt, or .md.");
    }
  } else {
    text = p.text;
    source = "(pasted text)";
  }
  if (!text.trim()) throw new Error("Provide a file or some pasted text.");

  const textHash = await sha256Hex(text);
  if (cached) {
    onStatus("Checking your library for this paper…");
    const hit = await cached(textHash);
    if (hit) return hit;
  }

  try {
    const result = await decomposeText(text, {
      apiKey,
      ontology: p.ontology,
      onProgress: (e) => onStatus(statusLine(e)),
    });
    return {
      ontology: p.ontology,
      source,
      models: result.models,
      pieces: result.stats.pieces,
      piecesDecomposed: result.stats.piecesDecomposed,
      flakes: result.flakes,
      paper: result.paper,
      nodes: result.nodes,
      edges: result.edges,
      dropped: result.dropped,
      mergeFolded: result.stats.merge.collapsed,
      consolidation: result.stats.consolidation,
      extractedText: text.slice(0, MAX_ECHO_CHARS),
      textHash,
      chars: text.length,
    } as ExtractResponse;
  } catch (e) {
    if (e instanceof PaperTooBigError) {
      throw new Error(
        `This document is ${e.chars.toLocaleString()} characters — over the ${e.limit.toLocaleString()}-character single-call limit. The extractor refuses rather than splitting it; try one section at a time.`,
      );
    }
    throw e;
  }
}
