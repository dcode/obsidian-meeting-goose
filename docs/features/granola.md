# Granola Integration

MeetingMind syncs notes and transcripts from [Granola](https://granola.ai) through Granola's official API.

::: warning Plan requirement
Granola API keys are available on Granola's **Business** and **Enterprise** plans.
On another plan? See [Not on a Business Plan?](#not-on-a-business-plan) below.
:::

## Setup

1. **Create an API key** in the Granola desktop app.

2. **Configure in MeetingMind:**
   - Open **Settings → MeetingMind**
   - Enable **Granola sync**
   - Paste your API key
   - Click **Test Connection** to verify
   - Set your preferred sync interval

## Not on a Business Plan?

Without a Granola API key, you can still bring Granola meetings into MeetingMind with the [Folder Watcher](/features/folder-watcher):

1. Open the meeting in Granola and copy its transcript
2. Paste it into a new `.txt` file, one line per speaker turn in the form `Name: what they said`
3. Name the file with the date and title, for example `2026-10-01 Roadmap review.txt`
4. Save it in your watched folder. MeetingMind imports it automatically

The file name sets the meeting title and date. Manual imports do not sync automatically, and timestamps are estimated.

## Features

| Feature | Description |
|---------|-------------|
| **Auto-sync** | Notes sync automatically at your chosen interval |
| **Manual sync** | Click "Sync Now" anytime to fetch the latest notes |
| **Full transcript** | Speaker labels, timestamps, and full text, including very long meetings |
| **Participants** | Calendar attendees and identified speakers |
| **Granola summary** | Granola's own summary is kept alongside the import |

## What Gets Imported

- Meeting title (or the calendar event title)
- Scheduled date and duration
- Attendees and identified speakers
- Full transcript with timestamps
- A link back to the note in Granola

## How Syncing Works

- The first sync imports notes from the last 7 days.
- Granola only makes a note available once its AI summary is ready, so a meeting can appear a little after it ends.
- Each Granola note is imported once. Editing the note in Granola later does not create a duplicate.

## Speaker Labels

Granola records your microphone and your computer's audio separately. When Granola identifies a speaker by name, MeetingMind uses that name. Otherwise, your own lines are labelled with your name, and other speakers appear as **Unknown** or as an anonymous label such as **Speaker A**.

## Tips

- **Reprocess anytime**: Use "MeetingMind: Reprocess current note" to add AI enrichment
- **Combine with AI**: Enable Pro features to get vault-aware summaries, action items, and auto-linking on top of Granola transcripts
