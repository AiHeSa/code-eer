import { encodeLine, readLines } from './json-lines.js';
import { analyze, type Parser } from './worker-analysis.js';
import { failure, ProtocolError, parseRequest, responseSchema } from './protocol.js';
import { VERSION } from './schema.js';

export function serveParser(parser: Parser): void {
  let queue: Promise<void> = Promise.resolve();
  const handle = async (line: string) => {
    let id: string | null = null;
    try {
      const input: unknown = JSON.parse(line);
      if (typeof input === 'object' && input && 'requestId' in input && typeof input.requestId === 'string') id = input.requestId;
      const request = parseRequest(input);
      if (request.backend !== parser.language) throw new ProtocolError('WRONG_BACKEND', request.backend);
      const result = request.method === 'capabilities' ? await parser.capabilities() : await analyze(parser, request.params);
      process.stdout.write(encodeLine(responseSchema.parse({ protocolVersion: VERSION, requestId: id, ok: true, result })));
    } catch (error) { process.stdout.write(encodeLine(failure(id, error))); }
  };
  readLines(process.stdin, (line) => { queue = queue.then(() => handle(line)); },
    (error) => { process.stderr.write(String(error)); process.exitCode = 1; process.stdin.destroy(); });
}
