/**
 * Tests for how a person keeps one note as their display name changes.
 */

import { App } from 'obsidian';
import { ParticipantService } from '../src/services/ParticipantService';
import { NoteGenerator } from '../src/services/NoteGenerator';
import { parseSpeakerName, SpeakerDetails } from '../src/services/speakerName';

const CAPT = 'Doe, John A Capt USAF ACC 16 AF/A6';
const MAJ = 'Doe, John A Maj USAF AFMC AFLCMC/HNCO';

describe('person note identity', () => {
  let app: App;
  let service: ParticipantService;
  const vault = (): any => app.vault;
  const paths = (): string[] => app.vault.getMarkdownFiles().map(file => file.path).sort();
  const read = (path: string): Promise<string> => app.vault.read(app.vault.getAbstractFileByPath(path) as any);

  /** Stand in for Obsidian's indexer: publish each note's properties to the metadata cache. */
  const reindex = async (): Promise<void> => {
    for (const file of app.vault.getMarkdownFiles()) {
      const yaml = (await app.vault.read(file)).match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
      const frontmatter: Record<string, unknown> = {};
      for (const line of yaml.split('\n')) {
        const property = line.match(/^(\w+):\s*(.*)$/);
        if (!property) continue;
        try {
          frontmatter[property[1]] = JSON.parse(property[2]);
        } catch {
          frontmatter[property[1]] = property[2];
        }
      }
      (app.metadataCache as any)._setCache(file.path, { frontmatter });
    }
  };

  /** Import one meeting for one raw speaker name, as the plugin does. */
  const attend = async (rawName: string, meeting: string, date: string): Promise<{ display: string; noteName: string }> => {
    const { display, details } = parseSpeakerName(rawName);
    const detailMap: Record<string, SpeakerDetails> = details ? { [display]: details } : {};
    const noteName = service.resolveNoteNames([display], detailMap)[display];
    await service.processParticipants(
      [display], meeting, `Meetings/${meeting}.md`, new Date(`${date}T10:00:00Z`), [], undefined, detailMap
    );
    await reindex();
    return { display, noteName };
  };

  beforeEach(() => {
    app = new App();
    service = new ParticipantService(app);
    service.configure('People');
    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('names a new note without the rank and records the rest as properties', async () => {
    const { display, noteName } = await attend(CAPT, '2024-01-15 Standup', '2024-01-15');

    expect(display).toBe('Doe, John Capt');
    expect(noteName).toBe('Doe, John');
    expect(paths()).toEqual(['People/Doe, John.md']);
    expect(await read('People/Doe, John.md')).toContain([
      'type: person',
      'tags: [person]',
      'aliases: ["Doe, John Capt", "Doe, John A Capt USAF ACC 16 AF/A6"]',
      'last_name: "Doe"',
      'first_name: "John"',
      'middle_initial: "A"',
      'rank: "Capt"',
      'branch: "USAF"',
      'organization: "ACC 16 AF/A6"',
      'details_as_of: 2024-01-15',
      '---',
      '',
      '# Doe, John',
    ].join('\n'));
  });

  it('keeps one note through a promotion and a move, and follows the latest details', async () => {
    await attend(CAPT, '2024-01-15 Standup', '2024-01-15');
    const { display, noteName } = await attend(MAJ, '2025-03-01 Standup', '2025-03-01');

    expect(display).toBe('Doe, John Maj');
    expect(noteName).toBe('Doe, John');
    expect(paths()).toEqual(['People/Doe, John.md']);

    const content = await read('People/Doe, John.md');
    expect(content).toContain(
      `aliases: ["Doe, John Capt", "${CAPT}", "Doe, John Maj", "${MAJ}"]`
    );
    expect(content).toContain('rank: "Maj"');
    expect(content).toContain('organization: "AFMC AFLCMC/HNCO"');
    expect(content).toContain('details_as_of: 2025-03-01');
    expect(content).not.toContain('rank: "Capt"');
    expect(content).toContain('2024-01-15 Standup');
    expect(content).toContain('2025-03-01 Standup');
    expect(content.match(/^---$/gm)).toHaveLength(2);
  });

  it('does not undo a promotion when an older transcript is imported later', async () => {
    await attend(MAJ, '2025-03-01 Standup', '2025-03-01');
    await attend(CAPT, '2024-01-15 Standup', '2024-01-15');

    const content = await read('People/Doe, John.md');
    expect(paths()).toEqual(['People/Doe, John.md']);
    expect(content).toContain('rank: "Maj"');
    expect(content).toContain('details_as_of: 2025-03-01');
    expect(content).toContain('"Doe, John Capt"');
  });

  it('adds nothing new when the same name attends again', async () => {
    await attend(CAPT, '2024-01-15 Standup', '2024-01-15');
    await attend(CAPT, '2024-01-22 Standup', '2024-01-22');

    const content = await read('People/Doe, John.md');
    expect(content).toContain('aliases: ["Doe, John Capt", "Doe, John A Capt USAF ACC 16 AF/A6"]');
    expect(content).toContain('details_as_of: 2024-01-22');
  });

  it('links the meeting note to the person note under the name used that day', async () => {
    await attend(CAPT, '2024-01-15 Standup', '2024-01-15');
    const { display } = parseSpeakerName(MAJ);
    const links = service.resolveNoteNames([display, 'Sarah Chen']);

    const note = new NoteGenerator(app).buildNoteContent({
      transcript: {
        source: 'local', title: 'Standup', date: new Date('2025-03-01T10:00:00Z'), duration: 1,
        participants: [display, 'Sarah Chen'], segments: [{ speaker: display, timestamp: 0, text: 'Hi.' }], hash: 'h',
      },
      autoLinks: new Map(),
      participantLinks: links,
      suggestedLinks: [],
    });

    expect(links).toEqual({ 'Doe, John Maj': 'Doe, John', 'Sarah Chen': 'Sarah Chen' });
    expect(note).toContain('  - "[[Doe, John|Doe, John Maj]]"\n  - "[[Sarah Chen]]"');
    expect(note).toContain('> **Doe, John Maj** (00:00): Hi.');
  });

  it('adopts a note created under a full display name by an earlier version', async () => {
    const legacy = 'Doe, John A Capt USAF ACC';
    vault()._setFile(`People/${legacy}.md`, '---\ntype: person\n---\n\n# Old\n\n## Meetings\n');
    await reindex();

    const { noteName } = await attend(MAJ, '2025-03-01 Standup', '2025-03-01');

    expect(noteName).toBe(legacy);
    expect(paths()).toEqual([`People/${legacy}.md`]);
    const content = await read(`People/${legacy}.md`);
    expect(content).toContain(`aliases: ["Doe, John Maj", "${MAJ}"]`);
    expect(content).toContain('last_name: "Doe"');
    expect(content).toContain('rank: "Maj"');
  });

  it('extends aliases written as a YAML block list or a single value', async () => {
    vault()._setFile('People/Doe, John.md', '---\ntype: person\naliases:\n  - JD\n  - "Johnny, the Elder"\ntags: [person]\n---\n\n# Doe, John\n');
    vault()._setFile('People/Lee, Sam.md', '---\naliases: Sammy\ntype: person\n---\n\n# Lee, Sam\n');
    await reindex();

    await attend(MAJ, '2025-03-01 Standup', '2025-03-01');
    await attend('Lee, Sam Lt Col USSF SSC/CGT', '2025-03-01 Standup', '2025-03-01');

    const doe = await read('People/Doe, John.md');
    expect(doe).toContain(`aliases: ["JD", "Johnny, the Elder", "Doe, John Maj", "${MAJ}"]`);
    expect(doe).not.toContain('  - JD');
    expect(doe).toContain('tags: [person]');
    expect(await read('People/Lee, Sam.md')).toContain(
      'aliases: ["Sammy", "Lee, Sam Lt Col", "Lee, Sam Lt Col USSF SSC/CGT"]'
    );
    expect(paths()).toEqual(['People/Doe, John.md', 'People/Lee, Sam.md']);
  });

  it('keeps hand-edited name parts and fills in only what is missing', async () => {
    vault()._setFile('People/Doe, John.md', '---\ntype: person\nfirst_name: "Jonathan"\n---\n\n# Doe, John\n');
    await reindex();
    // The note is found by its file name; its edited first name is not overwritten.
    await attend('Doe, John Capt', '2024-01-15 Standup', '2024-01-15');

    const content = await read('People/Doe, John.md');
    expect(content).toContain('first_name: "Jonathan"');
    expect(content).toContain('last_name: "Doe"');
    expect(content).toContain('rank: "Capt"');
  });

  it('gives a different person with the same first and last name their own note', async () => {
    await attend(CAPT, '2024-01-15 Standup', '2024-01-15');
    const { noteName } = await attend('Doe, John Q SSgt USMC', '2024-01-16 Sync', '2024-01-16');

    expect(noteName).toBe('Doe, John Q');
    expect(paths()).toEqual(['People/Doe, John Q.md', 'People/Doe, John.md']);
    expect(await read('People/Doe, John.md')).not.toContain('SSgt');
  });

  it('does not match people against notes that are not person notes', async () => {
    vault()._setFile('Projects/Doe, John.md', '# A project that happens to share the name\n');
    vault()._setFile('Archive/Doe, John Capt USAF.md', '# Not a person note\n');
    await reindex();

    const { display, details } = parseSpeakerName(MAJ);
    const links = service.resolveNoteNames([display], { [display]: details! });

    expect(links[display]).toBe('Doe, John');
    expect(paths()).not.toContain('People/Doe, John.md');
  });

  it('leaves ordinary names exactly as they were', async () => {
    const { noteName } = await attend('Sarah Chen', '2024-01-15 Standup', '2024-01-15');

    expect(noteName).toBe('Sarah Chen');
    expect(await read('People/Sarah Chen.md')).toContain('tags: [person]\n---\n');
  });
});
