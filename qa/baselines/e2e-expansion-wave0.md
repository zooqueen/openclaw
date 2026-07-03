# E2E Expansion Wave 0 Baseline

Baseline source revision: `df1452799b28782ebfe273b4dcaf779cf34ced38`  
Tracking issue: https://github.com/openclaw/openclaw/issues/99621  
Scope: Wave 0 Lanes 0A and 0E only.

## Repository Alignment

- The branch matched `origin/main` at the captured source revision.
- Merged PR #99310 commit `8604dbdc93fb8eea3db3891944e60ede6b0625f2` is present in history.
- QA Lab uses `@openclaw/crabline` `0.1.8`.
- All seven public bridge adapters started and probed through `startOpenClawCrablineAdapter`: Telegram, Slack, WhatsApp, Matrix, Signal, Mattermost, and Zalo.

## Inventory

| Metric                        | Baseline |
| ----------------------------- | -------: |
| Canonical YAML scenarios      |      155 |
| Coverage IDs                  |      209 |
| Primary coverage IDs          |      137 |
| Secondary coverage IDs        |      100 |
| Missing coverage IDs          |        0 |
| Overlapping coverage IDs      |       64 |
| Flow scenarios                |      120 |
| Script scenarios              |       16 |
| Vitest scenarios              |       18 |
| Playwright scenarios          |        1 |
| Legacy live catalog scenarios |       82 |
| Duplicate canonical IDs       |        0 |
| Duplicate legacy live IDs     |        0 |
| Cross-catalog duplicate IDs   |        0 |

The complete scenario list, execution kinds, source paths, and coverage claims are in `qa/baselines/e2e-expansion-wave0.json`.

The live catalog total is Discord 6, Slack 9, Telegram 16, and WhatsApp 51. The separate coverage-lane inventory maps 20 of those live scenarios into the standard coverage report.

## Real-Boundary Findings

The plan-listed helper-backed primary claims remain visible in the machine-readable inventory. The two converted references are marked completed:

- `channel-message-flows`: canonical transport-native flow from merged #99310.
- `native-command-session-target`: existing canonical transport-native flow.

The remaining listed claims retain their current helper/Vitest ownership for later Wave 1+ conversion. Three plan names are not canonical scenario IDs at this revision: `active-talk-agent-run-status`, `voice-call-cli-rpc-agent-tool`, and `telegram-bot-token`.

## #99310 Adoption

Alignment was verified across:

- scenario schema validation;
- flow execution and runtime API;
- QA Channel state/delivery behavior;
- Crabline Telegram recorder normalization;
- canonical YAML scenario;
- focused tests;
- `.agents/skills/channel-message-flows/SKILL.md`.

| Check                                             | Result                    | Duration |
| ------------------------------------------------- | ------------------------- | -------: |
| `channel-message-flows` through QA Channel        | Passed                    |  10.045s |
| `channel-message-flows` through Crabline Telegram | Passed                    |  11.381s |
| Focused #99310 Vitest set                         | 200 passed across 9 files |  11.690s |

QA Channel observed `sent -> edited -> edited -> edited`; Crabline Telegram observed `sent -> edited`. Both resolved to the required final marker.

## Existing Smoke Baseline

| Surface / scenario                              | Runner                  | Result          |   Duration |
| ----------------------------------------------- | ----------------------- | --------------- | ---------: |
| Crabline public bridge startup/probe, 7 bridges | Host                    | 7 passed        | 43ms total |
| `docker-compose-setup`                          | Testbox through Crabbox | Passed          |    23.469s |
| `gateway-smoke`                                 | Testbox through Crabbox | Passed          |     1.052s |
| `mcp-gateway-connect-startup-retry`             | Testbox through Crabbox | Passed          |    11.709s |
| `webchat-auto-tts`                              | Testbox through Crabbox | Passed          |     3.984s |
| `hosted-image-generation-providers-live`        | Host live script        | 2 checks passed |   101.951s |
| Matrix fast profile                             | Testbox through Crabbox | 15/15 passed    |    60.708s |

Remote proof used Blacksmith Testbox through Crabbox lease `tbx_01kwmn13d2ttf48fq8z555027v`.

## Blocked Live Lanes

Discord, Slack, Telegram, and WhatsApp live channel lanes are credential-blocked in this session. Their required environment variables are absent, and no Convex credential broker configuration is available. This is recorded as blocked baseline state, not passing coverage. Hosted live image generation did have a safe configured credential path and passed.

## Remaining Wave 0 Gaps

- PR #99374 remains open; its shared script evidence writer integration belongs to Lane 0C, not this assigned Lane 0A/0E scope.
- Real-boundary remediation findings are inventory only here; implementation belongs to later waves.
- No Wave 1+ transport schema, evidence writer, or duplicate-ID validator implementation is included.

## Reproduction

```bash
node scripts/run-node.mjs qa coverage --json --output tmp/wave0/qa-coverage.json
OPENCLAW_BUILD_PRIVATE_QA=1 node scripts/run-node.mjs qa suite --provider-mode mock-openai --scenario channel-message-flows --channel-driver qa-channel
OPENCLAW_BUILD_PRIVATE_QA=1 node scripts/run-node.mjs qa suite --provider-mode mock-openai --scenario channel-message-flows --channel-driver crabline --channel telegram
```

Broader smoke and Matrix commands are recorded in `qa/baselines/e2e-expansion-wave0.json` with runner/provider details.
