# Scene 1 benchmark: next best action

Model `jev-1.13.0`, 2026-10-16. Seed 42: 60 customers (12 per action) × 2 variants × 3 runs = 360 calls, 414,150 input tokens (about $0.0174).

| | Raw | jev-state |
|---|---|---|
| Accuracy | 80.6% | 95.6% |
| Sent to human review (confidence < 0.6) | 45.0% | 19.4% |
| Wrong decisions executed automatically | 12 | 3 |
| Accuracy of executed decisions | 87.9% | 97.9% |
| Customers whose answer changed across reruns | 5/60 | 1/60 |
| Avg input tokens | 1597 | 703 |
| p50 / p95 latency | 310 / 390 ms | 305 / 368 ms |
| Errors | 0 | 0 |

| Expected action | Raw | jev-state |
|---|---|---|
| social_coverage_proof | 94.4% | 91.7% |
| wait | 25.0% | 100.0% |
| email_upgrade_offer | 100.0% | 86.1% |
| service_handoff | 100.0% | 100.0% |
| sms_reminder | 83.3% | 100.0% |
