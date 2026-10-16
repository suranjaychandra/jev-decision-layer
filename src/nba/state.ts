import { type Pick, band, count, pick, pipe, project } from "jev-state";
import { ACTIONS, type Action, COVERAGE_PAGE, DAY, type RawCustomer, INSTRUCTIONS, TARIFF_PAGE, WEEK, allowedActions } from "./journey.js";

/** Below this confidence, a decision goes to a person instead of being executed. */
export const MIN_CONFIDENCE = 0.6;

/** The same customer after jev-state: only the facts the rules need, as words. */
export function jevState(c: RawCustomer) {
  const inLastWeek = (at: number) => c.now - at < WEEK;
  const offers = c.sendLog.filter((s) => s.campaign === "upgrade_offer").sort((a, b) => b.sentAt - a.sentAt);
  return project(
    c,
    {
      tariffVisitsLast7Days: pipe(
        () => c.events.filter((e) => e.path === TARIFF_PAGE && inLastWeek(e.at)),
        count({ few: 2, many: 3, labels: { none: "none", one: "once", few: "twice", many: "3 or more times" } }),
      ),
      coveragePageLast7Days: () => (c.events.some((e) => e.path === COVERAGE_PAGE && inLastWeek(e.at)) ? "visited" : "not visited"),
      contractRenews: pipe(
        () => (c.contract.renewsAt - c.now) / DAY,
        band({ cuts: [14, 60], labels: ["in less than 14 days", "in 14 to 59 days", "in 60 days or more"] }),
      ),
      lastUpgradeOffer: () => (offers.length === 0 ? "none sent" : offers[0]!.opened ? "opened" : "ignored"),
      supportTicket: () => (c.tickets.some((t) => t.status === "open") ? "open" : "none open"),
      faultReportedLast7Days: () => (c.tickets.some((t) => t.topic === "network_fault" && inLastWeek(t.openedAt)) ? "yes" : "no"),
      fiveGAtAddress: () => (c.network.fiveGLiveAtAddress ? "live" : "not live"),
    },
    { unknown: "drop" },
  ).state;
}

/** The choice question for one customer: only the actions its hard limits allow. */
export function actionQuestion(c: RawCustomer): Pick<Action> {
  return pick(INSTRUCTIONS, allowedActions(c), { label: (a) => a, describe: (a) => ACTIONS[a], none: false });
}
