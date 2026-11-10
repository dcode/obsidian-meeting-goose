/**
 * SettingsTab - Plugin settings UI
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import MeetingGoosePlugin from '../main';
import { DEFAULT_SETTINGS } from '../types';

// Debounce utility for text inputs
function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export class MeetingGooseSettingsTab extends PluginSettingTab {
  plugin: MeetingGoosePlugin;
  
  constructor(app: App, plugin: MeetingGoosePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    
    new Setting(containerEl)
      .setName('Configuration')
      .setHeading();
    
    containerEl.createEl('p', { 
      text: 'Configure how this plugin imports and processes your meeting transcripts.',
      cls: 'setting-item-description'
    });
    
    // Sources Section
    this.createSourcesSection(containerEl);
    
    // Output Section
    this.createOutputSection(containerEl);
    
    // AI Section
    this.createAISection(containerEl);
    
    // Linking Section
    this.createLinkingSection(containerEl);
    
    // Participants Section
    this.createParticipantsSection(containerEl);
    
    // Entity Extraction Section
    this.createEntitySection(containerEl);
    
  }
  
  /**
   * Create Sources section
   */
  private createSourcesSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Sources')
      .setHeading();
    
    // Folder watcher toggle (primary method)
    new Setting(containerEl)
      .setName('Enable folder watcher')
      .setDesc('Watch a folder for new transcript files.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.folderWatcherEnabled)
        .onChange(async (value) => {
          this.plugin.settings.folderWatcherEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.updateFolderWatcher();
          this.display();
        })
      );
    
    if (this.plugin.settings.folderWatcherEnabled) {
      // Watch folder path - debounced to avoid creating folders on every keystroke
      const debouncedWatchFolderUpdate = debounce(async (value: string) => {
        this.plugin.settings.watchFolder = value;
        await this.plugin.saveSettings();
        this.plugin.updateFolderWatcher();
      }, 1000); // Wait 1 second after user stops typing
      
      new Setting(containerEl)
        .setName('Watch folder')
        .setDesc('Folder path to watch for new transcript files')
        .addText(text => text
          .setPlaceholder('Transcripts/import')
          .setValue(this.plugin.settings.watchFolder)
          .onChange(debouncedWatchFolderUpdate)
        );
    }
    
    // Otter.ai export guide
    const otterGuide = containerEl.createDiv({ cls: 'meeting-goose-otter-guide' });
    new Setting(otterGuide)
      .setName('Otter integration guide')
      .setHeading();
    otterGuide.createEl('p', {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: 'Export your transcripts from Otter and drop them in your watched folder.',
      cls: 'setting-item-description'
    });
    const steps = otterGuide.createEl('ol', { cls: 'meeting-goose-otter-steps' });
    // eslint-disable-next-line obsidianmd/ui/sentence-case
    steps.createEl('li', { text: 'Open your transcript in Otter.' });
    steps.createEl('li', { text: 'Click the "..." menu → export.' });
    steps.createEl('li', { text: 'Choose "text" format.' });
    steps.createEl('li', { text: 'Save to your watched folder.' });
    otterGuide.createEl('p', {
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      text: 'Your Otter transcripts will be automatically imported and processed!',
      cls: 'setting-item-description meeting-goose-otter-tip'
    });
    
    // Fireflies.ai Integration
    new Setting(containerEl)
      .setName('Fireflies integration')
      .setHeading();
    
    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName('Enable Fireflies sync')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Automatically sync transcripts from your Fireflies account.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.firefliesEnabled)
        .onChange(async (value) => {
          this.plugin.settings.firefliesEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    
    if (this.plugin.settings.firefliesEnabled) {
      // API Key
      new Setting(containerEl)
        .setName('Fireflies API key')
        .addText(text => {
          text
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('Enter your Fireflies API key.')
            .setValue(this.plugin.settings.firefliesApiKey)
            .onChange(async (value) => {
              this.plugin.settings.firefliesApiKey = value;
              await this.plugin.saveSettings();
              this.plugin.updateFirefliesService();
            });
          text.inputEl.type = 'password';
          text.inputEl.addClass('meeting-goose-api-key-input');
        });
      
      // Test connection button
      new Setting(containerEl)
        .setName('Test connection')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Verify your Fireflies API key is working.')
        .addButton(button => button
          .setButtonText('Test connection')
          .onClick(async () => {
            button.setButtonText('Testing...');
            button.setDisabled(true);
            
            const result = await this.plugin.firefliesService.testConnection();
            
            if (result.success) {
              new Notice(`✓ ${result.message}`);
            } else {
              new Notice(`✗ ${result.message}`);
            }
            
            button.setButtonText('Test connection');
            button.setDisabled(false);
          })
        );
      
      // Sync interval
      new Setting(containerEl)
        .setName('Sync interval')
        .setDesc('How often to check for new transcripts.')
        .addDropdown(dropdown => dropdown
          .addOption('5', '5 minutes')
          .addOption('15', '15 minutes')
          .addOption('30', '30 minutes')
          .addOption('60', '60 minutes')
          .setValue(this.plugin.settings.firefliesSyncInterval.toString())
          .onChange(async (value) => {
            this.plugin.settings.firefliesSyncInterval = parseInt(value);
            await this.plugin.saveSettings();
            this.plugin.restartFirefliesSync();
          })
        );
      
      // Sync now button
      new Setting(containerEl)
        .setName('Sync now')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Manually trigger a sync with Fireflies.')
        .addButton(button => button
          .setButtonText('Sync now')
          .setCta()
          .onClick(async () => {
            button.setButtonText('Syncing...');
            button.setDisabled(true);
            
            try {
              const transcripts = await this.plugin.firefliesService.sync();
              new Notice(`Synced ${transcripts.length} transcripts from Fireflies.ai`);
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Sync failed';
              new Notice(`Sync failed: ${errorMessage}`);
            }
            
            button.setButtonText('Sync now');
            button.setDisabled(false);
          })
        );
    }

    // Granola Integration
    new Setting(containerEl)
      .setName('Granola integration')
      .setHeading();

    new Setting(containerEl)
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setName('Enable Granola sync')
      // eslint-disable-next-line obsidianmd/ui/sentence-case
      .setDesc('Automatically sync notes and transcripts from Granola. Requires a Granola Business or Enterprise plan.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.granolaEnabled)
        .onChange(async (value) => {
          this.plugin.settings.granolaEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.restartGranolaSync();
          this.display();
        })
      );

    if (this.plugin.settings.granolaEnabled) {
      // API Key
      new Setting(containerEl)
        .setName('Granola API key')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Create an API key in the Granola desktop app.')
        .addText(text => {
          text
            // eslint-disable-next-line obsidianmd/ui/sentence-case
            .setPlaceholder('Enter your Granola API key.')
            .setValue(this.plugin.settings.granolaApiKey)
            .onChange(async (value) => {
              this.plugin.settings.granolaApiKey = value;
              await this.plugin.saveSettings();
              this.plugin.updateGranolaService();
            });
          text.inputEl.type = 'password';
          text.inputEl.addClass('meeting-goose-api-key-input');
          // Start syncing once the key is entered, not on every keystroke
          text.inputEl.addEventListener('blur', () => this.plugin.restartGranolaSync());
        });

      // Test connection button
      new Setting(containerEl)
        .setName('Test connection')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Verify your Granola API key is working.')
        .addButton(button => button
          .setButtonText('Test connection')
          .onClick(async () => {
            button.setButtonText('Testing...');
            button.setDisabled(true);

            const result = await this.plugin.granolaService.testConnection();

            if (result.success) {
              new Notice(`✓ ${result.message}`);
            } else {
              new Notice(`✗ ${result.message}`);
            }

            button.setButtonText('Test connection');
            button.setDisabled(false);
          })
        );

      // Sync interval
      new Setting(containerEl)
        .setName('Sync interval')
        .setDesc('How often to check for new transcripts.')
        .addDropdown(dropdown => dropdown
          .addOption('5', '5 minutes')
          .addOption('15', '15 minutes')
          .addOption('30', '30 minutes')
          .addOption('60', '60 minutes')
          .setValue(this.plugin.settings.granolaSyncInterval.toString())
          .onChange(async (value) => {
            this.plugin.settings.granolaSyncInterval = parseInt(value);
            await this.plugin.saveSettings();
            this.plugin.restartGranolaSync();
          })
        );

      // Sync now button
      new Setting(containerEl)
        .setName('Sync now')
        // eslint-disable-next-line obsidianmd/ui/sentence-case
        .setDesc('Manually trigger a sync with Granola.')
        .addButton(button => button
          .setButtonText('Sync now')
          .setCta()
          .onClick(async () => {
            button.setButtonText('Syncing...');
            button.setDisabled(true);

            try {
              const transcripts = await this.plugin.granolaService.sync();
              new Notice(`Synced ${transcripts.length} transcripts from Granola`);
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : 'Sync failed';
              new Notice(`Sync failed: ${errorMessage}`);
            }

            button.setButtonText('Sync now');
            button.setDisabled(false);
          })
        );
    }
  }

  /**
   * Create Output section
   */
  private createOutputSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Output')
      .setHeading();
    
    // Destination folder
    new Setting(containerEl)
      .setName('Destination folder')
      .setDesc('Where to save processed meeting notes')
      .addText(text => text
        .setPlaceholder('Meetings')
        .setValue(this.plugin.settings.outputFolder)
        .onChange(async (value) => {
          this.plugin.settings.outputFolder = value || 'Meetings';
          await this.plugin.saveSettings();
          this.plugin.updateNoteGenerator();
        })
      );
    
    // Filename template
    new Setting(containerEl)
      .setName('Filename template')
      .setDesc('Template for generated filenames. Variables: yyyy, mm, dd, title')
      .addText(text => text
        .setPlaceholder('Yyyy-mm-dd meeting title')
        .setValue(this.plugin.settings.filenameTemplate)
        .onChange(async (value) => {
          this.plugin.settings.filenameTemplate = value || 'YYYY-MM-DD Meeting title';
          await this.plugin.saveSettings();
          this.plugin.updateNoteGenerator();
        })
      );
  }
  
  /**
   * Create AI section
   */
  private createAISection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('AI enrichment')
      .setHeading();
    
    new Setting(containerEl)
      .setName('Enable AI enrichment')
      .setDesc('Use a local agent to generate summaries, extract action items, and suggest tags')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.aiEnabled)
        .onChange(async (value) => {
          this.plugin.settings.aiEnabled = value;
          await this.plugin.saveSettings();
          this.plugin.updateAIService();
          this.display();
        })
      );
    
    if (this.plugin.settings.aiEnabled) {
      const debouncedAgentUpdate = debounce(async () => {
        await this.plugin.saveSettings();
        this.plugin.updateAIService();
      }, 1000);
      
      new Setting(containerEl)
        .setName('Agent command')
        .setDesc('Program that speaks the agent client protocol. Use a full path if it is not found.')
        .addText(text => text
          .setPlaceholder(DEFAULT_SETTINGS.acpAgentCommand)
          .setValue(this.plugin.settings.acpAgentCommand)
          .onChange((value) => {
            this.plugin.settings.acpAgentCommand = value.trim() || DEFAULT_SETTINGS.acpAgentCommand;
            debouncedAgentUpdate();
          })
        );
      
      new Setting(containerEl)
        .setName('Agent arguments')
        .setDesc('Arguments passed to the agent command. The model and provider are configured in the agent itself.')
        .addText(text => text
          .setPlaceholder(DEFAULT_SETTINGS.acpAgentArgs)
          .setValue(this.plugin.settings.acpAgentArgs)
          .onChange((value) => {
            this.plugin.settings.acpAgentArgs = value.trim() || DEFAULT_SETTINGS.acpAgentArgs;
            debouncedAgentUpdate();
          })
        );
      
      // Test connection button
      new Setting(containerEl)
        .setName('Test agent')
        .setDesc('Start the agent and send it a short prompt')
        .addButton(button => button
          .setButtonText('Test agent')
          .onClick(async () => {
            button.setButtonText('Testing...');
            button.setDisabled(true);
            
            // Apply any edit still waiting on the debounce before testing.
            await this.plugin.saveSettings();
            this.plugin.updateAIService();
            
            const result = await this.plugin.aiService.testConnection();
            
            if (result.success) {
              new Notice('Agent test succeeded');
            } else {
              new Notice(`Agent test failed: ${result.message}`);
            }
            
            button.setButtonText('Test agent');
            button.setDisabled(false);
          })
        );
      
      // Feature toggles
      new Setting(containerEl)
        .setName('AI features')
        .setHeading();
      
      new Setting(containerEl)
        .setName('Generate summary')
        .setDesc('Create a summary of the meeting, scaled to its length')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableSummary)
          .onChange(async (value) => {
            this.plugin.settings.enableSummary = value;
            await this.plugin.saveSettings();
            this.plugin.updateAIService();
          })
        );
      
      new Setting(containerEl)
        .setName('Extract action items')
        .setDesc('Find tasks and commitments mentioned in the meeting')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableActionItems)
          .onChange(async (value) => {
            this.plugin.settings.enableActionItems = value;
            await this.plugin.saveSettings();
            this.plugin.updateAIService();
          })
        );
      
      new Setting(containerEl)
        .setName('Extract decisions')
        .setDesc('Identify explicit decisions made during the meeting')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableDecisions)
          .onChange(async (value) => {
            this.plugin.settings.enableDecisions = value;
            await this.plugin.saveSettings();
            this.plugin.updateAIService();
          })
        );
      
      new Setting(containerEl)
        .setName('Suggest tags')
        .setDesc('Recommend relevant tags based on meeting content')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableTagSuggestions)
          .onChange(async (value) => {
            this.plugin.settings.enableTagSuggestions = value;
            await this.plugin.saveSettings();
            this.plugin.updateAIService();
          })
        );
    }
  }
  
  /**
   * Create Linking section
   */
  private createLinkingSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Auto-linking')
      .setHeading();
    
    // Enable auto-linking
    new Setting(containerEl)
      .setName('Enable auto-linking')
      .setDesc('Automatically create [[wiki-links]] to existing notes mentioned in transcripts')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoLinkingEnabled)
        .onChange(async (value) => {
          this.plugin.settings.autoLinkingEnabled = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    
    if (this.plugin.settings.autoLinkingEnabled) {
      // Implicit aliases
      new Setting(containerEl)
        .setName('Generate implicit aliases')
        .setDesc('Create aliases from individual words in multi-word note titles (e.g., "engineering" from "engineering lead")')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.generateImplicitAliases)
          .onChange(async (value) => {
            this.plugin.settings.generateImplicitAliases = value;
            await this.plugin.saveSettings();
            void this.plugin.rebuildVaultIndex();
          })
        );
      
      // Max matches threshold
      new Setting(containerEl)
        .setName('Maximum matches')
        .setDesc('Skip auto-linking if a term matches more than this many notes')
        .addText(text => text
          .setPlaceholder('3')
          .setValue(this.plugin.settings.maxMatchesBeforeSkip.toString())
          .onChange(async (value) => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.maxMatchesBeforeSkip = num;
              await this.plugin.saveSettings();
              this.plugin.updateAutoLinker();
            }
          })
        );
      
      // Excluded folders
      new Setting(containerEl)
        .setName('Exclude folders')
        .setDesc('Folders to exclude from the link index (comma-separated)')
        .addText(text => text
          .setPlaceholder('Templates, archive')
          .setValue(this.plugin.settings.excludedFolders)
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value;
            await this.plugin.saveSettings();
            void this.plugin.rebuildVaultIndex();
          })
        );
      
      // Rebuild index button
      new Setting(containerEl)
        .setName('Rebuild vault index')
        .setDesc('Force re-index all notes for auto-linking')
        .addButton(button => button
          .setButtonText('Rebuild index')
          .onClick(() => {
            button.setButtonText('Rebuilding...');
            button.setDisabled(true);
            
            this.plugin.rebuildVaultIndex();
            
            new Notice('Vault index rebuilt successfully');
            button.setButtonText('Rebuild index');
            button.setDisabled(false);
          })
        );
    }
  }
  
  /**
   * Create Participants section
   */
  private createParticipantsSection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Participants')
      .setHeading();
    
    // Auto-create participant notes
    new Setting(containerEl)
      .setName('Auto-create participant notes')
      .setDesc('Automatically create notes for meeting participants who do not have one')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoCreateParticipants)
        .onChange(async (value) => {
          this.plugin.settings.autoCreateParticipants = value;
          await this.plugin.saveSettings();
          this.display();
        })
      );
    
    if (this.plugin.settings.autoCreateParticipants) {
      // People folder - debounced
      const debouncedPeopleFolderUpdate = debounce(async (value: string) => {
        this.plugin.settings.peopleFolder = value;
        await this.plugin.saveSettings();
        this.plugin.updateParticipantService();
      }, 1000);
      
      new Setting(containerEl)
        .setName('People folder')
        .setDesc('Folder where participant notes are created (leave empty for vault root)')
        .addText(text => text
          .setPlaceholder('People')
          .setValue(this.plugin.settings.peopleFolder)
          .onChange(debouncedPeopleFolderUpdate)
        );
      
      // Update existing participant notes
      new Setting(containerEl)
        .setName('Update existing participant notes')
        .setDesc('Add meeting references to existing participant notes')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.updateExistingParticipants)
          .onChange(async (value) => {
            this.plugin.settings.updateExistingParticipants = value;
            await this.plugin.saveSettings();
          })
        );
    }
  }
  
  /**
   * Create Entity Extraction section
   */
  private createEntitySection(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Entity extraction')
      .setHeading();
    
    // Master toggle
    new Setting(containerEl)
      .setName('Auto-extract entities')
      .setDesc('Automatically create notes for issues, updates, and topics mentioned in meetings')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoExtractEntities)
        .onChange(async (value) => {
          this.plugin.settings.autoExtractEntities = value;
          await this.plugin.saveSettings();
          this.plugin.updateEntityService();
          this.display();
        })
      );
    
    if (this.plugin.settings.autoExtractEntities) {
      // Entity type toggles
      new Setting(containerEl)
        .setName('Extract issues')
        .setDesc('Create notes for blockers, problems, and bugs mentioned')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableIssueExtraction)
          .onChange(async (value) => {
            this.plugin.settings.enableIssueExtraction = value;
            await this.plugin.saveSettings();
            this.plugin.updateEntityService();
          })
        );
      
      new Setting(containerEl)
        .setName('Extract topics')
        .setDesc('Create notes for important concepts, systems, and recurring themes')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enableTopicExtraction)
          .onChange(async (value) => {
            this.plugin.settings.enableTopicExtraction = value;
            await this.plugin.saveSettings();
            this.plugin.updateEntityService();
          })
        );
      
      new Setting(containerEl)
        .setName('Enrich manually-created notes')
        .setDesc('Allow this plugin to find and enrich notes you created manually (adds frontmatter, AI synthesis). If disabled, only enriches notes created by the plugin.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.enrichManualNotes)
          .onChange(async (value) => {
            this.plugin.settings.enrichManualNotes = value;
            await this.plugin.saveSettings();
            this.plugin.updateEntityService();
          })
        );
      
      // Folder paths - debounced
      const debouncedFolderUpdate = debounce(async () => {
        await this.plugin.saveSettings();
        this.plugin.updateEntityService();
      }, 1000);
      
      new Setting(containerEl)
        .setName('Issues folder')
        .setDesc('Folder where issue notes are created')
        .addText(text => text
          .setPlaceholder('Issues')
          .setValue(this.plugin.settings.entityIssuesFolder)
          .onChange((value) => {
            this.plugin.settings.entityIssuesFolder = value || 'Issues';
            debouncedFolderUpdate();
          })
        );
      
      // Note: Updates are no longer created as separate notes - they appear in People notes
      
      new Setting(containerEl)
        .setName('Topics folder')
        .setDesc('Folder where topic notes are created')
        .addText(text => text
          .setPlaceholder('Topics')
          .setValue(this.plugin.settings.entityTopicsFolder)
          .onChange((value) => {
            this.plugin.settings.entityTopicsFolder = value || 'Topics';
            debouncedFolderUpdate();
          })
        );
      
      // Info box
      const infoBox = containerEl.createDiv({ cls: 'meeting-goose-info-box' });
      infoBox.createEl('p', {
        text: 'Entity notes are automatically created when mentioned in meetings and linked back to the meeting notes.'
      });
    }
  }
}
