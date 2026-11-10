---
date: 2026-11-09T17:17:00-06:00
git_commit: d988278b844715e8df9777d15c0b7ed31da28b23
branch: main
repository: meetingmind
topic: "MeetingMind Fork for Obsidian ACP Client & Goose CLI Integration (License-Free)"
research_artifact: "thoughts/research/2026-11-09-1715-meetingmind-obsidian-acp-fork.md"
status: implemented (manual verification against a real Goose install outstanding — see ROADMAP.md)
tags: [plan, implementation, rpi, acp, goose, obsidian]
---

# Implementation Plan: MeetingMind Fork for Obsidian ACP Client & Goose CLI Integration (License-Free)

## Overview
This engineering plan details the refactoring of the MeetingMind Obsidian plugin to:
1. **Remove all licensing restrictions**: Strip out `LicenseService.ts`, Gumroad integration, license activation prompts, and pro-feature gating so that all meeting summarization, tag generation, action item extraction, and entity extraction features are fully unlocked by default.
2. **Integrate ACP / Goose AI Processing**: Replace or refactor `AIService.ts` to utilize the Agent Client Protocol (ACP) via `@agentclientprotocol/sdk` and `child_process.spawn` (or integrate with the Obsidian ACP Client plugin mechanism) to route LLM prompts and transcript analysis through local `goose acp`.

## Baseline & Research Summary
- **Research Reference**: `thoughts/research/2026-11-09-1715-meetingmind-obsidian-acp-fork.md` & `thoughts/research/2026-11-09-1716-obsidian-agent-acp-client.md`
- **Key Architectural Findings**:
  - `src/services/AIService.ts`: Handles requests to remote LLM APIs (OpenAI / Anthropic / custom).
  - `src/services/LicenseService.ts`: Validates licenses and gates pro features.
  - `src/ui/SettingsTab.ts`: Contains license keys and API configurations.
  - `obsidian-agent` (`acp-client.ts`): Demonstrates how `@agentclientprotocol/sdk` and `child_process.spawn` run `goose acp` in Obsidian.

## Desired End State
- All license checks, Gumroad API calls, and pro gates are removed.
- `AIService.ts` (or a new `ACPService.ts`) spawns/interacts with `goose acp` via ACP SDK to process meeting transcripts and generate summaries, action items, decisions, and entities.
- Settings tab is simplified to configure ACP agent command (e.g. `goose`) and args (`acp`).

## Out of Scope
- Supporting remote proprietary LLM APIs directly in MeetingMind (replaced entirely by local ACP / Goose).
- Modifying the underlying `obsidian-agent` plugin repository itself (MeetingMind fork incorporates self-contained ACP client logic or communicates via ACP).

---

## Implementation Phases

### Phase 1: Removal of Licensing & Pro Gates

#### Objective & Scope
Strip out `LicenseService`, Gumroad license activation checks, and feature restrictions. Make all features available unconditionally.

#### File Modifications

##### 1. `src/services/LicenseService.ts`
- **Action**: Delete (or stub out if imported elsewhere).

##### 2. `src/ui/SettingsTab.ts`
- **Action**: Modify
- **Description**: Remove license key input fields, activation buttons, and upgrade banners. Retain general settings and ACP configuration.

##### 3. `src/main.ts`
- **Action**: Modify
- **Description**: Remove initialization and usage of `LicenseService`.

##### 4. `src/services/AIService.ts` & `src/services/NoteGenerator.ts`
- **Action**: Modify
- **Description**: Remove any `licenseService.isPro()` checks that restrict prompt generation or feature usage.

#### Success Criteria & Verification
- **Automated Verification**:
  - [x] TypeScript compilation succeeds: `npm run build` or `npx tsc --noEmit`
  - [x] Unit tests updated/passing without LicenseService dependencies.
- **Manual Verification**:
  - [ ] Settings tab opens cleanly without license prompts.

---

### Phase 2: Integration of ACP Client & Goose AI Service

#### Objective & Scope
Implement ACP client integration (`ACPClient` or wrapper) inside MeetingMind using `@agentclientprotocol/sdk` to spawn and communicate with `goose acp`.

#### File Modifications

##### 1. `package.json`
- **Action**: Modify
- **Description**: Add `@agentclientprotocol/sdk` and `shell-env` dependencies.

##### 2. `src/types.ts` & `src/settings.ts` (or `src/ui/SettingsTab.ts`)
- **Action**: Modify
- **Description**: Add settings for ACP agent command (default `goose`) and arguments (default `acp`).

##### 3. `src/services/ACPService.ts` (New File)
- **Action**: Create
- **Description**: Implement process spawning (`child_process.spawn`), stream bridging, and ACP session initialization / prompting using `@agentclientprotocol/sdk`.

##### 4. `src/services/AIService.ts`
- **Action**: Modify
- **Description**: Refactor `AIService` to delegate prompt execution and transcript processing to `ACPService`.

#### Success Criteria & Verification
- **Automated Verification**:
  - [x] Typecheck passes: `npx tsc --noEmit`
- **Manual Verification**:
  - [ ] Plugin successfully spawns `goose acp` when processing a meeting transcript.

---

### Phase 3: End-to-End Testing & Polish

#### Objective & Scope
Verify full transcript ingestion, ACP AI processing, and note generation in Obsidian.

#### File Modifications
- Update unit tests in `tests/AIService.test.ts` and `tests/integration.test.ts` to mock ACP client responses.

#### Success Criteria & Verification
- **Automated Verification**:
  - [x] All unit tests pass: `npm test`
- **Manual Verification**:
  - [ ] Import a mock transcript in Obsidian and verify that MeetingMind generates a clean markdown note using `goose acp`.

---

## Testing & Quality Assurance Strategy

### Unit Tests
- `tests/AIService.test.ts`: Test ACP prompt submission and structured output parsing.

### Rollback & Migration Plan
- Git branches allow instant rollback if ACP communication encounters edge cases.

---

## Implementation Notes (2026-11-10)

Deviations from the plan as written, recorded so the plan and the code agree:

- **SDK version.** `@agentclientprotocol/sdk@0.0.1` was never published; the plugin uses `^2.5.0` (stable ACP v1 entrypoint). Its API is `client().connect(ndJsonStream(...))` plus `buildSession(cwd).start()`, not the `ClientSideConnection`/`StreamTransport` shape assumed in the research notes.
- **AIService keeps its role.** It still builds prompts and parses replies; only the transport changed. It takes a `PromptRunner` (implemented by `ACPService`) in its constructor, which is also what the tests fake.
- **Settings.** `aiProvider`, `aiModel`, `claudeApiKey`, `openaiApiKey` and the license fields are removed, and stripped from `data.json` on load. New: `acpAgentCommand` (`goose`) and `acpAgentArgs` (`acp`).
- **Tool use is locked down.** Permission requests are declined, sessions run in the temp dir, and the agent is started with `GOOSE_MODE=chat`. Not in the original plan.
- **Tests.** `tests/AIService.test.ts` covers AIService with a fake runner; `tests/ACPService.test.ts` runs the real SDK against `tests/fixtures/fake-acp-agent.mjs`. `LicenseService.test.ts` and `GumroadLinkTracking.test.ts` are deleted.
- **Manual verification is still open** for all three phases: nothing here has been run inside Obsidian or against a real `goose acp`.
