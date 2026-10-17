# jev-decision-layer

A marketing decision layer built with [Jev](https://typesafe.ai), TypeSafe AI's decision model, and [jev-state](https://github.com/suranjaychandra/jev-state). It follows the four jobs described in Uplane's post [Beyond the Campaign: Building a Decision Layer for Customer Engagement](https://uplane.com/blogs/continuous-engagement-segments-of-one/): notice, remember, **choose one action or none**, and learn.

[![CI](https://github.com/suranjaychandra/jev-decision-layer/actions/workflows/ci.yml/badge.svg)](https://github.com/suranjaychandra/jev-decision-layer/actions/workflows/ci.yml)

**[Open the dashboard](https://suranjaychandra.github.io/jev-decision-layer/)**: every test-set case side by side, raw vs jev-state, with the options Jev saw, what the hard limits blocked and why, and Jev's recorded answers. It replays saved answers, so no API key is needed.

| Scene | Accuracy, raw → jev-state | Wrong decisions executed automatically | Input tokens |
|---|---|---|---|
| [1. Next best action](#scene-1-next-best-action) | 80.6% → **95.6%** | 12 → **3** | 1,597 → **703** |
| [2. Budget steering](#scene-2-budget-steering) | 58.3% → **100%** | 3 → **0** | 1,267 → **609** |

## Scene 1: next best action

One journey, a mobile operator's contract renewal. For each customer, the system chooses one of five actions:

| Action | Meaning |
|---|---|
| `service_handoff` | Hand the customer to customer service |
| `email_upgrade_offer` | Email the contract upgrade offer |
| `sms_reminder` | Text a renewal reminder |
| `social_coverage_proof` | Show coverage proof in paid social (no direct contact) |
| `wait` | Do nothing now |

**Hard limits stay in code.** Consent per channel and a cap of two emails per rolling 7 days remove actions before Jev sees the question, so Jev can only choose among allowed actions. Service and waiting are always allowed.

**Jev chooses among what's left**, with [`pick()`](https://github.com/suranjaychandra/jev-state#pickinstructions-items--label-describe-none-) from jev-state. Below 60% confidence, the decision goes to a person instead.

**Two versions of the same customer** go to Jev with the same rules and options:

- **Raw:** the CRM record: page views with epoch timestamps, the send log, tickets, consent, device, tracking, and internal ids.
- **jev-state:** only the facts the rules need, as words: `renewalInterest: "present"`, `coverageInterest: "yes"`, `contractRenews: "in 14 to 59 days"`, `lastUpgradeOffer: "ignored"`.

The post's own example (Tuesday 09:14, the third tariff-page visit in five days, two of two weekly emails used, the last offer ignored, 5G live at the address) is included. Email is blocked by the cap, SMS by consent, and the rules choose coverage proof in paid social, as in the post.

### Results

Test set: 60 seeded customers (12 per action) × 2 versions × 3 runs = 360 calls on `jev-1.13.0`, about $0.017 in total. Same rules, same allowed options, same model; only the state format differs.

| | Raw | jev-state |
|---|---|---|
| Accuracy | 80.6% | **95.6%** |
| Sent to human review (confidence < 0.6) | 45.0% | **19.4%** |
| Wrong decisions executed automatically | 12 | **3** |
| Accuracy of executed decisions | 87.9% | **97.9%** |
| Customers whose answer changed across reruns | 5/60 | **1/60** |
| Avg input tokens | 1,597 | **703** |
| p50 / p95 latency | 310 / 390 ms | 305 / 368 ms |

Full tables: [`results/nba.md`](results/nba.md). Every call: [`results/nba.json`](results/nba.json).

**What the raw version gets wrong.** 27 of its 35 wrong answers contacted a customer who should have been left alone: the rules said `wait`, and raw state produced an email or an ad. Deciding to wait means counting tariff-page visits inside a 7-day window and working out the days to renewal from epoch timestamps, which is where Jev slips. With jev-state, `wait` was right every time. This is the "continuous interruption" the post warns about.

**What jev-state still gets wrong.** All 3 of its automatically executed mistakes are one customer, the same way each run: renewal in under 14 days, email allowed, and Jev chose the SMS reminder (rule 5) over the email (rule 4). Both channels had consent, so no limit was broken, but the priority order was. The same pattern showed up on the dev set: Jev follows single facts well and rule order less reliably.

**How the numbers were made.** The state design was tuned on a separate dev set (seed 7) only. One change came from it: rules with two conditions joined by "and"/"or" were often half-matched, so the rules now name each combined condition once ("renewal interest", "coverage interest"), for both versions. The test set (seed 42) was then run once, and those are the numbers above.

## Scene 2: budget steering

Steering ad budget toward what performs is Uplane's core product. For each ad variant, the system chooses what to do with its money:

| Action | Meaning |
|---|---|
| `scale` | Raise the daily budget |
| `hold` | Keep the budget as it is (too little data yet, or nothing to change) |
| `pause` | Pause the ad; it can restart later |
| `retire` | Stop the ad for good and replace its creative |

**The rules** (first match wins), each condition defined once by name:

1. `hold` while evidence is not enough: under 3 days, or under twice the target CPA spent.
2. `pause` when CPA is above target: 1.3 times the target or more, or spend with no conversions.
3. `retire` on fatigue: after 6+ days, the last 3 days' click rate is more than 30% below the first 3 days'.
4. `scale` when CPA is below target: under 0.8 times the target.
5. Otherwise `hold`.

**Hard limits stay in code**, as in Scene 1:

- **Budget cap:** an ad already at its maximum daily budget can't be scaled.
- **Protected explore budget:** a new "explore" ad can't be paused or retired before 5,000 impressions. This follows the idea in Uplane's post [From asset production to a continuous learning system](https://uplane.com/blogs/continuous-testing-connected-teams/): cut every challenger early and nothing new ever gets a fair test.

**Two versions of the same ad:**

- **Raw:** what an ad platform's reporting API returns: settings, creative, targeting, ids, and one row per day (impressions, clicks, spend, conversions).
- **jev-state:** three facts in the rules' own words: `evidence: "enough"`, `cpa: "below target"`, `fatigue: "yes"`.

Six worked examples in [`src/budget/ads.ts`](src/budget/ads.ts) walk through every rule with a $40 target CPA. For example, ad C spent $900 for 30 conversions ($30 each, below target), but its click rate fell from 2.0% to 1.2%, so it is retired rather than scaled.

### Results

Test set: 48 seeded ads (12 per action) × 2 versions × 3 runs = 288 calls on `jev-1.13.0`, about $0.011 in total.

| | Raw | jev-state |
|---|---|---|
| Accuracy | 58.3% | **100%** |
| Sent to human review (confidence < 0.6) | 85.4% | **3.5%** |
| Wrong decisions executed automatically | 3 | **0** |
| Accuracy of executed decisions | 85.7% | **100%** |
| Ads whose answer changed across reruns | 6/48 | **0/48** |
| Avg input tokens | 1,267 | **609** |
| p50 / p95 latency | 325 / 429 ms | 315 / 405 ms |

Full tables: [`results/budget.md`](results/budget.md). Every call: [`results/budget.json`](results/budget.json).

**What the raw version gets wrong.** 24 of its 60 wrong answers gave more money to an ad that shouldn't get it (`scale` instead of hold, pause, or retire), and 10 paused an ad that should have been scaled. Spotting fatigue was the hardest: only 22% of `retire` cases were right, because it means comparing click rates across the first and last three daily rows. Raw answers also averaged 0.37 confidence, so 85% would go to a person: the automation would barely run.

**Why jev-state reaches 100% here.** Its three facts are exactly the rules' definitions, so what is left for Jev is applying an ordered list to three labels. That is the point of the design, not a sign the task is hard: the arithmetic moves into tested code, and the model does the choosing. The dev set (seed 7) needed no changes, so the test set (seed 42) ran on the design as first written.

## Dashboard

[`docs/index.html`](docs/index.html) is a static page that replays the test-set benchmarks. For each customer or ad it shows the raw record and the jev-state version, the options Jev saw, which actions the hard limits removed and why, and every recorded answer with its confidence, marked **executed** or **sent to human review**. It opens on the example from Uplane's post, recorded separately (3 runs each; not part of the benchmark numbers).

```sh
npm run dashboard             # builds docs/data.json and serves http://localhost:3002
```

## Run it

You need Node.js 22+.

```sh
npm install
npm test                      # no network, no API key
npm run nba -- --dry          # print what would be sent; no API calls
npm run budget:bench -- --dry # the same for Scene 2
```

With a [TypeSafe](https://typesafe.ai) API key:

```sh
cp .env.example .env          # paste your TYPESAFE_API_KEY and save
npm run nba -- --limit 5      # 5 customers × 2 versions = 10 Jev calls
npm run nba:bench -- --seed 42 --reruns 3      # Scene 1 test set: 360 calls, about $0.02
npm run budget:bench -- --seed 42 --reruns 3   # Scene 2 test set: 288 calls, about $0.01
```

## Limitations

- The customers and ads are synthetic and seeded, and the rules were written for this test.
- This is not Uplane's logic or data, and it says nothing about whether Uplane uses Jev.
- jev-state does the counting and date math in code, so a comparison measures that design end to end, not better reasoning by Jev.

## License

[MIT](LICENSE) © 2026 Suranjay Kumar

Unofficial community project. Not affiliated with or endorsed by TypeSafe AI or Uplane.
