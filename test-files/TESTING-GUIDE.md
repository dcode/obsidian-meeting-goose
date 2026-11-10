# Obsidian Meeting Goose Testing Guide

## Quick Test Steps

### 1. Basic Import Test (No AI)

1. Open Obsidian with your test vault
2. Press `Cmd+P` (Mac) or `Ctrl+P` (Windows)
3. Type "Obsidian Meeting Goose: Import file"
4. Select one of the test files:
   - `sample-otter-export.json` - Otter.ai style export
   - `sample-meeting.vtt` - WebVTT format
   - `simple-meeting.txt` - Plain text format

**Expected result**: A new note appears in your `Meetings` folder with:
- YAML frontmatter (date, duration, attendees, source)
- A collapsible transcript section

---

### 2. Auto-Linking Test

To test auto-linking, first create these notes in your vault:

1. Create `Engineering Lead.md`:
```markdown
---
aliases: [Engineering]
---
# Engineering Lead
Engineering Lead
```

2. Create `Product Lead.md`:
```markdown
# Product Lead
Product Manager
```

3. Create `Enrollment API.md`:
```markdown
# Enrollment API
Our main customer-facing API for enrollment services.
```

4. Create `Project Alpha.md`:
```markdown
# Project Alpha
Our flagship integration project.
```

Then import a transcript. You should see:
- `[[Engineering Lead]]` or `[[Engineering Lead|Engineering]]` auto-linked
- `[[Enrollment API]]` auto-linked
- `[[Project Alpha]]` auto-linked

---

### 3. AI Enrichment Test

1. Go to Settings → Obsidian Meeting Goose → AI Enrichment
2. Enable AI enrichment
3. Set the agent command (default `goose`) and arguments (default `acp`)
4. Click "Test agent" to verify
5. Import a transcript

**Expected result**: The note will include:
- A Summary section
- Action Items (as Obsidian tasks)
- Decisions (bulleted list)
- Suggested tags in frontmatter

---

### 4. Folder Watcher Test

1. Go to Settings → Obsidian Meeting Goose → Sources
2. Enable "Folder watcher"
3. Set watch folder to something like `Transcripts/Import`
4. Create that folder in your vault
5. Copy a transcript file into that folder

**Expected result**: Within 5 seconds, the transcript is automatically imported.

---

### 5. Command Palette Commands

Test each command via `Cmd+P` / `Ctrl+P`:

| Command | What to Expect |
|---------|----------------|
| Obsidian Meeting Goose: Import file | Opens file picker |
| Obsidian Meeting Goose: Rebuild vault index | Notification confirms rebuild |
| Obsidian Meeting Goose: View sync log | Opens modal with activity log |
| Obsidian Meeting Goose: Sync now | Triggers Otter sync (needs setup) |

---

### 6. Status Bar

Look at the bottom-right status bar:
- ✓ (checkmark) = Idle
- 🔄 (spinner) = Syncing/Processing
- ⚠️ (warning) = Error

Click the icon to open the sync log.

---

## Test Files Location

```
test-files/
├── sample-otter-export.json   # Otter.ai JSON format
├── sample-meeting.vtt         # WebVTT format  
├── simple-meeting.txt         # Plain text format
├── test-wins-and-status.json  # Test wins extraction
├── test-status-changes.json   # Test entity status updates
├── QUICK-TEST-CHECKLIST.md    # Quick testing checklist
├── TESTING-GUIDE.md           # This file (basic features)
└── TESTING-GUIDE-NEW-FEATURES.md  # New features testing guide
```

## Testing New Features

For testing wins extraction, entity status updates, Top of Mind/Archive, and refresh command, see:
- **`TESTING-GUIDE-NEW-FEATURES.md`** - Comprehensive guide
- **`QUICK-TEST-CHECKLIST.md`** - Quick verification checklist

## Troubleshooting

### Plugin not showing in settings?
- Make sure folder is named `meeting-goose`
- Restart Obsidian
- Check Developer Console (Cmd+Option+I) for errors

### Import not working?
- Check the Meetings folder was created
- Look at sync log (click status bar)
- Check Developer Console for errors

### Auto-linking not working?
- Run "Rebuild vault index" command
- Check that notes exist with matching names
- Check excluded folders in settings
