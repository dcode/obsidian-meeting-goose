/**
 * Tests for AIService
 *
 * The agent is replaced by a fake PromptRunner, so these cover prompt
 * construction and reply parsing without spawning anything.
 */

import { AIService, AIFeatureOptions } from '../src/services/AIService';
import type { PromptRunner } from '../src/services/ACPService';
import { RawTranscript, EntityExtraction, ParticipantInsight } from '../src/types';

const ALL_FEATURES: AIFeatureOptions = {
  enableSummary: true,
  enableActionItems: true,
  enableDecisions: true,
  enableTagSuggestions: true,
};

const ENRICHMENT_REPLY = JSON.stringify({
  summary: '**TL;DR** — Timeline agreed.',
  actionItems: [
    { task: 'Complete the API', assignee: 'Bob', dueDate: 'Friday' },
    'Write the docs',
  ],
  decisions: ['Use TypeScript'],
  suggestedTags: ['Project Timeline', 'API!'],
});

const INSIGHTS_REPLY = JSON.stringify({
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
});

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
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      const transcript = createTranscript();

      expect(await aiService.processTranscript(transcript)).toBeNull();
      expect(await aiService.generateParticipantInsights(transcript)).toBeNull();
      expect(await aiService.extractEntities(transcript)).toBeNull();
      expect(await aiService.synthesizeDescription('X', 'issue', '', 'ctx', 'M')).toBeNull();
      expect(await aiService.synthesizePersonAbout('Bob', '', 'ctx', 'M')).toBeNull();
      expect(await aiService.analyzeEntityStatusChanges(transcript, [{ name: 'X', type: 'issue' }])).toEqual([]);
      expect(runner.prompts).toHaveLength(0);
    });
  });

  describe('processTranscript', () => {
    it('sends the transcript and parses the enrichment', async () => {
      runner.reply(ENRICHMENT_REPLY, INSIGHTS_REPLY);

      const result = await aiService.processTranscript(createTranscript());

      expect(runner.prompts[0]).toContain("Alice: Let's discuss the project timeline.");
      // Segments without a speaker are sent without a "name:" prefix.
      expect(runner.prompts[0]).toContain('\nGreat! We decided to use TypeScript.');
      expect(result).toMatchObject({
        summary: '**TL;DR** — Timeline agreed.',
        decisions: ['Use TypeScript'],
        suggestedTags: ['project-timeline', 'api'],
      });
      expect(result?.actionItems).toEqual([
        { task: 'Complete the API', assignee: 'Bob', dueDate: 'Friday' },
        { task: 'Write the docs', assignee: undefined, dueDate: undefined },
      ]);
    });

    it('adds participant insights from a second prompt', async () => {
      runner.reply(ENRICHMENT_REPLY, INSIGHTS_REPLY);

      const result = await aiService.processTranscript(createTranscript());

      expect(runner.prompts).toHaveLength(2);
      expect(runner.prompts[1]).toContain('PARTICIPANTS: Alice, Bob');
      expect(result?.participantInsights).toEqual([
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
        },
      ]);
    });

    it('skips participant insights when there are no participants', async () => {
      runner.reply(ENRICHMENT_REPLY);

      const result = await aiService.processTranscript(createTranscript({ participants: [] }));

      expect(runner.prompts).toHaveLength(1);
      expect(result?.participantInsights).toBeUndefined();
    });

    it('keeps the enrichment when the insights prompt fails', async () => {
      runner.reply(ENRICHMENT_REPLY, new Error('agent died'));

      const result = await aiService.processTranscript(createTranscript());

      expect(result?.summary).toBe('**TL;DR** — Timeline agreed.');
      expect(result?.participantInsights).toBeUndefined();
    });

    it('extracts JSON wrapped in prose or code fences', async () => {
      runner.reply('Here you go:\n```json\n' + ENRICHMENT_REPLY + '\n```\nAnything else?');

      const result = await aiService.processTranscript(createTranscript({ participants: [] }));

      expect(result?.decisions).toEqual(['Use TypeScript']);
    });

    it('accepts "tags" as an alias for suggestedTags', async () => {
      runner.reply(JSON.stringify({ summary: 's', tags: ['One Two'] }));

      const result = await aiService.processTranscript(createTranscript({ participants: [] }));

      expect(result).toEqual({ summary: 's', actionItems: [], decisions: [], suggestedTags: ['one-two'] });
    });

    it('returns an empty enrichment when the reply is not JSON', async () => {
      runner.reply('I cannot help with that.');

      const result = await aiService.processTranscript(createTranscript({ participants: [] }));

      expect(result).toEqual({ summary: '', actionItems: [], decisions: [], suggestedTags: [] });
    });

    it('propagates agent failures', async () => {
      runner.reply(new Error('Could not find "goose"'));

      await expect(aiService.processTranscript(createTranscript())).rejects.toThrow('Could not find "goose"');
    });
  });

  describe('prompt construction', () => {
    const promptFor = async (options: Partial<AIFeatureOptions>, text = 'short'): Promise<string> => {
      runner.reply(ENRICHMENT_REPLY);
      aiService.configure(true, { ...ALL_FEATURES, ...options });
      await aiService.processTranscript(createTranscript({
        participants: [],
        segments: [{ speaker: 'A', timestamp: 0, text }],
      }));
      return runner.prompts[runner.prompts.length - 1];
    };

    it('requests every enabled section', async () => {
      const prompt = await promptFor({});
      expect(prompt).toContain('SUMMARY:');
      expect(prompt).toContain('ACTION_ITEMS:');
      expect(prompt).toContain('DECISIONS:');
      expect(prompt).toContain('TAGS:');
    });

    it('omits disabled sections', async () => {
      const prompt = await promptFor({ enableSummary: false, enableDecisions: false });
      expect(prompt).not.toContain('SUMMARY:');
      expect(prompt).not.toContain('DECISIONS:');
      expect(prompt).toContain('ACTION_ITEMS:');
      expect(prompt).toContain('TAGS:');
    });

    it('scales the summary depth with meeting length', async () => {
      const words = (count: number): string => Array(count).fill('word').join(' ');

      expect(await promptFor({}, words(100))).toContain('1-2 sentences capturing the essential outcome');
      expect(await promptFor({}, words(150 * 20))).toContain('4-6 bullet points');
      expect(await promptFor({}, words(150 * 45))).toContain('6-10 bullet points');
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

  describe('long transcripts', () => {
    const longTranscript = (): RawTranscript => {
      const text = 'x'.repeat(50_000);
      return createTranscript({
        participants: [],
        segments: [
          { speaker: 'A', timestamp: 0, text },
          { speaker: 'B', timestamp: 20 * 60, text },
          { speaker: 'A', timestamp: 40 * 60, text },
          { speaker: 'B', timestamp: 80 * 60, text },
        ],
      });
    };

    it('splits into ~30 minute chunks and merges the results', async () => {
      runner.reply(
        JSON.stringify({
          summary: 'First part.',
          actionItems: [{ task: 'Ship it' }],
          decisions: ['Go'],
          suggestedTags: ['a', 'b', 'c'],
        }),
        JSON.stringify({
          summary: 'Second part.',
          actionItems: [{ task: 'SHIP IT' }, { task: 'Test it' }],
          decisions: ['Go', 'Wait'],
          suggestedTags: ['c', 'd', 'e', 'f'],
        }),
        JSON.stringify({ summary: 'Third part.' })
      );

      const result = await aiService.processTranscript(longTranscript());

      expect(runner.prompts).toHaveLength(3);
      expect(result?.summary).toBe('**Overall:** First part.\n\n**Part 2:** Second part.\n\n**Part 3:** Third part.');
      expect(result?.actionItems.map(item => item.task)).toEqual(['Ship it', 'Test it']);
      expect(result?.decisions).toEqual(['Go', 'Wait']);
      expect(result?.suggestedTags).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('uses a single summary as-is when only one chunk has one', async () => {
      runner.reply(
        JSON.stringify({ summary: 'Only summary.' }),
        JSON.stringify({ decisions: ['Go'] })
      );

      const result = await aiService.processTranscript(longTranscript());

      expect(result?.summary).toBe('Only summary.');
    });
  });

  describe('generateParticipantInsights', () => {
    it('returns an empty list when the reply cannot be parsed', async () => {
      runner.reply('not json');
      expect(await aiService.generateParticipantInsights(createTranscript())).toEqual([]);
    });

    it('returns null when the agent fails', async () => {
      runner.reply(new Error('boom'));
      expect(await aiService.generateParticipantInsights(createTranscript())).toBeNull();
    });

    it('fills in defaults for missing fields', async () => {
      runner.reply(JSON.stringify({ participants: [{}] }));
      expect(await aiService.generateParticipantInsights(createTranscript())).toEqual([
        { name: '', role: undefined, keyPoints: [], actionItems: [], wins: [], sentiment: undefined },
      ]);
    });
  });

  describe('extractEntities', () => {
    it('parses issues, updates, and topics', async () => {
      runner.reply(JSON.stringify({
        issues: [{ name: 'Login bug', description: 'Fails on SSO', mentionedBy: 'Alice', status: 'blocked' }],
        updates: [{ name: 'API v2', status: 'completed', relatedTo: 'Platform' }],
        topics: [{ name: 'Migration', category: 'technical' }],
      }));

      expect(await aiService.extractEntities(createTranscript())).toEqual({
        issues: [{ type: 'issue', name: 'Login bug', description: 'Fails on SSO', mentionedBy: 'Alice', status: 'blocked' }],
        updates: [{ type: 'update', name: 'API v2', status: 'completed', relatedTo: 'Platform' }],
        topics: [{ type: 'topic', name: 'Migration', category: 'technical' }],
      });
    });

    it('drops unknown statuses and non-string fields', async () => {
      runner.reply(JSON.stringify({
        issues: [{ name: 42, status: 'on fire', mentionedBy: null }],
      }));

      expect(await aiService.extractEntities(createTranscript())).toEqual({
        issues: [{ type: 'issue', name: '' }],
        updates: [],
        topics: [],
      });
    });

    it('returns empty lists when the reply cannot be parsed', async () => {
      runner.reply('{ not json');
      expect(await aiService.extractEntities(createTranscript())).toEqual({ issues: [], updates: [], topics: [] });
    });

    it('returns null when the agent fails', async () => {
      runner.reply(new Error('boom'));
      expect(await aiService.extractEntities(createTranscript())).toBeNull();
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

  describe('synthesis', () => {
    it('synthesizes a description and strips wrapping quotes', async () => {
      runner.reply('  "The login flow fails for SSO users."  ');

      const result = await aiService.synthesizeDescription('Login bug', 'issue', '', 'Fails on SSO', 'Standup');

      expect(result).toBe('The login flow fails for SSO users.');
      expect(runner.prompts[0]).toContain('ENTITY: Login bug');
      expect(runner.prompts[0]).toContain('(No existing description)');
      expect(runner.prompts[0]).toContain('NEW CONTEXT FROM "Standup"');
    });

    it('synthesizes a person about section', async () => {
      runner.reply("'Bob leads the API team.'");

      const result = await aiService.synthesizePersonAbout('Bob', 'Old about', 'Shipped auth', 'Standup');

      expect(result).toBe('Bob leads the API team.');
      expect(runner.prompts[0]).toContain('PERSON: Bob');
      expect(runner.prompts[0]).toContain('Old about');
    });

    it('notes when a person has no existing about section', async () => {
      runner.reply('Bob leads the API team.');
      await aiService.synthesizePersonAbout('Bob', '', 'Shipped auth', 'Standup');
      expect(runner.prompts[0]).toContain('(No existing information)');
    });

    it('returns null when the agent fails', async () => {
      runner.reply(new Error('boom'));

      expect(await aiService.synthesizeDescription('X', 'topic', 'old', 'new', 'M')).toBeNull();
      expect(await aiService.synthesizePersonAbout('Bob', '', 'ctx', 'M')).toBeNull();
    });
  });

  describe('analyzeEntityStatusChanges', () => {
    const existing = [
      { name: 'Login bug', type: 'issue' as const, currentStatus: 'in-progress' },
      { name: 'Migration', type: 'topic' as const },
    ];

    it('lists the existing entities in the prompt', async () => {
      runner.reply('{"statusUpdates": []}');
      await aiService.analyzeEntityStatusChanges(createTranscript(), existing);
      expect(runner.prompts[0]).toContain('- Login bug (issue, current: in-progress)');
      expect(runner.prompts[0]).toContain('- Migration (topic, current: none)');
    });

    it('keeps only well-formed status updates', async () => {
      runner.reply(JSON.stringify({
        statusUpdates: [
          { entityName: 'Login bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' },
          { entityName: 'No type', newStatus: 'stale' },
          { entityName: 'Bad status', newStatus: 'exploded' },
          { newStatus: 'resolved' },
        ],
      }));

      expect(await aiService.analyzeEntityStatusChanges(createTranscript(), existing)).toEqual([
        { entityName: 'Login bug', entityType: 'issue', newStatus: 'resolved', reason: 'Fixed' },
        { entityName: 'No type', entityType: 'issue', newStatus: 'stale', reason: undefined },
      ]);
    });

    it('does not call the agent when there are no entities', async () => {
      expect(await aiService.analyzeEntityStatusChanges(createTranscript(), [])).toEqual([]);
      expect(runner.prompts).toHaveLength(0);
    });

    it.each([
      ['no JSON', 'nothing changed'],
      ['invalid JSON', '{ nope }'],
      ['a non-array', '{"statusUpdates": "none"}'],
    ])('returns no updates for %s', async (_label, reply) => {
      runner.reply(reply);
      expect(await aiService.analyzeEntityStatusChanges(createTranscript(), existing)).toEqual([]);
    });

    it('returns no updates when the agent fails', async () => {
      runner.reply(new Error('boom'));
      expect(await aiService.analyzeEntityStatusChanges(createTranscript(), existing)).toEqual([]);
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
