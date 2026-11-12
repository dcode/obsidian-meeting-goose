/**
 * Deterministic clean-up of a parsed transcript, done before anything is
 * written to the vault or sent to the agent:
 *
 * - Speaker names are shortened to "Last, First Rank" (see speakerName.ts) and
 *   the parts removed are kept in participantDetails for the person's note.
 * - Consecutive segments from the same speaker are merged into one, spanning
 *   from the first segment's start to the last one's end.
 *
 * Captioning tools emit a cue every few seconds, so a single remark arrives as
 * many segments, each repeating a long display name. Merging makes the
 * transcript readable and cuts the tokens the agent has to read.
 */

import { RawTranscript, TranscriptSegment } from '../types';
import { parseSpeakerName, SpeakerDetails } from './speakerName';

export function normalizeTranscript(transcript: RawTranscript): RawTranscript {
  const participantDetails: Record<string, SpeakerDetails> = { ...transcript.participantDetails };
  const displayNames = new Map<string, string>();

  const displayName = (rawName: string): string => {
    if (!rawName) return rawName;
    let display = displayNames.get(rawName);
    if (display === undefined) {
      const parsed = parseSpeakerName(rawName);
      display = parsed.display;
      displayNames.set(rawName, display);
      // Keep the fullest record: a re-parsed short name knows less than the original.
      if (parsed.details && !participantDetails[display]) {
        participantDetails[display] = parsed.details;
      }
    }
    return display;
  };

  const segments: TranscriptSegment[] = [];
  for (const segment of transcript.segments) {
    const speaker = displayName(segment.speaker);
    const previous = segments[segments.length - 1];

    // Unattributed text is left as it was: merging it would glue a whole
    // speakerless transcript into one paragraph.
    if (previous && speaker && previous.speaker === speaker) {
      previous.text = `${previous.text} ${segment.text}`.trim();
      previous.endTimestamp = Math.max(
        previous.endTimestamp ?? previous.timestamp,
        segment.endTimestamp ?? segment.timestamp
      );
    } else {
      segments.push({ ...segment, speaker });
    }
  }

  const participants = [...new Set(transcript.participants.map(displayName).filter(name => name))];

  return {
    ...transcript,
    participants,
    segments,
    participantDetails: Object.keys(participantDetails).length > 0 ? participantDetails : undefined,
  };
}
