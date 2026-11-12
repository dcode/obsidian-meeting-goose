/**
 * Tests for transcript normalization: Teams-style VTT in, clean transcript out.
 */

import { App } from 'obsidian';
import { TranscriptParser } from '../src/services/TranscriptParser';
import { NoteGenerator } from '../src/services/NoteGenerator';
import { normalizeTranscript } from '../src/services/transcriptNormalizer';
import { RawTranscript } from '../src/types';

const DOE = 'Doe, John A CTR USAF AFMC AFLCMC/HNCO';
const SMITH = 'Smith, Jane B Maj USAF ACC 16 AF/A6';

const TEAMS_VTT = `WEBVTT

3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d/12-0
00:00:03.120 --> 00:00:05.480
<v ${DOE}>Good morning everyone.</v>

3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d/12-1
00:00:05.480 --> 00:00:09.900
<v ${DOE}>Let's start with
the disk failures.</v>

3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d/31-0
00:00:10.200 --> 00:00:14.000
<v ${SMITH}>We lost two more overnight.</v>

3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d/44-0
00:00:14.500 --> 00:00:16.000
<v ${DOE}>Understood.</v>

3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d/44-1
00:01:02.000 --> 00:01:15.750
<v ${DOE}>I'll order replacements today.</v>
`;

const transcript = (segments: RawTranscript['segments'], participants: string[] = []): RawTranscript => ({
  source: 'local',
  title: 'Sync',
  date: new Date('2024-01-15T10:00:00Z'),
  duration: 2,
  participants,
  segments,
  hash: 'h',
});

describe('TranscriptParser on Teams VTT', () => {
  it('drops cue identifier lines and voice tags', async () => {
    const parsed = await new TranscriptParser().parseFile(TEAMS_VTT, '2024-01-15 Sync.vtt');

    expect(parsed.segments).toHaveLength(5);
    expect(parsed.segments.map(segment => segment.text)).toEqual([
      'Good morning everyone.',
      "Let's start with the disk failures.",
      'We lost two more overnight.',
      'Understood.',
      "I'll order replacements today.",
    ]);
    expect(JSON.stringify(parsed.segments)).not.toMatch(/3f2b8c1e|<\/?v/);
  });
});

describe('normalizeTranscript', () => {
  it('merges consecutive segments from one speaker across their whole time span', () => {
    const result = normalizeTranscript(transcript([
      { speaker: 'A', timestamp: 3, endTimestamp: 5, text: 'One.' },
      { speaker: 'A', timestamp: 5, endTimestamp: 9, text: 'Two.' },
      { speaker: 'B', timestamp: 10, endTimestamp: 14, text: 'Three.' },
      { speaker: 'A', timestamp: 14, endTimestamp: 16, text: 'Four.' },
      { speaker: 'A', timestamp: 62, text: 'Five.' },
    ]));

    expect(result.segments).toEqual([
      { speaker: 'A', timestamp: 3, endTimestamp: 9, text: 'One. Two.' },
      { speaker: 'B', timestamp: 10, endTimestamp: 14, text: 'Three.' },
      { speaker: 'A', timestamp: 14, endTimestamp: 62, text: 'Four. Five.' },
    ]);
  });

  it('does not merge unattributed segments', () => {
    const segments = [
      { speaker: '', timestamp: 0, text: 'First paragraph.' },
      { speaker: '', timestamp: 5, text: 'Second paragraph.' },
    ];
    expect(normalizeTranscript(transcript(segments)).segments).toEqual(segments);
  });

  it('shortens speaker names and keeps what it removed', () => {
    const result = normalizeTranscript(transcript(
      [
        { speaker: DOE, timestamp: 0, text: 'Hi.' },
        { speaker: 'Guest User', timestamp: 5, text: 'Hello.' },
      ],
      [DOE, 'Guest User', SMITH]
    ));

    expect(result.segments.map(segment => segment.speaker)).toEqual(['Doe, John CTR', 'Guest User']);
    expect(result.participants).toEqual(['Doe, John CTR', 'Guest User', 'Smith, Jane Maj']);
    expect(result.participantDetails).toEqual({
      'Doe, John CTR': {
        originalName: DOE, lastName: 'Doe', firstName: 'John', middleInitial: 'A',
        rank: 'CTR', branch: 'USAF', organization: 'AFMC AFLCMC/HNCO',
      },
      'Smith, Jane Maj': {
        originalName: SMITH, lastName: 'Smith', firstName: 'Jane', middleInitial: 'B',
        rank: 'Maj', branch: 'USAF', organization: 'ACC 16 AF/A6',
      },
    });
  });

  it('merges segments whose long names shorten to the same speaker', () => {
    const result = normalizeTranscript(transcript([
      { speaker: 'Doe, John A CTR USAF AFMC', timestamp: 0, endTimestamp: 2, text: 'One.' },
      { speaker: 'Doe, John A CTR USAF AFLCMC', timestamp: 2, endTimestamp: 4, text: 'Two.' },
    ], ['Doe, John A CTR USAF AFMC', 'Doe, John A CTR USAF AFLCMC']));

    expect(result.segments).toEqual([{ speaker: 'Doe, John CTR', timestamp: 0, endTimestamp: 4, text: 'One. Two.' }]);
    expect(result.participants).toEqual(['Doe, John CTR']);
  });

  it('leaves ordinary names and no details alone', () => {
    const result = normalizeTranscript(transcript([{ speaker: 'Sarah Chen', timestamp: 0, text: 'Hi.' }], ['Sarah Chen']));
    expect(result.participants).toEqual(['Sarah Chen']);
    expect(result.participantDetails).toBeUndefined();
  });

  it('is idempotent and keeps the details from the first pass', () => {
    const once = normalizeTranscript(transcript([{ speaker: DOE, timestamp: 0, endTimestamp: 2, text: 'Hi.' }], [DOE]));
    expect(normalizeTranscript(once)).toEqual(once);
  });

  it('does not modify its input', () => {
    const input = transcript([
      { speaker: DOE, timestamp: 0, endTimestamp: 2, text: 'One.' },
      { speaker: DOE, timestamp: 2, endTimestamp: 4, text: 'Two.' },
    ], [DOE]);
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeTranscript(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
  });
});

describe('Teams VTT end to end', () => {
  it('renders merged turns with short names and time ranges', async () => {
    const parsed = await new TranscriptParser().parseFile(TEAMS_VTT, '2024-01-15 Sync.vtt');
    const normalized = normalizeTranscript(parsed);

    const note = new NoteGenerator(new App()).buildNoteContent({
      transcript: normalized,
      autoLinks: new Map(),
      suggestedLinks: [],
    });

    expect(note).toContain('  - "[[Doe, John CTR]]"\n  - "[[Smith, Jane Maj]]"');
    expect(note).toContain([
      "> **Doe, John CTR** (00:03 --> 00:09): Good morning everyone. Let's start with the disk failures.",
      '> **Smith, Jane Maj** (00:10 --> 00:14): We lost two more overnight.',
      "> **Doe, John CTR** (00:14 --> 01:15): Understood. I'll order replacements today.",
    ].join('\n'));
    expect(note).not.toMatch(/3f2b8c1e|USAF|AFLCMC/);
  });

  it('shows a single timestamp for a segment with no duration', () => {
    const note = new NoteGenerator(new App()).buildNoteContent({
      transcript: transcript([
        { speaker: 'A', timestamp: 65, text: 'No end.' },
        { speaker: 'B', timestamp: 70, endTimestamp: 70, text: 'Zero length.' },
      ]),
      autoLinks: new Map(),
      suggestedLinks: [],
    });
    expect(note).toContain('> **A** (01:05): No end.\n> **B** (01:10): Zero length.');
  });
});
