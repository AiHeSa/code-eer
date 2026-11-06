import { AstService } from '../code-review/internal/ast/service.js';
import { encodeLine, readLines } from '../code-review/internal/ast/json-lines.js';
import { cancelSchema, failure, ProtocolError, parseRequest } from '../code-review/internal/ast/protocol.js';
import { VERSION } from '../code-review/internal/ast/schema.js';

export function serveStdio(): void {
  const service = new AstService();
  const active = new Map<string, AbortController>();
  let ended = false;
  const write = (value: unknown) => process.stdout.write(encodeLine(value));
  const handle = async (line: string) => {
    let id: string | null = null;
    try {
      const input: unknown = JSON.parse(line);
      const cancel = cancelSchema.safeParse(input);
      if (cancel.success) {
        active.get(cancel.data.targetRequestId)?.abort();
        write({ protocolVersion: VERSION, requestId: cancel.data.requestId, ok: true,
          result: { cancelled: active.has(cancel.data.targetRequestId) } }); return;
      }
      const request = parseRequest(input);
      id = request.requestId;
      if (active.has(id)) throw new ProtocolError('DUPLICATE_REQUEST', id);
      if (active.size >= 128) throw new ProtocolError('TOO_MANY_REQUESTS', 'At most 128 active requests are accepted');
      const controller = new AbortController();
      active.set(id, controller);
      try { write(await service.dispatch(request, { signal: controller.signal })); }
      finally { active.delete(id); if (ended && !active.size) service.close(); }
    } catch (error) { write(failure(id, error)); }
  };
  readLines(process.stdin, (line) => { void handle(line); }, (error) => { write(failure(null, error)); service.close(); process.stdin.destroy(); });
  process.stdin.on('end', () => { ended = true; if (!active.size) service.close(); });
  process.once('SIGTERM', () => { service.close(); process.exit(0); });
  process.once('SIGINT', () => { service.close(); process.exit(130); });
}
