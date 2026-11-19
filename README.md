# MIRA Scope

Turn a research paper into a **reviewable graph**, in whichever ontology you need:

| ontology | what it maps | output |
|---|---|---|
| **Discourse graph** | Questions, Claims, Evidence, Studies, Protocols, Source Documents, Requests (the [MIRA](https://www.mira.science/) schema, which builds on [Discourse Graphs](https://discoursegraphs.com/)) | canonical MIRA JSON-LD |
| **Outcomes graph** | An Outcome pursued by Solutions, blocked by Constraints, unblocked by deeper Solutions, with open questions, evidence, requirements, competitors and tactics attached (the DSV method) | an Obsidian vault (one flat folder of `.md` files) |

```
PDF / .txt / .md ──▶ pinned free LLM ──▶ classified graph ──▶ review & edit ──▶ JSON-LD  (discourse)
                       (prompt chosen by                                    └▶ vault.zip (outcomes)
                        the active ontology)
```

It is a *draft generator for human review*: it publishes nothing, signs nothing, and talks to no network except the LLM.

## Credit and provenance

This project is derived from **[MIRA-science/MIRA-extraction](https://github.com/MIRA-science/MIRA-extraction)**, built by [SciOS](https://scios.tech) as the extraction engine of [RRGI](https://graph.scios.tech) and contributed to the MIRA community. The pipeline (single whole-paper call, verbatim anchors, report-never-drop classification, transport watchdogs, the staging web editor) is theirs. The discourse prompt and MIRA JSON-LD projection are carried over unchanged. See [`UPSTREAM.md`](UPSTREAM.md) for the licence status.

What this repo adds:

- `src/ontology.ts` — ontologies as data (node classes + legal relations); everything downstream reads the active one.
- `src/prompt-outcomes.ts` — the outcomes-graph extraction prompt.
- `src/to-obsidian-outcomes.ts` — renders an outcomes graph as an Obsidian vault (tab-indented recursive trees, root + node files, `#question #EVD #req #comp #tactic` tags, `_Unplaced.md` for anything that can't be placed).
- A **Graph type** toggle in the web UI, an `--ontology` flag in the CLI, and ontology-aware validation/editing/export.

## Install

Requires Node ≥ 18.18.

```bash
npm install
cp .env.example .env      # put your OpenRouter key in .env (https://openrouter.ai/keys)
```

## Web UI

```bash
cd web
npm install
cp .env.local.example .env.local   # same OpenRouter key
npm run dev                         # http://localhost:3030
```

Choose **Discourse graph** or **Outcomes graph**, paste or upload a paper, extract, review/edit the draft (every record carries a verbatim anchor quote that is checked against the source), then export: `⤓ MIRA` (JSON-LD) or `⤓ Vault` (zip you open in Obsidian).

## CLI

```bash
npm run extract -- paper.pdf                         # discourse graph → paper.mira.jsonld
npm run extract -- paper.pdf --ontology outcomes     # outcomes graph → paper_Graph/ (Obsidian vault)
```

Flags: `--ontology discourse|outcomes` · `--slug name` · `--creator name` · `--model id` · `--out dir`. Each run also writes `<name>.graph.json` (working graph + report).

## Library

```ts
import { decompose } from "./src/index.ts";
const res = await decompose({ file: "paper.pdf" }, { apiKey, ontology: "outcomes" });
res.vault?.files;   // [{ name, content }] — the Obsidian files
res.jsonld;         // discourse runs only
res.nodes; res.edges; res.dropped;
```

## The outcomes ontology

Structural nodes (each gets its own file): `Outcome`, `Solution`, `HypothesizedSolution`, `Constraint`, `HypothesizedConstraint`.
Tagged values (a line, no file): `Question` `#question`, `Evidence` `#EVD`, `Requirement` `#req`, `Competitor` `#comp`, `Tactic` `#tactic`.
Relations point child → parent: `pursues` (Solution → Outcome), `blocks` (Constraint → Solution), `resolves` (Solution → Constraint), `annotates` (tagged value → any structural node).

## Honest limitations

- An LLM can be wrong or fabricate a number or citation. Review the output; the anchor quotes exist so each record can be checked.
- The two ontologies are extracted in **separate passes**, not translated into each other: an outcomes graph is a recursive hierarchy, a discourse graph is a network of claims and evidence, and the structures do not map one-to-one.
- The outcomes prompt is new and has had little corpus time — compare it against graphs you've scoped by hand before trusting it.
- Multi-column PDFs extract weakly (pdf.js gives positioned fragments); clean `.txt`/`.md` works best.
- Papers over 400K characters are refused, not split.

## Test

```bash
npm test            # offline: parsing, grammar, merge, JSON-LD projection, outcomes vault, zip
npm run typecheck
cd web && npx next build
```
