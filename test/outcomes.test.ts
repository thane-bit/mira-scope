/**
 * Offline tests for the outcomes ontology: grammar, vault rendering, zip.
 *   npm test
 */
import assert from "node:assert/strict";
import { classifyGraph, type RawGraph } from "../src/grammar.ts";
import { OUTCOMES, DISCOURSE, legalRelations } from "../src/ontology.ts";
import { toObsidianOutcomes } from "../src/to-obsidian-outcomes.ts";
import { zipFiles } from "../src/zip.ts";

let n = 0;
const section = (s: string) => console.log(`\n[outcomes ${++n}] ${s}`);

const raw: RawGraph = {
  nodes: [
    { id: "o1", type: "Outcome", text: "SSBs reach $100/kWh at GWh scale enabling EV cost parity" },
    { id: "s1", type: "Solution", text: "Electrochemical synthesis achieves 99.9% purity at room temperature", description: "At ambient conditions, side reactions drop below 0.1%." },
    { id: "k1", type: "Constraint", text: "Catalyst degrades within 48h under continuous operation" },
    { id: "h1", type: "HypothesizedSolution", text: "Encapsulating catalyst in MOF shell extends lifetime to 200h" },
    { id: "ev1", type: "Evidence", text: "Lab tests show 180-220h range" },
    { id: "q1", type: "Question", text: "Is the MOF synthesis cost acceptable at industrial scale?" },
    { id: "t1", type: "Tactic", text: "Benchmark MOF suppliers" },
    { id: "bad", type: "Claim", text: "a discourse class is illegal here" },
    { id: "orph", type: "Constraint", text: "Nothing connects this constraint upward" },
  ],
  edges: [
    { relation: "pursues", subject: "s1", object: "o1" },
    { relation: "blocks", subject: "k1", object: "s1" },
    { relation: "resolves", subject: "h1", object: "k1" },
    { relation: "annotates", subject: "ev1", object: "h1" },
    { relation: "annotates", subject: "q1", object: "h1" },
    { relation: "annotates", subject: "t1", object: "h1" },
    { relation: "supports", subject: "ev1", object: "h1" }, // discourse relation → ungrammatical here
    { relation: "blocks", subject: "o1", object: "s1" }, // wrong endpoints
  ],
};

section("grammar is ontology-scoped");
const g = classifyGraph(raw, OUTCOMES);
assert.equal(g.dropped.nodes.length, 1, "the discourse-only class is dropped");
assert.equal(g.dropped.ungrammaticalEdges.length, 2, "foreign relation + wrong endpoints reported");
assert.equal(g.edges.length, 6);
assert.deepEqual(legalRelations(OUTCOMES, "Constraint", "Solution"), ["blocks"]);
assert.deepEqual(legalRelations(DISCOURSE, "Constraint", "Solution"), []);
console.log("  ok");

section("vault: files, tabs, leading space, tags");
const v = toObsidianOutcomes({ nodes: g.nodes, edges: g.edges });
const names = v.files.map((f) => f.name);
assert.ok(names.some((x) => x.startsWith("_Outcome - ")), "root file");
assert.ok(names.includes("Sol - Electrochemical synthesis achieves 99.9% purity at room temperature.md"));
assert.ok(names.includes("Con - Catalyst degrades within 48h under continuous operation.md"));
assert.ok(names.includes("HSol - Encapsulating catalyst in MOF shell extends lifetime to 200h.md"));
assert.ok(names.includes("_Unplaced.md"), "orphan is reported in a file, not lost");
assert.equal(v.report.unplaced.length, 1);
const root = v.files.find((f) => f.name.startsWith("_Outcome - "))!.content.split("\n");
assert.equal(root[0], "---");
assert.equal(root[4], " [[Outcome: SSBs reach $100/kWh at GWh scale enabling EV cost parity]]", "exactly one leading space");
assert.equal(root[5], "\t[[Sol - Electrochemical synthesis achieves 99.9% purity at room temperature]]");
assert.equal(root[6], "\t\tAt ambient conditions, side reactions drop below 0.1%.");
assert.equal(root[7], "\t\t[[Con - Catalyst degrades within 48h under continuous operation]]");
assert.equal(root[8], "\t\t\t[[HSol - Encapsulating catalyst in MOF shell extends lifetime to 200h]]");
assert.ok(root.includes("\t\t\t\tLab tests show 180-220h range #EVD"));
assert.ok(root.includes("\t\t\t\tIs the MOF synthesis cost acceptable at industrial scale? #question"));
assert.ok(root.includes("\t\t\t\tBenchmark MOF suppliers #tactic"));
assert.ok(!root.some((l) => /^\s*- /.test(l)), "no bullet syntax in the hierarchy");
const node = v.files.find((f) => f.name.startsWith("Con - "))!.content.split("\n");
assert.equal(node[0], "[[Con - Catalyst degrades within 48h under continuous operation]]", "node files start at column 0");
assert.equal(node[1], "\t[[HSol - Encapsulating catalyst in MOF shell extends lifetime to 200h]]");
assert.equal(v.report.taggedValues, 3);
console.log("  ok");

section("vault: cycles and illegal filename characters");
const cyc = toObsidianOutcomes({
  nodes: [
    { id: "o", type: "Outcome", text: "Goal: ship <it>/fast" },
    { id: "a", type: "Solution", text: "A works" },
    { id: "b", type: "Constraint", text: "B blocks A" },
  ],
  edges: [
    { relation: "pursues", subject: "a", object: "o" },
    { relation: "blocks", subject: "b", object: "a" },
    { relation: "resolves", subject: "a", object: "b" }, // a ↔ b cycle
  ],
});
assert.ok(cyc.report.cyclesSkipped >= 1, "cycle skipped, no infinite recursion");
assert.ok(cyc.files.every((f) => !/[<>:"/\\|?*]/.test(f.name)), "illegal filename chars replaced");
console.log("  ok");

section("zip writer produces a valid archive header/footer");
const z = zipFiles([{ name: "a.md", content: "hello" }]);
assert.equal(z[0], 0x50);
assert.equal(z[1], 0x4b);
assert.equal(z[z.length - 22], 0x50, "end-of-central-directory record");
console.log("  ok");

console.log("\nall outcomes tests passed");
