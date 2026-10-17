/**
 * Budget steering: for one ad variant, decide what to do with its money.
 *
 * Why this scene: steering ad budget in real time toward what performs is Uplane's core product.
 * Their post "From asset production to a continuous learning system" adds two ideas used here:
 * decision rules are fixed before launch, and an explore budget protects new challengers so
 * learning doesn't stop.
 *
 * This file holds the business side: the actions, the hard limits enforced in code, and the
 * policy used to grade Jev's answers. Nothing here calls Jev.
 */

/**
 * The four actions and the description Jev reads for each.
 * Why `hold` covers two cases: "not enough data yet" and "nothing needs to change" both mean
 * leaving the budget alone, and a separate action for each would only add a way to be wrong.
 */
export const ACTIONS = {
  scale: "Raise this ad's daily budget.",
  hold: "Keep the budget as it is.",
  pause: "Pause this ad; it can be restarted later.",
  retire: "Stop this ad for good and replace its creative.",
} as const;

/** One of the action ids above. */
export type Action = keyof typeof ACTIONS;

/**
 * Impressions a new "explore" ad gets before it may be paused or retired.
 * Why: if every challenger is cut after a weak first day, nothing new ever gets a fair test and
 * performance quietly decays. The post calls this protecting the explore budget.
 */
export const PLANNED_EXPLORE_IMPRESSIONS = 5_000;

/**
 * One ad variant the way an ad platform's reporting API returns it: settings, creative and
 * targeting details, and one row of numbers per day.
 * Why so much: the benchmark sends this as the "raw" version, so it has to look like a real export.
 * A type alias, not an interface, so TypeScript accepts it as the SDK's JSON state type.
 */
export type RawAd = {
  adId: string;
  campaignId: string;
  channel: "meta" | "google" | "tiktok";
  /** "explore" ads test a new idea; "exploit" ads carry proven spend. */
  bucket: "explore" | "exploit";
  status: "active";
  currency: "USD";
  dailyBudget: number;
  /** The most this ad may spend per day, set by the account owner. */
  maxDailyBudget: number;
  /** What one conversion may cost, set before launch. */
  targetCpa: number;
  /** One row per day since launch, oldest first. */
  daily: { date: string; impressions: number; clicks: number; spend: number; conversions: number }[];
  creative: { headline: string; format: "image" | "video" | "carousel"; assetUrl: string };
  targeting: { geo: string[]; ageMin: number; ageMax: number; interests: string[] };
  internal: { accountId: string; pixelId: string; lastSyncedAt: string };
};

/** Click rate over a set of days: total clicks divided by total impressions. */
function clickRate(days: RawAd["daily"]): number {
  const impressions = days.reduce((a, d) => a + d.impressions, 0);
  return impressions === 0 ? 0 : days.reduce((a, d) => a + d.clicks, 0) / impressions;
}

/**
 * The facts the rules depend on, computed in plain code from the daily rows.
 * Why: summing rows, dividing spend by conversions, and comparing click rates across days is
 * arithmetic, exactly what Jev is weak at, so the grading policy never relies on a model for it.
 * The tests also use this as the source of truth for the jev-state labels.
 */
export function signals(ad: RawAd) {
  const days = ad.daily.length;
  const spend = ad.daily.reduce((a, d) => a + d.spend, 0);
  const conversions = ad.daily.reduce((a, d) => a + d.conversions, 0);
  const impressions = ad.daily.reduce((a, d) => a + d.impressions, 0);
  // No conversions after spending means cost per conversion is unbounded: treat it as infinitely high.
  const cpaRatio = conversions === 0 ? Infinity : spend / conversions / ad.targetCpa;
  // Fatigue compares the first 3 days with the last 3, so it needs 6 days to avoid overlap.
  const first = clickRate(ad.daily.slice(0, 3));
  const last = clickRate(ad.daily.slice(-3));
  return {
    days,
    spend,
    conversions,
    impressions,
    cpaRatio,
    // Enough evidence: at least 3 days and at least twice the target CPA spent.
    enoughEvidence: days >= 3 && spend >= 2 * ad.targetCpa,
    cpa: cpaRatio >= 1.3 ? "above target" : cpaRatio < 0.8 ? "below target" : "on target",
    // Fatigue: the last 3 days' click rate is more than 30% below the first 3 days'.
    fatigue: days >= 6 && first > 0 && last / first < 0.7,
  } as const;
}

/**
 * The hard limits: the daily budget cap and the protected explore budget. Blocked actions are
 * removed before Jev sees the question.
 * Why in code and not in the prompt: an option the model never sees cannot be chosen. A budget
 * cap is money the account owner never agreed to spend, so it must not depend on a model.
 */
export function allowedActions(ad: RawAd): Action[] {
  const s = signals(ad);
  const allowed: Action[] = [];
  if (ad.dailyBudget < ad.maxDailyBudget) allowed.push("scale");
  allowed.push("hold");
  // A protected challenger can't be stopped before its planned exposure.
  if (!(ad.bucket === "explore" && s.impressions < PLANNED_EXPLORE_IMPRESSIONS)) allowed.push("pause", "retire");
  return allowed;
}

/**
 * The rules Jev is given. The raw and jev-state versions get the exact same text.
 * Why named definitions from the start: Scene 1's dev set showed Jev often half-matches a rule
 * with two conditions joined by "and"/"or", and follows single named facts well.
 */
export const INSTRUCTIONS = `You steer the daily budget of one ad. Choose what to do with it.
Every listed option is already permitted by the budget cap and the explore-budget protection. Only choose a listed option.
Definitions:
- CPA is spend divided by conversions over all days. With spend but no conversions, CPA is above target.
- CPA is above target at 1.3 times the target CPA or more, below target under 0.8 times the target, and otherwise on target.
- Evidence is enough when the ad has run at least 3 days and has spent at least twice the target CPA.
- Fatigue is yes when the ad has run at least 6 days and its click rate over the last 3 days is more than 30% below its click rate over the first 3 days.
The rules are in priority order. Apply the FIRST rule that matches and ignore all later rules:
1. hold: evidence is not enough yet.
2. pause: if listed, CPA is above target.
3. retire: if listed, fatigue is yes.
4. scale: if listed, CPA is below target.
5. hold.`;

/**
 * The correct answer by the rules, written in code. It mirrors INSTRUCTIONS line by line.
 * Why: every Jev answer is graded against this, so accuracy numbers are measured, not judged.
 */
export function policy(ad: RawAd): Action {
  const s = signals(ad);
  const allowed = new Set(allowedActions(ad));
  // 1. Two days of data is noise; don't act on it.
  if (!s.enoughEvidence) return "hold";
  // 2. Losing money on every conversion: stop the bleeding first.
  if (allowed.has("pause") && s.cpa === "above target") return "pause";
  // 3. Still fine but wearing out: replace it before results drop. Checked before scaling,
  //    so a cheap but tiring ad is not given more money.
  if (allowed.has("retire") && s.fatigue) return "retire";
  // 4. Cheap and healthy: give it more budget.
  if (allowed.has("scale") && s.cpa === "below target") return "scale";
  // 5. Nothing to change.
  return "hold";
}
