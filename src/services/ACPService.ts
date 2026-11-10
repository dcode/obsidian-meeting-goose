/**
 * ACPService - runs prompts through a local Agent Client Protocol (ACP) agent
 * such as the Goose CLI (`goose acp`).
 *
 * The agent is spawned lazily as a child process and spoken to over
 * newline-delimited JSON-RPC on stdin/stdout. One process is kept alive and
 * reused; every prompt gets its own ACP session so prompts never share context.
 */

import { spawn, ChildProcess } from 'child_process';
import { tmpdir } from 'os';
import type { Readable, Writable } from 'stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  ClientConnection,
  InitializeResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '@agentclientprotocol/sdk';
import { shellEnv } from 'shell-env';

export const DEFAULT_AGENT_COMMAND = 'goose';
export const DEFAULT_AGENT_ARGS: readonly string[] = ['acp'];
export const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

const CLIENT_NAME = 'obsidian-meeting-goose';
const STDERR_TAIL_CHARS = 2000;

/** Anything that can turn a prompt into the agent's text reply. */
export interface PromptRunner {
  sendPrompt(promptText: string): Promise<string>;
}

export interface ACPServiceOptions {
  /** Version reported to the agent in `clientInfo`. */
  clientVersion?: string;
  /** How long a single prompt may run before it is cancelled. */
  promptTimeoutMs?: number;
  /** Working directory handed to the agent for each session. */
  sessionCwd?: string;
}

interface ActiveAgent {
  child: ChildProcess;
  connection: ClientConnection;
  info: InitializeResponse;
}

/**
 * Split an argument string the way a user would type it in a settings field:
 * whitespace separated, with single or double quotes grouping words.
 */
export function parseAgentArgs(input: string): string[] {
  const args: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input)) !== null) {
    args.push(match[1] ?? match[2] ?? match[3]);
  }
  return args;
}

/**
 * Meeting analysis never needs tools, so every tool permission request is
 * declined: pick the agent's own "reject" option when it offers one.
 */
export function rejectPermission(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject =
    request.options.find(option => option.kind === 'reject_once') ??
    request.options.find(option => option.kind === 'reject_always');
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}

function toWebWritable(stdin: Writable): WritableStream<Uint8Array> {
  return new WritableStream<Uint8Array>({
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        stdin.write(chunk, error => (error ? reject(error) : resolve()));
      });
    },
    close() {
      stdin.end();
    },
    abort() {
      stdin.destroy();
    },
  });
}

function toWebReadable(stdout: Readable): ReadableStream<Uint8Array> {
  // Set once the stream is closed, errored, or cancelled by the reader; after
  // that the controller must not be touched again.
  let done = false;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const finish = (error?: Error): void => {
        if (done) return;
        done = true;
        if (error) {
          controller.error(error);
        } else {
          controller.close();
        }
      };
      stdout.on('data', (chunk: Buffer) => {
        if (!done) controller.enqueue(new Uint8Array(chunk));
      });
      stdout.on('end', () => finish());
      stdout.on('close', () => finish());
      stdout.on('error', error => finish(error));
    },
    cancel() {
      done = true;
      stdout.destroy();
    },
  });
}

export class ACPService implements PromptRunner {
  private agentCommand: string;
  private agentArgs: string[];
  private readonly clientVersion: string;
  private readonly promptTimeoutMs: number;
  private readonly sessionCwd: string;

  private agent: Promise<ActiveAgent> | null = null;
  private stderrTail = '';

  constructor(
    agentCommand: string = DEFAULT_AGENT_COMMAND,
    agentArgs: readonly string[] = DEFAULT_AGENT_ARGS,
    options: ACPServiceOptions = {}
  ) {
    this.agentCommand = agentCommand.trim() || DEFAULT_AGENT_COMMAND;
    this.agentArgs = agentArgs.length > 0 ? [...agentArgs] : [...DEFAULT_AGENT_ARGS];
    this.clientVersion = options.clientVersion ?? '0.0.0';
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS;
    // A scratch directory rather than the vault: the agent only needs to read
    // the prompt, and should not be pointed at the user's notes.
    this.sessionCwd = options.sessionCwd ?? tmpdir();
  }

  /**
   * Change the agent command. A running agent is stopped so the next prompt
   * starts the new one.
   */
  configure(agentCommand: string, agentArgs: readonly string[]): void {
    const command = agentCommand.trim() || DEFAULT_AGENT_COMMAND;
    const args = agentArgs.length > 0 ? [...agentArgs] : [...DEFAULT_AGENT_ARGS];
    const changed =
      command !== this.agentCommand ||
      args.length !== this.agentArgs.length ||
      args.some((arg, index) => arg !== this.agentArgs[index]);

    this.agentCommand = command;
    this.agentArgs = args;
    if (changed) {
      this.disconnect();
    }
  }

  /** The command line that will be (or was) spawned, for display. */
  describeCommand(): string {
    return [this.agentCommand, ...this.agentArgs].join(' ');
  }

  /**
   * Start the agent if needed and return what it reported about itself.
   */
  async connect(): Promise<InitializeResponse> {
    return (await this.ensureAgent()).info;
  }

  /**
   * Send one prompt in a fresh session and return the agent's text reply.
   */
  async sendPrompt(promptText: string): Promise<string> {
    const { connection } = await this.ensureAgent();
    const session = await connection.agent.buildSession(this.sessionCwd).start();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void connection.agent
          .notify(methods.agent.session.cancel, { sessionId: session.sessionId })
          .catch(() => undefined);
        reject(new Error(
          `Agent did not finish within ${Math.round(this.promptTimeoutMs / 1000)}s (${this.describeCommand()})`
        ));
      }, this.promptTimeoutMs);
    });

    try {
      const turn = Promise.all([session.prompt(promptText), session.readText()]);
      // If the timeout wins, the turn's eventual rejection must not go unhandled.
      turn.catch(() => undefined);
      const [response, text] = await Promise.race([turn, timeout]);

      if (response.stopReason !== 'end_turn') {
        throw new Error(`Agent stopped without finishing its reply (${response.stopReason})`);
      }
      return text;
    } catch (error) {
      throw this.withStderr(error);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      session.dispose();
    }
  }

  /** Stop the agent process, if one is running. */
  disconnect(): void {
    const pending = this.agent;
    this.agent = null;
    if (!pending) return;

    pending
      .then(({ child, connection }) => {
        connection.close();
        child.kill();
      })
      .catch(() => undefined);
  }

  private ensureAgent(): Promise<ActiveAgent> {
    if (!this.agent) {
      const starting = this.startAgent();
      this.agent = starting;
      // A failed start must not be cached, or every later prompt would fail too.
      starting.catch(() => {
        if (this.agent === starting) this.agent = null;
      });
    }
    return this.agent;
  }

  private async startAgent(): Promise<ActiveAgent> {
    this.stderrTail = '';
    const env = await this.resolveEnv();

    const child = spawn(this.agentCommand, this.agentArgs, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const { stdin, stdout, stderr } = child;
    if (!stdin || !stdout) {
      child.kill();
      throw new Error(`Could not open pipes to the agent (${this.describeCommand()})`);
    }

    stderr?.on('data', (data: Buffer) => {
      this.stderrTail = (this.stderrTail + data.toString()).slice(-STDERR_TAIL_CHARS);
    });
    // Writing to an agent that already exited would otherwise raise an unhandled EPIPE.
    stdin.on('error', () => undefined);

    const connection = client({ name: CLIENT_NAME })
      .onRequest(methods.client.session.requestPermission, ({ params }) => rejectPermission(params))
      .connect(ndJsonStream(toWebWritable(stdin), toWebReadable(stdout)));

    let starting: Promise<ActiveAgent> | null = null;
    const forget = (): void => {
      if (starting && this.agent === starting) this.agent = null;
    };

    // Reject before closing the connection, so the readable message below wins
    // the race against the raw error the closing connection reports.
    const failed = new Promise<never>((_, reject) => {
      child.once('error', (error: NodeJS.ErrnoException) => {
        forget();
        reject(new Error(
          error.code === 'ENOENT'
            ? `Could not find "${this.agentCommand}". Install it or set the full path in settings.`
            : `Could not start "${this.describeCommand()}": ${error.message}`
        ));
        connection.close(error);
      });
      child.once('exit', (code, signal) => {
        forget();
        const reason = new Error(
          `Agent exited (${signal ?? `code ${code ?? 'unknown'}`}): ${this.describeCommand()}`
        );
        reject(reason);
        connection.close(reason);
      });
    });
    failed.catch(() => undefined);

    const initialized = connection.agent.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: CLIENT_NAME, title: 'Obsidian Meeting Goose', version: this.clientVersion },
    });
    initialized.catch(() => undefined);

    starting = this.agent;

    try {
      const info = await Promise.race([initialized, failed]);
      if (info.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `Agent speaks ACP protocol version ${String(info.protocolVersion)}, expected ${PROTOCOL_VERSION}`
        );
      }
      return { child, connection, info };
    } catch (error) {
      connection.close();
      child.kill();
      throw this.withStderr(error);
    }
  }

  /**
   * Obsidian launched from a desktop icon does not inherit the login shell's
   * PATH, so binaries installed with Homebrew, cargo, or npm are not found
   * unless the shell environment is loaded first.
   *
   * GOOSE_MODE=chat tells Goose not to use tools at all. Transcripts are
   * untrusted text, so the agent should only ever read them and answer.
   */
  private async resolveEnv(): Promise<NodeJS.ProcessEnv> {
    let shell: NodeJS.ProcessEnv = {};
    try {
      shell = await shellEnv();
    } catch (error) {
      console.warn('Meeting Goose: could not load shell environment, using process environment', error);
    }
    return { ...process.env, ...shell, GOOSE_MODE: 'chat' };
  }

  private withStderr(error: unknown): Error {
    const base = error instanceof Error ? error : new Error(String(error));
    const tail = this.stderrTail.trim();
    if (!tail || base.message.includes(tail)) {
      return base;
    }
    const lastLine = tail.split('\n').pop() ?? tail;
    return new Error(`${base.message} — ${lastLine.trim()}`);
  }
}
