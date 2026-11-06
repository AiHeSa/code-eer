import { createInterface } from 'node:readline';

const mode = process.argv[2];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (mode === 'hang') continue;
  if (mode === 'exit') process.exit(3);
  if (mode === 'malformed') { process.stdout.write('invalid-json\n'); continue; }
  if (mode === 'oversized') { process.stdout.write('x'.repeat(17 * 1024 * 1024)); continue; }
  const result = { schemaVersion: '1.0', backend: request.backend, version: 'test', runtime: 'test',
    available: true, capabilities: ['syntax'], factTypes: [], frameworks: [], errors: [],
    coverage: { projection: 'selected-facts', nativeNodes: ['test'], metadata: [], limitations: ['test'] },
    syntax: { grammar: 'test', parserVersion: 'test', targetVersion: null, versionConstraint: 'parser', configurationKeys: [] },
    frameworkCoverage: {} };
  const response = { protocolVersion: '1.0', requestId: mode === 'mismatch' ? 'wrong' : request.requestId,
    ok: true, result: mode === 'invalid' ? {} : result };
  const bytes = Buffer.from(JSON.stringify(response) + '\n');
  if (mode === 'fragment') {
    for (let index = 0; index < bytes.length; index += 7) process.stdout.write(bytes.subarray(index, index + 7));
  } else process.stdout.write(bytes);
}
