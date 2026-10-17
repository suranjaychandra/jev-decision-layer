/**
 * Benchmark for Scene 2 (budget steering), using the shared runner in ../benchmark.ts.
 *
 *   npm run budget:bench -- --dry                                 # what would be sent; no calls
 *   npm run budget:bench -- --seed 7 --per-action 6 --reruns 2   # dev set: tune here only
 *   npm run budget:bench -- --seed 42 --reruns 3 --save          # test set: measure once
 */
import { runBenchmark } from "../benchmark.js";
import { makeCases } from "./ads.js";
import { MIN_CONFIDENCE, actionQuestion, jevState } from "./state.js";

await runBenchmark({
  name: "budget",
  title: "Scene 2 benchmark: budget steering",
  unit: "ads",
  makeCases: (perAction, seed) => makeCases(perAction, seed).map((c) => ({ id: c.raw.adId, raw: c.raw, expected: c.expected })),
  rawState: (raw) => raw,
  jevState,
  question: actionQuestion,
  minConfidence: MIN_CONFIDENCE,
  perAction: 12,
});
