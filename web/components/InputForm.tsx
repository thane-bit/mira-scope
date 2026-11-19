"use client";

import { useRef, useState } from "react";
import { ONTOLOGIES, type OntologyId } from "../../src/ontology.ts";

export interface RunPayload {
  text: string;
  file: File | null;
  apiKey: string;
  ontology: OntologyId;
}

export default function InputForm({
  busy,
  onRun,
}: {
  busy: boolean;
  onRun: (p: RunPayload) => void;
}) {
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [ontology, setOntology] = useState<OntologyId>("discourse");
  const fileRef = useRef<HTMLInputElement>(null);

  const canRun = !busy && (mode === "paste" ? text.trim().length > 0 : !!file);

  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canRun) onRun({ text, file, apiKey, ontology });
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

      <details className="advanced">
        <summary>Options</summary>
        <label className="field">
          <span>OpenRouter API key (optional)</span>
          <input
            type="password"
            placeholder="sk-or-…  (else uses server's OPENROUTER_API_KEY)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
          />
        </label>
      </details>

      <button className="run" type="submit" disabled={!canRun}>
        {busy ? "Extracting…" : `Extract ${ontology === "outcomes" ? "outcomes" : "discourse"} graph`}
      </button>
      <p className="muted tiny">Pinned free model · one call per paper · draft for review · nothing is published or signed.</p>
    </form>
  );
}
