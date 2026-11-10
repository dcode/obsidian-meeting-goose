# Roadmap

Working notes on where the fork stands and what is next. Update this file whenever work starts or lands.

_Last updated: 2026-11-10_

## Where things stand

The fork plan in `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md` is implemented in code:

- [x] **Phase 1 — licensing removed.** No `LicenseService`, no Gumroad calls, no Pro gates in `main.ts` or the settings tab; license CSS and tests deleted.
- [x] **Phase 2 — ACP / Goose integration.** `src/services/ACPService.ts` spawns `goose acp` and speaks ACP v1 via `@agentclientprotocol/sdk`. `AIService` sends every prompt through it. Settings: agent command, agent arguments, "Test agent" button.
- [x] **Phase 3 — automated tests.** `npm test`, `npm run build`, and `npm run lint` pass. The ACP client is exercised against a fake agent process, not mocks.
- [x] **Rebrand** to Meeting Goose (plugin id `meeting-goose`), README rewritten, MIT attribution kept, `NOTICE` and `THIRD-PARTY-NOTICES.md` added.
- [x] **Upstream marketing material removed**: docs site, landing page, blog content, logos, SEO scripts, and the content CI workflow.
- [x] **Version restarted at `0.1.0`** for the fork (`versions.json` reset).

## Next up

- [ ] **Manual test against a real Goose install** (the plan's manual checks; nothing has been run inside Obsidian yet):
  - [ ] Settings tab opens cleanly; "Test agent" succeeds with `goose acp`.
  - [ ] Import `test-files/demo/01-monday-standup.json` and check the generated note, participant notes, and entity notes.
  - [ ] Confirm Goose honours `GOOSE_MODE=chat` under `goose acp` (no tool calls), and that replies still arrive as `agent_message_chunk` text.
  - [ ] Confirm `goose` is found when Obsidian is launched from the dock/desktop (the `shell-env` PATH lookup), on macOS at least.
- [ ] **First release**: tag, attach `main.js`, `manifest.json`, `styles.css`.

## Later / ideas

- [ ] Close ACP sessions after each prompt when the agent advertises `sessionCapabilities.close` (each prompt currently leaves a finished session behind in the agent).
- [ ] Make the 10-minute prompt timeout a setting; local models can be slow on long transcripts.
- [ ] Surface agent failures in the sync log / a Notice with the stderr tail, not just the console.
- [ ] Batch the per-meeting prompts (enrichment, insights, entities) to cut agent round-trips.
- [ ] Remove or wire up the dormant Otter sync client (`OtterService` has no settings UI).
- [ ] Rewrite or delete `.cursor/rules/tech-stack.mdc`: it still describes the removed landing page, the Gumroad license check, and the direct Claude/OpenAI integration.
- [ ] Write a current architecture doc (the upstream `docs/ENGINEERING-FLOW.md` was removed with the docs site because it described the license check and remote APIs).
- [ ] A plugin icon/logo of our own, if wanted (upstream logos were removed).
- [ ] CI: bump the `actions/*` versions (the test matrix is now Node 20 and 22; the ACP SDK is untested on 18).
- [ ] Work down the ~90 `no-unsafe-*` lint warnings inherited from upstream.

## Reference

- Plan: `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md`
- Research: `thoughts/research/`
- ACP SDK docs: https://agentclientprotocol.github.io/typescript-sdk
