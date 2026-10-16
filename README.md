# jev-decision-layer

A marketing decision layer built with [Jev](https://typesafe.ai), TypeSafe AI's decision model, and [jev-state](https://github.com/suranjaychandra/jev-state). It follows the four jobs described in Uplane's post [Beyond the Campaign: Building a Decision Layer for Customer Engagement](https://uplane.com/blogs/continuous-engagement-segments-of-one/): notice, remember, **choose one action or none**, and learn.

> Work in progress. Scene 1 (next best action) is in place; the benchmark and Scene 2 (budget steering) come next.

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
- **jev-state:** only the facts the rules need, as words: `tariffVisitsLast7Days: "3 or more times"`, `contractRenews: "in 14 to 59 days"`, `lastUpgradeOffer: "ignored"`.

The post's own example (Tuesday 09:14, the third tariff-page visit in five days, two of two weekly emails used, the last offer ignored, 5G live at the address) is included. Email is blocked by the cap, SMS by consent, and the rules choose coverage proof in paid social, as in the post.

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
```

## Limitations

- The customers are synthetic and seeded, and the rules were written for this test.
- This is not Uplane's logic or data, and it says nothing about whether Uplane uses Jev.
- jev-state does the counting and date math in code, so a comparison measures that design end to end, not better reasoning by Jev.

## License

[MIT](LICENSE) © 2026 Suranjay Kumar

Unofficial community project. Not affiliated with or endorsed by TypeSafe AI or Uplane.
