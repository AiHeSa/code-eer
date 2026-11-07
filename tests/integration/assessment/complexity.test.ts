import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withAssessment } from './helpers.js';

test('complexity: sequence/nesting, closures, loop calls and allocations preserve ownership', async () => {
    const source = `export function run(n: number, m: number) {
for (let i = 0; i < n; i++) {
  for (let j = 0; j < m; j++) { work(i, j); const value = []; }
  const nested = () => { for (const x of items) { next(x); } };
}
for (let k = 0; k < 4; k++) { other(); }
return new Map(); }`;
    await withAssessment(source, ({ evidence, complexity }) => {
        const fn = evidence.functions.find((item) => item.name === 'run')!;
        const metrics = complexity.functions.find((item) => item.functionId === fn.id)!;
        assert.equal(metrics.loops.length, 3);
        assert.equal(metrics.maxLoopDepth, 2);
        assert.equal(metrics.loopForest.filter((item) => item.parentLoopId === null).length, 2);
        const nested = evidence.functions.find((item) => item.name === 'nested')!;
        const own = evidence.loops.find((item) => item.functionId === nested.id)!;
        assert.equal(own.depth, 1);
        assert.equal(own.parentLoopId, null);
        assert.equal(metrics.callsInLoops.length, 2);
        assert.equal(metrics.allocationsInLoops.length, 2); // array and closure creation
        assert.equal(metrics.time.expression, null);
        assert.equal(metrics.space.expression, null);
        assert.equal(evidence.loops.find((item) => item.condition === 'i < n')?.update, 'i++');
    });
});

test('complexity: local mutual recursion is detected without claiming unbounded execution or a leak', async () => {
    const source = `export function a(n: number): number { if (!n) return 0; return b(n - 1); }
function b(n: number): number { return a(n); }
function daemon() { while (true) { if (stop) break; awaitable(); } const cache = new Map(); }`;
    await withAssessment(source, ({ evidence, complexity }) => {
        const a = evidence.functions.find((item) => item.name === 'a')!;
        const daemon = evidence.functions.find((item) => item.name === 'daemon')!;
        assert.equal(complexity.functions.find((item) => item.functionId === a.id)?.recursive, 'detected-local-cycle');
        const metric = complexity.functions.find((item) => item.functionId === daemon.id)!;
        assert.equal(metric.termination.candidates.length, 1);
        assert.equal(metric.termination.status, 'unknown');
        assert.equal(metric.memoryLeak.status, 'unknown');
        assert.ok(evidence.exits.some((item) => item.kind === 'break' && item.functionId === daemon.id));
    });
});

test('complexity: loop initializers and iterable evaluation are outside their own repetition region', async () => {
    await withAssessment(
        `function run() {
for (let i = initialize(); check(i); i = update(i)) { body(); }
for (const item of iterable()) { visit(item); }
}`,
        ({ evidence }) => {
            const call = (name: string) => evidence.calls.find((item) => item.callee === name)!;
            assert.equal(call('initialize').loopIds.length, 0);
            assert.equal(call('iterable').loopIds.length, 0);
            for (const name of ['check', 'update', 'body', 'visit']) assert.equal(call(name).loopIds.length, 1);
        },
    );
});
