# GPT-5.6 task-tier benchmark

Generated 2026-07-18T10:46:36.437Z. This benchmark uses the production strict schemas, image-detail tiers, reasoning efforts, and safety policy on two permanent regression images, one rendered page from the local synthetic South America booklet, its six-page printed exam PDF, and one practice-generation case.

Official model guidance positions Sol as flagship, Terra as balanced lower-cost, and Luna as efficient high-volume. Standard rates used here are Sol $5/$30, Terra $2.50/$15, and Luna $1/$6 per million input/output tokens ([pricing](https://developers.openai.com/api/docs/pricing), [model guidance](https://developers.openai.com/api/docs/guides/model-guidance?model=gpt-5.6)).

The Models endpoint exposed gpt-5.6-luna, gpt-5.6-sol, gpt-5.6-terra. Requested benchmark models: gpt-5.6-sol, gpt-5.6-terra, gpt-5.6-luna.

## Results

| Task | Model | Observed result | Schema | Transcription / task fidelity | Verdict agreement | Abstention safety | Latency | Tokens in/out | Cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| diagnosis/sign-equals | gpt-5.6-sol | CORRECT | PASS | PASS | PASS | PASS | 14.3s | 5406/663 | $0.0469 |
| diagnosis/negative-distribution | gpt-5.6-sol | MISCONCEPTION | PASS | PASS | PASS | PASS | 14.8s | 5433/742 | $0.0494 |
| diagnosis/south-america-page | gpt-5.6-sol | 4 matched block(s) | PASS | PASS | PASS | PASS | 101.1s | 9213/5494 | $0.2109 |
| extraction/south-america-exam | gpt-5.6-sol | 6 exercises | PASS | PASS | PASS | PASS | 79.2s | 7310/3998 | $0.1565 |
| practice/negative-distribution | gpt-5.6-sol | 5 practice items | PASS | PASS | PASS | PASS | 29.7s | 358/1195 | $0.0376 |
| diagnosis/sign-equals | gpt-5.6-terra | MISCONCEPTION | PASS | FAIL | FAIL | FAIL | 6.1s | 5406/595 | $0.0224 |
| diagnosis/negative-distribution | gpt-5.6-terra | MISCONCEPTION | PASS | PASS | PASS | PASS | 8.2s | 5433/687 | $0.0239 |
| diagnosis/south-america-page | gpt-5.6-terra | 4 matched block(s) | PASS | PASS | PASS | PASS | 30.0s | 9213/4277 | $0.0872 |
| extraction/south-america-exam | gpt-5.6-terra | 6 exercises | PASS | PASS | PASS | PASS | 33.9s | 7310/4309 | $0.0829 |
| practice/negative-distribution | gpt-5.6-terra | 5 practice items | PASS | PASS | PASS | PASS | 9.7s | 358/1044 | $0.0166 |
| diagnosis/sign-equals | gpt-5.6-luna | MISCONCEPTION | PASS | FAIL | FAIL | FAIL | 5.6s | 5406/796 | $0.0102 |
| diagnosis/negative-distribution | gpt-5.6-luna | MISCONCEPTION | PASS | PASS | PASS | PASS | 5.2s | 5433/729 | $0.0098 |
| diagnosis/south-america-page | gpt-5.6-luna | 4 matched block(s) | PASS | PASS | FAIL | PASS | 23.8s | 9213/4948 | $0.0389 |
| extraction/south-america-exam | gpt-5.6-luna | 6 exercises | PASS | PASS | PASS | PASS | 16.8s | 7310/3349 | $0.0274 |
| practice/negative-distribution | gpt-5.6-luna | 5 practice items | PASS | PASS | PASS | PASS | 23.6s | 358/1127 | $0.0071 |

Total measured API cost: **$0.8278** across 15 calls.

## Recommendation by tier

- **Diagnosis:** keep **gpt-5.6-sol**. No cheaper candidate met every fidelity, verdict, and abstention gate.
- **Extraction:** gpt-5.6-luna is a cost-saving candidate on this set, but keep the production default unchanged until the fixture set contains independent answer-level gold labels for this tier.
- **Practice:** gpt-5.6-luna is a cost-saving candidate on this set, but keep the production default unchanged until the fixture set contains independent answer-level gold labels for this tier.

No production default is changed by this report. The evaluation is intentionally conservative: schema success alone is not parity, and any cheaper model that turns a baseline abstention into a guess fails the safety gate.

## Reproduce

```bash
node --env-file=.env.local scripts/bench-models.mjs --dry-run
node --env-file=.env.local scripts/bench-models.mjs
```

The live run is capped at 30 calls; the default matrix uses 15. It requires the local six-exercise South America evaluation assignment and `pdftoppm` to render booklet page 2. No roster name is queried or sent.
