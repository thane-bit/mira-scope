"use client";

import { useRef, useState } from "react";
import { useEffect } from "react";
import { ONTOLOGIES, type OntologyId } from "../../src/ontology.ts";
import { listLibrary, LIBRARY_REPO, type LibraryItem } from "../lib/library.ts";

export interface RunPayload {
  text: string;
  file: File | null;
  apiKey: string;
  ontology: OntologyId;
  ghToken: string;
}

export default function InputForm({
  busy,
  onRun,
  ghToken,
  onGhToken,
  libraryTick,
  onOpenLibrary,
}: {
  busy: boolean;
  onRun: (p: RunPayload) => void;
  ghToken: string;
  onGhToken: (t: string) => void;
  libraryTick: number;
  onOpenLibrary: (name: string) => void;
}) {
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const [libraryErr, setLibraryErr] = useState(false);
  useEffect(() => {
    let live = true;
    listLibrary()
      .then((items) => live && (setLibrary(items), setLibraryErr(false)))
      .catch(() => live && setLibraryErr(true));
    return () => {
      live = false;
    };
  }, [libraryTick]);
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [ontology, setOntology] = useState<OntologyId>("discourse");
  const fileRef = useRef<HTMLInputElement>(null);

  const canRun = !busy && apiKey.trim().length > 0 && (mode === "paste" ? text.trim().length > 0 : !!file);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onRun({ text, file, apiKey, ontology, ghToken });
      }}
    >
      <div className="field">
        <span>Graph type</span>
        <div className="tabs" role="radiogroup" aria-label="Graph type">
          {(Object.keys(ONTOLOGIES) as OntologyId[]).map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={ontology === id}
              className={ontology === id ? "tab active" : "tab"}
              onClick={() => setOntology(id)}
            >
              {ONTOLOGIES[id].label}
            </button>
          ))}
        </div>
        <span className="muted tiny">{ONTOLOGIES[ontology].blurb}</span>
      </div>

      <div className="tabs">
        <button type="button" className={mode === "paste" ? "tab active" : "tab"} onClick={() => setMode("paste")}>
          Paste text
        </button>
        <button type="button" className={mode === "upload" ? "tab active" : "tab"} onClick={() => setMode("upload")}>
          Upload file
        </button>
      </div>

      {mode === "paste" ? (
        <textarea
          className="textarea"
          placeholder="Paste the paper's text here (abstract + body works best)…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      ) : (
        <div className="dropzone" onClick={() => fileRef.current?.click()}>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <span className="file-pill">{file.name} <em>({Math.round(file.size / 1024)} KB)</em></span>
          ) : (
            <span className="muted">Click to choose a <b>.pdf</b>, <b>.txt</b>, or <b>.md</b></span>
          )}
        </div>
      )}

      <label className="field">
        <span>Your OpenRouter API key <em className="req">required</em></span>
        <input
          type="password"
          placeholder="sk-or-…  (free at openrouter.ai/keys)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="off"
        />
        <span className="muted tiny">
          Runs entirely in your browser. The key and paper go straight to OpenRouter — this site has no server and stores nothing.
        </span>
      </label>

      <label className="field">
        <span>GitHub token — to save every extraction to your library <em className="muted">(optional)</em></span>
        <input
          type="password"
          placeholder="github_pat_…  (fine-grained: this repo only, Contents read & write)"
          value={ghToken}
          onChange={(e) => onGhToken(e.target.value)}
          autoComplete="off"
        />
        <span className="muted tiny">
          Kept in memory only and sent only to api.github.com. Without it the site still works; graphs just aren&apos;t saved. Saved graphs are public in {LIBRARY_REPO}.
        </span>
      </label>

      <button className="run" type="submit" disabled={!canRun}>
        {busy ? "Extracting…" : `Extract ${ontology === "outcomes" ? "outcomes" : "discourse"} graph`}
      </button>
      <div className="field">
        <span>Saved library {library ? `(${library.length})` : ""}</span>
        {libraryErr ? (
          <span className="muted tiny">Library unavailable right now (GitHub rate limit?). Try again in a minute.</span>
        ) : library === null ? (
          <span className="muted tiny">Loading…</span>
        ) : library.length === 0 ? (
          <span className="muted tiny">Nothing saved yet. Extract a paper with a GitHub token and it will appear here.</span>
        ) : (
          <div className="lib-list">
            {library.map((it) => (
              <button key={it.name} type="button" className="tab lib-item" disabled={busy} onClick={() => onOpenLibrary(it.name)} title={it.name}>
                <span>{it.slug.replace(/-/g, " ")}</span>
                <em>{it.ontology === "outcomes" ? "outcomes" : "discourse"}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="muted tiny">Pinned free model · one call per paper · draft for review · nothing is published or signed.</p>
    </form>
  );
}
