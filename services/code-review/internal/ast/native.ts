import { spawn } from 'node:child_process';
import { MAX_MESSAGE_BYTES, ProtocolError } from './protocol.js';
import { rawResultSchema, type RawResult } from './raw.js';
import type { Command } from './process.js';

export function runNative(command: Command, input: unknown): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, { cwd: command.cwd, stdio: 'pipe' });
    const output: Buffer[] = [];
    let bytes = 0;
    let stderr = '';
    const fail = (error: Error) => { child.kill('SIGKILL'); reject(error); };
    const timer = setTimeout(() => fail(new ProtocolError('TIMEOUT', 'Native parser exceeded 30 seconds')), 30000);
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_MESSAGE_BYTES) fail(new ProtocolError('MESSAGE_TOO_LARGE', 'Native parser output exceeds limit'));
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4096); });
    child.on('error', (error) => { clearTimeout(timer); reject(new ProtocolError('BACKEND_UNAVAILABLE', error.message)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new ProtocolError('PARSER_EXIT', `Parser exited (${code}): ${stderr}`));
      try { resolve(rawResultSchema.parse(JSON.parse(Buffer.concat(output).toString('utf8')))); }
      catch (error) { reject(new ProtocolError('INVALID_PARSER_RESULT', String(error))); }
    });
    child.stdin.on('error', fail);
    child.stdin.end(JSON.stringify(input));
  });
}
