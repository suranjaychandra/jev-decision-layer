/**
 * Tests for Scene 2, with no network and no API key.
 * Why: the benchmark is only meaningful if the grading policy, the hard limits, and the jev-state
 * labels are right. These tests pin every rule, every boundary (3 days, 2x target spend, 0.8 and
 * 1.3 times target, 30% fatigue, 5,000 planned impressions), and the six worked examples.
 */
import { describe, expect, it } from "vitest";
import { dailyRows, exampleAds, makeCases } from "../src/budget/ads.js";
import { ACTIONS, PLANNED_EXPLORE_IMPRESSIONS, type RawAd, allowedActions, blockedActions, policy, signals } from "../src/budget/steering.js";
import { actionQuestion, jevState } from "../src/budget/state.js";

const examples = exampleAds();
/** Example D (the star ad) with one change applied, so each test shows exactly what it varies. */
const star = (change: (ad: RawAd) => void = () => {}) => {
  const ad = structuredClone(examples.find((e) => e.name.startsWith("D"))!.ad);
  change(ad);
  return ad;
};
// Daily rows with steady clicks, for tests that only vary spend and conversions.
const rows = (days: number, spend: number, conversions: number, ctrEnd = 0.02) =>
  dailyRows({ days, spend, conversions, impressionsPerDay: 2000, ctrStart: 0.02, ctrEnd });

describe("the six worked examples", () => {
  for (const { name, ad, expected } of examples) {
    it(`${name} → ${expected}`, () => expect(policy(ad)).toBe(expected));
  }

  it("have rows that add up exactly to the numbers in their story", () => {
    const c = signals(examples.find((e) => e.name.startsWith("C"))!.ad);
    expect([c.days, c.spend, c.conversions]).toEqual([12, 900, 30]);
    const b = signals(examples.find((e) => e.name.startsWith("B"))!.ad);
    expect(b.spend / b.conversions).toBe(60);
  });

  it("project to the facts the rules need", () => {
    expect(examples.map((e) => jevState(e.ad))).toEqual([
      { evidence: "not enough yet", cpa: "on target", fatigue: "no" },
      { evidence: "enough", cpa: "above target", fatigue: "no" },
      { evidence: "enough", cpa: "below target", fatigue: "yes" },
      { evidence: "enough", cpa: "below target", fatigue: "no" },
      { evidence: "enough", cpa: "below target", fatigue: "no" },
      { evidence: "enough", cpa: "above target", fatigue: "no" },
    ]);
  });
});

describe("hard limits", () => {
  it("remove scale at the budget cap", () => {
    expect(allowedActions(star())).toContain("scale");
    expect(allowedActions(star((ad) => (ad.dailyBudget = ad.maxDailyBudget)))).not.toContain("scale");
  });

  it("protect an explore ad from pause and retire until its planned impressions", () => {
    const explore = (impressionsPerDay: number) => star((ad) => {
      ad.bucket = "explore";
      ad.daily = dailyRows({ days: 5, spend: 200, conversions: 2, impressionsPerDay, ctrStart: 0.02, ctrEnd: 0.02 });
    });
    expect(allowedActions(explore(PLANNED_EXPLORE_IMPRESSIONS / 5 - 1))).toEqual(["scale", "hold"]);
    expect(allowedActions(explore(PLANNED_EXPLORE_IMPRESSIONS / 5))).toEqual(["scale", "hold", "pause", "retire"]);
  });

  it("say why each action was removed", () => {
    expect(blockedActions(examples.find((e) => e.name.startsWith("E"))!.ad)).toEqual([{ action: "scale", reason: "daily budget already at its $500 cap" }]);
    expect(blockedActions(examples.find((e) => e.name.startsWith("F"))!.ad).map((b) => b.reason)).toEqual([
      "protected explore ad: 3,000 of 5,000 planned impressions",
      "protected explore ad: 3,000 of 5,000 planned impressions",
    ]);
  });

  it("only offer Jev the allowed actions", () => {
    const q = actionQuestion(examples.find((e) => e.name.startsWith("E"))!.ad);
    expect(q.ids).toEqual(["hold", "pause", "retire"]);
  });
});

describe("policy boundaries", () => {
  it("needs 3 days and twice the target CPA spent before acting", () => {
    expect(policy(star((ad) => (ad.daily = rows(2, 700, 25))))).toBe("hold");
    expect(policy(star((ad) => (ad.daily = rows(3, 79.99, 3))))).toBe("hold");
    expect(policy(star((ad) => (ad.daily = rows(3, 80, 3))))).toBe("scale");
  });

  it("puts exactly 1.3 times the target above target and exactly 0.8 on target", () => {
    expect(signals(star((ad) => (ad.daily = rows(5, 520, 10)))).cpa).toBe("above target"); // $52 = 1.3x
    expect(signals(star((ad) => (ad.daily = rows(5, 519, 10)))).cpa).toBe("on target");
    expect(signals(star((ad) => (ad.daily = rows(5, 320, 10)))).cpa).toBe("on target"); // $32 = 0.8x
    expect(signals(star((ad) => (ad.daily = rows(5, 319, 10)))).cpa).toBe("below target");
  });

  it("treats spend with no conversions as above target", () => {
    const ad = star((ad) => (ad.daily = rows(5, 300, 0)));
    expect(signals(ad).cpa).toBe("above target");
    expect(jevState(ad).cpa).toBe("above target");
    expect(policy(ad)).toBe("pause");
  });

  it("needs 6 days and a drop of more than 30% for fatigue", () => {
    expect(signals(star((ad) => (ad.daily = rows(5, 300, 10, 0.005)))).fatigue).toBe(false);
    expect(signals(star((ad) => (ad.daily = rows(6, 300, 10, 0.005)))).fatigue).toBe(true);
    expect(signals(star((ad) => (ad.daily = rows(12, 300, 10, 0.016)))).fatigue).toBe(false);
  });

  it("pauses before retiring, and retires before scaling", () => {
    expect(policy(star((ad) => (ad.daily = rows(12, 900, 10, 0.01))))).toBe("pause");
    expect(policy(star((ad) => (ad.daily = rows(12, 300, 10, 0.01))))).toBe("retire");
  });
});

describe("generated ads", () => {
  const cases = makeCases();

  it("are deterministic and balanced across actions", () => {
    expect(JSON.stringify(makeCases())).toBe(JSON.stringify(cases));
    for (const action of Object.keys(ACTIONS)) expect(cases.filter((c) => c.expected === action)).toHaveLength(12);
  });

  it("always expect an action the hard limits allow", () => {
    for (const c of cases) expect(allowedActions(c.raw)).toContain(c.expected);
  });

  it("project to labels that agree with the policy's own numbers", () => {
    for (const { raw } of cases) {
      const s = signals(raw);
      expect(jevState(raw)).toEqual({ evidence: s.enoughEvidence ? "enough" : "not enough yet", cpa: s.cpa, fatigue: s.fatigue ? "yes" : "no" });
    }
  });

  it("include hard-limit cases, so the limits are exercised", () => {
    expect(cases.some((c) => !allowedActions(c.raw).includes("scale"))).toBe(true);
    expect(cases.some((c) => !allowedActions(c.raw).includes("pause"))).toBe(true);
  });

  it("explain every removed action: allowed and blocked together cover each action once", () => {
    for (const { raw } of cases) {
      const all = [...allowedActions(raw), ...blockedActions(raw).map((b) => b.action)].sort();
      expect(all).toEqual(Object.keys(ACTIONS).sort());
    }
  });

  it("are not changed by projection", () => {
    const raw = cases[0]!.raw;
    const before = structuredClone(raw);
    jevState(raw);
    actionQuestion(raw);
    expect(raw).toEqual(before);
  });
});
