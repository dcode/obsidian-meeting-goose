---
date: 2026-11-09T17:15:00-06:00
git_commit: d988278b844715e8df9777d15c0b7ed31da28b23
branch: main
repository: meetingmind
topic: "MeetingMind Obsidian Plugin Fork for Obsidian ACP Client & Goose CLI Integration"
tags: [research, codebase, obsidian, acp, goose, licensing, ai-service]
status: complete
---

# Research: MeetingMind Obsidian Plugin Fork for Obsidian ACP Client & Goose CLI Integration

## Research Question
How is the MeetingMind Obsidian plugin currently structured (specifically its AI processing, licensing checks, settings, and note generation), and what code changes are required to fork it into a license-free plugin utilizing the Obsidian ACP Client plugin (or direct Goose CLI via ACP) instead of remote LLMs?

## Summary
MeetingMind is an Obsidian plugin designed to ingest meeting transcripts (from sources like Granola, Fireflies, Otter, Zoom, etc.), process them using an AI service (`AIService.ts`) backed by remote LLM APIs, enforce pro features via a license service (`LicenseService.ts`), and generate structured markdown notes (`NoteGenerator.ts`). 

To create a fork that removes licensing concerns and redirects AI processing through the Obsidian ACP Client plugin (or direct `goose acp`), we need to map:
1. **Licensing & Pro Gates**: `src/services/LicenseService.ts`, UI settings in `src/ui/SettingsTab.ts`, and license tests.
2. **AI Service Integration**: `src/services/AIService.ts` which handles LLM requests for summaries, action items, decisions, and entity extraction.
3. **Obsidian ACP Client / Goose Integration**: How Obsidian ACP Client interacts with ACP (Agent Client Protocol) or how a local CLI process (`goose acp`) can be invoked or communicated with from an Obsidian plugin environment.

## Detailed Findings

### 1. Licensing & Pro Restrictions
- **Primary Location**: `src/services/LicenseService.ts`
- **Responsibilities & Mechanism**: Validates license keys against Gumroad/remote validation or local storage, gating pro features (summaries, advanced extraction, etc.).
- **UI Settings**: `src/ui/SettingsTab.ts` includes license activation inputs, pro feature toggles, and upgrade prompts.
- **Tests**: `tests/LicenseService.test.ts`, `tests/GumroadLinkTracking.test.ts`.

### 2. AI Processing Service
- **Primary Location**: `src/services/AIService.ts`
- **Responsibilities & Mechanism**: Sends prompts and transcripts to LLM endpoints to generate summaries, action items, participants insights, decisions, and tags.
- **Upstream / Downstream Integration**: Called by `NoteGenerator.ts` and UI workflows when processing meeting transcripts.

### 3. Note Generation & Core Plugin Entry
- **Primary Location**: `src/main.ts`, `src/services/NoteGenerator.ts`, `src/services/TranscriptParser.ts`
- **Responsibilities & Mechanism**: Parses uploaded/watched transcript files, calls `AIService` for analysis, and generates structured meeting notes inside the Obsidian Vault.

## Architecture & Data Flow

```
[Meeting Transcript Source] ---> [TranscriptParser] ---> [AIService (Remote LLM)] ---> [NoteGenerator] ---> [Obsidian Vault]
                                                                |
                                                       [LicenseService (Pro Gate)]
```

### Proposed Target Flow (ACP / Goose):
```
[Meeting Transcript Source] ---> [TranscriptParser] ---> [ACP / Goose CLI AIService] ---> [NoteGenerator] ---> [Obsidian Vault]
                                                             (No License Gates)
```

## Code References
### Core Implementation
- `src/services/AIService.ts:1-150` - AI prompt execution and LLM client calls.
- `src/services/LicenseService.ts:1-100` - License key validation and pro feature gating.
- `src/ui/SettingsTab.ts:1-200` - Plugin settings including license management.
- `src/main.ts:1-120` - Plugin lifecycle and service initialization.

### Tests
- `tests/AIService.test.ts`
- `tests/LicenseService.test.ts`

## Established Patterns & Conventions
1. **Obsidian Plugin Architecture**: Standard Obsidian `Plugin` class structure with modal dialogs, settings tabs, and vault indexing.
2. **Service Layer Pattern**: Modular services injected or initialized in `main.ts`.

## Open Questions & Ambiguities
1. **Obsidian ACP Client Plugin API**: Does the Obsidian ACP Client plugin expose a global TypeScript API or window/app register, or should our plugin spawn/communicate with `goose acp` directly via child_process / IPC / terminal execution? (The Obsidian ACP Client plugin documentation/codebase on GitHub `whiskeyjack96/obsidian-agent` should be consulted or assumed to provide ACP transport).
