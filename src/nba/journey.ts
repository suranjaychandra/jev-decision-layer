/**
 * Next best action for one journey: a mobile operator's contract renewal.
 * The actions, the hard limits enforced in code, and the policy used to grade answers.
 */

export const DAY = 24 * 60 * 60 * 1000;
export const WEEK = 7 * DAY;

/** Emails one customer may receive in any rolling 7 days. */
export const WEEKLY_EMAIL_CAP = 2;

export const ACTIONS = {
  service_handoff: "Hand the customer to customer service.",
  email_upgrade_offer: "Email the contract upgrade offer.",
  sms_reminder: "Text a short contract renewal reminder.",
  social_coverage_proof: "Show an ad in paid social proving coverage at the customer's address. Uses no direct contact.",
  wait: "Do nothing now. Waiting is not a contact.",
} as const;

export type Action = keyof typeof ACTIONS;

/**
 * The pages, messages, and tickets a CRM and web analytics stack record about one customer.
 * A type alias (not an interface) so it is assignable to the SDK's JSON state type.
 */
export type RawCustomer = {
  customerId: string;
  /** Epoch ms at the moment of decision. */
  now: number;
  plan: { name: string; monthlyPrice: number; currency: string };
  contract: { startedAt: number; renewsAt: number };
  consent: { email: boolean; sms: boolean; ads: boolean };
  events: { type: "page_view"; path: string; at: number; sessionId: string }[];
  sendLog: { channel: "email" | "sms"; campaign: "upgrade_offer" | "newsletter" | "renewal_reminder"; sentAt: number; opened: boolean }[];
  tickets: { id: string; topic: "network_fault" | "billing" | "device"; status: "open" | "closed"; openedAt: number; closedAt: number | null }[];
  network: { fiveGLiveAtAddress: boolean };
  device: { model: string; os: string; appVersion: string };
  utm: { source: string; medium: string; campaign: string };
  internal: { crmId: string; segmentIds: string[]; lastSyncedAt: number };
};

export const TARIFF_PAGE = "/tariffs/compare";
export const COVERAGE_PAGE = "/coverage";

/** The facts the policy reads, computed in code from the raw record. */
export function signals(c: RawCustomer) {
  const inLastWeek = (at: number) => c.now - at < WEEK;
  const offers = c.sendLog.filter((s) => s.campaign === "upgrade_offer").sort((a, b) => b.sentAt - a.sentAt);
  return {
    tariffVisits: c.events.filter((e) => e.path === TARIFF_PAGE && inLastWeek(e.at)).length,
    coverageVisited: c.events.some((e) => e.path === COVERAGE_PAGE && inLastWeek(e.at)),
    daysToRenewal: (c.contract.renewsAt - c.now) / DAY,
    emailsThisWeek: c.sendLog.filter((s) => s.channel === "email" && inLastWeek(s.sentAt)).length,
    lastOffer: offers.length === 0 ? "none" : offers[0]!.opened ? "opened" : "ignored",
    openTicket: c.tickets.some((t) => t.status === "open"),
    recentFault: c.tickets.some((t) => t.topic === "network_fault" && inLastWeek(t.openedAt)),
    fiveG: c.network.fiveGLiveAtAddress,
  } as const;
}

/**
 * Hard limits, enforced in code before Jev sees the options: consent per channel and the
 * weekly email cap. Jev can only choose among what is left. Service and waiting are always allowed.
 */
export function allowedActions(c: RawCustomer): Action[] {
  const s = signals(c);
  const allowed: Action[] = ["service_handoff"];
  if (c.consent.email && s.emailsThisWeek < WEEKLY_EMAIL_CAP) allowed.push("email_upgrade_offer");
  if (c.consent.sms) allowed.push("sms_reminder");
  if (c.consent.ads) allowed.push("social_coverage_proof");
  allowed.push("wait");
  return allowed;
}

/** The rules Jev is given. The same text for raw and jev-state. */
export const INSTRUCTIONS = `You are the decision layer for a mobile network operator's contract-renewal journey. Choose the next action for this customer.
Every listed option is already permitted by consent and contact limits. Only choose a listed option.
Definitions:
- A tariff visit is an opening of the tariff comparison page in the last 7 days.
- A fault is recent if it was reported in the last 7 days.
Apply the FIRST rule that matches:
1. service_handoff: a support ticket is open, or a fault is recent.
2. wait: fewer than 2 tariff visits, and the contract renews in 60 days or more.
3. social_coverage_proof: if listed, the last upgrade offer was ignored, and 5G is live at the address or the coverage page was visited in the last 7 days.
4. email_upgrade_offer: if listed.
5. sms_reminder: if listed, and the contract renews in less than 14 days.
6. social_coverage_proof: if listed.
7. wait.`;

/** The correct answer by the rules. Mirrors INSTRUCTIONS exactly. */
export function policy(c: RawCustomer): Action {
  const s = signals(c);
  const allowed = new Set(allowedActions(c));
  if (s.openTicket || s.recentFault) return "service_handoff";
  if (s.tariffVisits < 2 && s.daysToRenewal >= 60) return "wait";
  if (allowed.has("social_coverage_proof") && s.lastOffer === "ignored" && (s.fiveG || s.coverageVisited)) {
    return "social_coverage_proof";
  }
  if (allowed.has("email_upgrade_offer")) return "email_upgrade_offer";
  if (allowed.has("sms_reminder") && s.daysToRenewal < 14) return "sms_reminder";
  if (allowed.has("social_coverage_proof")) return "social_coverage_proof";
  return "wait";
}
