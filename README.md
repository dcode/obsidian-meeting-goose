# Obsidian Meeting Goose

**Turn raw meeting transcripts into linked, actionable Obsidian notes — with AI enrichment that runs through your own local [Goose](https://github.com/block/goose) agent.**

Obsidian Meeting Goose imports meeting transcripts into your vault, links them to the notes you already have, and (optionally) asks a local agent for a summary, action items, decisions, tags, participant insights, and entity notes. There are no license keys, no paid tier, and no API keys stored in the plugin: the model and provider are whatever your Goose installation is configured to use.

> **Fork notice.** This is a fork of [MeetingMind](https://github.com/pattynextdoor/meetingmind) by Patrick Tumbucon, used under the MIT License. It is not affiliated with or endorsed by the original project. See [License and attribution](#license-and-attribution).

## What is different from MeetingMind

- **All features unlocked.** License validation and the Free/Pro split are gone.
- **AI goes through a local agent.** Instead of calling the Anthropic or OpenAI APIs directly, the plugin spawns `goose acp` and talks to it over the [Agent Client Protocol](https://agentclientprotocol.com) (ACP). Any ACP-speaking agent can be substituted in settings.

## Features

### Multi-source import
- **Fireflies.ai sync**: direct API integration
- **Granola sync**: direct API integration (Granola Business plan)
- **Meeting tool exports**: Otter.ai, Fathom, Zoom, Google Meet, Microsoft Teams, and others
- **Folder watcher**: import transcripts dropped into a watched folder
- **Manual import**: import individual files from the command palette
- **Supported formats**: VTT, SRT, TXT, JSON

### AI enrichment (optional)
- **Summaries** that scale with meeting length (TL;DR, key discussion points, context)
- **Action items** with assignees and due dates, as Obsidian tasks
- **Decisions** made during the meeting
- **Tag suggestions** that prefer tags already used in your vault
- **Participant insights** linked to each person's note
- **Entity extraction**: notes for issues and topics mentioned, with status tracking

### Auto-linking
- Creates `[[wiki-links]]` to existing notes, matching titles, explicit aliases, and implicit aliases
- Skips ambiguous matches and surfaces them as suggested links instead

### Participant tracking, formatting, dashboard
- Creates and updates a note per participant with their meeting history
- Clean Markdown with YAML frontmatter (Dataview compatible) and a collapsible full transcript
- A generated dashboard of meeting frequency, participant activity, and open action items

## Requirements

- Obsidian 1.4.0 or later, desktop only (macOS, Windows, Linux)
- For AI enrichment: [Goose](https://github.com/block/goose) installed and configured with a provider (`goose configure`), so that `goose acp` works from a terminal

## Installation

The plugin is not in the community plugin store. Install it manually:

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/dcode/obsidian-meeting-goose/releases/latest), or build them (see [Development](#development)).
2. Create the folder `.obsidian/plugins/meeting-goose/` in your vault.
3. Copy the three files into it.
4. Restart Obsidian and enable **Obsidian Meeting Goose** in Settings → Community plugins.

## Quick start

1. **Configure a source**: enable the folder watcher and set a watch folder, or connect Fireflies or Granola.
2. **Turn on AI enrichment** (optional) in Settings → Obsidian Meeting Goose → AI enrichment:
   - **Agent command**: `goose` by default. Use a full path if Obsidian cannot find it.
   - **Agent arguments**: `acp` by default.
   - Click **Test agent** to start the agent and send it a short prompt.
3. **Import a transcript**: drop a file in the watched folder, or run `Obsidian Meeting Goose: Import transcript file(s)`.

## How the agent is used

- The agent is started the first time it is needed and one process is reused. It is stopped when the plugin unloads or the agent command changes.
- Every prompt runs in its own ACP session, so prompts never share context. Importing one meeting sends several prompts (enrichment, participant insights, entities, status changes, description synthesis).
- Sessions use the system temp directory as their working directory, not your vault.
- The plugin offers the agent no file or terminal access and **declines every tool permission request**. It also starts the agent with `GOOSE_MODE=chat`, which tells Goose not to use tools at all. Transcripts are untrusted text; the agent only needs to read them and answer.
- A prompt that runs longer than 10 minutes is cancelled.

If you substitute another ACP agent, check how it handles tools: `GOOSE_MODE` means nothing to other agents, and an agent that runs its own tools without asking the client is not restrained by this plugin.

## Example output

```markdown
---
date: 2025-01-15
duration: 47
participants:
  - "[[Product Lead]]"
  - "[[Engineering Lead]]"
  - "[[Partner Lead]]"
source: otter
tags: [engineering, api, migration]
---

## Summary
Discussed timeline for the [[Enrollment API]] v2 migration.
Team decided to maintain backward compatibility through Q1.

## Action Items
- [ ] Draft deprecation timeline (@Partner Lead, due: Jan 20)
- [ ] Audit downstream consumers (@Engineering Lead)
- [ ] Schedule partner communication sync (@Product Lead)

## Decisions
- Keep v1 API available through end of Q1
- Prioritize mobile clients for v2 migration support

## Transcript
> [!note]- Full transcript (click to expand)
> 
> **Product Lead** (00:00): Alright, let's get started...
```

## Commands

All commands appear in the palette under `Obsidian Meeting Goose:`.

| Command | Description |
|---------|-------------|
| `Import transcript file(s)` | Import one or more transcript files |
| `Reprocess current note` | Re-run AI enrichment and auto-linking on the active meeting note |
| `Reprocess all meetings (add AI to existing notes)` | Enrich meeting notes that were imported without AI |
| `Generate meeting dashboard` | Create a stats dashboard with recent meetings and open action items |
| `Update dashboard` | Refresh the meeting dashboard |
| `Rebuild vault index` | Re-index notes for auto-linking |
| `Cleanup orphaned references` | Remove references to deleted meeting files from participant and entity notes |
| `Archive resolved issues` | Archive issue notes that have been resolved for a while |
| `View sync log` | Show recent sync activity |
| `Clear import history` | Allow re-importing transcripts |

## Network usage and privacy

The plugin itself only makes network requests for the sync sources you enable:

| Service | Host | Purpose |
|---------|------|---------|
| Fireflies.ai | `api.fireflies.ai` | Sync transcripts (when enabled) |
| Granola | `public-api.granola.ai` | Sync notes and transcripts (when enabled) |

The code also contains a dormant Otter.ai sync client (`otter.ai`); nothing in the settings UI enables it, and Otter transcripts are imported from exported files instead.

AI enrichment sends transcript text to the local agent process over stdin/stdout. Where it goes from there depends on how your agent is configured: a local model keeps everything on your machine, while a hosted provider receives your transcripts. The plugin collects no analytics and has no servers of its own.

## Development

```bash
npm install
```

```bash
npm run dev
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run lint
```

The ACP client is tested against `tests/fixtures/fake-acp-agent.mjs`, a small stand-in for `goose acp` built on the real ACP SDK, so the suite needs neither Goose nor a model.

After changing runtime dependencies, regenerate the bundled-license notices:

```bash
npm run notices
```

Project status and next steps are tracked in [ROADMAP.md](ROADMAP.md).

## License and attribution

MIT License — see [LICENSE](LICENSE).

- Original work: [MeetingMind](https://github.com/pattynextdoor/meetingmind), Copyright (c) 2025-2026 Patrick Tumbucon.
- Modifications in this fork: Copyright (c) 2026 Derek Ditch.
- [NOTICE](NOTICE) summarizes the fork's origin and changes.
- [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) reproduces the licenses of the packages bundled into `main.js`.
