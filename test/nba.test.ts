/**
 * Tests for Scene 1, with no network and no API key.
 * Why: the benchmark is only meaningful if the grading policy, the hard limits, and the jev-state
 * labels are right. These tests pin every rule, every boundary (7, 14, and 60 days), and the
 * example from Uplane's post, so a later change can't silently move the goalposts.
 */
import { describe, expect, it } from "vitest";
import { NOW, blogExample, makeCases } from "../src/nba/customers.js";
import { ACTIONS, type Action, DAY, type RawCustomer, TARIFF_PAGE, allowedActions, policy, signals } from "../src/nba/journey.js";
import { actionQuestion, jevState } from "../src/nba/state.js";

/** The blog example with one change applied, so each test shows exactly what it varies. */
const customer = (change: (c: RawCustomer) => void = () => {}) => {
  const c = blogExample();
  change(c);
  return c;
};
// A tariff-page visit a given number of days before the decision.
const visit = (daysAgo: number) => ({ type: "page_view" as const, path: TARIFF_PAGE, at: NOW - daysAgo * DAY, sessionId: "s_test" });

describe("the example from Uplane's decision-layer post", () => {
  it("blocks the email and the SMS, and picks coverage proof in paid social", () => {
    const c = blogExample();
    expect(allowedActions(c)).toEqual(["service_handoff", "social_coverage_proof", "wait"]);
    expect(policy(c)).toBe("social_coverage_proof");
  });

  it("projects to the facts the rules need", () => {
    expect(jevState(blogExample())).toEqual({
      tariffVisitsLast7Days: "3 or more times",
      coveragePageLast7Days: "not visited",
      contractRenews: "in 14 to 59 days",
      lastUpgradeOffer: "ignored",
      supportTicket: "none open",
      faultReportedLast7Days: "no",
      fiveGAtAddress: "live",
    });
  });
});

describe("hard limits", () => {
  it("removes email at the weekly cap and without consent", () => {
    expect(allowedActions(customer((c) => (c.sendLog = c.sendLog.slice(0, 1))))).toContain("email_upgrade_offer");
    expect(allowedActions(customer())).not.toContain("email_upgrade_offer");
    expect(allowedActions(customer((c) => { c.sendLog = []; c.consent.email = false; }))).not.toContain("email_upgrade_offer");
  });

  it("counts only emails from the last 7 days toward the cap", () => {
    const c = customer((c) => c.sendLog.forEach((s) => (s.sentAt = NOW - 7 * DAY)));
    expect(signals(c).emailsThisWeek).toBe(0);
    expect(allowedActions(c)).toContain("email_upgrade_offer");
  });

  it("removes SMS and paid social without consent, but always allows service and waiting", () => {
    const c = customer((c) => (c.consent = { email: false, sms: false, ads: false }));
    expect(allowedActions(c)).toEqual(["service_handoff", "wait"]);
  });

  it("only offers Jev the allowed actions", () => {
    const q = actionQuestion(blogExample());
    expect(q.ids).toEqual(["service_handoff", "social_coverage_proof", "wait"]);
    expect(Object.keys(q.question.criteria)).toEqual(q.ids);
  });
});

describe("policy, first matching rule", () => {
  const cases: [string, (c: RawCustomer) => void, Action][] = [
    ["an open ticket goes to service", (c) => (c.tickets[0]!.status = "open"), "service_handoff"],
    ["a fault reported in the last 7 days goes to service, even if closed", (c) => { c.tickets[0]!.openedAt = NOW - 6.9 * DAY; }, "service_handoff"],
    ["a fault exactly 7 days ago is not recent", (c) => { c.tickets[0]!.openedAt = NOW - 7 * DAY; }, "social_coverage_proof"],
    ["low interest and a distant renewal waits", (c) => { c.events = [visit(1)]; c.contract.renewsAt = NOW + 60 * DAY; }, "wait"],
    ["low interest but renewal under 60 days does not wait", (c) => { c.events = [visit(1)]; c.contract.renewsAt = NOW + 59.9 * DAY; }, "social_coverage_proof"],
    ["visits older than 7 days don't count as interest", (c) => { c.events = [visit(1), visit(7), visit(9)]; c.contract.renewsAt = NOW + 90 * DAY; }, "wait"],
    ["without 5G or a coverage visit, paid social still wins as the last contact allowed (rule 6)", (c) => { c.network.fiveGLiveAtAddress = false; }, "social_coverage_proof"],
    ["without 5G or a coverage visit, an allowed email wins over paid social", (c) => { c.network.fiveGLiveAtAddress = false; c.sendLog = c.sendLog.slice(0, 1); }, "email_upgrade_offer"],
    ["an opened offer with email room sends the email", (c) => { c.sendLog = [{ channel: "email", campaign: "upgrade_offer", sentAt: NOW - 10 * DAY, opened: true }]; }, "email_upgrade_offer"],
    ["no offer yet and email room sends the email", (c) => { c.sendLog = []; }, "email_upgrade_offer"],
    ["email blocked, SMS allowed, renewal under 14 days sends SMS", (c) => { c.consent = { email: false, sms: true, ads: true }; c.sendLog = []; c.contract.renewsAt = NOW + 13.9 * DAY; }, "sms_reminder"],
    ["SMS needs renewal under 14 days", (c) => { c.consent = { email: false, sms: true, ads: true }; c.sendLog = []; c.contract.renewsAt = NOW + 14 * DAY; }, "social_coverage_proof"],
    ["nothing allowed but service and waiting waits", (c) => { c.consent = { email: false, sms: false, ads: false }; }, "wait"],
  ];
  for (const [name, change, expected] of cases) {
    it(name, () => expect(policy(customer(change))).toBe(expected));
  }
});

describe("generated customers", () => {
  const cases = makeCases();

  it("are deterministic and balanced across actions", () => {
    expect(JSON.stringify(makeCases())).toBe(JSON.stringify(cases));
    for (const action of Object.keys(ACTIONS)) {
      expect(cases.filter((c) => c.expected === action)).toHaveLength(12);
    }
  });

  it("always expect an action the hard limits allow", () => {
    for (const c of cases) expect(allowedActions(c.raw)).toContain(c.expected);
  });

  it("project to labels that agree with the policy's own numbers", () => {
    for (const { raw } of cases) {
      const s = signals(raw);
      const state = jevState(raw);
      const visits = s.tariffVisits === 0 ? "none" : s.tariffVisits === 1 ? "once" : s.tariffVisits === 2 ? "twice" : "3 or more times";
      const renews = s.daysToRenewal < 14 ? "in less than 14 days" : s.daysToRenewal < 60 ? "in 14 to 59 days" : "in 60 days or more";
      expect(state.tariffVisitsLast7Days).toBe(visits);
      expect(state.contractRenews).toBe(renews);
      expect(state.lastUpgradeOffer).toBe(s.lastOffer === "none" ? "none sent" : s.lastOffer);
      expect(state.supportTicket).toBe(s.openTicket ? "open" : "none open");
      expect(state.faultReportedLast7Days).toBe(s.recentFault ? "yes" : "no");
    }
  });

  it("drop identifiers, device, tracking, and logs from the jev-state version", () => {
    const keys = Object.keys(jevState(cases[0]!.raw));
    for (const raw of ["customerId", "now", "events", "sendLog", "tickets", "device", "utm", "internal", "consent"]) {
      expect(keys).not.toContain(raw);
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
