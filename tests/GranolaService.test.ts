/**
 * Tests for GranolaService
 */

import { GranolaService, GranolaNote } from '../src/services/GranolaService';
import { requestUrl } from 'obsidian';

jest.mock('obsidian', () => ({ requestUrl: jest.fn() }));

const requestMock = requestUrl as jest.Mock;

const createNote = (overrides: Partial<GranolaNote> = {}): GranolaNote => ({
  id: 'not_1d3tmYTlCICgjy',
  title: 'Roadmap review',
  owner: { name: 'Alice Owner', email: 'alice@example.com' },
  created_at: '2026-10-01T15:00:00Z',
  updated_at: '2026-10-01T16:00:00Z',
  deleted_at: null,
  web_url: 'https://notes.granola.ai/d/abc',
  calendar_event: {
    event_title: 'Roadmap sync',
    scheduled_start_time: '2026-10-01T15:00:00Z',
    scheduled_end_time: '2026-10-01T15:30:00Z',
  },
  attendees: [
    { name: 'Alice Owner', email: 'alice@example.com' },
    { name: null, email: 'bob@example.com' },
  ],
  summary_text: 'Plain summary',
  summary_markdown: '## Summary',
  transcript: [
    {
      speaker: { source: 'microphone' },
      text: 'Let us start.',
      start_time: '2026-10-01T15:00:00Z',
      end_time: '2026-10-01T15:00:04Z',
    },
    {
      speaker: { source: 'speaker', name: 'Bob Builder' },
      text: 'Sounds good.',
      start_time: '2026-10-01T15:00:10Z',
      end_time: '2026-10-01T15:12:30Z',
    },
  ],
  ...overrides,
});

const ok = (json: unknown) => ({ status: 200, json });

describe('GranolaService', () => {
  let service: GranolaService;

  beforeEach(() => {
    requestMock.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    service = new GranolaService(0);
    service.configure('grn_test', 15, 0);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('convertToRawTranscript', () => {
    it('maps note metadata and transcript timing', () => {
      const transcript = service.convertToRawTranscript(createNote());

      expect(transcript.source).toBe('granola');
      expect(transcript.title).toBe('Roadmap review');
      expect(transcript.date.toISOString()).toBe('2026-10-01T15:00:00.000Z');
      expect(transcript.duration).toBe(13);
      expect(transcript.hash).toBe('granola-not_1d3tmYTlCICgjy');
      expect(transcript.sourceUrl).toBe('https://notes.granola.ai/d/abc');
      expect(transcript.rawContent).toBe('## Summary');
      expect(transcript.segments).toEqual([
        { speaker: 'Alice Owner', timestamp: 0, endTimestamp: 4, text: 'Let us start.' },
        { speaker: 'Bob Builder', timestamp: 10, endTimestamp: 750, text: 'Sounds good.' },
      ]);
    });

    it('combines speakers and attendees without duplicates', () => {
      const transcript = service.convertToRawTranscript(createNote());

      expect(transcript.participants).toEqual(['Alice Owner', 'Bob Builder', 'bob@example.com']);
    });

    it('resolves speakers from attribution and diarization labels', () => {
      const at = '2026-10-01T15:00:00Z';
      const transcript = service.convertToRawTranscript(createNote({
        transcript: [
          { speaker: { source: 'microphone', attribution: 'me' }, text: 'a', start_time: at, end_time: at },
          { speaker: { source: 'microphone', diarization_label: 'Speaker B' }, text: 'b', start_time: at, end_time: at },
          { speaker: { source: 'microphone', attribution: 'them' }, text: 'c', start_time: at, end_time: at },
          { speaker: { source: 'speaker' }, text: 'd', start_time: at, end_time: at },
        ],
      }));

      expect(transcript.segments.map(s => s.speaker)).toEqual(['Alice Owner', 'Speaker B', 'Unknown', 'Unknown']);
      expect(transcript.participants).not.toContain('Unknown');
    });

    it('falls back to the calendar event for title and duration', () => {
      const transcript = service.convertToRawTranscript(createNote({ title: null, transcript: [] }));

      expect(transcript.title).toBe('Roadmap sync');
      expect(transcript.duration).toBe(30);
      expect(transcript.segments).toEqual([]);
    });
  });

  describe('sync', () => {
    it('lists notes updated in the last week on first sync and imports them', async () => {
      const onSyncComplete = jest.fn().mockResolvedValue(undefined);
      const onSyncTimestamp = jest.fn();
      service.setCallbacks(onSyncComplete, jest.fn(), onSyncTimestamp);

      requestMock
        .mockResolvedValueOnce(ok({ notes: [createNote()], hasMore: false, cursor: null }))
        .mockResolvedValueOnce(ok(createNote()));

      const before = Date.now();
      const transcripts = await service.sync();

      const listUrl = new URL(requestMock.mock.calls[0][0].url);
      expect(listUrl.pathname).toBe('/v1/notes');
      const updatedAfter = Date.parse(listUrl.searchParams.get('updated_after') ?? '');
      expect(before - updatedAfter).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000 - 1000);
      expect(requestMock.mock.calls[0][0].headers.Authorization).toBe('Bearer grn_test');
      expect(requestMock.mock.calls[1][0].url).toContain('/v1/notes/not_1d3tmYTlCICgjy?include=transcript');

      expect(transcripts).toHaveLength(1);
      expect(onSyncComplete).toHaveBeenCalledWith(transcripts);
      expect(onSyncTimestamp).toHaveBeenCalledWith(expect.any(Number));
    });

    it('overlaps the previous sync window on later syncs', async () => {
      const lastSync = Date.parse('2026-10-05T12:00:00Z');
      service.configure('grn_test', 15, lastSync);
      requestMock.mockResolvedValueOnce(ok({ notes: [], hasMore: false, cursor: null }));

      await service.sync();

      const listUrl = new URL(requestMock.mock.calls[0][0].url);
      expect(listUrl.searchParams.get('updated_after')).toBe('2026-10-05T11:55:00.000Z');
    });

    it('follows list pagination cursors and skips deleted notes', async () => {
      const deleted = createNote({ id: 'not_deleted0000000', deleted_at: '2026-10-02T00:00:00Z' });
      requestMock
        .mockResolvedValueOnce(ok({ notes: [deleted], hasMore: true, cursor: 'next-page' }))
        .mockResolvedValueOnce(ok({ notes: [createNote()], hasMore: false, cursor: null }))
        .mockResolvedValueOnce(ok(createNote()));

      const transcripts = await service.sync();

      expect(new URL(requestMock.mock.calls[1][0].url).searchParams.get('cursor')).toBe('next-page');
      expect(requestMock).toHaveBeenCalledTimes(3);
      expect(transcripts.map(t => t.hash)).toEqual(['granola-not_1d3tmYTlCICgjy']);
    });

    it('fetches large transcripts from the paginated endpoint', async () => {
      const note = createNote();
      requestMock
        .mockResolvedValueOnce(ok({ notes: [note], hasMore: false, cursor: null }))
        .mockResolvedValueOnce({ status: 413 })
        .mockResolvedValueOnce(ok({ ...note, transcript: null }))
        .mockResolvedValueOnce(ok({ transcript: [note.transcript![0]], hasMore: true, cursor: 'c2' }))
        .mockResolvedValueOnce(ok({ transcript: [note.transcript![1]], hasMore: false, cursor: null }));

      const [transcript] = await service.sync();

      expect(requestMock.mock.calls[3][0].url).toContain('/v1/notes/not_1d3tmYTlCICgjy/transcript?');
      expect(new URL(requestMock.mock.calls[4][0].url).searchParams.get('cursor')).toBe('c2');
      expect(transcript.segments.map(s => s.text)).toEqual(['Let us start.', 'Sounds good.']);
    });

    it('skips a note that fails without failing the whole sync', async () => {
      const other = createNote({ id: 'not_other000000000' });
      requestMock
        .mockResolvedValueOnce(ok({ notes: [createNote(), other], hasMore: false, cursor: null }))
        .mockResolvedValueOnce({ status: 404 })
        .mockResolvedValueOnce(ok(other));

      const transcripts = await service.sync();

      expect(transcripts.map(t => t.hash)).toEqual(['granola-not_other000000000']);
    });

    it('stops and keeps the sync window when the key is rejected', async () => {
      const onSyncTimestamp = jest.fn();
      service.setCallbacks(jest.fn(), jest.fn(), onSyncTimestamp);
      requestMock.mockResolvedValueOnce({ status: 401 });

      await expect(service.sync()).rejects.toThrow('Invalid Granola API key');
      expect(onSyncTimestamp).not.toHaveBeenCalled();
    });

    it('does nothing without an API key', async () => {
      service.configure('', 15, 0);

      await expect(service.sync()).resolves.toEqual([]);
      expect(requestMock).not.toHaveBeenCalled();
    });
  });

  describe('testConnection', () => {
    it('reports success when notes can be listed', async () => {
      requestMock.mockResolvedValueOnce(ok({ notes: [], hasMore: false, cursor: null }));

      await expect(service.testConnection()).resolves.toEqual({ success: true, message: 'Connected to Granola' });
    });

    it('explains plan requirements on 403', async () => {
      requestMock.mockResolvedValueOnce({ status: 403 });

      const result = await service.testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toContain('Business or Enterprise');
    });
  });
});
