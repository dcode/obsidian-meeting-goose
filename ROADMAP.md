# Roadmap

Working notes on where the fork stands and what is next. Update this file whenever work starts or lands.

_Last updated: 2026-11-10_

## Where things stand

The fork plan in `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md` is implemented in code:

- [x] **Phase 1 — licensing removed.** No `LicenseService`, no Gumroad calls, no Pro gates in `main.ts` or the settings tab; license CSS and tests deleted.
- [x] **Phase 2 — ACP / Goose integration.** `src/services/ACPService.ts` spawns `goose acp` and speaks ACP v1 via `@agentclientprotocol/sdk`. `AIService` sends every prompt through it. Settings: agent command, agent arguments, "Test agent" button.
- [x] **Phase 3 — automated tests.** `npm test`, `npm run build`, and `npm run lint` pass. The ACP client is exercised against a fake agent process, not mocks.
- [x] **Rebrand** to Obsidian Meeting Goose (plugin id `meeting-goose`), README rewritten, MIT attribution kept, `NOTICE` and `THIRD-PARTY-NOTICES.md` added.

## Next up

- [ ] **Manual test against a real Goose install** (the plan's manual checks; nothing has been run inside Obsidian yet):
  - [ ] Settings tab opens cleanly; "Test agent" succeeds with `goose acp`.
  - [ ] Import `test-files/demo/01-monday-standup.json` and check the generated note, participant notes, and entity notes.
  - [ ] Confirm Goose honours `GOOSE_MODE=chat` under `goose acp` (no tool calls), and that replies still arrive as `agent_message_chunk` text.
  - [ ] Confirm `goose` is found when Obsidian is launched from the dock/desktop (the `shell-env` PATH lookup), on macOS at least.
- [ ] **Decide what to do with the upstream marketing material**: `docs/`, `content/`, `frontend/`, `CONTENT.md`, `assets/logos/`, `logo.svg`, `scripts/` (SEO/OG checks), `.github/workflows/content.yml`, `.cursor/rules/`. They still describe MeetingMind, its Pro tier, and meetingmind.me. Delete, or rewrite for this fork.
- [ ] **Versioning for the fork.** Still `1.2.4` inherited from upstream; decide whether to restart at `0.1.0` (and reset `versions.json`) before the first release.
- [ ] **First release**: tag, attach `main.js`, `manifest.json`, `styles.css`.

## Later / ideas

- [ ] Close ACP sessions after each prompt when the agent advertises `sessionCapabilities.close` (each prompt currently leaves a finished session behind in the agent).
- [ ] Make the 10-minute prompt timeout a setting; local models can be slow on long transcripts.
- [ ] Surface agent failures in the sync log / a Notice with the stderr tail, not just the console.
- [ ] Batch the per-meeting prompts (enrichment, insights, entities) to cut agent round-trips.
- [ ] Remove or wire up the dormant Otter sync client (`OtterService` has no settings UI).
- [ ] Community store submission would need a name and id without "Obsidian" in them.
- [ ] CI: bump the `actions/*` versions (the test matrix is now Node 20 and 22; the ACP SDK is untested on 18).
- [ ] Work down the ~90 `no-unsafe-*` lint warnings inherited from upstream.

## Reference

- Plan: `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md`
- Research: `thoughts/research/`
- ACP SDK docs: https://agentclientprotocol.github.io/typescript-sdk
