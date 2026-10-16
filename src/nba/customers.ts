/**
 * The customers the demo and benchmark run on: the example from Uplane's post plus seeded
 * synthetic customers.
 * Why synthetic: no real customer data is needed or used, and anyone can reproduce the results.
 */
import { ACTIONS, type Action, COVERAGE_PAGE, DAY, type RawCustomer, TARIFF_PAGE, policy, signals } from "./journey.js";

/**
 * Tuesday 09:14 UTC, the moment of decision in every case.
 * Why fixed: "in the last 7 days" depends on the clock, so a fixed clock keeps every run identical.
 * Why this time: it is the moment in Uplane's example.
 */
export const NOW = Date.UTC(2026, 9, 13, 9, 14);

const HOUR = DAY / 24;
const OTHER_PAGES = ["/home", "/account", "/devices/phone-17", "/support/billing", "/offers", "/roaming"];

/**
 * A small seeded random number generator (mulberry32).
 * Why not Math.random(): the same seed must always produce the same customers, so a benchmark
 * can be rerun and checked by anyone.
 */
export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The example from Uplane's post "Beyond the Campaign": Tuesday 09:14, the third visit to the
 * tariff comparison page in five days, renewal in 38 days, two of two weekly emails used, the last
 * upgrade offer ignored, 5G live at the address, email consent but no SMS, and a May fault long closed.
 */
export function blogExample(): RawCustomer {
  return {
    customerId: "cus_blog_0914",
    now: NOW,
    plan: { name: "Unlimited 5G", monthlyPrice: 34.99, currency: "EUR" },
    contract: { startedAt: NOW - 692 * DAY, renewsAt: NOW + 38 * DAY },
    consent: { email: true, sms: false, ads: true },
    events: [
      { type: "page_view", path: TARIFF_PAGE, at: NOW - 4.9 * DAY, sessionId: "s_71a2" },
      { type: "page_view", path: "/devices/phone-17", at: NOW - 4.9 * DAY + 3 * 60_000, sessionId: "s_71a2" },
      { type: "page_view", path: TARIFF_PAGE, at: NOW - 2 * DAY, sessionId: "s_83c9" },
      { type: "page_view", path: "/account", at: NOW - 30 * HOUR, sessionId: "s_8f10" },
      { type: "page_view", path: TARIFF_PAGE, at: NOW - 60_000, sessionId: "s_9d44" },
    ],
    sendLog: [
      { channel: "email", campaign: "upgrade_offer", sentAt: NOW - 3 * DAY, opened: false },
      { channel: "email", campaign: "newsletter", sentAt: NOW - 1 * DAY, opened: true },
    ],
    tickets: [
      { id: "t_5521", topic: "network_fault", status: "closed", openedAt: Date.UTC(2026, 4, 2, 8), closedAt: Date.UTC(2026, 4, 4, 16) },
    ],
    network: { fiveGLiveAtAddress: true },
    device: { model: "Phone 17", os: "iOS 27.1", appVersion: "8.4.2" },
    utm: { source: "newsletter", medium: "email", campaign: "renewal_q4" },
    internal: { crmId: "crm_004417", segmentIds: ["seg_price_conscious", "seg_family"], lastSyncedAt: NOW - 11 * 60_000 },
  };
}

/**
 * One random but realistic customer record.
 * Why the noise (device, tracking, extra pages, old visits): real CRM records look like this, and
 * the benchmark measures how well Jev handles it raw versus after jev-state.
 */
function randomCustomer(rnd: () => number, n: number): RawCustomer {
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const chance = (p: number) => rnd() < p;
  const one = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const ago = (maxDays: number) => NOW - rnd() * maxDays * DAY;

  // Page views: tariff and coverage visits up to 13 days back, so some fall outside the 7-day window.
  const events: RawCustomer["events"] = [];
  const session = () => `s_${int(0x1000, 0xffff).toString(16)}`;
  // Some visits fall outside the 7-day window on purpose.
  for (let i = int(0, 5); i > 0; i--) events.push({ type: "page_view", path: TARIFF_PAGE, at: ago(13), sessionId: session() });
  for (let i = int(0, 2); i > 0; i--) events.push({ type: "page_view", path: COVERAGE_PAGE, at: ago(13), sessionId: session() });
  for (let i = int(2, 8); i > 0; i--) events.push({ type: "page_view", path: one(OTHER_PAGES), at: ago(30), sessionId: session() });
  events.sort((a, b) => a.at - b.at);

  // Messages sent in the last 20 days; email-heavy, like most CRM send logs.
  const sendLog: RawCustomer["sendLog"] = [];
  for (let i = int(0, 4); i > 0; i--) {
    sendLog.push({
      channel: chance(0.8) ? "email" : "sms",
      campaign: one(["upgrade_offer", "newsletter", "renewal_reminder"] as const),
      sentAt: ago(20),
      opened: chance(0.5),
    });
  }
  sendLog.sort((a, b) => a.sentAt - b.sentAt);

  // About 30% of customers have a support ticket, some still open.
  const tickets: RawCustomer["tickets"] = [];
  if (chance(0.3)) {
    const openedAt = ago(60);
    const open = chance(0.35);
    tickets.push({
      id: `t_${int(1000, 9999)}`,
      topic: one(["network_fault", "billing", "device"] as const),
      status: open ? "open" : "closed",
      openedAt,
      closedAt: open ? null : Math.min(NOW - HOUR, openedAt + int(1, 5) * DAY),
    });
  }

  const renewsAt = NOW + (3 + rnd() * 147) * DAY;
  return {
    customerId: `cus_${String(n).padStart(4, "0")}`,
    now: NOW,
    plan: one([
      { name: "Unlimited 5G", monthlyPrice: 34.99, currency: "EUR" },
      { name: "Flex 20 GB", monthlyPrice: 19.99, currency: "EUR" },
      { name: "Family 4 Lines", monthlyPrice: 79.99, currency: "EUR" },
    ]),
    contract: { startedAt: renewsAt - 730 * DAY, renewsAt },
    consent: { email: chance(0.8), sms: chance(0.4), ads: chance(0.75) },
    events,
    sendLog,
    tickets,
    network: { fiveGLiveAtAddress: chance(0.5) },
    device: { model: one(["Phone 17", "Galaxy S27", "Pixel 11"]), os: one(["iOS 27.1", "Android 17"]), appVersion: `8.${int(0, 9)}.${int(0, 9)}` },
    utm: { source: one(["google", "meta", "newsletter", "direct"]), medium: one(["cpc", "social", "email", "none"]), campaign: one(["renewal_q4", "brand", "5g_launch"]) },
    internal: { crmId: `crm_${int(100000, 999999)}`, segmentIds: [one(["seg_price_conscious", "seg_premium", "seg_young"])], lastSyncedAt: NOW - int(1, 90) * 60_000 },
  };
}

/** One test case: the raw customer and the correct action by the policy. */
export interface Case {
  raw: RawCustomer;
  expected: Action;
}

/**
 * `perAction` customers for each action, deterministic for a given seed.
 * Why balanced: with random customers, "wait" and "email" would dominate, and a model that
 * always guessed them would look accurate. Equal counts per action make accuracy honest.
 * Different seeds give separate sets, so the state design can be tuned on one and measured on another.
 */
export function makeCases(perAction = 12, seed = 42): Case[] {
  const rnd = mulberry32(seed);
  const want = Object.fromEntries(Object.keys(ACTIONS).map((a) => [a, perAction])) as Record<Action, number>;
  const out: Case[] = [];
  for (let n = 1; out.length < perAction * Object.keys(ACTIONS).length; n++) {
    if (n > 100_000) throw new Error("makeCases() could not balance the actions");
    const raw = randomCustomer(rnd, n);
    const expected = policy(raw);
    if (want[expected] > 0) {
      want[expected]--;
      out.push({ raw, expected });
    }
  }
  return out;
}

/** A one-line human summary of a case, so logs are readable without opening the raw JSON. */
export function summary(c: RawCustomer): string {
  const s = signals(c);
  const parts = [
    `${s.tariffVisits} tariff visits`,
    `renews in ${s.daysToRenewal.toFixed(1)} days`,
    `${s.emailsThisWeek} emails this week`,
    `last offer ${s.lastOffer}`,
  ];
  if (s.openTicket) parts.push("ticket open");
  if (s.recentFault) parts.push("recent fault");
  if (s.fiveG) parts.push("5G live");
  if (s.coverageVisited) parts.push("coverage page");
  return parts.join(", ");
}
