/**
 * Tests for batched description synthesis in ParticipantService and EntityService:
 * collecting what needs rewriting, then applying the rewritten text.
 */

import { App } from 'obsidian';
import { ParticipantService } from '../src/services/ParticipantService';
import { EntityService } from '../src/services/EntityService';
import { EntityExtraction, ParticipantInsight } from '../src/types';

const MEETING_PATH = 'Meetings/2024-01-15 Standup.md';
const MEETING_DATE = new Date('2024-01-15T10:00:00Z');

describe('batched note synthesis', () => {
  let app: App;
  const vault = (): any => app.vault;
  const read = (path: string): Promise<string> => app.vault.read(app.vault.getAbstractFileByPath(path) as any);

  beforeEach(() => {
    app = new App();
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ParticipantService', () => {
    let service: ParticipantService;
    const insights: ParticipantInsight[] = [
      {
        name: 'bob',
        role: 'Engineer',
        keyPoints: ['Owns the API'],
        actionItems: [{ task: 'Ship v2' }],
        wins: ['Shipped auth'],
        ownedTopics: ['Migration'],
      },
      { name: 'Carol', keyPoints: [], actionItems: [] },
    ];

    beforeEach(() => {
      service = new ParticipantService(app);
      service.configure('People');
      vault()._setFile('People/Bob.md', '# Bob\n\n## About\n\nOld about text.\n\n## Meetings\n\n- [[Meetings/2023-12-01 Kickoff]]\n');
      vault()._setFile('People/Carol.md', '# Carol\n\n## Meetings\n');
      vault()._setFile('People/Dave.md', `# Dave\n\n## Meetings\n\n- [[${MEETING_PATH.replace('.md', '')}]]\n`);
    });

    it('requests a rewrite for existing notes that have something new to say', async () => {
      const requests = await service.collectSynthesisRequests(
        ['Bob', 'Carol', 'Dave', 'Erin'], MEETING_PATH,
        [...insights, { name: 'Dave', role: 'PM', keyPoints: ['x'], actionItems: [] }, { name: 'Erin', role: 'New', keyPoints: [], actionItems: [] }]
      );

      // Carol has no context, Dave already references this meeting, Erin has no note yet.
      expect(requests).toEqual([
        {
          id: 'People/Bob.md',
          kind: 'person',
          name: 'Bob',
          existing: 'Old about text.',
          newContext: 'Role: Engineer. Key contributions: Owns the API. Working on: Ship v2. Owns topics: Migration. Recent wins: Shipped auth',
        },
      ]);
    });

    it('requests nothing without insights', async () => {
      expect(await service.collectSynthesisRequests(['Bob'], MEETING_PATH, undefined)).toEqual([]);
    });

    it('writes the synthesized About section into the note', async () => {
      await service.processParticipants(
        ['Bob'], 'Standup', MEETING_PATH, MEETING_DATE, insights,
        new Map([['People/Bob.md', 'Bob leads the API team.']])
      );

      const content = await read('People/Bob.md');
      expect(content).toContain('## About\n\nBob leads the API team.');
      expect(content).not.toContain('Old about text.');
      expect(content).toContain('Meetings/2024-01-15 Standup');
    });

    describe('name details', () => {
      const details = {
        'Doe, John CTR': {
          originalName: 'Doe, John A CTR USAF AFMC AFLCMC/HNCO',
          lastName: 'Doe', firstName: 'John', middleInitial: 'A',
          rank: 'CTR', branch: 'USAF', organization: 'AFMC AFLCMC/HNCO',
        },
      };

      it('records them as properties on a new person note', async () => {
        await service.processParticipants(['Doe, John CTR'], 'Standup', MEETING_PATH, MEETING_DATE, [], undefined, details);

        const content = await read('People/Doe, John CTR.md');
        expect(content).toContain([
          'type: person',
          'tags: [person]',
          'aliases: ["Doe, John A CTR USAF AFMC AFLCMC/HNCO"]',
          'last_name: "Doe"',
          'first_name: "John"',
          'middle_initial: "A"',
          'rank: "CTR"',
          'branch: "USAF"',
          'organization: "AFMC AFLCMC/HNCO"',
          '---',
          '',
          '# Doe, John CTR',
        ].join('\n'));
      });

      it('adds only the missing properties to an existing note', async () => {
        vault()._setFile('People/Doe, John CTR.md', '---\ntype: person\nrank: "Contractor"\n---\n\n# Doe, John CTR\n\n## Meetings\n');

        await service.processParticipants(['Doe, John CTR'], 'Standup', MEETING_PATH, MEETING_DATE, [], undefined, details);

        const content = await read('People/Doe, John CTR.md');
        expect(content).toContain('rank: "Contractor"');
        expect(content).not.toContain('rank: "CTR"');
        expect(content).toContain('branch: "USAF"');
        expect(content).toContain('organization: "AFMC AFLCMC/HNCO"');
        expect(content.match(/^---$/gm)).toHaveLength(2);
      });

      it('writes no extra properties for an ordinary name', async () => {
        await service.processParticipants(['Erin'], 'Standup', MEETING_PATH, MEETING_DATE, [], undefined, details);
        expect(await read('People/Erin.md')).toContain('tags: [person]\n---\n');
      });
    });

    it('keeps the existing About section when no synthesis is supplied', async () => {
      await service.processParticipants(['Bob'], 'Standup', MEETING_PATH, MEETING_DATE, insights);

      const content = await read('People/Bob.md');
      expect(content).toContain('## About\n\nOld about text.');
      expect(content).toContain('Meetings/2024-01-15 Standup');
    });
  });

  describe('EntityService', () => {
    let service: EntityService;
    const entities: EntityExtraction = {
      issues: [
        { type: 'issue', name: 'Login bug', description: 'Now also fails on SAML', status: 'in-progress' },
        { type: 'issue', name: 'Brand new bug', description: 'Just found' },
        { type: 'issue', name: 'Quiet bug' },
      ],
      updates: [{ type: 'update', name: 'API v2', description: 'Shipped' }],
      topics: [{ type: 'topic', name: 'Migration', description: 'Phase 2 started' }],
    };

    beforeEach(() => {
      service = new EntityService(app);
      const issue = (name: string, body: string): void => {
        vault()._setFile(`Issues/${name}.md`, `---\ntype: issue\nstatus: in-progress\n---\n\n# ${name}\n\n${body}`);
        (app.metadataCache as any)._setCache(`Issues/${name}.md`, { frontmatter: { type: 'issue', status: 'in-progress' } });
      };
      issue('Login bug', '## Description\n\nFails on SSO.\n\n## Related Meetings\n\n- [[Meetings/2023-12-01 Kickoff]]\n');
      issue('Quiet bug', '## Description\n\nRarely seen.\n');
      vault()._setFile('Topics/Migration.md', '---\ntype: topic\n---\n\n# Migration\n\nMoving to the new cloud.\n\n## Related Meetings\n');
      (app.metadataCache as any)._setCache('Topics/Migration.md', { frontmatter: { type: 'topic' } });
    });

    it('requests a rewrite for existing issue and topic notes with a new description', async () => {
      const requests = await service.collectSynthesisRequests(entities, MEETING_PATH);

      // The new bug has no note, the quiet bug has nothing new, and updates never get notes.
      expect(requests).toEqual([
        { id: 'Issues/Login bug.md', kind: 'issue', name: 'Login bug', existing: 'Fails on SSO.', newContext: 'Now also fails on SAML' },
        { id: 'Topics/Migration.md', kind: 'topic', name: 'Migration', existing: 'Moving to the new cloud.', newContext: 'Phase 2 started' },
      ]);
    });

    it('skips entity types that are turned off', async () => {
      service.configure('Issues', 'Updates', 'Topics', false, true, false);
      const requests = await service.collectSynthesisRequests(entities, MEETING_PATH);
      expect(requests.map(request => request.name)).toEqual(['Migration']);
    });

    it('skips notes that already reference the meeting', async () => {
      vault()._setFile('Topics/Migration.md', `---\ntype: topic\n---\n\n# Migration\n\n- [[${MEETING_PATH.replace('.md', '')}]]\n`);
      const requests = await service.collectSynthesisRequests(entities, MEETING_PATH);
      expect(requests.map(request => request.name)).toEqual(['Login bug']);
    });

    it('writes the synthesized description into the note', async () => {
      await service.processEntities(
        entities, 'Standup', MEETING_PATH, MEETING_DATE,
        new Map([['Issues/Login bug.md', 'Login fails for SSO and SAML users.']])
      );

      const content = await read('Issues/Login bug.md');
      expect(content).toContain('## Description\n\nLogin fails for SSO and SAML users.');
      expect(content).not.toContain('Fails on SSO.');
      expect(content).toContain('Meetings/2024-01-15 Standup');
    });

    it('keeps the existing description when no synthesis is supplied', async () => {
      await service.processEntities(entities, 'Standup', MEETING_PATH, MEETING_DATE);

      const content = await read('Issues/Login bug.md');
      expect(content).toContain('## Description\n\nFails on SSO.');
      expect(content).toContain('Meetings/2024-01-15 Standup');
    });
  });
});
