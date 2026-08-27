# Demo Files

This folder contains everything needed to record the MeetingMind demo video.

## Scenario: "The New Hire"

You're a senior software engineer starting at a new company. Your team has a lot of moving parts—projects, issues, and people you haven't met yet. You have recordings from your first week of meetings.

## The Cast

| Name | Role |
|------|------|
| **New Engineer** | Senior Engineer |
| **Engineering Manager** | Engineering Manager |
| **Technical Lead** | Tech Lead |
| **Frontend Lead** | Frontend Engineer |
| **Backend Lead** | Backend Engineer |
| **Platform Lead** | DevOps |

## Transcript Files

| File | Meeting Type | Duration | Attendees |
|------|--------------|----------|-----------|
| `01-monday-standup.json` | Daily Standup | 12 min | Technical, Frontend, Backend, Platform Leads |
| `02-architecture-review.json` | Technical Review | 35 min | Technical, Backend, Platform Leads |
| `03-wednesday-standup.json` | Daily Standup | 10 min | Technical, Frontend, Backend Leads |
| `04-manager-1on1.json` | 1:1 | 28 min | Engineering Manager, New Engineer |

## Key Content Across Meetings

**Projects/Topics:**
- Platform Migration (the big Q2 initiative)
- Checkout Service (being redesigned)
- Metrics Dashboard (owned by the Frontend Lead)
- Auth Service (has issues)

**Issues:**
- Auth Token Refresh Bug (causes cart abandonment)
- CI Pipeline Slowdown (the Platform Lead is fixing)

## Vault Structure

The `vault/` folder contains the initial state for the demo:

```
vault/
├── Platform Migration.md    # Project stub
└── People/                  # Empty (populated by MeetingMind)
```

## Usage

### 1. Reset the Demo Vault

```bash
# Reset to a specific path
./reset-vault.sh /path/to/your/demo-vault

# Or use default path
./reset-vault.sh
```

### 2. Configure MeetingMind

In Obsidian settings:
- **Output folder:** `Meetings`
- **People folder:** `People`
- **AI enrichment:** Enabled
- **Entity extraction:** Enabled

### 3. Import Transcripts

Use `MeetingMind: Import file` command to import each transcript:
1. `01-monday-standup.json`
2. `02-architecture-review.json`
3. `03-wednesday-standup.json`
4. `04-manager-1on1.json`

### 4. Expected Results

After importing all 4 meetings, you should have:

```
Demo Vault/
├── Meetings/
│   ├── Monday Standup.md
│   ├── Architecture Review - Checkout Service.md
│   ├── Wednesday Standup.md
│   └── 1-1 with Engineering Manager.md
├── People/
│   ├── Engineering Manager.md
│   ├── New Engineer.md
│   ├── Technical Lead.md
│   ├── Frontend Lead.md
│   ├── Backend Lead.md
│   └── Platform Lead.md
├── Issues/
│   ├── Auth Token Refresh Bug.md
│   └── CI Pipeline Slowdown.md
├── Topics/
│   ├── Checkout Service.md
│   ├── Metrics Dashboard.md
│   ├── Platform Migration.md (or linked to existing)
│   └── ...
└── Platform Migration.md
```

## Demo Script

See `DEMO-SCRIPT.md` in the `docs/demos/` folder for the full recording script.
