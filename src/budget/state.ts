/**
 * What Jev receives in Scene 2: the jev-state version of an ad and the choice question.
 * This is the only part that changes between the raw and jev-state variants.
 */
import { type JsonObject, type Pick, band, pick, pipe, project } from "jev-state";
import { ACTIONS, type Action, INSTRUCTIONS, type RawAd, allowedActions, signals } from "./steering.js";

/**
 * Below this confidence, a decision goes to a person instead of being executed.
 * Why the same 0.6 as Scene 1: one review policy for the whole decision layer is easier to trust
 * and to explain than a threshold tuned per scene.
 */
export const MIN_CONFIDENCE = 0.6;

/**
 * The same ad after jev-state: three facts, in the rules' own words.
 * Why: deciding from raw rows means summing up to 14 days of spend and conversions, dividing, and
 * comparing click rates across days. That arithmetic happens here in code; Jev only applies the rules.
 * Everything else (creative, targeting, ids, the daily rows themselves) is dropped.
 */
export function jevState(ad: RawAd): JsonObject {
  const s = signals(ad);
  return project(
    ad,
    {
      // "Enough evidence" exactly as the rules define it.
      evidence: () => (s.enoughEvidence ? "enough" : "not enough yet"),
      // CPA as a multiple of the target, banded at the rules' 0.8 and 1.3 lines. A value exactly on
      // a line gets the higher label, which matches the rules ("1.3 times or more" is above).
      // No conversions gives Infinity, which band() labels "above target".
      cpa: pipe(() => s.cpaRatio, band({ cuts: [0.8, 1.3], labels: ["below target", "on target", "above target"] })),
      fatigue: () => (s.fatigue ? "yes" : "no"),
    },
    { unknown: "drop" },
  ).state;
}

/**
 * The choice question for one ad, listing only the actions its hard limits allow.
 * Why pick(): the options differ per ad (a capped ad can't scale, a protected challenger can't be
 * stopped), and pick() builds the question from that list and maps the answer back.
 */
export function actionQuestion(ad: RawAd): Pick<Action> {
  return pick(INSTRUCTIONS, allowedActions(ad), { label: (a) => a, describe: (a) => ACTIONS[a], none: false });
}
