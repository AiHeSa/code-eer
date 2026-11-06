import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const directory = '.cache/verification';
mkdirSync(directory, { recursive: true });
const report = { startedAt: new Date().toISOString(), node: process.version, status: 'running', steps: [] };
const save = () => writeFileSync(`${directory}/ast-verification.json`, JSON.stringify(report, null, 2) + '\n');
save();

for (const script of ['typecheck', 'build', 'test', 'verify:ast:corpus', 'check:limits', 'audit:ast']) {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const output = (result.stdout ?? '') + (result.stderr ?? '') + (result.error?.message ?? '');
  process.stdout.write(output);
  const log = `${directory}/${script.replaceAll(':', '-')}.log`;
  writeFileSync(log, output);
  const counts = Object.fromEntries([...output.matchAll(/(?:ℹ|#) (tests|pass|fail|skipped|cancelled|todo) (\d+)/g)]
    .map((match) => [match[1], Number(match[2])]));
  report.steps.push({ script, exitCode: result.status, log, ...(script === 'test' ? { counts } : {}) });
  if (result.status !== 0) {
    report.status = script === 'audit:ast' && result.status === 1 ? 'incomplete' : 'failed';
    report.completedAt = new Date().toISOString();
    save(); process.exit(result.status ?? 1);
  }
  save();
}
report.status = 'passed';
report.completedAt = new Date().toISOString();
save();
