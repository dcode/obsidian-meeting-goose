# Roadmap

Working notes on where the fork stands and what is next. Update this file whenever work starts or lands.

_Last updated: 2026-11-12_

## Where things stand

The fork plan in `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md` is implemented in code:

- [x] **Phase 1 — licensing removed.** No `LicenseService`, no Gumroad calls, no Pro gates in `main.ts` or the settings tab; license CSS and tests deleted.
- [x] **Phase 2 — ACP / Goose integration.** `src/services/ACPService.ts` spawns `goose acp` and speaks ACP v1 via `@agentclientprotocol/sdk`. `AIService` sends every prompt through it. Settings: agent command, agent arguments, "Test agent" button.
- [x] **Phase 3 — automated tests.** `npm test`, `npm run build`, and `npm run lint` pass. The ACP client is exercised against a fake agent process, not mocks.
- [x] **Rebrand** to Meeting Goose (plugin id `meeting-goose`), README rewritten, MIT attribution kept, `NOTICE` and `THIRD-PARTY-NOTICES.md` added.
- [x] **Verified against real Goose** (2026-11-12): a `.vtt` import produced notes end to end.
- [x] **Agent failures are visible**: Notice plus sync log entry; unusable replies fail with an excerpt.
- [x] **Lenient reply parsing** (`src/services/jsonReply.ts`): our string-escaping pass, then `jsonrepair`.
- [x] **Two prompts per meeting** instead of four-plus-one-per-note: one analysis prompt (summary as tagged markdown, the rest as compact JSON, transcript sent once) and one batched prompt for all person/issue/topic description rewrites.
- [x] **Upstream marketing material removed**: docs site, landing page, blog content, logos, SEO scripts, and the content CI workflow.
- [x] **Version restarted at `0.1.0`** for the fork (`versions.json` reset).

## Next up

- [ ] **Re-test against real Goose after the two-prompt change.** The new prompt format (tagged summary plus JSON data, batched note updates) has only been tested with a fake agent:
  - [ ] Import a short transcript and a long (chunked) one; check the meeting note, participant notes, and entity notes.
  - [ ] Import a second meeting with the same people and topics, to exercise the batched description rewrite and status updates on existing notes.
  - [ ] Confirm Goose honours `GOOSE_MODE=chat` under `goose acp` (no tool calls).
  - [ ] Confirm `goose` is found when Obsidian is launched from the dock/desktop (the `shell-env` PATH lookup), on macOS at least.
- [x] **Build/release workflow** (`.github/workflows/release.yml`): artifact on every PR and push to `main`, draft GitHub release on a version tag.
- [ ] **First release**: push tag `0.1.0`, then publish the draft release the workflow creates.

## Later / ideas

- [ ] Close ACP sessions after each prompt when the agent advertises `sessionCapabilities.close` (each prompt currently leaves a finished session behind in the agent).
- [ ] Make the 10-minute prompt timeout a setting; local models can be slow on long transcripts.
- [ ] Show progress during long imports (which step, which chunk).
- [ ] Long transcripts still cost one analysis prompt per ~30-minute chunk, and chunk summaries are joined rather than re-summarized. Revisit the chunk size (it is sized for small context windows) or add a final merge prompt.
- [ ] The known-entities list in the analysis prompt grows with the vault; cap or filter it once there are hundreds of issue/topic notes.
- [ ] Remove or wire up the dormant Otter sync client (`OtterService` has no settings UI).
- [ ] Write a current architecture doc (the upstream `docs/ENGINEERING-FLOW.md` was removed with the docs site because it described the license check and remote APIs).
- [ ] A plugin icon/logo of our own, if wanted (upstream logos were removed).
- [ ] CI: bump the `actions/*` versions (the test matrix is now Node 20 and 22; the ACP SDK is untested on 18).
- [ ] Work down the ~90 `no-unsafe-*` lint warnings inherited from upstream.

## Reference

- Plan: `thoughts/plans/2026-11-09-1717-meetingmind-acp-fork-plan.md`
- Research: `thoughts/research/`
- ACP SDK docs: https://agentclientprotocol.github.io/typescript-sdk
