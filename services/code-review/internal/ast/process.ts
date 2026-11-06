import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { encodeLine, readLines } from './json-lines.js';
import { ProtocolError, responseSchema, type Request, type Response } from './protocol.js';
import { analysisSchema, capabilitiesSchema } from './schema.js';
import { validateHierarchy } from './normalize.js';

export interface Command { command: string; args: string[]; cwd?: string }
type Pending = { request: Request; resolve: (value: Response) => void; reject: (error: Error) => void };

export class BackendProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private pending: Pending | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private stderr = '';
  private closed = false;
  constructor(private readonly command: Command) {}

  request(request: Request, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const work = this.tail.then(() => this.exchange(request, timeoutMs, signal));
    this.tail = work.catch(() => undefined);
    return work;
  }

  close(): void {
    this.closed = true;
    this.stop(new ProtocolError('CANCELLED', 'Backend closed'));
  }

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    this.stderr = '';
    const child = spawn(this.command.command, this.command.args,
      { cwd: this.command.cwd, detached: process.platform !== 'win32', stdio: 'pipe' });
    this.child = child;
    child.stderr.on('data', (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8192); });
    readLines(child.stdout, (line) => { if (this.child === child) this.receive(line); },
      (error) => { if (this.child === child) this.stop(error); });
    child.on('error', (error) => {
      if (this.child === child) this.stop(new ProtocolError('BACKEND_UNAVAILABLE', error.message));
    });
    child.on('exit', (code, signal) => {
      if (this.child === child) this.stop(new ProtocolError('BACKEND_EXIT',
        `Backend exited (${code ?? signal}): ${this.stderr}`));
    });
    child.stdin.on('error', (error) => { if (this.child === child) this.stop(error); });
    return child;
  }

  private exchange(request: Request, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    if (this.closed || signal?.aborted) return Promise.reject(new ProtocolError('CANCELLED', 'Request cancelled'));
    return new Promise((resolve, reject) => {
      const line = encodeLine(request);
      const child = this.start();
      const abort = () => this.stop(new ProtocolError('CANCELLED', 'Request cancelled'));
      const timer = setTimeout(() => this.stop(new ProtocolError('TIMEOUT', `Backend exceeded ${timeoutMs}ms`)), timeoutMs);
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      this.pending = { request,
        resolve: (value) => { cleanup(); resolve(value); },
        reject: (error) => { cleanup(); reject(error); } };
      signal?.addEventListener('abort', abort, { once: true });
      child.stdin.write(line);
    });
  }

  private receive(line: string): void {
    try {
      const response = responseSchema.parse(JSON.parse(line));
      if (!this.pending || response.requestId !== this.pending.request.requestId)
        throw new ProtocolError('RESPONSE_MISMATCH', 'Unexpected response requestId');
      if (response.ok) {
        const request = this.pending.request;
        const result = request.method === 'analyze' ? analysisSchema.parse(response.result) : capabilitiesSchema.parse(response.result);
        if (result.backend !== request.backend) throw new ProtocolError('WRONG_BACKEND', result.backend);
        if ('files' in result) for (const file of result.files) validateHierarchy(file.facts);
      }
      const pending = this.pending;
      this.pending = undefined;
      pending.resolve(response);
    } catch (error) {
      this.stop(error instanceof ProtocolError ? error : new ProtocolError('INVALID_RESPONSE', String(error)));
    }
  }

  private stop(error: Error): void {
    const child = this.child;
    this.child = undefined;
    this.pending?.reject(error);
    this.pending = undefined;
    if (!child?.pid) return;
    try {
      if (process.platform === 'win32') child.kill('SIGKILL');
      else process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') child.kill('SIGKILL');
    }
  }
}
