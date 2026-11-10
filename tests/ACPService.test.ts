/**
 * Tests for ACPService
 *
 * These run the real ACP SDK against a small fake agent process
 * (tests/fixtures/fake-acp-agent.mjs) standing in for `goose acp`.
 */

import path from 'path';
import { shellEnv } from 'shell-env';
import {
  ACPService,
  DEFAULT_AGENT_ARGS,
  DEFAULT_AGENT_COMMAND,
  parseAgentArgs,
  rejectPermission,
} from '../src/services/ACPService';

const FAKE_AGENT = path.join(__dirname, 'fixtures', 'fake-acp-agent.mjs');
const shellEnvMock = shellEnv as jest.MockedFunction<typeof shellEnv>;

describe('parseAgentArgs', () => {
  it('splits on whitespace', () => {
    expect(parseAgentArgs('acp')).toEqual(['acp']);
    expect(parseAgentArgs('  --debug   acp ')).toEqual(['--debug', 'acp']);
  });

  it('keeps quoted arguments together', () => {
    expect(parseAgentArgs(`acp --profile "my profile" --name 'a b'`)).toEqual([
      'acp', '--profile', 'my profile', '--name', 'a b',
    ]);
  });

  it('returns no arguments for blank input', () => {
    expect(parseAgentArgs('')).toEqual([]);
    expect(parseAgentArgs('   ')).toEqual([]);
  });
});

describe('rejectPermission', () => {
  const toolCall = { toolCallId: 'call-1' };

  it('selects the reject-once option when offered', () => {
    expect(rejectPermission({
      sessionId: 's',
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'never', name: 'Never', kind: 'reject_always' },
        { optionId: 'no', name: 'No', kind: 'reject_once' },
      ],
    })).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('falls back to reject-always', () => {
    expect(rejectPermission({
      sessionId: 's',
      toolCall,
      options: [
        { optionId: 'allow', name: 'Allow', kind: 'allow_always' },
        { optionId: 'never', name: 'Never', kind: 'reject_always' },
      ],
    })).toEqual({ outcome: { outcome: 'selected', optionId: 'never' } });
  });

  it('cancels rather than allowing when no reject option exists', () => {
    expect(rejectPermission({
      sessionId: 's',
      toolCall,
      options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
    })).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('ACPService', () => {
  const services: ACPService[] = [];

  const fakeAgent = (mode: string, promptTimeoutMs?: number, ...extraArgs: string[]): ACPService => {
    const service = new ACPService(process.execPath, [FAKE_AGENT, mode, ...extraArgs], {
      clientVersion: '9.9.9',
      promptTimeoutMs,
    });
    services.push(service);
    return service;
  };

  beforeEach(() => {
    shellEnvMock.mockReset();
    shellEnvMock.mockResolvedValue({});
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.disconnect();
    }
    jest.restoreAllMocks();
  });

  describe('configuration', () => {
    it('defaults to goose acp', () => {
      expect(DEFAULT_AGENT_COMMAND).toBe('goose');
      expect(DEFAULT_AGENT_ARGS).toEqual(['acp']);
      expect(new ACPService().describeCommand()).toBe('goose acp');
    });

    it('uses the configured command and arguments', () => {
      const service = new ACPService();
      service.configure('/opt/bin/goose', ['--debug', 'acp']);
      expect(service.describeCommand()).toBe('/opt/bin/goose --debug acp');
    });

    it('falls back to the defaults for blank values', () => {
      const service = new ACPService('  ', []);
      expect(service.describeCommand()).toBe('goose acp');
      service.configure('', []);
      expect(service.describeCommand()).toBe('goose acp');
    });
  });

  describe('talking to an agent', () => {
    it('initializes and reports the agent info', async () => {
      const info = await fakeAgent('echo').connect();
      expect(info.protocolVersion).toBe(1);
      expect(info.agentInfo?.name).toBe('fake-acp-agent');
    });

    it('returns the concatenated text chunks of the reply', async () => {
      const reply = await fakeAgent('echo').sendPrompt('summarize this meeting');
      expect(reply).toBe('echo(session-1): summarize this meeting');
    });

    it('reuses one process and gives each prompt its own session', async () => {
      const service = fakeAgent('echo');
      expect(await service.sendPrompt('one')).toBe('echo(session-1): one');
      expect(await service.sendPrompt('two')).toBe('echo(session-2): two');
    });

    it('handles prompts sent concurrently', async () => {
      const service = fakeAgent('echo');
      const replies = await Promise.all([service.sendPrompt('a'), service.sendPrompt('b')]);
      expect(replies.map(reply => reply.replace(/session-\d/, 'session-N')).sort()).toEqual([
        'echo(session-N): a',
        'echo(session-N): b',
      ]);
    });

    it('declines tool permission requests', async () => {
      const reply = await fakeAgent('permission').sendPrompt('do something');
      expect(JSON.parse(reply)).toEqual({ outcome: 'selected', optionId: 'no' });
    });

    it('passes the login shell environment to the agent', async () => {
      shellEnvMock.mockResolvedValue({ FAKE_AGENT_MARKER: 'from-shell' });
      const service = fakeAgent('env', undefined, 'FAKE_AGENT_MARKER');
      expect(await service.sendPrompt('x')).toBe('from-shell');
    });

    it('runs Goose in chat mode so it cannot use tools, whatever the shell says', async () => {
      shellEnvMock.mockResolvedValue({ GOOSE_MODE: 'auto' });
      const service = fakeAgent('env', undefined, 'GOOSE_MODE');
      expect(await service.sendPrompt('x')).toBe('chat');
    });

    it('still starts the agent when the shell environment cannot be loaded', async () => {
      shellEnvMock.mockRejectedValue(new Error('no shell'));
      expect(await fakeAgent('echo').sendPrompt('hi')).toBe('echo(session-1): hi');
      expect(console.warn).toHaveBeenCalled();
    });

    it('restarts the agent after disconnect', async () => {
      const service = fakeAgent('echo');
      await service.sendPrompt('one');
      service.disconnect();
      // A new process starts counting sessions from 1 again.
      expect(await service.sendPrompt('two')).toBe('echo(session-1): two');
    });

    it('restarts the agent when the command changes', async () => {
      const service = fakeAgent('echo');
      await service.sendPrompt('one');
      service.configure(process.execPath, [FAKE_AGENT, 'env', 'NOT_SET_ANYWHERE']);
      expect(await service.sendPrompt('two')).toBe('(unset)');
    });

    it('keeps the running agent when configured with the same command', async () => {
      const service = fakeAgent('echo');
      await service.sendPrompt('one');
      service.configure(process.execPath, [FAKE_AGENT, 'echo']);
      expect(await service.sendPrompt('two')).toBe('echo(session-2): two');
    });
  });

  describe('failures', () => {
    it('explains when the agent command is not installed', async () => {
      const service = new ACPService('definitely-not-a-real-goose-binary', ['acp']);
      services.push(service);
      await expect(service.sendPrompt('hi')).rejects.toThrow(
        'Could not find "definitely-not-a-real-goose-binary"'
      );
    });

    it('rejects an agent that speaks another protocol version', async () => {
      await expect(fakeAgent('bad-version').connect()).rejects.toThrow(
        'Agent speaks ACP protocol version 99, expected 1'
      );
    });

    it('reports the agent stderr when it dies mid-prompt', async () => {
      await expect(fakeAgent('crash').sendPrompt('hi')).rejects.toThrow(
        /provider is not configured/
      );
    });

    it('recovers with a fresh process after a crash', async () => {
      const service = fakeAgent('crash');
      await expect(service.sendPrompt('hi')).rejects.toThrow();
      service.configure(process.execPath, [FAKE_AGENT, 'echo']);
      expect(await service.sendPrompt('again')).toBe('echo(session-1): again');
    });

    it('times out a prompt that never finishes', async () => {
      await expect(fakeAgent('hang', 200).sendPrompt('hi')).rejects.toThrow(
        /Agent did not finish within/
      );
    });

    it('rejects a reply that did not end normally', async () => {
      await expect(fakeAgent('refuse').sendPrompt('hi')).rejects.toThrow(
        'Agent stopped without finishing its reply (refusal)'
      );
    });

    it('reports what the agent sent when it finishes without any text', async () => {
      await expect(fakeAgent('silent').sendPrompt('hi')).rejects.toThrow(
        'Agent finished without sending any text (received: agent_thought_chunk x2)'
      );
    });

    it('does not cache a failed start', async () => {
      const service = new ACPService('definitely-not-a-real-goose-binary', ['acp']);
      services.push(service);
      await expect(service.connect()).rejects.toThrow();
      service.configure(process.execPath, [FAKE_AGENT, 'echo']);
      expect(await service.sendPrompt('ok')).toBe('echo(session-1): ok');
    });
  });
});
