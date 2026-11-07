import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface LspCommand { command: string; args: string[]; env?: NodeJS.ProcessEnv }
type Message = { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { message: string; code: number } };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout };
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};

export class LspClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = new Map<number, Pending>();
  private serial = 0;
  private stderr = '';
  readonly diagnostics = new Map<string, unknown[]>();
  quiescent = false;
  constructor(command: LspCommand, private settings: Record<string, unknown>) {
    this.child = spawn(command.command, command.args, { stdio: 'pipe', ...(command.env ? { env: command.env } : {}) });
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => { this.stderr = (this.stderr + chunk).slice(-8192); });
    this.child.on('error', (error) => this.fail(error));
    this.child.on('exit', (code) => this.fail(new Error(`Language server exited ${code}: ${this.stderr}`)));
    this.child.stdin.on('error', (error) => this.fail(error));
  }
  notify(method: string, params: unknown): void { this.send({ method, params }); }
  request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); this.notify('$/cancelRequest', { id }); reject(new Error(`LSP timeout: ${method}`)); }, 25000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  close(): void { this.fail(new Error('Language server closed')); this.child.kill(); }
  private fail(error: Error): void {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); } this.pending.clear();
  }
  private send(message: Message): void {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message }); this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  }
  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const end = this.buffer.indexOf('\r\n\r\n'); if (end < 0) return;
      const length = Number(/Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString())?.[1]);
      if (!Number.isSafeInteger(length) || length < 0 || length > 16 * 1024 * 1024) { this.close(); return; }
      if (this.buffer.length < end + 4 + length) return;
      const body = this.buffer.subarray(end + 4, end + 4 + length); this.buffer = this.buffer.subarray(end + 4 + length);
      try { this.dispatch(JSON.parse(body.toString('utf8')) as Message); } catch (error) { this.fail(error as Error); }
    }
  }
  private dispatch(message: Message): void {
    if (message.method) {
      const params = object(message.params);
      if (message.method === 'textDocument/publishDiagnostics' && typeof params['uri'] === 'string') this.diagnostics.set(params['uri'], params['diagnostics'] as unknown[] ?? []);
      if (message.method === 'experimental/serverStatus') this.quiescent = params['quiescent'] === true;
      if (message.id !== undefined) {
        const items = params['items'] as unknown[] | undefined;
        const result = message.method === 'workspace/configuration' ? (items ?? []).map((item) => {
          const section = object(item)['section']; return typeof section === 'string' ? section.split('.').reduce<unknown>((value, key) => object(value)[key], this.settings) ?? null : this.settings;
        }) : null;
        this.send({ id: message.id, result });
      }
      return;
    }
    const item = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
    if (!item) return;
    this.pending.delete(message.id as number); clearTimeout(item.timer);
    if (message.error) item.reject(Object.assign(new Error(message.error.message), { code: message.error.code })); else item.resolve(message.result);
  }
}
