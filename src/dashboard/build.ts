/**
 * Build docs/data.json for the dashboard from the saved benchmark results.
 *
 *   npm run dashboard:build
 *
 * Why a build step: the dashboard is a static page, so it can run on GitHub Pages with no server,
 * no API key, and no cost. Everything it shows is computed here from the same code the benchmark
 * used: the raw and jev-state versions, the allowed and blocked actions, and Jev's recorded answers.
 * Nothing is re-asked; the page replays what Jev actually answered.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import * as ads from "../budget/ads.js";
import { blockedActions as blockedForAd } from "../budget/steering.js";
import * as budgetState from "../budget/state.js";
import { blogExample, makeCases as makeCustomers, summary as customerSummary } from "../nba/customers.js";
import { blockedActions as blockedForCustomer, policy } from "../nba/journey.js";
import * as nbaState from "../nba/state.js";

/** One recorded answer from a results file. */
type Answer = { got: string; confidence: number };
/** The parts of a saved results file the dashboard reads. */
type Saved = {
  date: string;
  model: string;
  seed: number;
  perAction: number;
  reruns: number;
  summary: Record<string, unknown>;
  results: { id: string; variant: string; run: number; got?: string; confidence?: number }[];
};

/** Read a saved results file. Why fail loudly: a dashboard without its data would show nothing useful. */
function load(path: string): Saved {
  if (!existsSync(path)) throw new Error(`${path} is missing. Run the test-set benchmark with --save first.`);
  return JSON.parse(readFileSync(path, "utf8")) as Saved;
}

/** Group recorded answers by case and variant, in run order. */
function answersById(saved: Saved): Map<string, Record<string, Answer[]>> {
  const out = new Map<string, Record<string, Answer[]>>();
  for (const r of [...saved.results].sort((a, b) => a.run - b.run)) {
    if (r.got === undefined) continue;
    const entry = out.get(r.id) ?? { raw: [], "jev-state": [] };
    entry[r.variant]!.push({ got: r.got, confidence: r.confidence! });
    out.set(r.id, entry);
  }
  return out;
}

/** The facts about one benchmark run that the page prints, so every number is traceable. */
const meta = (saved: Saved) => ({ date: saved.date, model: saved.model, seed: saved.seed, perAction: saved.perAction, reruns: saved.reruns });

// Scene 1: generated customers from the test set, plus the post's example first if it was recorded.
const nbaSaved = load("results/nba.json");
const nbaAnswers = answersById(nbaSaved);
const nbaCases = makeCustomers(nbaSaved.perAction, nbaSaved.seed).map((c) => ({
  id: c.raw.customerId,
  summary: customerSummary(c.raw),
  expected: c.expected,
  options: nbaState.actionQuestion(c.raw).ids,
  blocked: blockedForCustomer(c.raw),
  raw: c.raw,
  jev: nbaState.jevState(c.raw),
  answers: nbaAnswers.get(c.raw.customerId)!,
}));
if (existsSync("results/nba-example.json")) {
  const ex = JSON.parse(readFileSync("results/nba-example.json", "utf8")) as { runs: (Answer & { variant: string })[] };
  const raw = blogExample();
  nbaCases.unshift({
    id: raw.customerId,
    summary: `The example from Uplane's post. ${customerSummary(raw)}`,
    expected: policy(raw),
    options: nbaState.actionQuestion(raw).ids,
    blocked: blockedForCustomer(raw),
    raw,
    jev: nbaState.jevState(raw),
    answers: {
      raw: ex.runs.filter((r) => r.variant === "raw").map(({ got, confidence }) => ({ got, confidence })),
      "jev-state": ex.runs.filter((r) => r.variant === "jev-state").map(({ got, confidence }) => ({ got, confidence })),
    },
  });
}

// Scene 2: generated ads from the test set.
const budgetSaved = load("results/budget.json");
const budgetAnswers = answersById(budgetSaved);
const budgetCases = ads.makeCases(budgetSaved.perAction, budgetSaved.seed).map((c) => ({
  id: c.raw.adId,
  summary: ads.summary(c.raw),
  expected: c.expected,
  options: budgetState.actionQuestion(c.raw).ids,
  blocked: blockedForAd(c.raw),
  raw: c.raw,
  jev: budgetState.jevState(c.raw),
  answers: budgetAnswers.get(c.raw.adId)!,
}));

const data = {
  scenes: [
    { key: "nba", title: "Next best action", unit: "customers", minConfidence: nbaState.MIN_CONFIDENCE, run: meta(nbaSaved), summary: nbaSaved.summary, cases: nbaCases },
    { key: "budget", title: "Budget steering", unit: "ads", minConfidence: budgetState.MIN_CONFIDENCE, run: meta(budgetSaved), summary: budgetSaved.summary, cases: budgetCases },
  ],
};

writeFileSync("docs/data.json", `${JSON.stringify(data)}\n`);
console.log(`Wrote docs/data.json: ${nbaCases.length} customers, ${budgetCases.length} ads.`);
