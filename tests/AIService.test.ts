/**
 * Tests for AIService
 *
 * The agent is replaced by a fake PromptRunner, so these cover prompt
 * construction, reply parsing, and how many agent round-trips are spent.
 */

import { AIService, AIFeatureOptions, SynthesisRequest } from '../src/services/AIService';
import type { PromptRunner } from '../src/services/ACPService';
import { RawTranscript, EntityExtraction, ParticipantInsight } from '../src/types';

const ALL_FEATURES: AIFeatureOptions = {
  enableSummary: true,
  enableActionItems: true,
  enableDecisions: true,
  enableTagSuggestions: true,
};

const SUMMARY = '**TL;DR** — Timeline agreed.\n\n**Key Discussion Points**\n- Bob said "Friday", then "maybe Monday"';

const DATA = {
  actionItems: [
    { task: 'Complete the API', assignee: 'Bob', dueDate: 'Friday' },
    'Write the docs',
  ],
  decisions: ['Use TypeScript'],
  suggestedTags: ['Project Timeline', 'API!'],
  participants: [
    {
      name: 'Bob',
      role: 'Backend Engineer',
      keyPoints: ['Owns the API'],
      actionItems: [{ task: 'Complete the API', due_date: 'Friday' }, 'Review PR'],
      wins: ['Shipped auth'],
      sentiment: 'Engaged',
    },
  ],
  issues: [{ name: 'Login bug', description: 'Fails on SSO', mentionedBy: 'Bob', status: 'resolved' }],
  updates: [{ name: 'API v2', status: 'completed', mentionedBy: 'bob' }],
  topics: [{ name: 'Migration', category: 'technical', mentionedBy: 'Alice' }],
  statusUpdates: [{ entityName: 'Old bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' }],
};

const reply = (summary: string | null, data: unknown): string =>
  (summary === null ? '' : `<summary>\n${summary}\n</summary>\n`) + `<data>\n${JSON.stringify(data)}\n</data>`;

class FakeRunner implements PromptRunner {
  prompts: string[] = [];
  private replies: Array<string | Error> = [];

  /** Queue replies; the last one repeats once the queue is exhausted. */
  reply(...replies: Array<string | Error>): this {
    this.replies = replies;
    return this;
  }

  async sendPrompt(promptText: string): Promise<string> {
    this.prompts.push(promptText);
    const next = this.replies.length > 1 ? this.replies.shift() : this.replies[0];
    if (next === undefined) throw new Error('FakeRunner: no reply queued');
    if (next instanceof Error) throw next;
    return next;
  }
}

const createTranscript = (overrides: Partial<RawTranscript> = {}): RawTranscript => ({
  source: 'local',
  title: 'Team Meeting',
  date: new Date('2024-01-15T10:00:00Z'),
  duration: 30,
  participants: ['Alice', 'Bob'],
  segments: [
    { speaker: 'Alice', timestamp: 0, text: "Let's discuss the project timeline." },
    { speaker: 'Bob', timestamp: 5, text: "I'll complete the API by Friday." },
    { speaker: '', timestamp: 10, text: 'Great! We decided to use TypeScript.' },
  ],
  hash: 'test-hash',
  ...overrides,
});

describe('AIService', () => {
  let runner: FakeRunner;
  let aiService: AIService;

  beforeEach(() => {
    runner = new FakeRunner();
    aiService = new AIService(runner);
    aiService.configure(true, ALL_FEATURES);
  });

  describe('enabled state', () => {
    it('is disabled until configured', () => {
      expect(new AIService(runner).isEnabled()).toBe(false);
    });

    it('follows the enabled flag', () => {
      expect(aiService.isEnabled()).toBe(true);
      aiService.configure(false, ALL_FEATURES);
      expect(aiService.isEnabled()).toBe(false);
    });

    it('never calls the agent while disabled', async () => {
      aiService.configure(false, ALL_FEATURES);

      expect(await aiService.analyzeMeeting(createTranscript(), { extractEntities: true })).toBeNull();
      expect(await aiService.synthesizeNotes(
        [{ id: 'a', kind: 'person', name: 'Bob', existing: '', newContext: 'ctx' }], 'M'
      )).toEqual(new Map());
      expect(runner.prompts).toHaveLength(0);
    });
  });

  describe('analyzeMeeting', () => {
    const known = [{ name: 'Old bug', type: 'issue' as const, currentStatus: 'in-progress' }];

    it('gets everything in a single agent round-trip', async () => {
      runner.reply(reply(SUMMARY, DATA));

      const result = await aiService.analyzeMeeting(createTranscript(), { extractEntities: true, knownEntities: known });

      expect(runner.prompts).toHaveLength(1);
      expect(result?.enrichment.summary).toBe(SUMMARY);
      expect(result?.enrichment.actionItems).toEqual([
        { task: 'Complete the API', assignee: 'Bob', dueDate: 'Friday' },
        { task: 'Write the docs', assignee: undefined, dueDate: undefined },
      ]);
      expect(result?.enrichment.decisions).toEqual(['Use TypeScript']);
      expect(result?.enrichment.suggestedTags).toEqual(['project-timeline', 'api']);
      expect(result?.enrichment.entities).toEqual({
        issues: [{ type: 'issue', name: 'Login bug', description: 'Fails on SSO', mentionedBy: 'Bob', status: 'resolved' }],
        updates: [{ type: 'update', name: 'API v2', status: 'completed', mentionedBy: 'bob' }],
        topics: [{ type: 'topic', name: 'Migration', category: 'technical', mentionedBy: 'Alice' }],
      });
      expect(result?.statusUpdates).toEqual([
        { entityName: 'Old bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' },
      ]);
    });

    it('links participant insights to the entities they mentioned', async () => {
      runner.reply(reply(SUMMARY, DATA));

      const result = await aiService.analyzeMeeting(createTranscript(), { extractEntities: true });

      expect(result?.enrichment.participantInsights).toEqual([
        {
          name: 'Bob',
          role: 'Backend Engineer',
          keyPoints: ['Owns the API'],
          actionItems: [
            { task: 'Complete the API', assignee: 'Bob', dueDate: 'Friday' },
            { task: 'Review PR', assignee: 'Bob', dueDate: undefined },
          ],
          wins: ['Shipped auth'],
          sentiment: 'Engaged',
          updates: [{ name: 'API v2', status: 'completed', date: '2024-01-15' }],
          ownedTopics: [],
          raisedIssues: ['Login bug'],
        },
      ]);
    });

    it('sends the transcript once, without a prefix for unnamed speakers', async () => {
      runner.reply(reply(SUMMARY, DATA));

      await aiService.analyzeMeeting(createTranscript(), { extractEntities: true });

      const [prompt] = runner.prompts;
      expect(prompt.split("Alice: Let's discuss the project timeline.")).toHaveLength(2);
      expect(prompt).toContain('\nGreat! We decided to use TypeScript.');
    });

    it('keeps a summary full of quotes and line breaks intact', async () => {
      const awkward = 'He said "no", then "yes".\n\n- {"not": "json"}\n- a </data> lookalike is fine too';
      runner.reply(reply(awkward, { decisions: ['Go'] }));

      const result = await aiService.analyzeMeeting(createTranscript({ participants: [] }));

      expect(result?.enrichment.summary).toBe(awkward);
      expect(result?.enrichment.decisions).toEqual(['Go']);
    });

    it('propagates agent failures', async () => {
      runner.reply(new Error('Could not find "goose"'));
      await expect(aiService.analyzeMeeting(createTranscript())).rejects.toThrow('Could not find "goose"');
    });
  });

  describe('prompt construction', () => {
    const promptFor = async (
      features: Partial<AIFeatureOptions>,
      options: Parameters<AIService['analyzeMeeting']>[1] = {},
      transcript: Partial<RawTranscript> = { participants: [] }
    ): Promise<string> => {
      runner.reply(reply(SUMMARY, DATA));
      aiService.configure(true, { ...ALL_FEATURES, ...features });
      await aiService.analyzeMeeting(createTranscript(transcript), options);
      return runner.prompts[runner.prompts.length - 1];
    };

    it('asks for the summary as tagged markdown, not as JSON', async () => {
      const prompt = await promptFor({});
      expect(prompt).toContain('<summary>\nmarkdown summary\n</summary>');
      expect(prompt).not.toContain('"summary"');
    });

    it('requests only the enabled sections', async () => {
      const prompt = await promptFor({ enableSummary: false, enableDecisions: false });
      expect(prompt).not.toContain('<summary>');
      expect(prompt).not.toContain('"decisions"');
      expect(prompt).toContain('"actionItems"');
      expect(prompt).toContain('"suggestedTags"');
    });

    it('leaves out the data block when only the summary is wanted', async () => {
      const prompt = await promptFor({ enableActionItems: false, enableDecisions: false, enableTagSuggestions: false });
      expect(prompt).toContain('<summary>');
      expect(prompt).not.toContain('<data>');
    });

    it('asks about participants only when the transcript has some', async () => {
      expect(await promptFor({})).not.toContain('"participants"');
      const prompt = await promptFor({}, {}, { participants: ['Alice', 'Bob'] });
      expect(prompt).toContain('"participants"');
      expect(prompt).toContain('who actually spoke: Alice, Bob');
    });

    it('asks about entities only when extraction is on', async () => {
      expect(await promptFor({})).not.toContain('"issues"');
      const prompt = await promptFor({}, { extractEntities: true });
      expect(prompt).toContain('"issues"');
      expect(prompt).toContain('"updates"');
      expect(prompt).toContain('"topics"');
    });

    it('lists known entities for status tracking only alongside extraction', async () => {
      const knownEntities = [
        { name: 'Login bug', type: 'issue' as const, currentStatus: 'in-progress' },
        { name: 'Migration', type: 'topic' as const },
      ];

      const withExtraction = await promptFor({}, { extractEntities: true, knownEntities });
      expect(withExtraction).toContain('"statusUpdates"');
      expect(withExtraction).toContain('- Login bug (issue, current: in-progress)');
      expect(withExtraction).toContain('- Migration (topic, current: none)');

      expect(await promptFor({}, { extractEntities: true, knownEntities: [] })).not.toContain('"statusUpdates"');
      expect(await promptFor({}, { knownEntities })).not.toContain('"statusUpdates"');
    });

    it('scales the summary depth with meeting length', async () => {
      const words = (count: number): Partial<RawTranscript> => ({
        participants: [],
        segments: [{ speaker: 'A', timestamp: 0, text: Array(count).fill('word').join(' ') }],
      });

      expect(await promptFor({}, {}, words(100))).toContain('1-2 sentences capturing the essential outcome');
      expect(await promptFor({}, {}, words(150 * 20))).toContain('4-6 bullet points');
      expect(await promptFor({}, {}, words(150 * 45))).toContain('6-10 bullet points');
    });

    it('offers existing vault tags, capped at twenty', async () => {
      aiService.setExistingTags(Array.from({ length: 25 }, (_, i) => `tag${i}`));
      const prompt = await promptFor({});
      expect(prompt).toContain('tag0, tag1');
      expect(prompt).toContain('tag19');
      expect(prompt).not.toContain('tag20');
    });

    it('leaves out the tag hint when the vault has no tags', async () => {
      expect(await promptFor({})).not.toContain('existing tags from the vault');
    });
  });

  describe('reply parsing', () => {
    const analyze = async (text: string, options: Parameters<AIService['analyzeMeeting']>[1] = {}) => {
      runner.reply(text);
      return aiService.analyzeMeeting(createTranscript({ participants: [] }), options);
    };

    it('tolerates prose around the blocks and a code fence around the JSON', async () => {
      const result = await analyze(
        'Here you go:\n<summary>\nShort.\n</summary>\n<data>\n```json\n{"decisions": ["Go"]}\n```\n</data>\nAnything else?'
      );
      expect(result?.enrichment).toMatchObject({ summary: 'Short.', decisions: ['Go'] });
    });

    it('accepts missing closing tags', async () => {
      const result = await analyze('<summary>\nShort.\n<data>\n{"decisions": ["Go"]}');
      expect(result?.enrichment).toMatchObject({ summary: 'Short.', decisions: ['Go'] });
    });

    it('finds the JSON when the data tags are missing', async () => {
      const result = await analyze('<summary>Has {braces} in it.</summary>\n{"decisions": ["Go"]}');
      expect(result?.enrichment).toMatchObject({ summary: 'Has {braces} in it.', decisions: ['Go'] });
    });

    it('accepts the old all-JSON shape with the summary inside it', async () => {
      const result = await analyze('{"summary": "In JSON.", "tags": ["One Two"]}');
      expect(result?.enrichment).toEqual({
        summary: 'In JSON.', actionItems: [], decisions: [], suggestedTags: ['one-two'],
      });
    });

    it('repairs unescaped quotes in the data block', async () => {
      const result = await analyze('<summary>S</summary><data>{"decisions": ["Use "main" only", "Ship",]}</data>');
      expect(result?.enrichment.decisions).toEqual(['Use "main" only', 'Ship']);
    });

    it('fails with an excerpt when the data block is unusable', async () => {
      await expect(analyze('I cannot   help\nwith that.'))
        .rejects.toThrow('The agent reply contained no JSON: "I cannot help with that."');
      await expect(analyze('<summary>S</summary><data>{ : : }</data>'))
        .rejects.toThrow(/^The agent reply was not valid JSON/);
    });

    it('takes a bare reply as the summary when only a summary was asked for', async () => {
      aiService.configure(true, {
        enableSummary: true, enableActionItems: false, enableDecisions: false, enableTagSuggestions: false,
      });
      expect((await analyze('Just the summary, no tags.'))?.enrichment.summary).toBe('Just the summary, no tags.');
      expect((await analyze('<summary>Tagged.</summary>'))?.enrichment.summary).toBe('Tagged.');
    });

    it('returns empty sections for missing or malformed data', async () => {
      const result = await analyze(
        reply('S', { actionItems: 'nope', decisions: [1, '', 'Real'], participants: [{}], issues: [{ name: 42 }], statusUpdates: 'x' }),
        { extractEntities: true, knownEntities: [{ name: 'X', type: 'issue' }] }
      );
      expect(result).toEqual({
        enrichment: {
          summary: 'S',
          actionItems: [],
          decisions: ['Real'],
          suggestedTags: [],
          entities: { issues: [], updates: [], topics: [] },
        },
        statusUpdates: [],
      });
    });

    it('drops unknown entity statuses and "null" owners', async () => {
      const result = await analyze(
        reply('S', { issues: [{ name: 'A', status: 'on fire', mentionedBy: 'null' }] }),
        { extractEntities: true }
      );
      expect(result?.enrichment.entities?.issues).toEqual([{ type: 'issue', name: 'A' }]);
    });

    it('keeps only well-formed status updates', async () => {
      const result = await analyze(
        reply('S', {
          statusUpdates: [
            { entityName: 'Login bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' },
            { entityName: 'No type', newStatus: 'stale' },
            { entityName: 'Bad status', newStatus: 'exploded' },
            { newStatus: 'resolved' },
          ],
        }),
        { extractEntities: true, knownEntities: [{ name: 'Login bug', type: 'issue' }] }
      );
      expect(result?.statusUpdates).toEqual([
        { entityName: 'Login bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' },
        { entityName: 'No type', entityType: 'issue', newStatus: 'stale', reason: undefined },
      ]);
    });

    it('ignores status updates it did not ask for', async () => {
      const result = await analyze(reply('S', DATA), { extractEntities: true });
      expect(result?.statusUpdates).toEqual([]);
    });
  });

  describe('long transcripts', () => {
    const longTranscript = (): RawTranscript => {
      const text = 'x'.repeat(50_000);
      return createTranscript({
        segments: [
          { speaker: 'A', timestamp: 0, text },
          { speaker: 'B', timestamp: 20 * 60, text },
          { speaker: 'A', timestamp: 40 * 60, text },
          { speaker: 'B', timestamp: 80 * 60, text },
        ],
      });
    };

    it('spends one round-trip per ~30 minute chunk and merges every section', async () => {
      runner.reply(
        reply('First part.', {
          actionItems: [{ task: 'Ship it' }],
          decisions: ['Go'],
          suggestedTags: ['a', 'b', 'c'],
          participants: [{ name: 'Bob', keyPoints: ['One'], actionItems: ['Ship it'], wins: ['W1'] }],
          issues: [{ name: 'Login bug', description: 'Fails on SSO', status: 'in-progress' }],
          statusUpdates: [{ entityName: 'Old bug', entityType: 'issue', newStatus: 'in-progress' }],
        }),
        reply('Second part.', {
          actionItems: [{ task: 'SHIP IT' }, { task: 'Test it' }],
          decisions: ['Go', 'Wait'],
          suggestedTags: ['c', 'd', 'e', 'f'],
          participants: [
            { name: 'bob', role: 'Engineer', keyPoints: ['One', 'Two'], actionItems: ['ship it', 'Test it'], wins: ['W2'] },
            { name: 'Alice', keyPoints: ['Three'] },
          ],
          issues: [{ name: 'login bug', description: 'Later wording', status: 'resolved' }],
          statusUpdates: [{ entityName: 'old bug', entityType: 'issue', newStatus: 'resolved' }],
        }),
        reply('Third part.', {})
      );

      const result = await aiService.analyzeMeeting(longTranscript(), {
        extractEntities: true,
        knownEntities: [{ name: 'Old bug', type: 'issue' }],
      });

      expect(runner.prompts).toHaveLength(3);
      const enrichment = result!.enrichment;
      expect(enrichment.summary).toBe('**Overall:** First part.\n\n**Part 2:** Second part.\n\n**Part 3:** Third part.');
      expect(enrichment.actionItems.map(item => item.task)).toEqual(['Ship it', 'Test it']);
      expect(enrichment.decisions).toEqual(['Go', 'Wait']);
      expect(enrichment.suggestedTags).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(enrichment.participantInsights).toMatchObject([
        {
          name: 'Bob',
          role: 'Engineer',
          keyPoints: ['One', 'Two'],
          actionItems: [{ task: 'Ship it' }, { task: 'Test it' }],
          wins: ['W1', 'W2'],
        },
        { name: 'Alice', keyPoints: ['Three'] },
      ]);
      // First description, latest status.
      expect(enrichment.entities?.issues).toEqual([
        { type: 'issue', name: 'Login bug', description: 'Fails on SSO', status: 'resolved' },
      ]);
      expect(result!.statusUpdates).toEqual([
        { entityName: 'old bug', entityType: 'issue', newStatus: 'resolved', reason: undefined },
      ]);
    });

    it('uses a single summary as-is when only one chunk has one', async () => {
      runner.reply(reply('Only summary.', {}), reply(null, { decisions: ['Go'] }));
      const result = await aiService.analyzeMeeting(longTranscript());
      expect(result?.enrichment.summary).toBe('Only summary.');
    });
  });

  describe('enrichParticipantInsightsWithEntities', () => {
    const insights: ParticipantInsight[] = [{ name: 'Alice', keyPoints: [], actionItems: [] }];

    it('attaches the entities each participant mentioned', () => {
      const entities: EntityExtraction = {
        issues: [
          { type: 'issue', name: 'Login bug', mentionedBy: 'alice' },
          { type: 'issue', name: 'Other bug', mentionedBy: 'Bob' },
        ],
        updates: [
          { type: 'update', name: 'API v2', mentionedBy: 'ALICE', status: 'completed' },
          { type: 'update', name: 'Docs', mentionedBy: 'Alice' },
        ],
        topics: [{ type: 'topic', name: 'Migration', mentionedBy: 'Alice' }],
      };

      const [alice] = aiService.enrichParticipantInsightsWithEntities(
        insights, entities, new Date('2024-01-15T10:00:00Z')
      );

      expect(alice.raisedIssues).toEqual(['Login bug']);
      expect(alice.ownedTopics).toEqual(['Migration']);
      expect(alice.updates).toEqual([
        { name: 'API v2', status: 'completed', date: '2024-01-15' },
        { name: 'Docs', status: 'in-progress', date: '2024-01-15' },
      ]);
    });

    it('tolerates malformed entity data', () => {
      const malformed = { issues: 'nope', updates: [null, { name: 'ok' }], topics: [] } as unknown as EntityExtraction;

      const [alice] = aiService.enrichParticipantInsightsWithEntities(insights, malformed, new Date());

      expect(alice.raisedIssues).toEqual([]);
      expect(alice.updates).toEqual([]);

      const [fromNothing] = aiService.enrichParticipantInsightsWithEntities(
        insights, undefined as unknown as EntityExtraction, new Date()
      );
      expect(fromNothing.ownedTopics).toEqual([]);
    });
  });

  describe('synthesizeNotes', () => {
    const requests: SynthesisRequest[] = [
      { id: 'People/Bob.md', kind: 'person', name: 'Bob', existing: 'Old about', newContext: 'Role: Engineer' },
      { id: 'Issues/Login bug.md', kind: 'issue', name: 'Login bug', existing: '', newContext: 'Fails on SSO' },
      { id: 'Topics/Migration.md', kind: 'topic', name: 'Migration', existing: 'Moving clouds', newContext: 'Phase 2 started' },
    ];

    it('rewrites every note in one agent round-trip', async () => {
      runner.reply(JSON.stringify({
        results: [
          { id: 1, text: 'Bob leads the API team.' },
          { id: '2', text: '  "The login flow fails for SSO users."  ' },
          { id: 3, text: 'The migration is in phase 2.' },
        ],
      }));

      const result = await aiService.synthesizeNotes(requests, 'Standup');

      expect(runner.prompts).toHaveLength(1);
      expect(result).toEqual(new Map([
        ['People/Bob.md', 'Bob leads the API team.'],
        ['Issues/Login bug.md', 'The login flow fails for SSO users.'],
        ['Topics/Migration.md', 'The migration is in phase 2.'],
      ]));
    });

    it('describes each entry and the meeting in the prompt', async () => {
      runner.reply('{"results": []}');

      await aiService.synthesizeNotes(requests, 'Standup');

      const [prompt] = runner.prompts;
      expect(prompt).toContain('from the meeting "Standup"');
      expect(prompt).toContain('[1] person: Bob\nExisting: Old about\nNew: Role: Engineer');
      expect(prompt).toContain('[2] issue: Login bug\nExisting: (none)\nNew: Fails on SSO');
      expect(prompt).toContain('[3] topic: Migration');
    });

    it('leaves out entries the agent skipped or answered with nothing', async () => {
      runner.reply(JSON.stringify({ results: [{ id: 2, text: 'Only this one.' }, { id: 3, text: ' ' }, { id: 9, text: 'Stray' }] }));

      const result = await aiService.synthesizeNotes(requests, 'Standup');

      expect(result).toEqual(new Map([['Issues/Login bug.md', 'Only this one.']]));
    });

    it('costs nothing when there is nothing to rewrite', async () => {
      expect(await aiService.synthesizeNotes([], 'Standup')).toEqual(new Map());
      expect(runner.prompts).toHaveLength(0);
    });

    it('propagates agent and parse failures', async () => {
      runner.reply(new Error('boom'));
      await expect(aiService.synthesizeNotes(requests, 'Standup')).rejects.toThrow('boom');

      runner.reply('no json here');
      await expect(aiService.synthesizeNotes(requests, 'Standup')).rejects.toThrow('contained no JSON');
    });
  });

  describe('testConnection', () => {
    it('succeeds when the agent replies, even while enrichment is off', async () => {
      aiService.configure(false, ALL_FEATURES);
      runner.reply('ready');
      expect(await aiService.testConnection()).toEqual({ success: true, message: 'Agent responded' });
    });

    it('fails on an empty reply', async () => {
      runner.reply('   ');
      expect(await aiService.testConnection()).toEqual({
        success: false,
        message: 'The agent returned an empty reply',
      });
    });

    it('reports the agent error', async () => {
      runner.reply(new Error('Could not find "goose"'));
      expect(await aiService.testConnection()).toEqual({ success: false, message: 'Could not find "goose"' });
    });
  });
});
