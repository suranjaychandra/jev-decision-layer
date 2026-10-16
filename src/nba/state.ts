/**
 * What Jev receives: the jev-state version of a customer and the choice question.
 * This is the only part that changes between the raw and jev-state variants.
 */
import { type Pick, band, pick, pipe, project } from "jev-state";
import { ACTIONS, type Action, COVERAGE_PAGE, DAY, type RawCustomer, INSTRUCTIONS, TARIFF_PAGE, WEEK, allowedActions } from "./journey.js";

/**
 * Below this confidence, a decision goes to a person instead of being executed.
 * Why: the post says the team must define when a human reviews the machine's choice. Jev returns a
 * confidence with every answer, so low-confidence decisions can be held back automatically.
 */
export const MIN_CONFIDENCE = 0.6;

/**
 * The same customer after jev-state: only the facts the rules need, as words.
 * Why: Jev reads numbers and timestamps as text, can't count events, and gets worse as irrelevant
 * state grows. So the counting and date math happen here in code, the results become labels that
 * use the rules' own words ("3 or more times", "in 60 days or more"), and everything else is dropped.
 * Jev still makes the decision; this only prepares the facts.
 */
export function jevState(c: RawCustomer) {
  const inLastWeek = (at: number) => c.now - at < WEEK;
  const offers = c.sendLog.filter((s) => s.campaign === "upgrade_offer").sort((a, b) => b.sentAt - a.sentAt);
  // The facts behind the rules' definitions, computed once in code.
  const tariffVisits = c.events.filter((e) => e.path === TARIFF_PAGE && inLastWeek(e.at)).length;
  const coverageVisited = c.events.some((e) => e.path === COVERAGE_PAGE && inLastWeek(e.at));
  const daysToRenewal = (c.contract.renewsAt - c.now) / DAY;
  return project(
    c,
    {
      // The rules' "renewal interest": fewer than 2 tariff visits in 7 days and renewal 60+ days away
      // means low. Computed here because counting in a window and date math are where Jev slips.
      renewalInterest: () => (tariffVisits < 2 && daysToRenewal >= 60 ? "low" : "present"),
      // The rules' "coverage interest": 5G live at the address, or a coverage-page visit in 7 days.
      coverageInterest: () => (c.network.fiveGLiveAtAddress || coverageVisited ? "yes" : "no"),
      // Days until renewal as words; only the 14-day line still matters once interest is computed.
      contractRenews: pipe(
        () => daysToRenewal,
        band({ cuts: [14, 60], labels: ["in less than 14 days", "in 14 to 59 days", "in 60 days or more"] }),
      ),
      lastUpgradeOffer: () => (offers.length === 0 ? "none sent" : offers[0]!.opened ? "opened" : "ignored"),
      supportTicket: () => (c.tickets.some((t) => t.status === "open") ? "open" : "none open"),
      faultReportedLast7Days: () => (c.tickets.some((t) => t.topic === "network_fault" && inLastWeek(t.openedAt)) ? "yes" : "no"),
    },
    // Drop every raw field the schema doesn't name: ids, device, tracking, and the raw logs.
    { unknown: "drop" },
  ).state;
}

/**
 * The choice question for one customer, listing only the actions its hard limits allow.
 * Why pick(): it builds the question from a list and maps Jev's answer back to the action, so the
 * options can differ per customer. `none: false` because waiting is already an explicit action.
 */
export function actionQuestion(c: RawCustomer): Pick<Action> {
  return pick(INSTRUCTIONS, allowedActions(c), { label: (a) => a, describe: (a) => ACTIONS[a], none: false });
}
