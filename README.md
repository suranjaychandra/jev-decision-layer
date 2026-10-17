# jev-decision-layer

A marketing decision layer built with [Jev](https://typesafe.ai), TypeSafe AI's decision model, and [jev-state](https://github.com/suranjaychandra/jev-state). It follows the four jobs described in Uplane's post [Beyond the Campaign: Building a Decision Layer for Customer Engagement](https://uplane.com/blogs/continuous-engagement-segments-of-one/): notice, remember, **choose one action or none**, and learn.

> Work in progress. Scene 1 (next best action) is done and measured; Scene 2 (budget steering) comes next.

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

## Results

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

## Run it

You need Node.js 22+.

```sh
npm install
npm test                      # no network, no API key
npm run nba -- --dry          # print what would be sent; no API calls
```

With a [TypeSafe](https://typesafe.ai) API key:

```sh
cp .env.example .env          # paste your TYPESAFE_API_KEY and save
npm run nba -- --limit 5      # 5 customers × 2 versions = 10 Jev calls
npm run nba:bench -- --seed 42 --reruns 3   # the test set: 360 calls, about $0.02
```

## Limitations

- The customers are synthetic and seeded, and the rules were written for this test.
- This is not Uplane's logic or data, and it says nothing about whether Uplane uses Jev.
- jev-state does the counting and date math in code, so a comparison measures that design end to end, not better reasoning by Jev.

## License

[MIT](LICENSE) © 2026 Suranjay Kumar

Unofficial community project. Not affiliated with or endorsed by TypeSafe AI or Uplane.
