/**
 * Benchmark for Scene 1: every customer, raw and jev-state, several reruns, graded by the policy.
 *
 *   npm run nba:bench -- --seed 7 --per-action 4 --reruns 1           # dev set: tune here only
 *   npm run nba:bench -- --seed 42 --per-action 12 --reruns 3 --save  # test set: measure once
 *
 * Why two seeds: if the state design were tuned on the same customers it is scored on, the numbers
 * would flatter it. The design is improved on the dev seed, then measured once on the test seed.
 *
 * Why these metrics: accuracy alone hides what matters for a decision layer in production, so it
 * also reports how often decisions go to human review, and how many wrong decisions would have
 * been executed automatically (wrong, and above the confidence threshold).
 */
import { writeFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { type Case, makeCases } from "./customers.js";
import { MIN_CONFIDENCE, actionQuestion, jevState } from "./state.js";

/** Read `--name value` from the command line, with a default. */
function arg(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} needs a whole number`);
  return value;
}

const SEED = arg("seed", 7);
const PER_ACTION = arg("per-action", 4);
const RERUNS = arg("reruns", 1);
const SAVE = process.argv.includes("--save");
// Parallel requests: fast enough, and far below Jev's rate limit (~1,200 requests a minute).
const CONCURRENCY = 8;

const VARIANTS = {
  raw: (c: Case) => c.raw,
  "jev-state": (c: Case) => jevState(c.raw),
} as const;
type Variant = keyof typeof VARIANTS;

/** One Jev call and how it went. Errors are recorded, not thrown, so one failure can't stop a run. */
interface Result {
  customer: string;
  variant: Variant;
  run: number;
  expected: string;
  got?: string;
  confidence?: number;
  inputTokens?: number;
  latencyMs?: number;
  error?: string;
}

const cases = makeCases(PER_ACTION, SEED);
const calls = cases.length * 2 * RERUNS;
console.log(`Seed ${SEED}: ${cases.length} customers × 2 variants × ${RERUNS} runs = ${calls} Jev calls.`);

const client = new TypeSafeClient();
let model = "";

// Build every call as a job first, then run them through a small pool.
const jobs: (() => Promise<Result>)[] = [];
for (const c of cases) {
  const q = actionQuestion(c.raw);
  for (const variant of Object.keys(VARIANTS) as Variant[]) {
    for (let run = 0; run < RERUNS; run++) {
      jobs.push(async () => {
        const base = { customer: c.raw.customerId, variant, run, expected: c.expected };
        const t0 = performance.now();
        try {
          const res = await client.systemOne({ state: VARIANTS[variant](c), questions: { action: q.question } });
          model ||= res.model;
          return {
            ...base,
            got: res.answers.action.choice,
            confidence: res.answers.action.confidence,
            inputTokens: res.usage.input_tokens,
            latencyMs: performance.now() - t0,
          };
        } catch (err) {
          return { ...base, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
        }
      });
    }
  }
}

/** Run jobs with at most `limit` in flight, keeping results in job order. */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

const results = await pool(jobs, CONCURRENCY);

/** Nearest-rank quantile, for latency percentiles. */
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
};

/** All the numbers for one variant. */
function summarize(variant: Variant) {
  const rs = results.filter((r) => r.variant === variant);
  const ok = rs.filter((r) => r.error === undefined);
  const correct = ok.filter((r) => r.got === r.expected);
  const executed = ok.filter((r) => r.confidence! >= MIN_CONFIDENCE);
  // A customer is unstable if its reruns didn't all give the same answer.
  const unstable = cases.filter((c) => new Set(ok.filter((r) => r.customer === c.raw.customerId).map((r) => r.got)).size > 1);
  const perAction: Record<string, number> = {};
  for (const action of new Set(cases.map((c) => c.expected))) {
    const these = ok.filter((r) => r.expected === action);
    perAction[action] = these.filter((r) => r.got === r.expected).length / (these.length || 1);
  }
  return {
    calls: rs.length,
    errors: rs.length - ok.length,
    accuracy: correct.length / (ok.length || 1),
    humanReviewRate: (ok.length - executed.length) / (ok.length || 1),
    wrongExecuted: executed.filter((r) => r.got !== r.expected).length,
    executedAccuracy: executed.filter((r) => r.got === r.expected).length / (executed.length || 1),
    unstableCustomers: RERUNS > 1 ? unstable.length : null,
    avgInputTokens: ok.reduce((a, r) => a + r.inputTokens!, 0) / (ok.length || 1),
    p50LatencyMs: quantile(ok.map((r) => r.latencyMs!), 0.5),
    p95LatencyMs: quantile(ok.map((r) => r.latencyMs!), 0.95),
    perAction,
  };
}

const summary = { raw: summarize("raw"), "jev-state": summarize("jev-state") };
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const totalTokens = results.reduce((a, r) => a + (r.inputTokens ?? 0), 0);

// A side-by-side table: the format used in the README.
const rows: [string, (s: ReturnType<typeof summarize>) => string][] = [
  ["Accuracy", (s) => pct(s.accuracy)],
  [`Sent to human review (confidence < ${MIN_CONFIDENCE})`, (s) => pct(s.humanReviewRate)],
  ["Wrong decisions executed automatically", (s) => String(s.wrongExecuted)],
  ["Accuracy of executed decisions", (s) => pct(s.executedAccuracy)],
  ["Customers whose answer changed across reruns", (s) => (s.unstableCustomers === null ? "n/a" : `${s.unstableCustomers}/${cases.length}`)],
  ["Avg input tokens", (s) => s.avgInputTokens.toFixed(0)],
  ["p50 / p95 latency", (s) => `${s.p50LatencyMs.toFixed(0)} / ${s.p95LatencyMs.toFixed(0)} ms`],
  ["Errors", (s) => String(s.errors)],
];
const table = [
  "| | Raw | jev-state |",
  "|---|---|---|",
  ...rows.map(([label, f]) => `| ${label} | ${f(summary.raw)} | ${f(summary["jev-state"])} |`),
].join("\n");
const perActionTable = [
  "| Expected action | Raw | jev-state |",
  "|---|---|---|",
  ...Object.keys(summary.raw.perAction).map((a) => `| ${a} | ${pct(summary.raw.perAction[a]!)} | ${pct(summary["jev-state"].perAction[a]!)} |`),
].join("\n");

console.log(`\nModel ${model}, ${calls} calls, ${totalTokens.toLocaleString("en-US")} input tokens (about $${((totalTokens / 1e6) * 0.042).toFixed(4)}).\n`);
console.log(table);
console.log(`\n${perActionTable}`);

// Every run is kept locally for inspecting mistakes (git-ignored; dev runs are never published).
writeFileSync("results/last-run.json", `${JSON.stringify({ seed: SEED, perAction: PER_ACTION, reruns: RERUNS, results }, null, 2)}\n`);

// Only the test-set run is saved for publishing, so the published numbers come from one untuned measurement.
if (SAVE) {
  const date = new Date().toISOString().slice(0, 10);
  writeFileSync("results/nba.json", `${JSON.stringify({ date, model, seed: SEED, perAction: PER_ACTION, reruns: RERUNS, summary, results }, null, 2)}\n`);
  writeFileSync(
    "results/nba.md",
    `# Scene 1 benchmark: next best action\n\nModel \`${model}\`, ${date}. Seed ${SEED}: ${cases.length} customers (${PER_ACTION} per action) × 2 variants × ${RERUNS} runs = ${calls} calls, ${totalTokens.toLocaleString("en-US")} input tokens (about $${((totalTokens / 1e6) * 0.042).toFixed(4)}).\n\n${table}\n\n${perActionTable}\n`,
  );
  console.log("\nSaved results/nba.json and results/nba.md");
}
