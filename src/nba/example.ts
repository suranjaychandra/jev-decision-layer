/**
 * Record Jev's answers for the example from Uplane's post: 3 runs × raw and jev-state = 6 calls.
 *
 *   npm run nba:example
 *
 * Why separately: the benchmark grades generated customers only, so its numbers are not affected
 * by a hand-made case. The dashboard opens on the post's example, and shows these recorded answers.
 */
import { writeFileSync } from "node:fs";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { blogExample } from "./customers.js";
import { policy } from "./journey.js";
import { actionQuestion, jevState } from "./state.js";

const raw = blogExample();
const q = actionQuestion(raw);
const client = new TypeSafeClient();
const runs: { variant: string; run: number; got: string; confidence: number; inputTokens: number }[] = [];
let model = "";

for (let run = 0; run < 3; run++) {
  for (const [variant, state] of [["raw", raw], ["jev-state", jevState(raw)]] as const) {
    const res = await client.systemOne({ state, questions: { action: q.question } });
    model ||= res.model;
    runs.push({ variant, run, got: res.answers.action.choice, confidence: res.answers.action.confidence, inputTokens: res.usage.input_tokens });
    console.log(`run ${run + 1}  ${variant.padEnd(9)} ${res.answers.action.choice.padEnd(21)} ${res.answers.action.confidence.toFixed(2)}`);
  }
}

const date = new Date().toISOString().slice(0, 10);
writeFileSync("results/nba-example.json", `${JSON.stringify({ date, model, id: raw.customerId, expected: policy(raw), runs }, null, 2)}\n`);
console.log("\nSaved results/nba-example.json");
