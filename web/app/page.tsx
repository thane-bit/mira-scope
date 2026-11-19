"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GraphView, { type Selection } from "../components/GraphView.tsx";
import Inspector from "../components/Inspector.tsx";
import InputForm, { type RunPayload } from "../components/InputForm.tsx";
import StagePanel from "../components/StagePanel.tsx";
import { checkAnchor } from "../lib/types.ts";
import { extractInBrowser } from "../lib/extract-client.ts";
import type { OntologyId } from "../../src/ontology.ts";
import {
  entryToResponse,
  findCached,
  loadEntry,
  saveEntry,
  LIBRARY_REPO,
  type LibraryEntry,
} from "../lib/library.ts";
import { zipFiles } from "../../src/zip.ts";
import {
  buildStageModel,
  validate,
  exportGraph,
  legalRelationsForPair,
  ops,
  peekEdgeId,
  type StageModel,
} from "../lib/staging.ts";

/** Seconds → "42s" or "1:23" for the elapsed-time liveness readout. */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function Home() {
  const [model, setModel] = useState<StageModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // GitHub token for saving to the library — memory only, never persisted
  const [ghToken, setGhToken] = useState("");
  // OpenRouter key — memory only; kept so the ontology toggle can extract the other graph
  const [apiKey, setApiKey] = useState("");
  // both ontologies for the CURRENT paper, so toggling is instant and edits are kept
  const [drafts, setDrafts] = useState<Partial<Record<OntologyId, StageModel>>>({});
  const [libraryTick, setLibraryTick] = useState(0); // bump to refresh the library list
  const [selection, setSelection] = useState<Selection>(null);
  // The over-the-limit submission panel: the refused paper + review-inbox state.

  const validation = useMemo(() => (model ? validate(model) : null), [model]);

  // keep the stored draft for the open ontology in step with edits
  useEffect(() => {
    if (model) setDrafts((d) => (d[model.ontology] === model ? d : { ...d, [model.ontology]: model }));
  }, [model]);
  const anchored = useMemo(() => {
    if (!model) return 0;
    return model.nodes.filter(
      (n) => !n.dropped && n.anchor && checkAnchor(model.meta.extractedText, n.anchor) !== "missing",
    ).length;
  }, [model]);

  // elapsed ticker — a live "still working" signal beside the streamed stages
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // esc closes the inspector — the viewer's habit
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelection(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const update = useCallback((fn: (m: StageModel) => StageModel) => {
    setModel((prev) => (prev ? fn(prev) : prev));
  }, []);

  /** Commit the current (edited) graph to the GitHub library. */
  const saveToLibrary = useCallback(async (m: StageModel, token: string): Promise<string> => {
    if (!m.meta.textHash) throw new Error("This draft has no paper hash, so it can't be filed in the library.");
    const out = exportGraph(m, validate(m), new Date().toISOString());
    const g = out.graph;
    const entry: LibraryEntry = {
      version: 1,
      ontology: m.ontology,
      source: m.meta.source,
      textHash: m.meta.textHash,
      chars: m.meta.chars ?? 0,
      savedAt: new Date().toISOString(),
      models: m.meta.models,
      paper: g.paper,
      nodes: g.nodes as LibraryEntry["nodes"],
      edges: g.edges as LibraryEntry["edges"],
    };
    const name = await saveEntry(token, entry);
    setLibraryTick((t) => t + 1);
    return name;
  }, []);

  const loadFromLibrary = useCallback(async (name: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setSelection(null);
    setProgress("Loading from the library…");
    try {
      const entry = await loadEntry(name);
      const loaded = buildStageModel(entryToResponse(entry));
      setModel(loaded);
      setDrafts({ [loaded.ontology]: loaded });
      setNotice("Loaded from the library — no model call. Anchor quotes are shown but not re-verified (paper full text isn't stored).");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }, []);

  // Guards background work: bumped on every new run / reset so a late result
  // from an abandoned paper can't land on the next one.
  const runId = useRef(0);
  // ontology currently being extracted in the background (toggle shows it as pending)
  const [pending, setPending] = useState<OntologyId | null>(null);

  /** Get the graph for `target` of the paper `base` was extracted from — the
   *  GitHub library first, else a fresh extraction from the paper text. Saves
   *  to the library when a token is set. Never touches `model`. */
  const buildOther = useCallback(
    async (target: OntologyId, base: StageModel, onStatus: (m: string) => void): Promise<{ model: StageModel; note: string }> => {
      if (base.meta.textHash) {
        onStatus(`Checking your library for the ${target} graph…`);
        const hit = await findCached(base.meta.textHash, target);
        if (hit) {
          const m = buildStageModel(entryToResponse(await loadEntry(hit.name)));
          return { model: m, note: `Loaded the saved ${target} graph from the library — no model call.` };
        }
      }
      const text = base.meta.extractedText;
      if (!text) throw new Error(`This graph came from the library, so the paper text isn't in the page. Go ← new and upload the paper once to extract the ${target} graph.`);
      if (!apiKey.trim()) throw new Error("Paste your OpenRouter key on the start screen (← new) to extract the other graph.");
      const data = await extractInBrowser({ text, file: null, apiKey, ontology: target }, onStatus);
      data.source = base.meta.source;
      const built = buildStageModel(data);
      let note = `The ${target} graph is ready.`;
      if (ghToken.trim()) {
        try {
          const name = await saveToLibrary(built, ghToken.trim());
          note = `The ${target} graph is ready and saved to the library as ${name}.`;
        } catch (e) {
          note = `The ${target} graph is ready, but not saved: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      return { model: built, note };
    },
    [apiKey, ghToken, saveToLibrary],
  );

  /** One button, both graphs: outcomes first (shown as soon as it lands), then
   *  the discourse graph in the background. */
  const run = useCallback(async (p: RunPayload) => {
    const id = ++runId.current;
    setBusy(true);
    setElapsed(0);
    setError(null);
    setNotice(null);
    setSelection(null);
    setDrafts({});
    setPending(null);
    setProgress("Preparing…");
    let first: StageModel | null = null;
    try {
      const data = await extractInBrowser({ ...p, ontology: "outcomes" }, setProgress, async (hash) => {
        const hit = await findCached(hash, "outcomes");
        if (!hit) return null;
        return entryToResponse(await loadEntry(hit.name));
      });
      first = buildStageModel(data);
      setModel(first);
      setDrafts({ outcomes: first });
      if (!data.fromLibrary && p.ghToken.trim()) {
        setProgress("Saving to the GitHub library…");
        try {
          await saveToLibrary(first, p.ghToken.trim());
        } catch (e) {
          setNotice(`Not saved to the library: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setModel(null);
      setProgress(null);
      setBusy(false);
      return;
    }
    setProgress(null);
    setBusy(false);

    // the other ontology, in the background
    setPending("discourse");
    try {
      const { model: m, note } = await buildOther("discourse", first, (msg) => {
        if (runId.current === id) setNotice(`Outcomes graph ready. Now the discourse graph — ${msg}`);
      });
      if (runId.current !== id) return;
      setDrafts((d) => ({ ...d, discourse: m }));
      setNotice(note);
    } catch (e) {
      if (runId.current === id) setNotice(`Outcomes graph ready. The discourse graph failed: ${e instanceof Error ? e.message : String(e)} — click Discourse to retry.`);
    } finally {
      if (runId.current === id) setPending(null);
    }
  }, [saveToLibrary, buildOther]);

  /** Flip the open paper between its two graphs (edits are kept). If the other
   *  graph doesn't exist yet (a failed background run, or a library load), build it. */
  const switchOntology = useCallback(
    async (target: OntologyId) => {
      if (!model || busy || pending || model.ontology === target) return;
      setSelection(null);
      const have = drafts[target];
      if (have) {
        setModel(have);
        setNotice(null);
        return;
      }
      const id = runId.current;
      setPending(target);
      try {
        const { model: m, note } = await buildOther(target, model, (msg) => setNotice(msg));
        if (runId.current !== id) return;
        setDrafts((d) => ({ ...d, [target]: m }));
        setModel(m);
        setNotice(note);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e)); // the current graph stays open
      } finally {
        if (runId.current === id) setPending(null);
      }
    },
    [model, busy, pending, drafts, buildOther],
  );

  // Draw-to-connect: pick the (only) legal relation for the dragged direction.
  const handleConnect = useCallback((subject: string, object: string) => {
    setModel((prev) => {
      if (!prev) return prev;
      const s = prev.nodes.find((n) => n.id === subject);
      const o = prev.nodes.find((n) => n.id === object);
      if (!s || !o) return prev;
      const legal = legalRelationsForPair(prev.ontology, s.type, o.type);
      if (legal.length === 0) {
        setNotice(`No legal relation from ${s.type} → ${o.type}. Try the other direction.`);
        return prev;
      }
      const id = peekEdgeId(prev);
      setNotice(null);
      setSelection({ kind: "edge", id });
      return ops.addEdge(prev, legal[0], subject, object);
    });
  }, []);

  const download = useCallback(() => {
    if (!model || !validation) return;
    const out = exportGraph(model, validation, new Date().toISOString());
    const saveBlob = (blob: Blob, name: string) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    };
    const saveJson = (obj: unknown, name: string) =>
      saveBlob(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), name);
    if (out.kind === "vault") {
      // outcomes → an Obsidian vault, zipped (one flat folder of .md files)
      const files = out.vault.files.map((f) => ({ name: `${out.slug}_Graph/${f.name}`, content: f.content }));
      saveBlob(new Blob([zipFiles(files)], { type: "application/zip" }), `${out.slug}_Graph.zip`);
      const r = out.vault.report;
      setNotice(
        `Exported ${r.files} Obsidian files (${r.outcomes} outcome, ${r.structuralNodes} nodes, ${r.taggedValues} tagged values)` +
          (r.unplaced.length ? ` — ${r.unplaced.length} unplaced record(s) listed in _Unplaced.md` : "") + ".",
      );
    } else {
      saveJson(out.jsonld, `${out.slug}.mira.jsonld`); // canonical MIRA JSON-LD — the headline artifact
    }
    saveJson(out.graph, `${out.slug}.graph.json`); // working graph (debug artifact)
  }, [model, validation]);

  const reset = useCallback(() => {
    runId.current++;
    setPending(null);
    setModel(null);
    setDrafts({});
    setSelection(null);
    setError(null);
    setNotice(null);
    setProgress(null);
  }, []);

  return (
    <div className="shell">
      <div className="grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      {/* -------------------------------------------- masthead (the viewer's) */}
      <header className="masthead">
        <div className="mark">
          <span className="mark-glyph" aria-hidden="true" />
          <div className="mark-text">
            <h1>MIRA Scope</h1>
            <p>graph extractor · staging viewer</p>
          </div>
        </div>

        <div className="breadcrumb">
          {model ? (
            <>
              staging › <b>{model.meta.source}</b>
              {model.meta.pieces > 1 ? ` · ${model.meta.pieces} pieces` : ""}
            </>
          ) : busy ? (
            "extracting…"
          ) : (
            "no draft — bring a paper"
          )}
        </div>

        <div className="readout">
          <div className="stat">
            <b>{validation ? validation.liveNodeCount : "·"}</b>
            <span>records</span>
          </div>
          <div className="stat">
            <b>{validation ? validation.liveEdgeCount : "·"}</b>
            <span>relations</span>
          </div>
          <div className="stat">
            <b>{model ? `${anchored}/${validation?.liveNodeCount ?? 0}` : "·"}</b>
            <span>anchored</span>
          </div>
          <div className={busy ? "pulse busy" : model ? "pulse ok" : "pulse"}>
            <span className="dot" />
            <span className="pulse-label">{busy ? "extracting" : model ? "draft" : "idle"}</span>
          </div>
        </div>

        <div className="mast-actions">
          {model && (
            <div className="onto-switch" role="radiogroup" aria-label="Graph type for this paper">
              {(["discourse", "outcomes"] as OntologyId[]).map((id) => (
                <button
                  key={id}
                  role="radio"
                  aria-checked={model.ontology === id}
                  className={model.ontology === id ? "active" : ""}
                  disabled={busy || (!!pending && model.ontology !== id)}
                  title={id === "outcomes" ? "Outcome → Solution → Constraint tree" : "Questions, claims, evidence (MIRA)"}
                  onClick={() => switchOntology(id)}
                >
                  {id === "outcomes" ? "Outcomes" : "Discourse"}
                  {pending === id ? " …" : ""}
                </button>
              ))}
            </div>
          )}
          {model && (
            <button className="compose-new" onClick={reset} title="Discard this draft and start over">
              ← new
            </button>
          )}
          {model && (
            <button
              className="compose-new"
              disabled={busy}
              title={ghToken.trim() ? `Save this graph (with your edits) to ${LIBRARY_REPO}` : "Add a GitHub token on the start screen (← new) to save"}
              onClick={async () => {
                if (!ghToken.trim()) {
                  setNotice("To save, go ← new and paste a GitHub token first — it's kept in memory only, so your draft stays here once you reload it from the library.");
                  return;
                }
                try {
                  const name = await saveToLibrary(model, ghToken.trim());
                  setNotice(`Saved to the library as ${name}.`);
                } catch (e) {
                  setNotice(`Not saved: ${e instanceof Error ? e.message : String(e)}`);
                }
              }}
            >
              ↑ Library
            </button>
          )}
          <button
            className="compose-new export-mira"
            disabled={!model || !validation?.publishable}
            onClick={download}
            title={model?.ontology === "outcomes" ? "Download the graph as an Obsidian vault (.zip)" : "Download the graph as canonical MIRA JSON-LD"}
          >
            {model?.ontology === "outcomes" ? "⤓ Vault" : model ? "⤓ MIRA" : "⤓ Export"}
          </button>
        </div>
      </header>

      {/* -------------------------------------------- the graph + overlays */}
      <main>
        {model && validation && (
          <GraphView
            nodes={model.nodes}
            edges={model.edges}
            ontology={model.ontology}
            validation={validation}
            selection={selection}
            onSelect={setSelection}
            onConnect={handleConnect}
          />
        )}

        {/* the staging rail — docked left over the canvas, like the viewer's */}
        {model && validation && (
          <aside className="rail">
            <div className="opp-bar">
              <span className="rb-kind">staging</span>
              <span className="rb-title">review → export</span>
            </div>
            <div className="rail-body">
              <StagePanel
                model={model}
                validation={validation}
                selection={selection}
                update={update}
                onSelect={setSelection}
                onDownload={download}
                onReset={reset}
              />
            </div>
          </aside>
        )}

        {/* the inspector — right slide-in, esc closes */}
        {model && validation && selection && (
          <section className="inspector" data-open="true">
            <button className="inspector-close" onClick={() => setSelection(null)}>
              esc
            </button>
            <Inspector
              selection={selection}
              model={model}
              validation={validation}
              update={update}
              onSelect={setSelection}
            />
          </section>
        )}

        {/* the importer — a centered overlay panel until a draft exists */}
        {!model && (
          <div className="importer-overlay">
            <div className="importer-panel">
              <div className="opp-bar">
                <span className="rb-kind">import</span>
                <span className="rb-title">decompose a paper → graph</span>
              </div>
              <div className="importer-body">
                {busy ? (
                  <div className="imp-status">
                    <div className="placeholder-mark spin">◇</div>
                    <p>{progress ?? "Working…"}</p>
                    <p className="muted tiny">
                      {formatElapsed(elapsed)} elapsed · a whole paper is one model call on the
                      pinned free model (~1–3 min)
                    </p>
                  </div>
                ) : (
                  <>
                    {error && <div className="banner error">{error}</div>}
                    <InputForm
                      busy={busy}
                      onRun={run}
                      apiKey={apiKey}
                      onApiKey={setApiKey}
                      ghToken={ghToken}
                      onGhToken={setGhToken}
                      libraryTick={libraryTick}
                      onOpenLibrary={loadFromLibrary}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {notice && (
          <div className="notice" onClick={() => setNotice(null)}>
            {notice}
          </div>
        )}
      </main>

      {/* -------------------------------------------- the bottom hud strip */}
      <footer className="hud">
        <span>
          staging viewer · click a node or relation to edit · drag dot → dot to draw a relation ·
          esc closes the inspector
        </span>
        <span>mira-scope · nothing is published or signed</span>
      </footer>
    </div>
  );
}
