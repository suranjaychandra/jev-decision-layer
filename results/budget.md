# Scene 2 benchmark: budget steering

Model `jev-1.13.0`, 2026-10-17. Seed 42: 48 ads (12 per action) × 2 variants × 3 runs = 288 calls, 270,126 input tokens (about $0.0113).

| | Raw | jev-state |
|---|---|---|
| Accuracy | 58.3% | 100.0% |
| Sent to human review (confidence < 0.6) | 85.4% | 3.5% |
| Wrong decisions executed automatically | 3 | 0 |
| Accuracy of executed decisions | 85.7% | 100.0% |
| Ads whose answer changed across reruns | 6/48 | 0/48 |
| Avg input tokens | 1267 | 609 |
| p50 / p95 latency | 325 / 429 ms | 315 / 405 ms |
| Errors | 0 | 0 |

| Expected action | Raw | jev-state |
|---|---|---|
| hold | 52.8% | 100.0% |
| retire | 22.2% | 100.0% |
| pause | 86.1% | 100.0% |
| scale | 72.2% | 100.0% |
