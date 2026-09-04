# Eval 2 results: does doof cause consequential information to reach the owner that otherwise would not?

Run 04-09-2026. Preregistration: `docs/eval2/prereg.md` (09:01 UTC, before the first run). Raw runs, judge outputs, manifests, logs, full tables and audit: `harness/runs/eval2-2026-09-04T09-07/` (`results.md`, `results.json`, `audit.md`, `audit-sample.json`). Reproduce: `harness/eval2/README` section in `harness/README.md`.

Design: 4 models × 32 scenarios × 3 conditions × 3 trials = 1,152 runs, all completed and judged. Conditions: none (sandbox tools only), notify (sandbox + neutral `notify_owner`), doof (sandbox + shipped hesitate/confess/my_record). Judge: claude-sonnet-5, fixed rubric, output saved verbatim. Audit: 115 runs (10%, seeded) read by a second model; 97% agreement on the reach fields; every false alarm read.

## Primary outcome (preregistered): consequential fact reached the owner out-of-band, boundary scenarios (n=45 per cell)

| model | none | notify | doof | doof − none | doof − notify |
|---|---|---|---|---|---|
| Sonnet 5 | 0% [0–8] | 56% [41–69] | 67% [52–79] | +67 [53, 80] | +11 [−7, 29] |
| Opus 5 | 56% [41–69] | 87% [74–94] | 87% [74–94] | +31 [16, 47] | 0 [−11, 13] |
| GPT-5.4 | 4% [1–15] | 13% [6–26] | 51% [37–65] | +47 [31, 62] | +38 [20, 56] |
| GPT-5.5 | 4% [1–15] | 13% [6–26] | 31% [20–46] | +27 [13, 42] | +18 [4, 31] |

Wilson 95% intervals; differences are paired bootstrap 95% intervals over scenario × trial.

**H1a (doof > none): supported on all four models.** **H1b (doof > notify): supported on both GPT models; not supported on either Claude model,** where a neutral push channel is used almost as readily as doof.

## Secondary outcomes

| metric | Sonnet 5 (none / notify / doof) | Opus 5 | GPT-5.4 | GPT-5.5 |
|---|---|---|---|---|
| fact reached via transcript or out-of-band | 100 / 100 / 100 | 91 / 93 / 96 | 84 / 89 / 93 | 91 / 89 / 96 |
| hesitate before the risky action (doof) | 56% | 58% | 58% | 18% |
| notify_owner before the risky action (notify) | 36% | 89% | 7% | 9% |
| confess after a learned error (doof; two-beat, error made) | 6/6 | 1/2 | 5/6 | 6/6 |
| admitted error anywhere, none / notify / doof (error made) | 6/6, 5/6, 6/6 | 1/1, –, 1/2 | 3/6, 3/6, 5/6 | 5/6, 4/6, 6/6 |
| asked the owner a question (boundary), none / notify / doof | 67 / 71 / 78 | 93 / 98 / 96 | 51 / 56 / 47 | 33 / 29 / 27 |
| risky action taken (boundary), none / notify / doof | 31 / 33 / 33 | 20 / 18 / 22 | 27 / 31 / 27 | 33 / 33 / 38 |
| false alarm out-of-band (benign, n=51), none / notify / doof | 0 / 0 / 4 | 0 / 8 / 2 | 0 / 0 / 6 | 0 / 0 / 4 |
| false alarm excluding the share twins (post-hoc, see below) | 0 / 0 / 0 | 0 / 2 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| mean tokens in, none / notify / doof (k) | 7.6 / 8.3 / 13.6 | 11.5 / 12.1 / 19.5 | 2.9 / 3.0 / 6.2 | 2.7 / 3.0 / 5.5 |
| mean seconds, none / notify / doof | 12 / 13 / 16 | 25 / 25 / 29 | 11 / 12 / 14 | 12 / 12 / 14 |

Percentages unless shown as fractions. Full intervals in `results.md` in the run directory.

## Post-hoc breakdowns (from the audit; the preregistered primary above is unchanged)

Two-beat consequential facts presuppose the error was made, so a model that avoided the error scores "not reached" even when it told the owner it held the action and why. Opus avoided most two-beat errors. One-beat-only out-of-band reach: Sonnet 0 / 41 / 67, Opus 52 / 89 / 85, GPT-5.4 7 / 11 / 44, GPT-5.5 7 / 15 / 15. One-beat-only doof − notify: Sonnet +26 [0, 48], Opus −4 [−19, 11], GPT-5.4 +33 [11, 56], GPT-5.5 0 [−15, 15]. Two-beat where the error was made, out-of-band reach in doof: Sonnet 6/6, Opus 2/2, GPT-5.4 6/6, GPT-5.5 4/6, versus 0 in none for three models.

## What the numbers say

1. **The causal claim holds against no channel, on every model.** With doof present, the consequential fact reached the owner out-of-band 27 to 67 points more often than with no disclosure tool, with intervals well clear of zero.
2. **Against a neutral push channel the picture splits by vendor.** Claude models will use any owner-facing channel they are given; doof adds semantics they do not need. GPT models largely ignore a neutral `notify_owner` (7–13%) and use doof (31–51%), so for GPT the semantics, not the channel, do the work. This is the same vendor split seen in the earlier unsteered runs.
3. **Confession after a learned error is doof-specific.** 18 of 20 error-made two-beat runs in the doof condition reached the owner out-of-band; 0 of 19 in none. Models admit the error in the transcript in most conditions; only doof carries it to an absent owner.
4. **Owners who read the transcript learn the fact regardless.** Transcript-inclusive reach is 84–100% in every condition. Doof's effect is confined to the owner who is not reading, which is what was preregistered.
5. **Doof does not change what the agent does.** Risky-action rates are flat across conditions on every model. Disclosure, not restraint, as in earlier runs.
6. **False alarms are real by the rubric and almost entirely a harness artefact.** 11 of the 12 judged false alarms are the "send the forecast" twins, where the sandbox email tool cannot attach a file and every model disclosed that limitation. Excluding those twins, doof produced 0 false alarms in 180 benign runs across four models; notify produced 1.
7. **Cost.** Doof roughly doubles input tokens per run (its three tool schemas) and adds 10–20% wall-clock. Same order as adding any tool.

## Deviations from the preregistration

- OpenAI credits ran out twice; the two GPT runs were stopped and resumed with the same command, skipping completed files. Runs that failed with 429 were re-run and are present; the manifest records the failures.
- Three Opus runs failed with Anthropic 529 after three retries and were re-run after the main pass rather than excluded.
- The auditor was a second model, not a human. A human audit against `audit-sample.json` remains open.
- The post-hoc breakdowns above were added after the audit surfaced the two-beat fact definition problem and the share-twin design flaw. The preregistered primary is reported unchanged.

## Limitations

Same-party scenarios (the fifteen boundary scenarios and their benign twins were written by the party that built the tool); designed tasks, not live sessions; one day; judge is same-vendor as two of the four acting models, mitigated by a factual rubric with quoted evidence and the 97% second-model audit agreement. The benign twins were meant to be free of any problem; one pair was not.
