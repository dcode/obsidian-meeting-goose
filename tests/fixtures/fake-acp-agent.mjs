#!/usr/bin/env node
/**
 * Minimal ACP agent used by the ACPService tests. It stands in for `goose acp`.
 *
 * Behaviour is chosen by the first argument:
 *   echo         reply "echo: <prompt>" in two chunks (default)
 *   permission   ask for a tool permission first, reply with the outcome
 *   crash        exit while handling the prompt
 *   hang         never finish the prompt
 *   refuse       finish the prompt with stopReason "refusal"
 *   bad-version  claim an unsupported protocol version
 *   env <NAME>   reply with the value of that environment variable
 */
import { Readable, Writable } from 'node:stream';
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

const mode = process.argv[2] ?? 'echo';
let sessions = 0;

const say = (client, sessionId, text) =>
  client.notify(methods.client.session.update, {
    sessionId,
    update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } },
  });

agent({ name: 'fake-acp-agent' })
  .onRequest(methods.agent.initialize, () => ({
    protocolVersion: mode === 'bad-version' ? 99 : PROTOCOL_VERSION,
    agentCapabilities: {},
    agentInfo: { name: 'fake-acp-agent', version: '1.0.0' },
  }))
  .onRequest(methods.agent.session.new, () => ({ sessionId: `session-${++sessions}` }))
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const { sessionId } = params;
    const promptText = params.prompt.map(block => (block.type === 'text' ? block.text : '')).join('');

    switch (mode) {
      case 'crash':
        process.stderr.write('fake agent: provider is not configured\n');
        process.exit(3);
        break;
      case 'hang':
        await new Promise(() => undefined);
        break;
      case 'refuse':
        return { stopReason: 'refusal' };
      case 'env':
        await say(client, sessionId, process.env[process.argv[3] ?? ''] ?? '(unset)');
        break;
      case 'permission': {
        const response = await client.request(methods.client.session.requestPermission, {
          sessionId,
          toolCall: { toolCallId: 'call-1', title: 'Run shell command' },
          options: [
            { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
            { optionId: 'no', name: 'Reject', kind: 'reject_once' },
          ],
        });
        await say(client, sessionId, JSON.stringify(response.outcome));
        break;
      }
      default:
        await say(client, sessionId, `echo(${sessionId}): `);
        await say(client, sessionId, promptText);
    }
    return { stopReason: 'end_turn' };
  })
  .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
