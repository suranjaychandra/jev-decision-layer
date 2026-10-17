/**
 * The ads Scene 2 runs on: six hand-made examples that walk through every rule, plus seeded
 * synthetic ads for the benchmark.
 * Why synthetic: no real ad account is needed or used, and anyone can reproduce the results.
 */
import { mulberry32, randomTools } from "../rng.js";
import { ACTIONS, type Action, type RawAd, policy, signals } from "./steering.js";

/** The last reporting day in every case. A fixed date keeps every run identical. */
const LAST_DAY = Date.UTC(2026, 9, 12);
const DAY = 24 * 60 * 60 * 1000;

/** What one ad's daily rows should add up to; `dailyRows()` spreads it over the days. */
interface Shape {
  days: number;
  spend: number;
  conversions: number;
  impressionsPerDay: number;
  /** Click rate on the first day and on the last day; days in between move in a straight line. */
  ctrStart: number;
  ctrEnd: number;
}

/**
 * Daily report rows that add up exactly to a shape's totals.
 * Why exact: the examples are used to explain the rules, so "$900 spent, 30 conversions" must be
 * literally true of the rows, not approximately.
 */
export function dailyRows(shape: Shape): RawAd["daily"] {
  const rows: RawAd["daily"] = [];
  let conversionsLeft = shape.conversions;
  for (let i = 0; i < shape.days; i++) {
    const t = shape.days === 1 ? 0 : i / (shape.days - 1);
    const ctr = shape.ctrStart + (shape.ctrEnd - shape.ctrStart) * t;
    // Spread conversions as evenly as whole numbers allow; the last day takes the remainder.
    const conversions = i === shape.days - 1 ? conversionsLeft : Math.floor(shape.conversions / shape.days);
    conversionsLeft -= conversions;
    rows.push({
      date: new Date(LAST_DAY - (shape.days - 1 - i) * DAY).toISOString().slice(0, 10),
      impressions: shape.impressionsPerDay,
      clicks: Math.round(shape.impressionsPerDay * ctr),
      spend: Math.round((shape.spend / shape.days) * 100) / 100,
      conversions,
    });
  }
  // Put any rounding difference in the last day so total spend is exact.
  const diff = Math.round((shape.spend - rows.reduce((a, r) => a + r.spend, 0)) * 100) / 100;
  rows[rows.length - 1]!.spend = Math.round((rows[rows.length - 1]!.spend + diff) * 100) / 100;
  return rows;
}

/** The fields every example shares, so each example only states what makes it different. */
function exampleAd(adId: string, fields: Partial<RawAd> & { daily: RawAd["daily"] }): RawAd {
  return {
    adId,
    campaignId: "cmp_fall_sneakers",
    channel: "meta",
    bucket: "exploit",
    status: "active",
    currency: "USD",
    dailyBudget: 90,
    maxDailyBudget: 500,
    targetCpa: 40,
    creative: { headline: "Run lighter this fall", format: "image", assetUrl: "https://cdn.example.com/ads/sneaker-01.jpg" },
    targeting: { geo: ["US"], ageMin: 18, ageMax: 44, interests: ["running", "fitness"] },
    internal: { accountId: "act_118204", pixelId: "px_99231", lastSyncedAt: "2026-10-12T23:55:00Z" },
    ...fields,
  };
}

/**
 * Six ads that walk through every rule, with a $40 target CPA. They match the explanation in the
 * README, so anyone can check one by hand.
 */
export function exampleAds(): { name: string; ad: RawAd; expected: Action }[] {
  const steady = { impressionsPerDay: 2000, ctrStart: 0.02, ctrEnd: 0.02 };
  return [
    // A: two days old. Too little data to act on.
    { name: "A: new ad", expected: "hold", ad: exampleAd("ad_a", { daily: dailyRows({ ...steady, days: 2, spend: 80, conversions: 2 }) }) },
    // B: $1,200 for 20 conversions is $60 each, 1.5 times the target.
    { name: "B: expensive ad", expected: "pause", ad: exampleAd("ad_b", { daily: dailyRows({ ...steady, days: 10, spend: 1200, conversions: 20, ctrStart: 0.018, ctrEnd: 0.018 }) }) },
    // C: cheap at $30 a conversion, but click rate fell from 2.0% to 1.2%. Fatigue beats scaling.
    { name: "C: tiring ad", expected: "retire", ad: exampleAd("ad_c", { daily: dailyRows({ ...steady, days: 12, spend: 900, conversions: 30, ctrStart: 0.02, ctrEnd: 0.012 }) }) },
    // D: $28 a conversion, 0.7 times the target, steady clicks.
    { name: "D: star ad", expected: "scale", ad: exampleAd("ad_d", { daily: dailyRows({ ...steady, days: 8, spend: 700, conversions: 25, ctrStart: 0.022, ctrEnd: 0.022 }) }) },
    // E: the same numbers as D, but the budget is already at its cap, so scaling is removed.
    { name: "E: star ad at its budget cap", expected: "hold", ad: exampleAd("ad_e", { dailyBudget: 500, daily: dailyRows({ ...steady, days: 8, spend: 700, conversions: 25, ctrStart: 0.022, ctrEnd: 0.022 }) }) },
    // F: an explore ad at 3,000 of its 5,000 planned impressions. Expensive so far, but protected.
    { name: "F: protected challenger", expected: "hold", ad: exampleAd("ad_f", { bucket: "explore", daily: dailyRows({ days: 4, spend: 200, conversions: 2, impressionsPerDay: 750, ctrStart: 0.015, ctrEnd: 0.015 }) }) },
  ];
}

/**
 * One random but realistic ad.
 * Why the noise (creative, targeting, ids, uneven daily numbers): real reporting exports look like
 * this, and the benchmark measures how well Jev handles it raw versus after jev-state.
 */
function randomAd(rnd: () => number, n: number): RawAd {
  const { int, between, chance, one } = randomTools(rnd);
  const days = int(1, 14);
  const targetCpa = one([25, 40, 60, 90]);
  const dailyBudget = int(4, 60) * 5;
  // About 15% of ads already sit at their budget cap.
  const maxDailyBudget = chance(0.15) ? dailyBudget : dailyBudget * one([2, 3, 4]);
  const baseImpressions = int(300, 3000);
  const ctrStart = between(0.006, 0.03);
  // About a third of ads wear out: their click rate ends 35–65% of where it started.
  const ctrEnd = ctrStart * (chance(0.35) ? between(0.35, 0.65) : between(0.8, 1.1));
  // How expensive conversions really are compared with the target; a few ads never convert.
  const cpaRatio = chance(0.08) ? Infinity : between(0.4, 2.2);

  const daily: RawAd["daily"] = [];
  for (let i = 0; i < days; i++) {
    const t = days === 1 ? 0 : i / (days - 1);
    const impressions = Math.round(baseImpressions * between(0.85, 1.15));
    const spend = Math.round(dailyBudget * between(0.85, 1) * 100) / 100;
    const expected = cpaRatio === Infinity ? 0 : spend / (targetCpa * cpaRatio);
    daily.push({
      date: new Date(LAST_DAY - (days - 1 - i) * DAY).toISOString().slice(0, 10),
      impressions,
      clicks: Math.round(impressions * (ctrStart + (ctrEnd - ctrStart) * t) * between(0.9, 1.1)),
      spend,
      // Whole conversions per day, rounded up or down at random so totals land near the true rate.
      conversions: Math.floor(expected + rnd()),
    });
  }

  return {
    adId: `ad_${String(n).padStart(4, "0")}`,
    campaignId: one(["cmp_fall_sneakers", "cmp_trail_launch", "cmp_retarget_q4"]),
    channel: one(["meta", "google", "tiktok"] as const),
    bucket: chance(0.35) ? "explore" : "exploit",
    status: "active",
    currency: "USD",
    dailyBudget,
    maxDailyBudget,
    targetCpa,
    daily,
    creative: {
      headline: one(["Run lighter this fall", "Built for the trail", "Your new daily pair", "Free returns, always"]),
      format: one(["image", "video", "carousel"] as const),
      assetUrl: `https://cdn.example.com/ads/creative-${int(100, 999)}.jpg`,
    },
    targeting: { geo: [one(["US", "CA", "GB"])], ageMin: one([18, 25]), ageMax: one([34, 44, 54]), interests: [one(["running", "hiking", "fitness", "fashion"])] },
    internal: { accountId: `act_${int(100000, 999999)}`, pixelId: `px_${int(10000, 99999)}`, lastSyncedAt: "2026-10-12T23:55:00Z" },
  };
}

/** One test case: the raw ad and the correct action by the policy. */
export interface Case {
  raw: RawAd;
  expected: Action;
}

/**
 * `perAction` ads for each action, deterministic for a given seed.
 * Why balanced: random ads are mostly "hold", and a model that always held would look accurate.
 * Equal counts per action make accuracy honest. Seed 7 is the dev set, seed 42 the test set.
 */
export function makeCases(perAction = 12, seed = 42): Case[] {
  const rnd = mulberry32(seed);
  const want = Object.fromEntries(Object.keys(ACTIONS).map((a) => [a, perAction])) as Record<Action, number>;
  const out: Case[] = [];
  for (let n = 1; out.length < perAction * Object.keys(ACTIONS).length; n++) {
    if (n > 100_000) throw new Error("makeCases() could not balance the actions");
    const raw = randomAd(rnd, n);
    const expected = policy(raw);
    if (want[expected] > 0) {
      want[expected]--;
      out.push({ raw, expected });
    }
  }
  return out;
}

/** A one-line human summary of an ad, so the dashboard and logs are readable without the raw rows. */
export function summary(ad: RawAd): string {
  const s = signals(ad);
  const money = (x: number) => `$${x.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const ctr = (days: RawAd["daily"]) => {
    const imp = days.reduce((a, d) => a + d.impressions, 0);
    return `${((days.reduce((a, d) => a + d.clicks, 0) / (imp || 1)) * 100).toFixed(1)}%`;
  };
  const cpa = s.conversions === 0 ? "no conversions" : `${money(s.spend / s.conversions)} each`;
  return `${s.days} days, ${money(s.spend)} spent, ${s.conversions} conversions (${cpa}, target ${money(ad.targetCpa)}), click rate ${ctr(ad.daily.slice(0, 3))} → ${ctr(ad.daily.slice(-3))}, ${ad.bucket}`;
}

