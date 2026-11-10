/**
 * GranolaService - Granola public API integration
 * Fetches meeting notes and transcripts from Granola (https://docs.granola.ai)
 */

import { requestUrl } from 'obsidian';
import { RawTranscript, TranscriptSegment } from '../types';

const GRANOLA_API_URL = 'https://public-api.granola.ai/v1';

// Granola allows 5 requests/second sustained
const MIN_REQUEST_GAP_MS = 200;

// Notes only appear in the API once their summary is generated, so overlap
// each sync window to tolerate clock skew between us and Granola
const SYNC_OVERLAP_MS = 5 * 60 * 1000;

const INITIAL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

export interface GranolaUser {
  name: string | null;
  email: string;
}

export interface GranolaTranscriptItem {
  speaker: {
    source: 'microphone' | 'speaker';
    attribution?: 'me' | 'them';
    diarization_label?: string;
    name?: string;
  };
  text: string;
  start_time: string;
  end_time: string;
}

export interface GranolaNoteSummary {
  id: string;
  title: string | null;
  owner: GranolaUser;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface GranolaNote extends GranolaNoteSummary {
  web_url: string;
  calendar_event: {
    event_title: string | null;
    scheduled_start_time: string | null;
    scheduled_end_time: string | null;
  } | null;
  attendees: GranolaUser[];
  summary_text: string;
  summary_markdown: string | null;
  transcript: GranolaTranscriptItem[] | null;
}

interface GranolaPage {
  hasMore: boolean;
  cursor: string | null;
}

export class GranolaApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export class GranolaService {
  private apiKey: string = '';
  private lastSyncTimestamp: number = 0;
  private syncTimer: NodeJS.Timeout | null = null;
  private syncInterval: number = 15; // minutes
  private lastRequestAt: number = 0;
  private syncing: boolean = false;

  // Callbacks
  private onSyncComplete: ((transcripts: RawTranscript[]) => Promise<void>) | null = null;
  private onStatusChange: ((status: { status: string; message?: string }) => void) | null = null;
  private onSyncTimestamp: ((timestamp: number) => void) | null = null;

  constructor(private minRequestGapMs: number = MIN_REQUEST_GAP_MS) {}

  /**
   * Configure the Granola service
   */
  configure(apiKey: string, syncInterval: number, lastSyncTimestamp: number): void {
    this.apiKey = apiKey.trim();
    this.syncInterval = syncInterval;
    this.lastSyncTimestamp = lastSyncTimestamp;
  }

  /**
   * Set callback handlers
   */
  setCallbacks(
    onSyncComplete: (transcripts: RawTranscript[]) => Promise<void>,
    onStatusChange: (status: { status: string; message?: string }) => void,
    onSyncTimestamp?: (timestamp: number) => void
  ): void {
    this.onSyncComplete = onSyncComplete;
    this.onStatusChange = onStatusChange;
    this.onSyncTimestamp = onSyncTimestamp ?? null;
  }

  /**
   * Check if connected (has API key)
   */
  isConnected(): boolean {
    return !!this.apiKey;
  }

  /**
   * Test the API connection
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    if (!this.apiKey) {
      return { success: false, message: 'No API key configured' };
    }

    try {
      await this.request('/notes?page_size=1');
      return { success: true, message: 'Connected to Granola' };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Start background sync
   */
  startSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(() => {
      void this.sync().catch(() => {});
    }, this.syncInterval * 60 * 1000);

    // Initial sync
    void this.sync().catch(() => {});

    console.debug(`Meeting Goose: granola sync started (every ${this.syncInterval} minutes)`);
  }

  /**
   * Stop background sync
   */
  stopSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    console.debug('Meeting Goose: granola sync stopped');
  }

  /**
   * Trigger immediate sync
   */
  async sync(): Promise<RawTranscript[]> {
    if (!this.isConnected()) {
      console.debug('Meeting Goose: cannot sync - Granola not configured');
      return [];
    }
    if (this.syncing) {
      return [];
    }

    this.syncing = true;
    this.updateStatus('syncing', 'Syncing with Granola...');

    // Record the start time so notes updated mid-sync are picked up next time
    const syncStartedAt = Date.now();

    try {
      const transcripts = await this.fetchTranscriptsSince(this.lastSyncTimestamp);

      if (transcripts.length > 0 && this.onSyncComplete) {
        await this.onSyncComplete(transcripts);
      }

      this.lastSyncTimestamp = syncStartedAt;
      this.onSyncTimestamp?.(syncStartedAt);

      this.updateStatus('idle', `Synced ${transcripts.length} transcripts from Granola`);
      console.debug(`Meeting Goose: granola sync complete - ${transcripts.length} transcripts`);

      return transcripts;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Granola sync failed';
      console.error('Meeting Goose: granola sync failed', errorMessage);
      this.updateStatus('error', `Granola sync failed: ${errorMessage}`);
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  /**
   * Fetch notes updated since a given timestamp, with full transcripts
   */
  private async fetchTranscriptsSince(timestamp: number): Promise<RawTranscript[]> {
    const since = timestamp
      ? new Date(timestamp - SYNC_OVERLAP_MS)
      : new Date(Date.now() - INITIAL_LOOKBACK_MS);

    const summaries: GranolaNoteSummary[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({
        updated_after: since.toISOString(),
        page_size: '30',
      });
      if (cursor) params.set('cursor', cursor);

      const page = await this.request(`/notes?${params.toString()}`) as GranolaPage & {
        notes?: GranolaNoteSummary[];
      };
      summaries.push(...(page.notes ?? []));
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    const rawTranscripts: RawTranscript[] = [];
    for (const summary of summaries) {
      if (summary.deleted_at) continue;

      try {
        const note = await this.fetchNote(summary.id);
        const transcript = this.convertToRawTranscript(note);
        if (transcript.segments.length > 0) {
          rawTranscripts.push(transcript);
        }
      } catch (error: unknown) {
        // Auth and rate limit failures affect every note, so stop the sync
        if (error instanceof GranolaApiError && (error.status === 401 || error.status === 429)) {
          throw error;
        }
        console.error(`Meeting Goose: failed to fetch Granola note ${summary.id}`);
      }
    }

    return rawTranscripts;
  }

  /**
   * Fetch a single note, falling back to the paginated transcript endpoint
   * when the transcript is too large to return inline
   */
  private async fetchNote(id: string): Promise<GranolaNote> {
    const noteId = encodeURIComponent(id);

    try {
      return await this.request(`/notes/${noteId}?include=transcript`) as GranolaNote;
    } catch (error: unknown) {
      if (!(error instanceof GranolaApiError) || error.status !== 413) {
        throw error;
      }
    }

    const note = await this.request(`/notes/${noteId}`) as GranolaNote;
    const items: GranolaTranscriptItem[] = [];
    let cursor: string | null = null;

    do {
      const params = new URLSearchParams({ page_size: '100' });
      if (cursor) params.set('cursor', cursor);

      const page = await this.request(`/notes/${noteId}/transcript?${params.toString()}`) as GranolaPage & {
        transcript?: GranolaTranscriptItem[];
      };
      items.push(...(page.transcript ?? []));
      cursor = page.hasMore ? page.cursor : null;
    } while (cursor);

    return { ...note, transcript: items };
  }

  /**
   * Convert a Granola note to RawTranscript format
   */
  convertToRawTranscript(note: GranolaNote): RawTranscript {
    const items = note.transcript ?? [];
    const ownerName = note.owner?.name || note.owner?.email || 'Me';
    const firstStart = items.length > 0 ? Date.parse(items[0].start_time) : NaN;

    const segments: TranscriptSegment[] = items
      .filter(item => item.text?.trim())
      .map(item => {
        const start = Date.parse(item.start_time);
        const end = Date.parse(item.end_time);
        return {
          speaker: this.resolveSpeaker(item, ownerName),
          timestamp: Number.isNaN(start) || Number.isNaN(firstStart) ? 0 : Math.max(0, (start - firstStart) / 1000),
          endTimestamp: Number.isNaN(end) || Number.isNaN(firstStart) ? undefined : Math.max(0, (end - firstStart) / 1000),
          text: item.text.trim(),
        };
      });

    const attendeeNames = (note.attendees ?? []).map(a => a.name || a.email);
    const participants = Array.from(new Set([
      ...segments.map(s => s.speaker),
      ...attendeeNames,
    ])).filter(p => p && p !== 'Unknown');

    const event = note.calendar_event;
    const date = new Date(event?.scheduled_start_time || note.created_at);

    return {
      source: 'granola',
      title: note.title || event?.event_title || 'Untitled Meeting',
      date,
      duration: this.calculateDuration(items, event),
      participants,
      segments,
      sourceUrl: note.web_url,
      // Note IDs are stable, so later edits to the note are not re-imported
      hash: `granola-${note.id}`,
      rawContent: note.summary_markdown || note.summary_text || undefined,
    };
  }

  /**
   * Pick the best available speaker label for a transcript item
   */
  private resolveSpeaker(item: GranolaTranscriptItem, ownerName: string): string {
    const { speaker } = item;
    if (speaker?.name) return speaker.name;
    if (speaker?.attribution === 'me') return ownerName;
    if (speaker?.diarization_label) return speaker.diarization_label;
    if (speaker?.attribution === 'them') return 'Unknown';
    // On macOS the microphone is the note owner and system audio is everyone else
    return speaker?.source === 'microphone' ? ownerName : 'Unknown';
  }

  /**
   * Meeting length in minutes, from the transcript span or the calendar event
   */
  private calculateDuration(
    items: GranolaTranscriptItem[],
    event: GranolaNote['calendar_event']
  ): number {
    if (items.length > 0) {
      const start = Date.parse(items[0].start_time);
      const end = Date.parse(items[items.length - 1].end_time);
      if (!Number.isNaN(start) && !Number.isNaN(end) && end > start) {
        return Math.ceil((end - start) / 60000);
      }
    }

    if (event?.scheduled_start_time && event.scheduled_end_time) {
      const minutes = (Date.parse(event.scheduled_end_time) - Date.parse(event.scheduled_start_time)) / 60000;
      if (minutes > 0) return Math.ceil(minutes);
    }

    return 0;
  }

  /**
   * Make a rate-limited GET request to the Granola API
   */
  private async request(path: string): Promise<unknown> {
    const wait = this.lastRequestAt + this.minRequestGapMs - Date.now();
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
    this.lastRequestAt = Date.now();

    const response = await requestUrl({
      url: `${GRANOLA_API_URL}${path}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
      throw: false,
    });

    if (response.status === 200) {
      return response.json;
    }

    const messages: Record<number, string> = {
      401: 'Invalid Granola API key',
      403: 'Granola denied access. API keys require a Granola Business or Enterprise plan',
      404: 'Granola note not found',
      413: 'Granola transcript too large to return inline',
      429: 'Granola rate limit reached. Try again shortly',
    };
    throw new GranolaApiError(
      messages[response.status] ?? `Granola API error: ${response.status}`,
      response.status
    );
  }

  /**
   * Update status via callback
   */
  private updateStatus(status: string, message?: string): void {
    if (this.onStatusChange) {
      this.onStatusChange({ status, message });
    }
  }

  /**
   * Clean up when plugin is unloaded
   */
  destroy(): void {
    this.stopSync();
    this.onSyncComplete = null;
    this.onStatusChange = null;
    this.onSyncTimestamp = null;
  }
}
