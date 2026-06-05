---
title: "LTS Deterministic Checklist Plan"
summary: "Plan for turning maturity scorecard claims into auditable release-support evidence packets"
read_when:
  - Designing deterministic LTS evidence packets from scorecard inputs
  - Auditing CLI support claims before an LTS or stable release
  - Reusing the checklist workflow for another OpenClaw surface
---

# LTS Deterministic Checklist Plan

This plan turns the current Clanker-generated maturity scorecard into an auditable release-support artifact. The goal is not to replace Clanker judgment. The goal is to force every proposed LTS claim into a repeatable evidence table that maintainers can inspect before an LTS or stable release.

## General Flow

The deterministic checklist answers one question for every proposed LTS feature:

> Can we prove this works today, and will CI or release validation catch it if it breaks?

Use this hierarchy:

```text
Surface
  -> Category
    -> Feature
      -> Evidence: docs, source, tests, CI/Testbox proof, known gaps
```

The maturity scorecard already defines the surfaces and categories. `LTS.md` marks which categories are proposed for the initial LTS slice. The checklist should not decide LTS policy directly. It should expose which promises are strongly backed, partially backed, missing proof, or require owner judgment.

## Deterministic Checklist Artifact

For each surface, produce one Markdown evidence packet:

```text
Surface: <surface name>
Snapshot:
- Scorecard ref:
- LTS ref:
- OpenClaw source ref:
- gitcrawl freshness:
- discrawl freshness:
- CI/Testbox source:

Summary:
- Included LTS categories:
- Strongly covered categories:
- Partial categories:
- Missing-proof categories:
- Owner-decision categories:

Feature Checklist:
| Category | Feature | Docs | Source | Test or proof | Latest CI/Testbox | Verdict | Gap | Next action |
```

Use these verdicts:

- `covered`: docs, source, and integration/e2e/live proof exist, and latest CI/Testbox proof is known.
- `partial`: implementation exists, but proof is unit-only, stale, platform-limited, or not tied to the user path.
- `missing`: no credible runtime-flow proof was found.
- `owner`: evidence exists, but whether it belongs in LTS is a product/support decision.

Do not let unit tests alone mark a feature as `covered`. Unit tests can support the row, but LTS coverage should be based on integration, e2e, live, or real runtime-flow proof.

## Agent Orchestration Model

Use Clankers as evidence collectors and reviewers.

Recommended roles:

- `surface-auditor`: builds the first checklist for one surface.
- `skeptic-reviewer`: attacks overclaims and downgrades weak rows.
- `ci-finder`: finds latest CI/Testbox proof for cited tests.
- `normalizer`: rewrites rows into the shared verdict vocabulary.

For high-risk surfaces, run two independent `surface-auditor` agents and compare disagreement. The useful output is often the conflict list, not the average answer.

## Standard Surface Auditor Prompt

```text
Audit only the <SURFACE> surface for the proposed LTS checklist.

Inputs:
- LTS source: docs/kevinslin/maturity-scorecard/LTS.md
- Scorecard source: docs/kevinslin/maturity-scorecard/maturity-scorecard.md
- Surface report: docs/kevinslin/maturity-scorecard/inventory/<surface-id>/report.md
- Surface score source: docs/kevinslin/maturity-scorecard/inventory/<surface-id>/scores.yaml
- Category notes: docs/kevinslin/maturity-scorecard/inventory/<surface-id>/*.md

Task:
For every category included in LTS.md for this surface:
1. Extract the user-facing features.
2. Cite docs that promise or explain the feature.
3. Cite implementation source that owns the feature.
4. Cite integration, e2e, live, or runtime-flow tests.
5. Find latest CI/Testbox proof for the cited tests when available.
6. Mark verdict as covered, partial, missing, or owner.
7. Explain the gap and the next action.

Rules:
- Do not change LTS policy.
- Do not score by vibes.
- A row without source plus runtime-flow proof is not covered.
- Unit tests alone are supporting evidence only.
- Prefer exact file paths and line references.
- Keep the final output to the checklist table plus a short gaps summary.
```

## Standard Skeptic Prompt

```text
Review this <SURFACE> LTS checklist.

Find:
- rows that overclaim coverage
- rows where unit tests are being counted as coverage
- rows where docs/source/test do not prove the same user-facing feature
- stale or missing CI/Testbox proof
- vague feature names
- categories that should be marked owner instead of covered

Return only actionable corrections:
| Row | Problem | Required correction | Severity |
```

## CLI Pilot

The CLI is the best first pilot because it is bounded, enterprise-relevant, and easier to connect to docs, source, tests, and release proof than provider or channel surfaces.

The proposed initial LTS slice includes 6 of 8 CLI categories:

- CLI Setup
- Onboarding and Auth Setup
- Gateway Service Management
- CLI Observability
- Doctor
- Updates and Upgrades

The deferred categories are:

- Plugin and Channel Setup
- Windows and WSL2

The CLI pilot should prove whether the included categories are actually backed by deterministic evidence, and whether any deferred category is obviously stronger than an included category.

## CLI Inputs To Read

Read these first:

- `docs/kevinslin/maturity-scorecard/LTS.md`
- `docs/kevinslin/maturity-scorecard/maturity-scorecard.md`
- `docs/kevinslin/maturity-scorecard/inventory/cli-install-update-onboard-doctor/report.md`
- `docs/kevinslin/maturity-scorecard/inventory/cli-install-update-onboard-doctor/scores.yaml`
- `docs/kevinslin/maturity-scorecard/inventory/cli-install-update-onboard-doctor/*.md`

Then read the product docs that match the categories:

- `docs/cli/index.md`
- `docs/cli/onboard.md`
- `docs/cli/configure.md`
- `docs/cli/doctor.md`
- `docs/cli/gateway.md`
- `docs/cli/health.md`
- `docs/cli/logs.md`
- `docs/cli/models.md`
- `docs/start/wizard-cli-automation.md`
- `docs/start/wizard-cli-reference.md`
- `docs/reference/wizard.md`

Use docs only as claims. Every claim still needs source and runtime proof.

## CLI Evidence Search Strategy

For each included category, search source and tests by command name and user workflow.

Suggested source searches:

```bash
rg -n "openclaw (onboard|configure|doctor|gateway|health|logs|models|update)" src packages ui extensions scripts test
rg -n "doctor|onboard|configure|gateway service|service install|update channel|auth profile|model set" src packages test
rg -n "program\\.command|subcommand|Command|commander|cac|yargs|parse" src packages
```

Suggested test searches:

```bash
rg -n "doctor|onboard|configure|gateway service|update|auth profile|models" --glob '*.{test,e2e.test}.ts' src packages test
rg -n "openclaw doctor|openclaw onboard|openclaw gateway|openclaw update" test scripts docs
```

Suggested proof searches:

```bash
gh run list -R openclaw/openclaw --limit 30 --json databaseId,headSha,conclusion,status,displayTitle,createdAt,url
gh pr checks <PR-or-branch> -R openclaw/openclaw
```

If local CI proof is not enough, mark the row `partial` and recommend Crabbox/Testbox proof.

## CLI Feature Table Template

Use this table as the CLI pilot output:

```markdown
| Category                   | Feature                                                      | Docs                                     | Source | Test or proof | Latest CI/Testbox | Verdict | Gap                                                      | Next action                          |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------------- | ------ | ------------- | ----------------- | ------- | -------------------------------------------------------- | ------------------------------------ |
| CLI Setup                  | Package install exposes `openclaw` CLI                       | `docs/start/getting-started.md`          | TBD    | TBD           | TBD               | partial | Need current package install smoke proof                 | Find release CI or add package smoke |
| Onboarding and Auth Setup  | `openclaw onboard` creates usable config/auth path           | `docs/cli/onboard.md`                    | TBD    | TBD           | TBD               | partial | Need non-interactive and interactive proof separated     | Audit onboarding tests               |
| Gateway Service Management | CLI can install/start/stop/status Gateway service            | `docs/cli/gateway.md`                    | TBD    | TBD           | TBD               | partial | Need Linux service proof if LTS includes Linux host path | Link service tests and Testbox run   |
| CLI Observability          | `openclaw health` and `openclaw logs` expose operator status | `docs/cli/health.md`, `docs/cli/logs.md` | TBD    | TBD           | TBD               | partial | Need running Gateway proof                               | Audit RPC/CLI e2e                    |
| Doctor                     | `openclaw doctor --fix` repairs supported config/auth drift  | `docs/cli/doctor.md`                     | TBD    | TBD           | TBD               | partial | Need migration fixture coverage                          | Audit doctor tests                   |
| Updates and Upgrades       | CLI supports supported update channel flow                   | TBD                                      | TBD    | TBD           | TBD               | partial | Need release/update smoke proof                          | Find release CI/Testbox run          |
```

Replace `TBD` with exact evidence. Do not leave `TBD` in the final artifact.

## CLI Definition Of Done

The CLI pilot is done when:

- Every included CLI LTS category has at least one feature row.
- Every feature row has docs, source, test/proof, verdict, gap, and next action.
- Rows without integration/e2e/live/runtime-flow proof are marked `partial` or `missing`.
- Latest CI/Testbox evidence is linked when available.
- A skeptic review has downgraded overclaims.
- The final summary names the top 3 CLI gaps Kevin needs to know before LTS.

## Likely CLI Outcomes

Expected useful outputs:

- A short list of CLI categories that are safe to keep in LTS.
- A short list of CLI categories that need one targeted integration or package smoke test.
- A short list of CLI claims that should be narrowed before announcement.
- A reusable checklist template for the next surface.

The most valuable result is not a high score. The most valuable result is a clear distinction between:

- "covered by current release gates"
- "implemented but not release-gated"
- "documented but weakly tested"
- "needs owner decision before support promise"

## Suggested First Day Plan

1. Run one `surface-auditor` on CLI.
2. Run one `ci-finder` on the cited CLI tests and release checks.
3. Run one `skeptic-reviewer` on the completed table.
4. Normalize the verdicts.
5. Send Kevin a concise packet:
   - CLI checklist
   - top 3 gaps
   - recommended test/proof additions
   - whether the checklist format should be repeated for Gateway runtime next
