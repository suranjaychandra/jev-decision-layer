/**
 * The benchmark runner both scenes share: every case, raw and jev-state, several reruns, each
 * answer graded against the scene's policy.
 *
 * Why shared: both scenes must be measured the same way, with the same metrics and the same
 * dev/test discipline, so a comparison between them is fair and a fix applies to both.
 *
 * Why these metrics: accuracy alone hides what matters for a decision layer in production, so it
 * also reports how often decisions go to human review, and how many wrong decisions would have
 * been executed automatically (wrong, and above the confidence threshold).
 *
 * Command-line options (each scene's bench script passes them through):
 *   --seed N          which generated set: 7 is the dev set (tune here), 42 is the test set
 *   --per-action N    cases per expected action
 *   --reruns N        calls per case and variant, to measure stability
 *   --dry             print what would be sent and the call count; no API calls
 *   --save            write results/<scene>.json and .md (only for the test-set run)
 */
import { writeFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { JsonObject, Pick } from "jev-state";

/** One graded case: an id for logs, the raw record, and the correct answer by the policy. */
export interface BenchCase<R> {
  id: string;
  raw: R;
  expected: string;
}

/** What a scene provides; everything else is common. */
export interface Scene<R> {
  /** File name for saved results, e.g. "nba". */
  name: string;
  /** Heading for the saved Markdown. */
  title: string;
  /** What one case is, for messages: "customers", "ads". */
  unit: string;
  /** Deterministic, balanced cases for a seed. */
  makeCases(perAction: number, seed: number): BenchCase<R>[];
  /** The raw record as Jev receives it. Usually the record itself. */
  rawState(raw: R): JsonObject;
  /** The same record after jev-state. */
  jevState(raw: R): JsonObject;
  /** The choice question for one case, with only the actions its hard limits allow. */
  question(raw: R): Pick<string>;
  /** Below this confidence, a decision goes to human review. */
  minConfidence: number;
  /** Default cases per action for this scene. */
  perAction: number;
}

/** One Jev call and how it went. Errors are recorded, not thrown, so one failure can't stop a run. */
interface Result {
  id: string;
  variant: Variant;
  run: number;
  expected: string;
  got?: string;
  confidence?: number;
  inputTokens?: number;
  latencyMs?: number;
  error?: string;
}

type Variant = "raw" | "jev-state";
const VARIANTS: Variant[] = ["raw", "jev-state"];
// Parallel requests: fast enough, and far below Jev's rate limit (~1,200 requests a minute).
const CONCURRENCY = 8;

/** Read `--name value` from the command line, with a default. */
function arg(name: string, fallback: number): number {
  const at = process.argv.indexOf(`--${name}`);
  const value = at >= 0 ? Number(process.argv[at + 1]) : fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} needs a whole number`);
  return value;
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

/** Nearest-rank quantile, for latency percentiles. */
function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] ?? 0;
}

/** Run a scene's benchmark from the command line. */
export async function runBenchmark<R>(scene: Scene<R>): Promise<void> {
  const seed = arg("seed", 7);
  const perAction = arg("per-action", scene.perAction);
  const reruns = arg("reruns", 1);
  const save = process.argv.includes("--save");
  const dry = process.argv.includes("--dry");

  const cases = scene.makeCases(perAction, seed);
  const build: Record<Variant, (c: BenchCase<R>) => JsonObject> = {
    raw: (c) => scene.rawState(c.raw),
    "jev-state": (c) => scene.jevState(c.raw),
  };
  const calls = cases.length * VARIANTS.length * reruns;
  console.log(`Seed ${seed}: ${cases.length} ${scene.unit} × 2 variants × ${reruns} runs = ${calls} Jev calls.`);

  // Dry run: show what would be sent for a few cases, with no API calls and no key needed.
  if (dry) {
    for (const c of cases.slice(0, 5)) {
      console.log(`\n${c.id}: expected ${c.expected}  ·  options: ${scene.question(c.raw).ids.join(", ")}`);
      console.log(`  raw state: ${JSON.stringify(build.raw(c)).length} chars`);
      console.log(`  jev-state: ${JSON.stringify(build["jev-state"](c))}`);
    }
    return;
  }

  const client = new TypeSafeClient();
  let model = "";

  // Build every call as a job first, then run them through a small pool.
  const jobs: (() => Promise<Result>)[] = [];
  for (const c of cases) {
    const q = scene.question(c.raw);
    for (const variant of VARIANTS) {
      for (let run = 0; run < reruns; run++) {
        jobs.push(async () => {
          const base = { id: c.id, variant, run, expected: c.expected };
          const t0 = performance.now();
          try {
            const res = await client.systemOne({ state: build[variant](c), questions: { action: q.question } });
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
  const results = await pool(jobs, CONCURRENCY);

  /** All the numbers for one variant. */
  const summarize = (variant: Variant) => {
    const rs = results.filter((r) => r.variant === variant);
    const ok = rs.filter((r) => r.error === undefined);
    const executed = ok.filter((r) => r.confidence! >= scene.minConfidence);
    // A case is unstable if its reruns didn't all give the same answer.
    const unstable = cases.filter((c) => new Set(ok.filter((r) => r.id === c.id).map((r) => r.got)).size > 1);
    const perActionAccuracy: Record<string, number> = {};
    for (const action of new Set(cases.map((c) => c.expected))) {
      const these = ok.filter((r) => r.expected === action);
      perActionAccuracy[action] = these.filter((r) => r.got === r.expected).length / (these.length || 1);
    }
    return {
      calls: rs.length,
      errors: rs.length - ok.length,
      accuracy: ok.filter((r) => r.got === r.expected).length / (ok.length || 1),
      humanReviewRate: (ok.length - executed.length) / (ok.length || 1),
      wrongExecuted: executed.filter((r) => r.got !== r.expected).length,
      executedAccuracy: executed.filter((r) => r.got === r.expected).length / (executed.length || 1),
      unstableCases: reruns > 1 ? unstable.length : null,
      avgInputTokens: ok.reduce((a, r) => a + r.inputTokens!, 0) / (ok.length || 1),
      p50LatencyMs: quantile(ok.map((r) => r.latencyMs!), 0.5),
      p95LatencyMs: quantile(ok.map((r) => r.latencyMs!), 0.95),
      perAction: perActionAccuracy,
    };
  };

  const summary = { raw: summarize("raw"), "jev-state": summarize("jev-state") };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const totalTokens = results.reduce((a, r) => a + (r.inputTokens ?? 0), 0);

  // A side-by-side table: the format used in the README.
  type Summary = ReturnType<typeof summarize>;
  const rows: [string, (s: Summary) => string][] = [
    ["Accuracy", (s) => pct(s.accuracy)],
    [`Sent to human review (confidence < ${scene.minConfidence})`, (s) => pct(s.humanReviewRate)],
    ["Wrong decisions executed automatically", (s) => String(s.wrongExecuted)],
    ["Accuracy of executed decisions", (s) => pct(s.executedAccuracy)],
    [`${scene.unit[0]!.toUpperCase()}${scene.unit.slice(1)} whose answer changed across reruns`, (s) => (s.unstableCases === null ? "n/a" : `${s.unstableCases}/${cases.length}`)],
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
  const cost = `$${((totalTokens / 1e6) * 0.042).toFixed(4)}`;

  console.log(`\nModel ${model}, ${calls} calls, ${totalTokens.toLocaleString("en-US")} input tokens (about ${cost}).\n`);
  console.log(table);
  console.log(`\n${perActionTable}`);

  // Every run is kept locally for inspecting mistakes (git-ignored; dev runs are never published).
  writeFileSync("results/last-run.json", `${JSON.stringify({ scene: scene.name, seed, perAction, reruns, results }, null, 2)}\n`);

  // Only the test-set run is saved for publishing, so the published numbers come from one untuned measurement.
  if (save) {
    const date = new Date().toISOString().slice(0, 10);
    writeFileSync(`results/${scene.name}.json`, `${JSON.stringify({ date, model, seed, perAction, reruns, summary, results }, null, 2)}\n`);
    writeFileSync(
      `results/${scene.name}.md`,
      `# ${scene.title}\n\nModel \`${model}\`, ${date}. Seed ${seed}: ${cases.length} ${scene.unit} (${perAction} per action) × 2 variants × ${reruns} runs = ${calls} calls, ${totalTokens.toLocaleString("en-US")} input tokens (about ${cost}).\n\n${table}\n\n${perActionTable}\n`,
    );
    console.log(`\nSaved results/${scene.name}.json and results/${scene.name}.md`);
  }
}
