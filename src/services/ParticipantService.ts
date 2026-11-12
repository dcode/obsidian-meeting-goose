/**
 * ParticipantService - Auto-create and update participant notes
 */

import { App, TFile, normalizePath } from 'obsidian';
import { ParticipantInsight } from '../types';
import type { SynthesisRequest } from './AIService';
import { parseSpeakerName } from './speakerName';
import type { SpeakerDetails } from './speakerName';

export interface ParticipantInfo {
  name: string;
  noteExists: boolean;
  notePath: string | null;
}

const FRONTMATTER = /^---\n([\s\S]*?)\n---/;
const DETAILS_AS_OF = 'details_as_of';
const ALIASES_BLOCK = /^aliases:[ \t]*\n((?:[ \t]*-[ \t]*.*(?:\n|$))+)/m;
const ALIASES_LINE = /^aliases:[ \t]*(.*)$/m;

const yamlText = (value: string): string => JSON.stringify(value);
const yamlList = (values: string[]): string => `[${values.map(yamlText).join(', ')}]`;
/** The text of a YAML scalar as written, with its quotes and escapes resolved. */
function unquote(value: string): string {
  const text = value.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 1) {
    try {
      return String(JSON.parse(text));
    } catch {
      return text.slice(1, -1);
    }
  }
  return text.replace(/^'(.*)'$/, '$1');
}

const hasProperty = (yaml: string, key: string): boolean => new RegExp(`^${key}:`, 'm').test(yaml);

/** Set a single-line property, replacing its current value or appending it. */
function setProperty(yaml: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  return hasProperty(yaml, key)
    ? yaml.replace(new RegExp(`^${key}:.*$`, 'm'), () => line)
    : `${yaml}\n${line}`;
}

/** Read the aliases property in any of its YAML forms: block list, inline list, or single value. */
function readAliases(yaml: string): string[] {
  const block = yaml.match(ALIASES_BLOCK);
  if (block) {
    return block[1].split('\n').map(line => unquote(line.replace(/^[ \t]*-[ \t]*/, ''))).filter(alias => alias);
  }
  const value = yaml.match(ALIASES_LINE)?.[1].trim();
  if (!value) return [];
  if (!value.startsWith('[')) return [unquote(value)];
  // Inline list: quoted items may contain commas.
  const items = value.slice(1, value.lastIndexOf(']')).match(/\s*"(?:[^"\\]|\\.)*"|\s*'[^']*'|[^,]+/g) ?? [];
  return items.map(unquote).filter(alias => alias);
}

/** Remove the aliases property, whatever form it is in, so it can be rewritten. */
function removeAliases(yaml: string): string {
  const withoutBlock = yaml.replace(ALIASES_BLOCK, '');
  const result = withoutBlock === yaml ? yaml.replace(/^aliases:.*(?:\n|$)/m, '') : withoutBlock;
  return result.replace(/\n+$/, '');
}

/** Enough of a name to tell whether two notes are about the same person. */
type PersonIdentity = Pick<SpeakerDetails, 'lastName' | 'firstName' | 'middleInitial'>;

export class ParticipantService {
  private app: App;
  private peopleFolder: string;
  
  constructor(app: App) {
    this.app = app;
    this.peopleFolder = '';
  }
  
  /**
   * Configure the people folder location
   */
  configure(peopleFolder: string): void {
    this.peopleFolder = peopleFolder;
  }
  
  /**
   * Check which participants have existing notes
   */
  checkParticipants(participants: string[]): ParticipantInfo[] {
    return participants.map(name => {
      const notePath = this.findParticipantNote(name);
      return {
        name,
        noteExists: notePath !== null,
        notePath,
      };
    });
  }
  
  /**
   * Find an existing note for a participant.
   *
   * A person keeps one note however their display name changes (a promotion
   * turns "Doe, John Capt" into "Doe, John Maj"), so the lookup tries, in order:
   * the name as a file name, the name as an alias, and then the person's last
   * and first name against the notes of known people.
   */
  private findParticipantNote(name: string, details?: SpeakerDetails): string | null {
    const folders = ['', 'People', 'Contacts', 'Team'];
    if (this.peopleFolder) folders.unshift(this.peopleFolder);
    
    for (const folder of folders) {
      const normalizedPath = normalizePath(folder ? `${folder}/${name}.md` : `${name}.md`);
      if (this.app.vault.getAbstractFileByPath(normalizedPath) instanceof TFile) {
        return normalizedPath;
      }
    }
    
    // Search by alias or basename
    const wanted = [name, details?.originalName].filter((n): n is string => !!n).map(n => n.toLowerCase());
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (this.aliasesOf(file).some(alias => wanted.includes(alias.toLowerCase())) ||
          wanted.includes(file.basename.toLowerCase())) {
        return file.path;
      }
    }
    
    // Search by who the person is
    const identity = details ?? parseSpeakerName(name).details;
    if (identity) {
      for (const file of files) {
        if (this.isSamePerson(this.identityOf(file), identity)) {
          return file.path;
        }
      }
    }
    
    return null;
  }
  
  private aliasesOf(file: TFile): string[] {
    const aliases: unknown = this.app.metadataCache.getFileCache(file)?.frontmatter?.aliases;
    const values: unknown[] = Array.isArray(aliases) ? aliases : [aliases];
    return values.filter((alias): alias is string => typeof alias === 'string' && alias !== '');
  }
  
  /**
   * The person a note is about, from its name properties, or failing that
   * from its file name and aliases if it is recognizably a person note.
   */
  private identityOf(file: TFile): PersonIdentity | null {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter?.last_name && frontmatter?.first_name) {
      return {
        lastName: String(frontmatter.last_name),
        firstName: String(frontmatter.first_name),
        middleInitial: frontmatter.middle_initial ? String(frontmatter.middle_initial) : undefined,
      };
    }
    
    const inPeopleFolder = !!this.peopleFolder && file.path.startsWith(`${this.peopleFolder}/`);
    if (frontmatter?.type !== 'person' && !inPeopleFolder) {
      return null;
    }
    for (const candidate of [file.basename, ...this.aliasesOf(file)]) {
      const parsed = parseSpeakerName(candidate).details;
      if (parsed) return parsed;
    }
    // A person note named plainly "Last, First", as newNoteName() names them.
    const plain = file.basename.match(/^([^,]+),\s*(\S+)$/);
    return plain ? { lastName: plain[1].trim(), firstName: plain[2] } : null;
  }
  
  /**
   * Same last and first name, and no disagreement about the middle initial.
   */
  private isSamePerson(a: PersonIdentity | null, b: PersonIdentity): boolean {
    if (!a) return false;
    const same = (x: string, y: string): boolean => x.trim().toLowerCase() === y.trim().toLowerCase();
    if (!same(a.lastName, b.lastName) || !same(a.firstName, b.firstName)) return false;
    return !a.middleInitial || !b.middleInitial || same(a.middleInitial, b.middleInitial);
  }
  
  /**
   * The file name for a new person note. Rank is left out so that it does not
   * change when the person's rank does: "Doe, John", not "Doe, John Capt".
   */
  private newNoteName(name: string, details?: SpeakerDetails): string {
    if (!details) return name;
    
    const exists = (candidate: string): boolean => {
      const folder = this.peopleFolder || '';
      const path = normalizePath(folder ? `${folder}/${candidate}.md` : `${candidate}.md`);
      return this.app.vault.getAbstractFileByPath(path) !== null;
    };
    
    // An existing "Doe, John" that was not matched is someone else with that name.
    const stable = `${details.lastName}, ${details.firstName}`;
    if (!exists(stable)) return stable;
    const withInitial = details.middleInitial ? `${stable} ${details.middleInitial}` : name;
    return exists(withInitial) ? name : withInitial;
  }
  
  /**
   * The note each participant is, or will be, recorded in: display name to
   * note name. The meeting note links through this, so "Doe, John Maj" points
   * at the note "Doe, John".
   */
  resolveNoteNames(participants: string[], details?: Record<string, SpeakerDetails>): Record<string, string> {
    const noteNames: Record<string, string> = {};
    for (const name of participants) {
      const existingPath = this.findParticipantNote(name, details?.[name]);
      const existing = existingPath ? this.app.vault.getAbstractFileByPath(existingPath) : null;
      noteNames[name] = existing instanceof TFile ? existing.basename : this.newNoteName(name, details?.[name]);
    }
    return noteNames;
  }
  
  /**
   * List the existing participant notes whose About section should be
   * rewritten for this meeting, so the caller can have them all synthesized in
   * one agent round-trip and pass the results to processParticipants().
   *
   * Request ids are note paths.
   */
  async collectSynthesisRequests(
    participants: string[],
    meetingPath: string,
    insights?: ParticipantInsight[],
    details?: Record<string, SpeakerDetails>
  ): Promise<SynthesisRequest[]> {
    const requests: SynthesisRequest[] = [];
    const meetingLink = meetingPath.replace(/\.md$/, '');
    
    for (const name of participants) {
      const insight = insights?.find(i => i.name.toLowerCase() === name.toLowerCase());
      const notePath = this.findParticipantNote(name, details?.[name]);
      if (!insight || !notePath) continue;
      
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!(file instanceof TFile)) continue;
      
      const content = await this.app.vault.read(file);
      // A note that already references this meeting is left untouched.
      if (content.includes(meetingLink)) continue;
      
      const newContext = this.buildAboutContext(insight);
      if (!newContext) continue;
      
      requests.push({
        id: notePath,
        kind: 'person',
        name: file.basename,
        existing: this.extractAbout(content),
        newContext,
      });
    }
    
    return requests;
  }
  
  /**
   * The names a person has gone by, other than the note's own name. Kept as
   * aliases so Obsidian's search and this plugin both find the note by them.
   */
  private aliasesFor(noteName: string, displayName: string, details?: SpeakerDetails): string[] {
    const names = [displayName, details?.originalName].filter((n): n is string => !!n);
    return [...new Set(names)].filter(n => n.toLowerCase() !== noteName.toLowerCase());
  }
  
  /**
   * Properties for a new person note, as [key, YAML value] pairs: aliases,
   * the parts of the name, and the details trimmed from the display name.
   */
  private newNoteProperties(
    noteName: string,
    displayName: string,
    meetingDate: Date,
    details?: SpeakerDetails
  ): Array<[string, string]> {
    const properties: Array<[string, string]> = [];
    const aliases = this.aliasesFor(noteName, displayName, details);
    if (aliases.length > 0) properties.push(['aliases', yamlList(aliases)]);
    if (!details) return properties;
    
    properties.push(['last_name', yamlText(details.lastName)], ['first_name', yamlText(details.firstName)]);
    if (details.middleInitial) properties.push(['middle_initial', yamlText(details.middleInitial)]);
    properties.push(...this.currentDetailProperties(details, meetingDate));
    return properties;
  }
  
  /**
   * The properties that change over a career, with the date they were seen.
   */
  private currentDetailProperties(details: SpeakerDetails, meetingDate: Date): Array<[string, string]> {
    const properties: Array<[string, string]> = [];
    if (details.rank) properties.push(['rank', yamlText(details.rank)]);
    if (details.branch) properties.push(['branch', yamlText(details.branch)]);
    if (details.organization) properties.push(['organization', yamlText(details.organization)]);
    if (properties.length > 0) properties.push([DETAILS_AS_OF, meetingDate.toISOString().split('T')[0]]);
    return properties;
  }
  
  /**
   * Bring an existing person note up to date with the name they appeared
   * under in this meeting:
   *
   * - the display name and original name are added as aliases;
   * - missing name parts are filled in, never changed;
   * - rank, branch, and organization follow the most recent meeting, so
   *   importing an older transcript later does not undo a promotion.
   */
  private updateNameProperties(
    content: string,
    noteName: string,
    displayName: string,
    meetingDate: Date,
    details?: SpeakerDetails
  ): string {
    const frontmatter = content.match(FRONTMATTER);
    if (!frontmatter) return content;
    let yaml = frontmatter[1];
    
    const existingAliases = readAliases(yaml);
    const known = new Set(existingAliases.map(alias => alias.toLowerCase()));
    const newAliases = this.aliasesFor(noteName, displayName, details).filter(alias => !known.has(alias.toLowerCase()));
    if (newAliases.length > 0) {
      yaml = setProperty(removeAliases(yaml), 'aliases', yamlList([...existingAliases, ...newAliases]));
    }
    
    if (details) {
      const fillIn: Array<[string, string]> = [
        ['last_name', yamlText(details.lastName)],
        ['first_name', yamlText(details.firstName)],
      ];
      if (details.middleInitial) fillIn.push(['middle_initial', yamlText(details.middleInitial)]);
      for (const [key, value] of fillIn) {
        if (!hasProperty(yaml, key)) yaml = setProperty(yaml, key, value);
      }
      
      const asOf = yaml.match(new RegExp(`^${DETAILS_AS_OF}:\\s*["']?(\\d{4}-\\d{2}-\\d{2})`, 'm'))?.[1];
      const isNewer = !asOf || meetingDate.toISOString().split('T')[0] >= asOf;
      for (const [key, value] of this.currentDetailProperties(details, meetingDate)) {
        if (isNewer || !hasProperty(yaml, key)) yaml = setProperty(yaml, key, value);
      }
    }
    
    return yaml === frontmatter[1] ? content : content.replace(frontmatter[0], `---\n${yaml}\n---`);
  }
  
  /**
   * What a meeting revealed about a person, as one line of context.
   */
  private buildAboutContext(insight: ParticipantInsight): string {
    const contextParts: string[] = [];
    if (insight.role) contextParts.push(`Role: ${insight.role}`);
    if (insight.keyPoints && insight.keyPoints.length > 0) {
      contextParts.push(`Key contributions: ${insight.keyPoints.join('; ')}`);
    }
    if (insight.actionItems && insight.actionItems.length > 0) {
      contextParts.push(`Working on: ${insight.actionItems.map(a => a.task).join('; ')}`);
    }
    if (insight.ownedTopics && insight.ownedTopics.length > 0) {
      contextParts.push(`Owns topics: ${insight.ownedTopics.join(', ')}`);
    }
    if (insight.wins && insight.wins.length > 0) {
      contextParts.push(`Recent wins: ${insight.wins.join('; ')}`);
    }
    return contextParts.join('. ');
  }
  
  private extractAbout(content: string): string {
    const aboutMatch = content.match(/## About\s*\n\n([\s\S]*?)(?=\n\n##|$)/);
    return aboutMatch ? aboutMatch[1].trim() : '';
  }
  
  /**
   * Create or update notes for participants with AI insights
   *
   * @param syntheses - rewritten About sections by note path, from collectSynthesisRequests()
   * @param details - rank, branch, organization etc. by participant name, recorded in note properties
   */
  async processParticipants(
    participants: string[],
    meetingTitle: string,
    meetingPath: string,
    meetingDate: Date,
    insights?: ParticipantInsight[],
    syntheses?: Map<string, string>,
    details?: Record<string, SpeakerDetails>
  ): Promise<{ created: string[]; updated: string[] }> {
    const created: string[] = [];
    const updated: string[] = [];
    
    // Ensure people folder exists if configured
    if (this.peopleFolder) {
      await this.ensureFolder(this.peopleFolder);
    }
    
    // Create a map of insights by participant name
    const insightMap = new Map<string, ParticipantInsight>();
    if (insights) {
      for (const insight of insights) {
        insightMap.set(insight.name.toLowerCase(), insight);
      }
    }
    
    for (const name of participants) {
      const insight = insightMap.get(name.toLowerCase());
      const existingPath = this.findParticipantNote(name, details?.[name]);
      
      if (existingPath) {
        // Update existing note
        await this.updateParticipantNote(existingPath, meetingTitle, meetingPath, meetingDate, insight, syntheses?.get(existingPath), name, details?.[name]);
        updated.push(name);
      } else {
        // Create new participant note
        const newPath = await this.createParticipantNote(name, meetingTitle, meetingPath, meetingDate, insight, details?.[name]);
        if (newPath) {
          created.push(name);
        }
      }
    }
    
    return { created, updated };
  }
  
  /**
   * Create a new participant note with insights
   */
  private async createParticipantNote(
    name: string,
    meetingTitle: string,
    meetingPath: string,
    meetingDate: Date,
    insight?: ParticipantInsight,
    details?: SpeakerDetails
  ): Promise<string | null> {
    const folderPath = this.peopleFolder || '';
    const noteName = this.newNoteName(name, details);
    const fileName = `${noteName}.md`;
    const filePath = folderPath ? normalizePath(`${folderPath}/${fileName}`) : fileName;
    
    if (this.app.vault.getAbstractFileByPath(filePath)) {
      return null;
    }
    
    const content = this.generateNewParticipantNote(noteName, meetingTitle, meetingPath, meetingDate, insight, details, name);
    
    try {
      await this.app.vault.create(filePath, content);
      console.debug(`Meeting Goose: created participant note for ${name}`);
      return filePath;
    } catch (error) {
      console.error(`Meeting Goose: failed to create note for ${name}`, error);
      return null;
    }
  }
  
  /**
   * Generate content for a new participant note
   */
  private generateNewParticipantNote(
    name: string,
    meetingTitle: string,
    meetingPath: string,
    meetingDate: Date,
    insight?: ParticipantInsight,
    details?: SpeakerDetails,
    displayName: string = name
  ): string {
    const date = new Date().toISOString().split('T')[0];
    const meetingLink = meetingPath.replace(/\.md$/, '');
    const meetingDateStr = meetingDate.toISOString().split('T')[0];
    
    let content = `---
created: ${date}
type: person
tags: [person]
${this.newNoteProperties(name, displayName, meetingDate, details).map(([key, value]) => `${key}: ${value}\n`).join('')}---

# ${name}

`;

    // Add role if we have insight
    if (insight?.role) {
      content += `**Role**: ${insight.role}\n\n`;
    }
    
    content += `## About\n\n\n`;
    
    // Owns section (topics and updates)
    if ((insight?.ownedTopics && insight.ownedTopics.length > 0) || (insight?.updates && insight.updates.length > 0)) {
      content += `## Owns\n`;
      
      // Add owned topics
      if (insight?.ownedTopics && insight.ownedTopics.length > 0) {
        for (const topic of insight.ownedTopics) {
          content += `- [[${topic}]] — *active topic*\n`;
        }
      }
      
      // Add updates as plain text with status and date
      if (insight?.updates && insight.updates.length > 0) {
        for (const update of insight.updates) {
          const statusEmoji = update.status === 'completed' ? '✅' : update.status === 'blocked' ? '🚫' : '🔄';
          content += `- ${statusEmoji} ${update.name} — *${update.status} ${update.date}* (from [[${meetingLink}|${meetingTitle}]])\n`;
        }
      }
      
      content += `\n`;
    }
    
    // Action items section (active)
    if (insight?.actionItems && insight.actionItems.length > 0) {
      content += `## Active Action Items\n\n`;
      for (const item of insight.actionItems) {
        let task = `- [ ] ${item.task}`;
        if (item.dueDate) {
          task += ` (due: ${item.dueDate})`;
        }
        task += ` — from [[${meetingLink}|${meetingTitle}]]`;
        content += task + '\n';
      }
      content += `\n`;
    }
    
    // Wins section
    if (insight?.wins && insight.wins.length > 0) {
      content += `## Recent Wins\n\n`;
      for (const win of insight.wins) {
        content += `- ✅ ${win} — from [[${meetingLink}|${meetingTitle}]]\n`;
      }
      content += `\n`;
    }
    
    // Raised Issues section
    if (insight?.raisedIssues && insight.raisedIssues.length > 0) {
      content += `## Raised Issues\n\n`;
      for (const issue of insight.raisedIssues) {
        content += `- [[${issue}]]\n`;
      }
      content += `\n`;
    }
    
    // Meetings section
    content += `## Meetings\n\n`;
    content += `### [[${meetingLink}|${meetingTitle}]] (${meetingDateStr})\n\n`;
    
    // Add key points from this meeting
    if (insight?.keyPoints && insight.keyPoints.length > 0) {
      content += `**Key Contributions:**\n`;
      for (const point of insight.keyPoints) {
        content += `- ${point}\n`;
      }
      content += `\n`;
    }
    
    // Add sentiment if available
    if (insight?.sentiment) {
      content += `*${insight.sentiment}*\n\n`;
    }
    
    // Archive section (empty initially)
    content += `## Archive\n\n`;
    content += `*Completed items and older meetings*\n\n`;
    
    content += `\n## Notes\n\n`;
    
    return content;
  }
  
  /**
   * Update an existing participant note with new meeting info
   */
  private async updateParticipantNote(
    notePath: string,
    meetingTitle: string,
    meetingPath: string,
    meetingDate: Date,
    insight?: ParticipantInsight,
    synthesizedAbout?: string,
    displayName?: string,
    details?: SpeakerDetails
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) return;
    
    try {
      let content = await this.app.vault.read(file);
      const meetingLink = meetingPath.replace(/\.md$/, '');
      const meetingDateStr = meetingDate.toISOString().split('T')[0];
      
      // Check if this meeting is already referenced
      if (content.includes(meetingLink)) {
        console.debug(`Meeting Goose: meeting already referenced in ${notePath}`);
        return;
      }
      
      // Extract person name from file path
      const personName = file.basename;
      
      content = this.updateNameProperties(content, personName, displayName ?? personName, meetingDate, details);
      
      // Replace the About section with the text synthesized for this meeting
      if (synthesizedAbout) {
        // Update the About section
        if (content.includes('## About')) {
          content = content.replace(
            /## About\s*\n\n[\s\S]*?(?=\n\n##|$)/,
            `## About\n\n${synthesizedAbout}`
          );
        } else {
          // Add About section after role or at the start
          const roleIndex = content.indexOf('**Role**:');
          if (roleIndex !== -1) {
            const roleEndIndex = content.indexOf('\n\n', roleIndex);
            if (roleEndIndex !== -1) {
              content = content.slice(0, roleEndIndex + 2) + 
                `## About\n\n${synthesizedAbout}\n\n` + 
                content.slice(roleEndIndex + 2);
            }
          } else {
            // Add after frontmatter/title
            const titleMatch = content.match(/^# .+\n\n/m);
            if (titleMatch) {
              const insertPos = content.indexOf(titleMatch[0]) + titleMatch[0].length;
              content = content.slice(0, insertPos) + 
                `## About\n\n${synthesizedAbout}\n\n` + 
                content.slice(insertPos);
            }
          }
        }
        console.debug(`Meeting Goose: synthesized About section for ${personName}`);
      }
      
      // Update role if we have one and there's no existing role
      if (insight?.role && !content.includes('**Role**:')) {
        const aboutIndex = content.indexOf('## About');
        if (aboutIndex !== -1) {
          content = content.slice(0, aboutIndex) + 
            `**Role**: ${insight.role}\n\n` + 
            content.slice(aboutIndex);
        }
      }
      
      // Add meeting entry
      const meetingsHeaderRegex = /^## Meetings\s*$/m;
      const meetingEntry = this.generateMeetingEntry(meetingTitle, meetingLink, meetingDateStr, insight);
      
      if (meetingsHeaderRegex.test(content)) {
        content = content.replace(
          meetingsHeaderRegex,
          `## Meetings\n\n${meetingEntry}`
        );
      } else {
        // No Meetings section - add before Action Items or at end
        const actionItemsIndex = content.indexOf('## Action Items');
        if (actionItemsIndex !== -1) {
          content = content.slice(0, actionItemsIndex) + 
            `## Meetings\n\n${meetingEntry}\n` + 
            content.slice(actionItemsIndex);
        } else {
          content = content.trimEnd() + `\n\n## Meetings\n\n${meetingEntry}\n`;
        }
      }
      
      // Remove old "Top of Mind" section logic - no longer used
      
      // Ensure Archive section exists
      if (!content.includes('## Archive')) {
        const notesIndex = content.indexOf('## Notes');
        if (notesIndex !== -1) {
          content = content.slice(0, notesIndex) + 
            `## Archive\n\n*Completed items and older meetings*\n\n` +
            content.slice(notesIndex);
        } else {
          content = content.trimEnd() + `\n\n## Archive\n\n*Completed items and older meetings*\n\n`;
        }
      }
      
      // Add owned topics and updates to Owns section
      if ((insight?.ownedTopics && insight.ownedTopics.length > 0) || (insight?.updates && insight.updates.length > 0)) {
        // Check if Owns section exists
        if (content.includes('## Owns')) {
          // Add to existing Owns section
          let ownsContent = '';
          
          if (insight?.ownedTopics && insight.ownedTopics.length > 0) {
            for (const topic of insight.ownedTopics) {
              ownsContent += `- [[${topic}]] — *active topic*\n`;
            }
          }
          
          if (insight?.updates && insight.updates.length > 0) {
            for (const update of insight.updates) {
              const statusEmoji = update.status === 'completed' ? '✅' : update.status === 'blocked' ? '🚫' : '🔄';
              ownsContent += `- ${statusEmoji} ${update.name} — *${update.status} ${update.date}* (from [[${meetingLink}|${meetingTitle}]])\n`;
            }
          }
          
          content = content.replace(
            /(## Owns\n)/,
            `$1${ownsContent}`
          );
        } else {
          // Create new Owns section before Raised Issues
          let ownsSection = `## Owns\n`;
          
          if (insight?.ownedTopics && insight.ownedTopics.length > 0) {
            for (const topic of insight.ownedTopics) {
              ownsSection += `- [[${topic}]] — *active topic*\n`;
            }
          }
          
          if (insight?.updates && insight.updates.length > 0) {
            for (const update of insight.updates) {
              const statusEmoji = update.status === 'completed' ? '✅' : update.status === 'blocked' ? '🚫' : '🔄';
              ownsSection += `- ${statusEmoji} ${update.name} — *${update.status} ${update.date}* (from [[${meetingLink}|${meetingTitle}]])\n`;
            }
          }
          
          ownsSection += `\n`;
          
          // Insert before Raised Issues or Meetings section
          const raisedIssuesIndex = content.indexOf('## Raised Issues');
          const meetingsIndex = content.indexOf('## Meetings');
          const insertIndex = raisedIssuesIndex !== -1 ? raisedIssuesIndex : meetingsIndex;
          
          if (insertIndex !== -1) {
            content = content.slice(0, insertIndex) + ownsSection + content.slice(insertIndex);
          } else {
            content = content.trimEnd() + `\n\n${ownsSection}`;
          }
        }
      }
      
      // Add raised issues
      if (insight?.raisedIssues && insight.raisedIssues.length > 0) {
        // Check if Raised Issues section exists
        if (content.includes('## Raised Issues')) {
          // Add to existing section
          let issuesContent = '';
          for (const issue of insight.raisedIssues) {
            // Check if this issue is already listed
            if (!content.includes(`[[${issue}]]`)) {
              issuesContent += `- [[${issue}]]\n`;
            }
          }
          
          if (issuesContent) {
            content = content.replace(
              /(## Raised Issues\n\n)/,
              `$1${issuesContent}`
            );
          }
        } else {
          // Create new Raised Issues section before Meetings
          let issuesSection = `## Raised Issues\n\n`;
          for (const issue of insight.raisedIssues) {
            issuesSection += `- [[${issue}]]\n`;
          }
          issuesSection += `\n`;
          
          const meetingsIndex = content.indexOf('## Meetings');
          if (meetingsIndex !== -1) {
            content = content.slice(0, meetingsIndex) + 
              issuesSection + 
              content.slice(meetingsIndex);
          } else {
            // Fallback: add before Archive
            const archiveIndex = content.indexOf('## Archive');
            if (archiveIndex !== -1) {
              content = content.slice(0, archiveIndex) + 
                issuesSection + 
                content.slice(archiveIndex);
            }
          }
        }
      }
      
      // Add wins to Recent Wins section
      if (insight?.wins && insight.wins.length > 0) {
        const winsContent = insight.wins.map(win => `- ✅ ${win} — from [[${meetingLink}|${meetingTitle}]]`).join('\n');
        
        if (content.includes('## Recent Wins')) {
          // Add to existing Recent Wins section
          content = content.replace(
            /(## Recent Wins\n\n)/,
            `$1${winsContent}\n`
          );
        } else {
          // Create new Recent Wins section before Active Action Items or Raised Issues
          const winsSection = `## Recent Wins\n\n${winsContent}\n\n`;
          const actionItemsIndex = content.indexOf('## Active Action Items');
          const raisedIssuesIndex = content.indexOf('## Raised Issues');
          const insertIndex = actionItemsIndex !== -1 ? actionItemsIndex : raisedIssuesIndex;
          
          if (insertIndex !== -1) {
            content = content.slice(0, insertIndex) + winsSection + content.slice(insertIndex);
          } else {
            content = content.trimEnd() + `\n\n${winsSection}`;
          }
        }
      }
      
      // Add new action items to Active Action Items section
      if (insight?.actionItems && insight.actionItems.length > 0) {
        const newActionItems = insight.actionItems.map(item => {
          let task = `- [ ] ${item.task}`;
          if (item.dueDate) {
            task += ` (due: ${item.dueDate})`;
          }
          task += ` — from [[${meetingLink}|${meetingTitle}]]`;
          return task;
        }).join('\n');
        
        // Check if Active Action Items section exists (##) or subsection (###)
        if (content.includes('## Active Action Items')) {
          // Add to existing top-level section
          content = content.replace(
            /(## Active Action Items\n\n)/,
            `$1${newActionItems}\n`
          );
        } else if (content.includes('### Active Action Items')) {
          // Add to existing subsection (from old structure)
          content = content.replace(
            /(### Active Action Items\n\n)/,
            `$1${newActionItems}\n`
          );
        } else {
          // Create new section before Raised Issues or Meetings
          const actionItemsSection = `## Active Action Items\n\n${newActionItems}\n\n`;
          const raisedIssuesIndex = content.indexOf('## Raised Issues');
          const meetingsIndex = content.indexOf('## Meetings');
          const insertIndex = raisedIssuesIndex !== -1 ? raisedIssuesIndex : meetingsIndex;
          
          if (insertIndex !== -1) {
            content = content.slice(0, insertIndex) + actionItemsSection + content.slice(insertIndex);
          } else {
            content = content.trimEnd() + `\n\n${actionItemsSection}`;
          }
        }
      }
      
      await this.app.vault.modify(file, content);
      console.debug(`Meeting Goose: updated participant note ${notePath}`);
      
    } catch (error) {
      console.error(`Meeting Goose: failed to update ${notePath}`, error);
    }
  }
  
  /**
   * Generate a meeting entry for a participant note
   */
  private generateMeetingEntry(
    meetingTitle: string,
    meetingLink: string,
    meetingDate: string,
    insight?: ParticipantInsight
  ): string {
    let entry = `### [[${meetingLink}|${meetingTitle}]] (${meetingDate})\n\n`;
    
    if (insight?.keyPoints && insight.keyPoints.length > 0) {
      entry += `**Key Contributions:**\n`;
      for (const point of insight.keyPoints) {
        entry += `- ${point}\n`;
      }
      entry += `\n`;
    }
    
    if (insight?.sentiment) {
      entry += `*${insight.sentiment}*\n\n`;
    }
    
    return entry;
  }
  
  /**
   * Ensure a folder exists
   */
  private async ensureFolder(folderPath: string): Promise<void> {
    const normalizedPath = normalizePath(folderPath);
    const folder = this.app.vault.getAbstractFileByPath(normalizedPath);
    
    if (!folder) {
      try {
        await this.app.vault.createFolder(normalizedPath);
      } catch {
        // Folder might already exist
      }
    }
  }
  
  /**
   * Clean up orphaned meeting references from participant notes
   * Removes references to meeting files that no longer exist
   */
  async cleanupOrphanedReferences(): Promise<{ cleaned: number; removed: number; deleted: number }> {
    let cleaned = 0;
    let removed = 0;
    const deleted = 0;
    
    if (!this.peopleFolder) {
      return { cleaned, removed, deleted };
    }
    
    try {
      const folder = this.app.vault.getAbstractFileByPath(this.peopleFolder);
      if (!folder) {
        return { cleaned, removed, deleted };
      }
      
      // Get all markdown files in the people folder
      const files = this.app.vault.getMarkdownFiles().filter(file => 
        file.path.startsWith(this.peopleFolder + '/')
      );
      
      for (const file of files) {
        let content = await this.app.vault.read(file);
        const originalContent = content;
        
        // Find the Meetings section
        const meetingsHeaderRegex = /^## Meetings\s*$/m;
        if (!meetingsHeaderRegex.test(content)) {
          continue;
        }
        
        // Extract meeting entries (lines starting with ### [[link|title]] (date))
        const meetingEntryRegex = /^### \[\[([^\]]+)\|([^\]]+)\]\] \(([^)]+)\)\s*$/gm;
        const meetingEntries: Array<{ fullMatch: string; link: string; title: string; date: string }> = [];
        let match;
        
        while ((match = meetingEntryRegex.exec(content)) !== null) {
          meetingEntries.push({
            fullMatch: match[0],
            link: match[1],
            title: match[2],
            date: match[3],
          });
        }
        
        // Check each meeting reference (in reverse order to preserve indices)
        let hasChanges = false;
        for (let i = meetingEntries.length - 1; i >= 0; i--) {
          const entry = meetingEntries[i];
          // Try to find the meeting file
          const meetingPath = entry.link.endsWith('.md') ? entry.link : `${entry.link}.md`;
          const meetingFile = this.app.vault.getAbstractFileByPath(meetingPath);
          
          if (!meetingFile) {
            // Meeting file doesn't exist - find and remove the entire entry block
            // Entry format: ### [[link|title]] (date)\n\n[optional content]\n\n
            // Find from the header line to the next ### or ## section
            const escapedLink = entry.link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedTitle = entry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const escapedDate = entry.date.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Match from the header to the next meeting entry or section
            const entryBlockRegex = new RegExp(
              `^### \\[\\[${escapedLink}\\|${escapedTitle}\\]\\] \\(${escapedDate}\\)\\s*\\n(?:[^#]|\\n)*?(?=\\n### |\\n## |$)`,
              'gm'
            );
            
            content = content.replace(entryBlockRegex, '');
            removed++;
            hasChanges = true;
          }
        }
        
        // Also check action items that reference meetings
        const actionItemRegex = /- \[ \] (.+?) — from \[\[([^\]]+)\|([^\]]+)\]\]/g;
        let actionItemMatch;
        while ((actionItemMatch = actionItemRegex.exec(content)) !== null) {
          const meetingLink = actionItemMatch[2];
          const meetingPath = meetingLink.endsWith('.md') ? meetingLink : `${meetingLink}.md`;
          const meetingFile = this.app.vault.getAbstractFileByPath(meetingPath);
          
          if (!meetingFile) {
            // Remove the action item line
            content = content.replace(actionItemMatch[0] + '\n', '');
            removed++;
            hasChanges = true;
          }
        }
        
        // Clean up empty Meetings section
        if (hasChanges) {
          const meetingsSectionRegex = /^## Meetings\s*$\n\n(?:(?:###|-) .*\n?)*/m;
          const meetingsSection = content.match(meetingsSectionRegex);
          if (meetingsSection && meetingsSection[0].trim() === '## Meetings') {
            // Section is empty, remove it
            content = content.replace(meetingsSectionRegex, '');
          }
          
          // Clean up empty Action Items section
          const actionItemsSectionRegex = /^## Action Items\s*$\n\n(?:\*No action items yet\*|(?:(?:- \[ \]|-) .*\n?)*)/m;
          const actionItemsSection = content.match(actionItemsSectionRegex);
          if (actionItemsSection && (actionItemsSection[0].includes('*No action items yet*') || actionItemsSection[0].trim() === '## Action Items')) {
            // Section is empty, remove it
            content = content.replace(actionItemsSectionRegex, '');
          }
          
          if (content !== originalContent) {
            await this.app.vault.modify(file, content);
            cleaned++;
          }
        }
      }
      
      return { cleaned, removed, deleted };
    } catch (error) {
      console.error('Meeting Goose: failed to cleanup participant references', error);
      return { cleaned, removed, deleted };
    }
  }
}
