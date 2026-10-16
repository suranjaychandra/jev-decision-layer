/**
 * Next best action for one journey: a mobile operator's contract renewal.
 *
 * Why this journey: it is the worked example in Uplane's post "Beyond the Campaign", where
 * timing obviously matters, so the demo can be checked against a case they published.
 *
 * This file holds the business side: the actions, the hard limits enforced in code, and the
 * policy used to grade Jev's answers. Nothing here calls Jev.
 */

// Time units in milliseconds, because the raw record stores epoch-ms timestamps like a real CRM.
export const DAY = 24 * 60 * 60 * 1000;
export const WEEK = 7 * DAY;

/**
 * Emails one customer may receive in any rolling 7 days.
 * Why: the post's example hinges on "two of two emails already used this week". A contact cap is
 * what stops a decision layer from turning into continuous interruption.
 */
export const WEEKLY_EMAIL_CAP = 2;

/**
 * The five actions and the description Jev reads for each.
 * Why `wait` is an action: the post argues "the right to send nothing" is what separates
 * engagement from interruption, so doing nothing must be a real, choosable option.
 */
export const ACTIONS = {
  service_handoff: "Hand the customer to customer service.",
  email_upgrade_offer: "Email the contract upgrade offer.",
  sms_reminder: "Text a short contract renewal reminder.",
  social_coverage_proof: "Show an ad in paid social proving coverage at the customer's address. Uses no direct contact.",
  wait: "Do nothing now. Waiting is not a contact.",
} as const;

/** One of the action ids above. Deriving the type from ACTIONS keeps the list in one place. */
export type Action = keyof typeof ACTIONS;

/**
 * Everything a CRM and web analytics stack record about one customer, the way they store it:
 * epoch timestamps, raw event lists, and fields irrelevant to the decision (device, tracking, ids).
 * Why so messy: the benchmark sends this as the "raw" version, so it has to look like real data.
 * It is a type alias, not an interface, so TypeScript accepts it as the SDK's JSON state type.
 */
export type RawCustomer = {
  customerId: string;
  /** Epoch ms at the moment of decision. A fixed clock makes every run reproducible. */
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

// The two pages that signal renewal interest. Named once so the policy and the projection agree.
export const TARIFF_PAGE = "/tariffs/compare";
export const COVERAGE_PAGE = "/coverage";

/**
 * The facts the rules depend on, computed in plain code from the raw record.
 * Why: counting events in a time window and doing date math are exactly what Jev is weak at, so
 * the grading policy must never rely on a model for them. The tests also use this as the source
 * of truth to check that the jev-state labels say the same thing.
 */
export function signals(c: RawCustomer) {
  // Rolling window: "in the last 7 days" means strictly less than 7 days before the decision.
  const inLastWeek = (at: number) => c.now - at < WEEK;
  // Newest offer first, because only the most recent offer's outcome matters.
  const offers = c.sendLog.filter((s) => s.campaign === "upgrade_offer").sort((a, b) => b.sentAt - a.sentAt);
  return {
    tariffVisits: c.events.filter((e) => e.path === TARIFF_PAGE && inLastWeek(e.at)).length,
    coverageVisited: c.events.some((e) => e.path === COVERAGE_PAGE && inLastWeek(e.at)),
    daysToRenewal: (c.contract.renewsAt - c.now) / DAY,
    emailsThisWeek: c.sendLog.filter((s) => s.channel === "email" && inLastWeek(s.sentAt)).length,
    lastOffer: offers.length === 0 ? "none" : offers[0]!.opened ? "opened" : "ignored",
    openTicket: c.tickets.some((t) => t.status === "open"),
    // A fault counts even if its ticket is closed: a customer who lost service days ago
    // should not receive a sales message yet.
    recentFault: c.tickets.some((t) => t.topic === "network_fault" && inLastWeek(t.openedAt)),
    fiveG: c.network.fiveGLiveAtAddress,
  } as const;
}

/**
 * The hard limits: consent per channel and the weekly email cap. Blocked actions are removed
 * before Jev sees the question.
 * Why in code and not in the prompt: a rule the model is asked to follow can still be broken;
 * an option the model never sees cannot be chosen. This is the "people set the limits, the
 * system chooses within them" split from the post. Service and waiting never contact the
 * customer through a marketing channel, so they are always allowed.
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

/**
 * The rules Jev is given, in plain words. The raw and jev-state versions get the exact same
 * text, so any difference in their answers comes from the state format alone.
 * Why "apply the FIRST rule that matches": an ordered list gives exactly one correct answer per
 * customer, which makes grading objective.
 */
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

/**
 * The correct answer by the rules, written in code. It mirrors INSTRUCTIONS line by line.
 * Why: every Jev answer is graded against this, so accuracy numbers are measured, not judged.
 */
export function policy(c: RawCustomer): Action {
  const s = signals(c);
  const allowed = new Set(allowedActions(c));
  // 1. Service first: someone with an open problem should not get a sales message.
  if (s.openTicket || s.recentFault) return "service_handoff";
  // 2. Deliberate silence when there is no sign of interest and renewal is far away.
  if (s.tariffVisits < 2 && s.daysToRenewal >= 60) return "wait";
  // 3. They ignored the offer, so show proof instead of repeating it (the post's choice).
  if (allowed.has("social_coverage_proof") && s.lastOffer === "ignored" && (s.fiveG || s.coverageVisited)) {
    return "social_coverage_proof";
  }
  // 4–6. Otherwise the most direct channel still allowed.
  if (allowed.has("email_upgrade_offer")) return "email_upgrade_offer";
  if (allowed.has("sms_reminder") && s.daysToRenewal < 14) return "sms_reminder";
  if (allowed.has("social_coverage_proof")) return "social_coverage_proof";
  // 7. Nothing fits: waiting is a valid decision.
  return "wait";
}
