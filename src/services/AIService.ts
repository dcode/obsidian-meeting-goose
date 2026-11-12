/**
 * AIService - AI-powered enrichment for meeting transcripts
 *
 * Builds the prompts and parses the replies. The prompts themselves are run by
 * a local ACP agent (Goose by default) through a PromptRunner.
 *
 * Agent round-trips are the expensive part, so a meeting costs as few as
 * possible:
 *
 * - analyzeMeeting(): ONE prompt per transcript (one per chunk for very long
 *   ones) returns the summary, action items, decisions, tags, participant
 *   insights, entities, and status changes of known entities. The transcript
 *   is sent once.
 * - synthesizeNotes(): ONE prompt rewrites the descriptions of every existing
 *   person, issue, and topic note the meeting touched.
 *
 * The summary is long markdown, so it travels as plain text between
 * <summary> tags rather than as a JSON string, which models escape badly.
 */

import {
  ActionItem,
  AIEnrichment,
  Entity,
  EntityExtraction,
  EntityStatusUpdate,
  ParticipantInsight,
  RawTranscript,
  TranscriptSegment,
} from '../types';
import type { PromptRunner } from './ACPService';
import { parseJsonReply } from './jsonReply';

// Token limits for chunking (approximate, being conservative)
const MAX_TOKENS_PER_CHUNK = 30000; // ~120KB of text
const CHARS_PER_TOKEN = 4; // Rough estimate
const CHUNK_DURATION_SECONDS = 30 * 60;

const ENTITY_STATUSES = ['in-progress', 'completed', 'blocked', 'resolved', 'stale'] as const;
type EntityStatus = typeof ENTITY_STATUSES[number];

export interface AIFeatureOptions {
  enableSummary: boolean;
  enableActionItems: boolean;
  enableDecisions: boolean;
  enableTagSuggestions: boolean;
}

/** An entity note that already exists in the vault. */
export interface KnownEntity {
  name: string;
  type: 'issue' | 'update' | 'topic';
  currentStatus?: string;
}

export interface AnalysisOptions {
  /** Also extract issues, updates, and topics. */
  extractEntities?: boolean;
  /** Existing entity notes whose status the meeting may have changed. */
  knownEntities?: KnownEntity[];
}

export interface MeetingAnalysis {
  enrichment: AIEnrichment;
  /** Status changes for known entities; empty unless knownEntities was given. */
  statusUpdates: EntityStatusUpdate[];
}

/** One existing note whose description should absorb what the meeting added. */
export interface SynthesisRequest {
  /** Caller's key for the result, e.g. the note path. */
  id: string;
  kind: 'person' | 'issue' | 'topic';
  name: string;
  /** Current description in the note; may be empty. */
  existing: string;
  /** What this meeting said about it. */
  newContext: string;
}

/** What the analysis prompt asks for; decides both the prompt and the parsing. */
interface AnalysisPlan {
  summary: boolean;
  actionItems: boolean;
  decisions: boolean;
  tags: boolean;
  participants: string[];
  entities: boolean;
  knownEntities: KnownEntity[];
}

type JsonObject = Record<string, unknown>;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
const asTexts = (value: unknown): string[] =>
  asArray(value).map(asText).filter((text): text is string => text !== undefined);

function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const k = key(item).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class AIService {
  private readonly runner: PromptRunner;
  private enabled: boolean;
  private enableSummary: boolean;
  private enableActionItems: boolean;
  private enableDecisions: boolean;
  private enableTagSuggestions: boolean;
  private existingTags: string[];
  
  constructor(runner: PromptRunner) {
    this.runner = runner;
    this.enabled = false;
    this.enableSummary = true;
    this.enableActionItems = true;
    this.enableDecisions = true;
    this.enableTagSuggestions = true;
    this.existingTags = [];
  }
  
  /**
   * Configure the AI service
   */
  configure(enabled: boolean, options: AIFeatureOptions): void {
    this.enabled = enabled;
    this.enableSummary = options.enableSummary;
    this.enableActionItems = options.enableActionItems;
    this.enableDecisions = options.enableDecisions;
    this.enableTagSuggestions = options.enableTagSuggestions;
  }
  
  /**
   * Set existing tags from vault for better tag suggestions
   */
  setExistingTags(tags: string[]): void {
    this.existingTags = tags;
  }
  
  /**
   * Check if AI enrichment is turned on
   */
  isEnabled(): boolean {
    return this.enabled;
  }
  
  // ==================== Meeting analysis ====================
  
  /**
   * Analyze a transcript in a single agent round-trip (one per chunk for
   * transcripts too long for one prompt).
   *
   * Throws if the agent fails or its reply is unusable. A reply that is
   * usable but missing a section just yields that section empty.
   */
  async analyzeMeeting(transcript: RawTranscript, options: AnalysisOptions = {}): Promise<MeetingAnalysis | null> {
    if (!this.isEnabled()) {
      return null;
    }
    
    const plan: AnalysisPlan = {
      summary: this.enableSummary,
      actionItems: this.enableActionItems,
      decisions: this.enableDecisions,
      tags: this.enableTagSuggestions,
      participants: transcript.participants,
      entities: options.extractEntities === true,
      knownEntities: options.extractEntities === true ? (options.knownEntities ?? []) : [],
    };
    
    const fullText = this.formatSegmentsForAI(transcript.segments);
    const chunkTexts = fullText.length / CHARS_PER_TOKEN > MAX_TOKENS_PER_CHUNK
      ? this.splitIntoChunks(transcript.segments).map(chunk => this.formatSegmentsForAI(chunk))
      : [fullText];
    
    const results: MeetingAnalysis[] = [];
    for (const chunkText of chunkTexts) {
      const reply = await this.runner.sendPrompt(this.buildAnalysisPrompt(chunkText, plan));
      results.push(this.parseAnalysisReply(reply, plan));
    }
    
    const analysis = this.mergeAnalyses(results);
    const { enrichment } = analysis;
    if (enrichment.entities && enrichment.participantInsights && enrichment.participantInsights.length > 0) {
      enrichment.participantInsights = this.enrichParticipantInsightsWithEntities(
        enrichment.participantInsights,
        enrichment.entities,
        transcript.date
      );
    }
    return analysis;
  }
  
  /**
   * Build the single analysis prompt. Only what the plan asks for is
   * described, so disabled features cost no prompt or reply tokens.
   */
  private buildAnalysisPrompt(transcriptText: string, plan: AnalysisPlan): string {
    const keys: string[] = [];
    const rules: string[] = [];
    
    if (plan.actionItems) {
      keys.push('"actionItems": [{"task": "string", "assignee": "name or null", "dueDate": "string or null"}]');
      rules.push('actionItems: tasks, commitments, and follow-ups mentioned, with assignee and due date when stated.');
    }
    if (plan.decisions) {
      keys.push('"decisions": ["string"]');
      rules.push('decisions: explicit decisions made during the meeting.');
    }
    if (plan.tags) {
      const hint = this.existingTags.length > 0
        ? ` Prefer these existing tags from the vault when relevant: ${this.existingTags.slice(0, 20).join(', ')}.`
        : '';
      keys.push('"suggestedTags": ["string"]');
      rules.push(`suggestedTags: 3-5 tags for the topics discussed.${hint}`);
    }
    if (plan.participants.length > 0) {
      keys.push('"participants": [{"name": "string", "role": "string", "keyPoints": ["string"], "actionItems": [{"task": "string", "dueDate": "string or null"}], "wins": ["string"], "sentiment": "string"}]');
      rules.push(`participants: one entry for each of these people who actually spoke: ${plan.participants.join(', ')}. role is their likely role or expertise inferred from what they discuss; keyPoints are what they contributed; actionItems are tasks assigned to them; wins are specific things they completed or achieved; sentiment is a brief note on their engagement.`);
    }
    if (plan.entities) {
      const entityShape = '[{"name": "string", "description": "string", "mentionedBy": "name or null", "status": "STATUS"';
      keys.push(`"issues": ${entityShape.replace('STATUS', 'in-progress|blocked|resolved')}}]`);
      keys.push(`"updates": ${entityShape.replace('STATUS', 'in-progress|completed|blocked')}}]`);
      keys.push('"topics": [{"name": "string", "description": "string", "mentionedBy": "name or null", "category": "technical|process|product"}]');
      rules.push('issues: specific technical problems, blockers, bugs, or challenges that need resolution; mentionedBy is who raised it.');
      rules.push('updates: substantive progress, milestones, or completions; mentionedBy is who owns the work.');
      rules.push('topics: significant concepts, systems, initiatives, or recurring themes worth documenting; mentionedBy is who owns or leads it.');
      rules.push('Only extract clear, substantive issues, updates, and topics.');
    }
    if (plan.knownEntities.length > 0) {
      const known = plan.knownEntities
        .map(entity => `- ${entity.name} (${entity.type}, current: ${entity.currentStatus || 'none'})`)
        .join('\n');
      keys.push('"statusUpdates": [{"entityName": "exact name from the list", "entityType": "issue|update|topic", "newStatus": "resolved|completed|stale|in-progress|blocked", "reason": "string"}]');
      rules.push(`statusUpdates: only for these already-tracked items whose status clearly changed in this meeting (an issue fixed or closed is "resolved"; an update finished is "completed"):\n${known}`);
    }
    
    const format: string[] = [];
    const instructions: string[] = [];
    
    if (plan.summary) {
      format.push('<summary>\nmarkdown summary\n</summary>');
      instructions.push(`SUMMARY: markdown between the <summary> tags, never inside the JSON.\n${this.summaryInstruction(transcriptText)}`);
    }
    if (keys.length > 0) {
      format.push('<data>\nJSON object\n</data>');
      instructions.push(
        `DATA: one JSON object between the <data> tags with exactly these keys:\n{\n  ${keys.join(',\n  ')}\n}\n` +
        `${rules.map(rule => `- ${rule}`).join('\n')}\n` +
        '- Use an empty array when there is nothing to report. Keep strings short and plain: no markdown, and escape double quotes as \\".'
      );
    }
    
    return `Analyze the meeting transcript below. Reply in exactly this format, with nothing before or after it:

${format.join('\n')}

${instructions.join('\n\n')}

MEETING TRANSCRIPT:
${transcriptText}`;
  }
  
  /**
   * Summary depth scales with the length of the meeting.
   */
  private summaryInstruction(transcriptText: string): string {
    const wordCount = transcriptText.split(/\s+/).length;
    const estimatedMinutes = Math.round(wordCount / 150); // ~150 wpm for transcripts
    
    if (estimatedMinutes <= 15) {
      return `- **TL;DR** — 1-2 sentences capturing the essential outcome.
- **Key Discussion Points** — 2-4 bullet points covering what was discussed, with enough context that someone who missed the meeting understands what happened and why it matters.
- **Context & Background** — 1 sentence noting any references to prior work, external dependencies, or upcoming deadlines mentioned. Omit if none.`;
    }
    if (estimatedMinutes <= 30) {
      return `- **TL;DR** — 2-3 sentences capturing the essential outcomes and any shifts in direction.
- **Key Discussion Points** — 4-6 bullet points covering major topics. Each bullet should include enough context that someone who missed the meeting understands what was discussed, what positions were taken, and why it matters.
- **Context & Background** — 2-3 sentences noting references to prior work, external dependencies, open questions carried forward, or upcoming deadlines mentioned.`;
    }
    return `- **TL;DR** — 3-4 sentences capturing the essential outcomes, key shifts, and overall trajectory.
- **Key Discussion Points** — 6-10 bullet points covering all major topics and sub-topics. Each bullet should provide substantive context: what was discussed, who drove it, what positions or concerns were raised, and what the resolution or next step is.
- **Context & Background** — 3-5 sentences covering references to prior meetings or decisions, external dependencies, cross-team implications, open questions, and upcoming deadlines or milestones mentioned.`;
  }
  
  /**
   * Parse one analysis reply: the tagged summary plus the JSON data object.
   */
  private parseAnalysisReply(reply: string, plan: AnalysisPlan): MeetingAnalysis {
    const expectsData = plan.actionItems || plan.decisions || plan.tags ||
      plan.participants.length > 0 || plan.entities;
    
    // The closing tag is optional: a reply can be cut off, or the model can forget it.
    const summaryMatch = reply.match(/<summary>([\s\S]*?)(?:<\/summary>|<data>|$)/i);
    const dataMatch = reply.match(/<data>([\s\S]*?)(?:<\/data>|$)/i);
    let summary = summaryMatch ? summaryMatch[1].trim() : '';
    
    let data: JsonObject = {};
    if (expectsData) {
      // Without a <data> tag, look for the JSON in whatever is not the summary.
      const dataText = dataMatch ? dataMatch[1] : reply.replace(summaryMatch?.[0] ?? '', '');
      data = asObject(parseJsonReply<unknown>(dataText)) ?? {};
    }
    
    if (plan.summary && !summary) {
      // The model ignored the tags: accept a summary inside the JSON, or a bare reply.
      summary = asText(data.summary) ?? (expectsData ? '' : reply.trim());
    }
    
    const enrichment: AIEnrichment = {
      summary,
      actionItems: this.parseActionItems(data.actionItems),
      decisions: asTexts(data.decisions),
      suggestedTags: asTexts(data.suggestedTags ?? data.tags).map(tag =>
        tag.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      ),
    };
    
    if (plan.participants.length > 0) {
      enrichment.participantInsights = this.parseParticipants(data.participants);
    }
    if (plan.entities) {
      enrichment.entities = {
        issues: this.parseEntities(data.issues, 'issue'),
        updates: this.parseEntities(data.updates, 'update'),
        topics: this.parseEntities(data.topics, 'topic'),
      };
    }
    
    return {
      enrichment,
      statusUpdates: plan.knownEntities.length > 0 ? this.parseStatusUpdates(data.statusUpdates) : [],
    };
  }
  
  private parseActionItems(value: unknown, assignee?: string): ActionItem[] {
    const items: ActionItem[] = [];
    for (const raw of asArray(value)) {
      const item = asObject(raw);
      const task = item ? asText(item.task) : asText(raw);
      if (!task) continue;
      items.push({
        task,
        assignee: assignee ?? (item ? asText(item.assignee) : undefined),
        dueDate: item ? (asText(item.dueDate) ?? asText(item.due_date)) : undefined,
      });
    }
    return items;
  }
  
  private parseParticipants(value: unknown): ParticipantInsight[] {
    const insights: ParticipantInsight[] = [];
    for (const raw of asArray(value)) {
      const item = asObject(raw);
      const name = item ? asText(item.name) : undefined;
      if (!item || !name) continue;
      insights.push({
        name,
        role: asText(item.role),
        keyPoints: asTexts(item.keyPoints),
        actionItems: this.parseActionItems(item.actionItems, name),
        wins: asTexts(item.wins),
        sentiment: asText(item.sentiment),
      });
    }
    return insights;
  }
  
  private parseEntities(value: unknown, type: Entity['type']): Entity[] {
    const entities: Entity[] = [];
    for (const raw of asArray(value)) {
      const item = asObject(raw);
      const name = item ? asText(item.name) : undefined;
      if (!item || !name) continue;
      
      const entity: Entity = { type, name };
      const description = asText(item.description);
      const mentionedBy = asText(item.mentionedBy);
      const status = asText(item.status);
      const relatedTo = asText(item.relatedTo);
      const category = asText(item.category);
      if (description) entity.description = description;
      if (mentionedBy && mentionedBy.toLowerCase() !== 'null') entity.mentionedBy = mentionedBy;
      if (status && (ENTITY_STATUSES as readonly string[]).includes(status)) entity.status = status as EntityStatus;
      if (relatedTo) entity.relatedTo = relatedTo;
      if (category) entity.category = category;
      entities.push(entity);
    }
    return entities;
  }
  
  private parseStatusUpdates(value: unknown): EntityStatusUpdate[] {
    const updates: EntityStatusUpdate[] = [];
    for (const raw of asArray(value)) {
      const item = asObject(raw);
      const entityName = item ? asText(item.entityName) : undefined;
      const newStatus = item ? asText(item.newStatus) : undefined;
      if (!item || !entityName || !newStatus || !(ENTITY_STATUSES as readonly string[]).includes(newStatus)) continue;
      
      const entityType = asText(item.entityType);
      updates.push({
        entityName,
        entityType: entityType === 'update' || entityType === 'topic' ? entityType : 'issue',
        newStatus: newStatus as EntityStatus,
        reason: asText(item.reason),
      });
    }
    return updates;
  }
  
  // ==================== Long transcripts ====================
  
  /**
   * Split transcript segments into chunks of ~30 minutes each
   */
  private splitIntoChunks(segments: TranscriptSegment[]): TranscriptSegment[][] {
    const chunks: TranscriptSegment[][] = [];
    let currentChunk: TranscriptSegment[] = [];
    let chunkStartTime = segments[0]?.timestamp || 0;
    
    for (const segment of segments) {
      if (segment.timestamp - chunkStartTime > CHUNK_DURATION_SECONDS && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        chunkStartTime = segment.timestamp;
      }
      currentChunk.push(segment);
    }
    
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }
    
    return chunks;
  }
  
  /**
   * Merge the analyses of several chunks into one.
   */
  private mergeAnalyses(results: MeetingAnalysis[]): MeetingAnalysis {
    if (results.length === 1) {
      return results[0];
    }
    
    const enrichments = results.map(result => result.enrichment);
    const summaries = enrichments.map(e => e.summary).filter(s => s);
    
    // Combine summaries into hierarchical summary
    let summary = '';
    if (summaries.length === 1) {
      summary = summaries[0];
    } else if (summaries.length > 1) {
      summary = [`**Overall:** ${summaries[0]}`, ...summaries.slice(1).map((s, i) => `**Part ${i + 2}:** ${s}`)].join('\n\n');
    }
    
    const enrichment: AIEnrichment = {
      summary,
      actionItems: dedupeBy(enrichments.flatMap(e => e.actionItems), item => item.task),
      decisions: [...new Set(enrichments.flatMap(e => e.decisions))],
      suggestedTags: [...new Set(enrichments.flatMap(e => e.suggestedTags))].slice(0, 5),
    };
    
    if (enrichments.some(e => e.participantInsights)) {
      enrichment.participantInsights = this.mergeParticipants(enrichments.flatMap(e => e.participantInsights ?? []));
    }
    if (enrichments.some(e => e.entities)) {
      enrichment.entities = {
        issues: this.mergeEntities(enrichments.flatMap(e => e.entities?.issues ?? [])),
        updates: this.mergeEntities(enrichments.flatMap(e => e.entities?.updates ?? [])),
        topics: this.mergeEntities(enrichments.flatMap(e => e.entities?.topics ?? [])),
      };
    }
    
    // A later chunk knows better than an earlier one what state something ended in.
    const statusUpdates = new Map<string, EntityStatusUpdate>();
    for (const update of results.flatMap(result => result.statusUpdates)) {
      statusUpdates.set(`${update.entityType}:${update.entityName.toLowerCase()}`, update);
    }
    
    return { enrichment, statusUpdates: [...statusUpdates.values()] };
  }
  
  private mergeParticipants(insights: ParticipantInsight[]): ParticipantInsight[] {
    const merged = new Map<string, ParticipantInsight>();
    for (const insight of insights) {
      const existing = merged.get(insight.name.toLowerCase());
      if (!existing) {
        merged.set(insight.name.toLowerCase(), { ...insight });
        continue;
      }
      existing.role = existing.role ?? insight.role;
      existing.sentiment = existing.sentiment ?? insight.sentiment;
      existing.keyPoints = [...new Set([...existing.keyPoints, ...insight.keyPoints])];
      existing.wins = [...new Set([...(existing.wins ?? []), ...(insight.wins ?? [])])];
      existing.actionItems = dedupeBy([...existing.actionItems, ...insight.actionItems], item => item.task);
    }
    return [...merged.values()];
  }
  
  private mergeEntities(entities: Entity[]): Entity[] {
    const merged = new Map<string, Entity>();
    for (const entity of entities) {
      const existing = merged.get(entity.name.toLowerCase());
      if (!existing) {
        merged.set(entity.name.toLowerCase(), { ...entity });
        continue;
      }
      existing.description = existing.description ?? entity.description;
      existing.mentionedBy = existing.mentionedBy ?? entity.mentionedBy;
      existing.category = existing.category ?? entity.category;
      existing.relatedTo = existing.relatedTo ?? entity.relatedTo;
      existing.status = entity.status ?? existing.status;
    }
    return [...merged.values()];
  }
  
  /**
   * Format segments for AI processing
   */
  private formatSegmentsForAI(segments: TranscriptSegment[]): string {
    return segments.map(seg => {
      const speaker = seg.speaker ? `${seg.speaker}: ` : '';
      return `${speaker}${seg.text}`;
    }).join('\n');
  }
  
  /**
   * Enrich participant insights with entity information (updates, topics, issues)
   */
  enrichParticipantInsightsWithEntities(
    insights: ParticipantInsight[],
    entities: EntityExtraction,
    meetingDate: Date
  ): ParticipantInsight[] {
    const meetingDateStr = meetingDate.toISOString().split('T')[0];
    
    // Type guard function to safely check if an item is an Entity
    const isEntity = (item: unknown): item is Entity => {
      return typeof item === 'object' && item !== null && 'name' in item && typeof (item as { name: unknown }).name === 'string';
    };
    
    // Type guard to ensure arrays are properly typed - avoids ESLint false positives
    const ensureEntityArray = (arr: unknown): Entity[] => {
      if (!Array.isArray(arr)) {
        return [];
      }
      const result: Entity[] = [];
      // Use Array.prototype methods which TypeScript understands better
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i];
        if (isEntity(item)) {
          result.push(item);
        }
      }
      return result;
    };
    
    // Validate entities parameter with proper type narrowing
    const validatedEntities: EntityExtraction = (entities && typeof entities === 'object' && 'issues' in entities && 'updates' in entities && 'topics' in entities)
      ? entities
      : { issues: [], updates: [], topics: [] };
    
    // Normalize entities arrays
    const safeEntities: EntityExtraction = {
      issues: ensureEntityArray(validatedEntities.issues),
      updates: ensureEntityArray(validatedEntities.updates),
      topics: ensureEntityArray(validatedEntities.topics),
    };
    
    return insights.map(insight => {
      const enriched = { ...insight };
      
      // Add updates owned by this participant
      const updatesList: readonly Entity[] = safeEntities.updates;
      const filteredUpdates = Array.from(updatesList).filter((update: Entity) => {
        const mentionedBy = update.mentionedBy;
        return mentionedBy && typeof mentionedBy === 'string' 
          ? mentionedBy.toLowerCase() === insight.name.toLowerCase()
          : false;
      });
      enriched.updates = filteredUpdates.map((update: Entity) => ({
        name: update.name,
        status: update.status || 'in-progress',
        date: meetingDateStr
      }));
      
      // Add topics owned by this participant
      enriched.ownedTopics = safeEntities.topics
        .filter((topic: Entity) => {
          const mentionedBy = topic.mentionedBy;
          return mentionedBy && typeof mentionedBy === 'string'
            ? mentionedBy.toLowerCase() === insight.name.toLowerCase()
            : false;
        })
        .map((topic: Entity) => topic.name);
      
      // Add issues raised by this participant
      enriched.raisedIssues = safeEntities.issues
        .filter((issue: Entity) => {
          const mentionedBy = issue.mentionedBy;
          return mentionedBy && typeof mentionedBy === 'string'
            ? mentionedBy.toLowerCase() === insight.name.toLowerCase()
            : false;
        })
        .map((issue: Entity) => issue.name);
      
      return enriched;
    });
  }

  // ==================== Note synthesis ====================
  
  /**
   * Rewrite the descriptions of existing notes so they absorb what a meeting
   * added, all in one agent round-trip.
   *
   * Returns the new text by request id. Requests the agent skipped are simply
   * absent, and an empty request list costs nothing.
   */
  async synthesizeNotes(requests: SynthesisRequest[], meetingTitle: string): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    if (!this.isEnabled() || requests.length === 0) {
      return results;
    }
    
    const entries = requests.map((request, index) =>
      `[${index + 1}] ${request.kind}: ${request.name}\n` +
      `Existing: ${request.existing || '(none)'}\n` +
      `New: ${request.newContext}`
    ).join('\n\n');
    
    const prompt = `You maintain a knowledge base. For each entry below, write an updated description that merges the existing text with the new context from the meeting "${meetingTitle}".

Rules for every description:
- 2-4 sentences, present tense, professional and concise.
- Keep the important details from both sources and drop redundancy.
- person: third person; their role, what they are working on, expertise, and responsibilities.
- issue: the problem, its impact, current status, and any progress.
- topic: what it is, why it matters, and its current state.

Reply with one JSON object and nothing else, with one result per entry:
{"results": [{"id": 1, "text": "string"}]}
Escape double quotes inside strings as \\".

ENTRIES:
${entries}`;
    
    const reply = await this.runner.sendPrompt(prompt);
    const data = asObject(parseJsonReply<unknown>(reply)) ?? {};
    
    for (const raw of asArray(data.results)) {
      const item = asObject(raw);
      const text = item ? asText(item.text) : undefined;
      const request = item ? requests[Number(item.id) - 1] : undefined;
      if (request && text) {
        // Models sometimes wrap the whole text in quotes.
        results.set(request.id, text.replace(/^["']|["']$/g, ''));
      }
    }
    return results;
  }
  
  /**
   * Check that the agent starts and answers a prompt
   */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const reply = await this.runner.sendPrompt('Reply with the single word: ready');
      if (!reply.trim()) {
        return { success: false, message: 'The agent returned an empty reply' };
      }
      return { success: true, message: 'Agent responded' };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      return { success: false, message: errorMessage };
    }
  }
}
