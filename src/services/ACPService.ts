/**
 * ACPService - Spawns and interacts with local Agent Client Protocol (ACP) agents (e.g. Goose CLI)
 */

import { spawn, ChildProcess } from 'child_process';
import { ClientSideConnection, AgentConnection, StreamTransport } from '@agentclientprotocol/sdk';
import shellEnv from 'shell-env';

export class ACPService {
  private agentCommand: string;
  private agentArgs: string[];
  private activeProcess: ChildProcess | null = null;
  private acpConnection: ClientSideConnection | null = null;
  
  constructor(agentCommand: string = 'goose', agentArgs: string[] = ['acp']) {
    this.agentCommand = agentCommand;
    this.agentArgs = agentArgs;
  }
  
  configure(agentCommand: string, agentArgs: string[]): void {
    this.agentCommand = agentCommand || 'goose';
    this.agentArgs = agentArgs.length > 0 ? agentArgs : ['acp'];
  }
  
  async initializeSession(): Promise<ClientSideConnection> {
    if (this.acpConnection) {
      return this.acpConnection;
    }
    
    // Load environment from user shell to locate binaries (like homebrew / cargo / npm bins)
    let env = process.env;
    try {
      const shellEnvironment = await shellEnv();
      env = { ...env, ...shellEnvironment };
    } catch (e) {
      console.warn('MeetingMind: failed to load shell env, using default process.env', e);
    }
    
    // Spawn ACP agent process
    const child = spawn(this.agentCommand, this.agentArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    this.activeProcess = child;
    
    child.stderr?.on('data', (data) => {
      console.error(`ACP Agent stderr: ${data.toString()}`);
    });
    
    child.on('error', (err) => {
      console.error('ACP Agent process error:', err);
    });
    
    // Setup ACP transport bridging stdout / stdin
    const transport: StreamTransport = {
      reader: child.stdout!,
      writer: child.stdin!,
    };
    
    const client = new ClientSideConnection(transport);
    await client.initialize({
      protocolVersion: '1.0',
      clientInfo: { name: 'MeetingMind Obsidian Plugin', version: '1.2.4' }
    });
    
    this.acpConnection = client;
    return client;
  }
  
  async sendPrompt(promptText: string): Promise<string> {
    const client = await this.initializeSession();
    
    const session = await client.createSession({
      workingDirectory: process.cwd()
    });
    
    const response = await session.prompt({
      prompt: promptText
    });
    
    return response.content || '';
  }
  
  disconnect(): void {
    if (this.activeProcess) {
      try {
        this.activeProcess.kill();
      } catch (e) {
        // ignore
      }
      this.activeProcess = null;
    }
    this.acpConnection = null;
  }
}
