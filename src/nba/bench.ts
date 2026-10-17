/**
 * Benchmark for Scene 1 (next best action), using the shared runner in ../benchmark.ts.
 *
 *   npm run nba:bench -- --seed 7 --per-action 6 --reruns 2           # dev set: tune here only
 *   npm run nba:bench -- --seed 42 --per-action 12 --reruns 3 --save  # test set: measure once
 *
 * Why two seeds: if the state design were tuned on the same customers it is scored on, the numbers
 * would flatter it. The design is improved on the dev seed, then measured once on the test seed.
 */
import { runBenchmark } from "../benchmark.js";
import { makeCases } from "./customers.js";
import { MIN_CONFIDENCE, actionQuestion, jevState } from "./state.js";

await runBenchmark({
  name: "nba",
  title: "Scene 1 benchmark: next best action",
  unit: "customers",
  makeCases: (perAction, seed) => makeCases(perAction, seed).map((c) => ({ id: c.raw.customerId, raw: c.raw, expected: c.expected })),
  rawState: (raw) => raw,
  jevState,
  question: actionQuestion,
  minConfidence: MIN_CONFIDENCE,
  perAction: 12,
});
