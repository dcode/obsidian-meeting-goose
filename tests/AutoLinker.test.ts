/**
 * Tests for AutoLinker service
 */

import { AutoLinker } from '../src/services/AutoLinker';
import { VaultIndexService } from '../src/services/VaultIndex';
import { App } from 'obsidian';

describe('AutoLinker', () => {
  let app: App;
  let vaultIndex: VaultIndexService;
  let autoLinker: AutoLinker;

  beforeEach(async () => {
    app = new App();
    vaultIndex = new VaultIndexService(app);
    autoLinker = new AutoLinker(vaultIndex, 3);
    
    // Clear mocks
    (app.vault as any)._clear();
    (app.metadataCache as any)._clear();
    
    // Set up a basic vault
    (app.vault as any)._setFile('People/Engineering Lead.md', '# Engineering Lead');
    (app.vault as any)._setFile('Projects/Project Phoenix.md', '# Phoenix');
    (app.vault as any)._setFile('Notes/API.md', '# API Documentation');
    
    vaultIndex.buildIndex();
  });

  describe('processText', () => {
    it('should create links for exact matches', () => {
      const text = 'Engineering Lead is working on Project Phoenix.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Engineering Lead]]');
      expect(result.linkedText).toContain('[[Project Phoenix]]');
    });

    it('should only link first occurrence of each term', () => {
      const text = 'Engineering Lead met with Engineering Lead about the project.';
      const result = autoLinker.processText(text);

      // Count occurrences of the link
      const linkCount = (result.linkedText.match(/\[\[Engineering Lead\]\]/g) || []).length;
      expect(linkCount).toBe(1);
      
      // Second occurrence should remain as plain text
      expect(result.linkedText).toMatch(/\[\[Engineering Lead\]\].*Engineering Lead/);
    });

    it('should preserve case in display text', () => {
      const text = 'ENGINEERING LEAD is working on project phoenix.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Engineering Lead|ENGINEERING LEAD]]');
      expect(result.linkedText).toContain('[[Project Phoenix|project phoenix]]');
    });

    it('should use simple link when case matches', () => {
      const text = 'Engineering Lead is here.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Engineering Lead]]');
      expect(result.linkedText).not.toContain('[[Engineering Lead|Engineering Lead]]');
    });

    it('should match word boundaries only', () => {
      const text = 'The API documentation is at API.md and myAPI.';
      const result = autoLinker.processText(text);

      // Should link standalone "API" but not "myAPI"
      const linkCount = (result.linkedText.match(/\[\[API\]\]/g) || []).length;
      expect(linkCount).toBe(1);
      expect(result.linkedText).toContain('myAPI'); // No link
    });

    it('should not link inside existing wiki-links', () => {
      const text = 'See [[Engineering Lead Notes]] for details about Engineering Lead.';
      const result = autoLinker.processText(text);

      // Should not modify the existing link
      expect(result.linkedText).toContain('[[Engineering Lead Notes]]');
      
      // Should link the second occurrence
      expect(result.linkedText).toMatch(/\[\[Engineering Lead Notes\]\].*\[\[Engineering Lead\]\]/);
    });

    it('should not link inside markdown links', () => {
      const text = '[Engineering Lead Profile](https://example.com) and Engineering Lead.';
      const result = autoLinker.processText(text);

      // Should not modify the markdown link
      expect(result.linkedText).toContain('[Engineering Lead Profile](https://example.com)');
      
      // Should link the second occurrence
      expect(result.linkedText.match(/\[\[Engineering Lead\]\]/g)?.length).toBe(1);
    });

    it('should prefer longer matches', () => {
      // Clear and set up overlapping terms
      (app.vault as any)._clear();
      (app.vault as any)._setFile('Phoenix.md', '# Phoenix');
      (app.vault as any)._setFile('Project Phoenix.md', '# Project Phoenix');
      
      vaultIndex.buildIndex();
        const text = 'Working on Project Phoenix today.';
        const result = autoLinker.processText(text);

        // Should link to "Project Phoenix" not just "Phoenix"
        expect(result.linkedText).toContain('[[Project Phoenix]]');
        expect(result.linkedText).not.toContain('[[Phoenix]]');
    });

    it('should handle ambiguous matches', async () => {
      // Clear and add ambiguous terms
      (app.vault as any)._clear();
      (app.vault as any)._setFile('People/Owner.md', '# Owner');
      (app.vault as any)._setFile('Projects/Owner.md', '# Owner Project');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3);

      const text = 'Owner is working on the project.';
      const result = autoLinker.processText(text);

      // Should not auto-link ambiguous term
      expect(result.linkedText).not.toContain('[[Owner]]');
      
      // Should provide suggestions
      expect(result.suggestedLinks.length).toBeGreaterThan(0);
      const ownerSuggestion = result.suggestedLinks.find(s => s.term === 'Owner');
      expect(ownerSuggestion).toBeDefined();
      expect(ownerSuggestion?.candidates).toHaveLength(2);
    });

    it('should skip terms with too many ambiguous matches', async () => {
      // Clear and add many ambiguous terms
      (app.vault as any)._clear();
      (app.vault as any)._setFile('A/Test.md', '# Test');
      (app.vault as any)._setFile('B/Test.md', '# Test');
      (app.vault as any)._setFile('C/Test.md', '# Test');
      (app.vault as any)._setFile('D/Test.md', '# Test');
      (app.vault as any)._setFile('E/Test.md', '# Test');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3); // Max 3 suggestions

      const text = 'This is a test.';
      const result = autoLinker.processText(text);

      // Should not link or suggest (too many matches)
      expect(result.linkedText).not.toContain('[[test]]');
      expect(result.suggestedLinks.length).toBe(0);
    });

    it('should handle empty text', () => {
      const result = autoLinker.processText('');
      
      expect(result.linkedText).toBe('');
      expect(result.suggestedLinks).toEqual([]);
    });

    it('should handle text with no matches', () => {
      const text = 'This text has no matching terms at all.';
      const result = autoLinker.processText(text);
      
      expect(result.linkedText).toBe(text);
      expect(result.suggestedLinks).toEqual([]);
    });

    it('should not link very short terms', () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('AB.md', '# AB');
      
      vaultIndex.buildIndex();
        const text = 'AB testing is important.';
        const result = autoLinker.processText(text);

        // Terms less than 3 characters should be skipped
        expect(result.linkedText).toBe(text);
    });
  });

  describe('suggested links deduplication', () => {
    it('should not duplicate suggested links', async () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('People/Owner.md', '# Owner');
      (app.vault as any)._setFile('Projects/Owner.md', '# Owner');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3);

      const text = 'Owner mentioned Owner several times.';
      const result = autoLinker.processText(text);

      // Should only have one suggestion for "Owner" despite multiple occurrences
      const ownerSuggestions = result.suggestedLinks.filter(
        s => s.term.toLowerCase() === 'owner'
      );
      expect(ownerSuggestions).toHaveLength(1);
    });
  });

  describe('setMaxMatches', () => {
    it('should update max matches threshold', async () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('A/Test.md', '# Test');
      (app.vault as any)._setFile('B/Test.md', '# Test');
      (app.vault as any)._setFile('C/Test.md', '# Test');
      (app.vault as any)._setFile('D/Test.md', '# Test');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 2); // Max 2

      let text = 'This is a test.';
      let result = autoLinker.processText(text);
      
      // Should skip (4 matches > 2 max)
      expect(result.suggestedLinks.length).toBe(0);

      // Increase threshold
      autoLinker.setMaxMatches(5);
      result = autoLinker.processText(text);
      
      // Should now suggest
      expect(result.suggestedLinks.length).toBeGreaterThan(0);
    });
  });

  describe('complex scenarios', () => {
    it('should handle multiple links in one sentence', () => {
      const text = 'Engineering Lead and API work on Project Phoenix together.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Engineering Lead]]');
      expect(result.linkedText).toContain('[[API]]');
      expect(result.linkedText).toContain('[[Project Phoenix]]');
    });

    it('should handle adjacent terms', async () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('API.md', '# API');
      (app.vault as any)._setFile('Documentation.md', '# Documentation');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3);

      const text = 'API Documentation is ready.';
      const result = autoLinker.processText(text);

      // Should link both terms
      expect(result.linkedText).toContain('[[API]]');
      expect(result.linkedText).toContain('[[Documentation]]');
    });

    it('should preserve punctuation and spacing', () => {
      const text = 'Hello, Engineering Lead! How is Project Phoenix?';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('Hello, [[Engineering Lead]]!');
      expect(result.linkedText).toContain('[[Project Phoenix]]?');
    });

    it('should handle terms at start and end of text', () => {
      const text = 'Engineering Lead works on projects like Project Phoenix';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Engineering Lead]]');
      expect(result.linkedText).toContain('[[Project Phoenix]]');
    });
  });

  describe('edge cases with special characters', () => {
    it('should handle terms with special regex characters', async () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('C++.md', '# C++');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3);

      const text = 'Learning C++ programming.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[C++]]');
    });

    it('should handle terms with hyphens', async () => {
      (app.vault as any)._clear();
      (app.vault as any)._setFile('Test-Driven-Development.md', '# TDD');
      
      vaultIndex.buildIndex();
      autoLinker = new AutoLinker(vaultIndex, 3);

      const text = 'Use Test-Driven-Development for quality.';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toContain('[[Test-Driven-Development]]');
    });
  });

  describe('performance considerations', () => {
    it('should handle large text efficiently', async () => {
      const text = 'Engineering Lead '.repeat(100) + 'Project Phoenix';
      
      const startTime = Date.now();
      const result = autoLinker.processText(text);
      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (< 100ms for this size)
      expect(elapsed).toBeLessThan(100);
      
      // Should still only link first occurrence
      const engineeringLeadCount = (result.linkedText.match(/\[\[Engineering Lead\]\]/g) || []).length;
      expect(engineeringLeadCount).toBe(1);
    });
  });

  describe('link format', () => {
    it('should use display text format when case differs', () => {
      const text = 'ENGINEERING LEAD';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toBe('[[Engineering Lead|ENGINEERING LEAD]]');
    });

    it('should use simple format when case matches exactly', () => {
      const text = 'Engineering Lead';
      const result = autoLinker.processText(text);

      expect(result.linkedText).toBe('[[Engineering Lead]]');
    });

    it('should use simple format for case-insensitive match', () => {
      const text = 'engineering lead';
      const result = autoLinker.processText(text);

      // When original text is all lowercase, use display text
      expect(result.linkedText).toBe('[[Engineering Lead|engineering lead]]');
    });
  });
});
