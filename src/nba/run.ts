/**
 * Ask Jev for the next best action, once with the raw customer record and once with jev-state.
 *
 *   npm run nba -- --dry              # print what would be sent; no API calls
 *   npm run nba -- --limit 5          # the blog example + 4 generated customers, both variants
 */
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { blogExample, makeCases, summary } from "./customers.js";
import { policy } from "./journey.js";
import { MIN_CONFIDENCE, actionQuestion, jevState } from "./state.js";

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : 5;
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit needs a positive whole number");

const cases = [{ raw: blogExample(), expected: policy(blogExample()) }, ...makeCases()].slice(0, limit);
const variants = { raw: (c: (typeof cases)[number]) => c.raw, "jev-state": (c: (typeof cases)[number]) => jevState(c.raw) };

if (dry) {
  for (const c of cases) {
    const q = actionQuestion(c.raw);
    console.log(`\n${c.raw.customerId}: ${summary(c.raw)}`);
    console.log(`  options: ${q.ids.join(", ")}  ·  expected: ${c.expected}`);
    console.log(`  raw state: ${JSON.stringify(c.raw).length} chars`);
    console.log(`  jev-state: ${JSON.stringify(jevState(c.raw))}`);
  }
  console.log(`\nDry run: ${cases.length} customers × 2 variants = ${cases.length * 2} calls would be made.`);
  process.exit(0);
}

const client = new TypeSafeClient();
let model = "";
const tally = { raw: { correct: 0, review: 0, tokens: 0 }, "jev-state": { correct: 0, review: 0, tokens: 0 } };

for (const c of cases) {
  const q = actionQuestion(c.raw);
  console.log(`\n${c.raw.customerId}: ${summary(c.raw)}  ·  expected ${c.expected}`);
  for (const [name, build] of Object.entries(variants) as [keyof typeof variants, (typeof variants)["raw"]][]) {
    const t0 = performance.now();
    const res = await client.systemOne({ state: build(c), questions: { action: q.question } });
    const ms = performance.now() - t0;
    model ||= res.model;
    const answer = res.answers.action;
    const action = q.resolve(answer, { minConfidence: MIN_CONFIDENCE });
    const t = tally[name];
    t.tokens += res.usage.input_tokens;
    if (answer.choice === c.expected) t.correct++;
    if (action === null) t.review++;
    const verdict = answer.choice === c.expected ? "correct" : "WRONG";
    const route = action === null ? "  → human review" : "";
    console.log(`  ${name.padEnd(9)} ${answer.choice.padEnd(21)} ${answer.confidence.toFixed(2)}  ${String(res.usage.input_tokens).padStart(5)} tok  ${ms.toFixed(0).padStart(4)} ms  ${verdict}${route}`);
  }
}

console.log(`\n${cases.length} customers, model ${model}:`);
for (const [name, t] of Object.entries(tally)) {
  console.log(`  ${name.padEnd(9)} ${t.correct}/${cases.length} correct, ${t.review} sent to human review, ${t.tokens} input tokens`);
}
const total = tally.raw.tokens + tally["jev-state"].tokens;
console.log(`  total ${total} input tokens, about $${((total / 1e6) * 0.042).toFixed(5)}`);
