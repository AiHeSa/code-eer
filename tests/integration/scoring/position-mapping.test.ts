import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { loadPolicy, policySchema } from '../../../services/code-review/internal/scoring/policy.js';
import type { PositionContext } from '../../../services/code-review/internal/scoring/position-context.js';
import type { PositionRole } from '../../../services/code-review/internal/scoring/position-policy.js';
import { positionedScope } from '../../../services/code-review/internal/scoring/position-scope.js';
import { positionedComplexity } from '../../../services/code-review/internal/scoring/position-complexity.js';
import type { ScopeInput } from '../../../services/code-review/internal/scoring/scope.js';
import type { ComplexityInput } from '../../../services/code-review/internal/scoring/complexity.js';
import { unknownProof, type Proof } from '../../../services/code-review/internal/scoring/model.js';
import { aggregateScores } from '../../../services/code-review/internal/scoring/aggregate.js';
import { result } from '../../../services/code-review/internal/scoring/score.js';
import { rule } from '../../../services/code-review/internal/scoring/rules.js';

const policy = await loadPolicy();
const yes: Proof = { state: 'verified', evidenceIds: ['proof'], reason: 'Fixture proof' };
const context = (...roles: PositionRole[]): PositionContext => ({ state: 'verified', roles, candidates: roles,
  evidenceIds: ['role'], reasons: ['Fixture role'] });
const unknown: PositionContext = { ...context('leaf', 'intermediate', 'global', 'entry', 'public'), state: 'unknown', roles: [] };
function scope(): ScopeInput {
  return { unitId: 'fn', category: 'local', bonuses: { pure: unknownProof('Unproved purity'), isolatedIife: null, temporary: null },
    impact: { methods: 2, files: 0, modules: 0, chainLength: 2, stateCategories: 0, complete: false,
      depthComplete: true, evidenceIds: ['caller'] } };
}
function cost(): ComplexityInput {
  return { unitId: 'fn', time: { ratio: 2, proof: yes }, space: { ratio: 1, proof: yes }, severe: [], riskCoverage: yes };
}

test('position: leaf scope depends only on depth even when purity and scope category are unknown', () => {
  const input = scope(), a = positionedScope(input, context('leaf'), policy);
  assert.equal(a.score.value, 98.5);
  assert.equal((a.score.details['baseline'] as { value: number | null }).value, null);
  assert.equal(a.rules.find((item) => item.ruleId === 'S-pure')!.applicability, 'not-applicable');
  input.category = 'unknown'; input.impact.methods = 1000; input.impact.files = 200;
  input.bonuses = { pure: yes, isolatedIife: yes, temporary: yes };
  assert.equal(positionedScope(input, context('leaf'), policy).score.value, 98.5);
  input.impact.chainLength = 4;
  assert.equal(positionedScope(input, context('leaf'), policy).score.value, 97);
  input.impact.depthComplete = false;
  assert.deepEqual(positionedScope(input, context('leaf'), policy).score.interval, { lower: 0, upper: 97 });
});

test('position: intermediate, global, public and entry scores are stricter for identical scope facts', () => {
  const input = scope(); input.bonuses.pure = null; input.impact.complete = true;
  const leaf = positionedScope(input, context('leaf'), policy).score.value!;
  const mid = positionedScope(input, context('intermediate'), policy).score.value!;
  const entry = positionedScope(input, context('entry'), policy).score.value!;
  assert.ok(leaf > mid && mid > entry);
  assert.equal(positionedScope(input, context('global'), policy).score.value, entry);
  assert.equal(positionedScope(input, context('public'), policy).score.value, entry);
  assert.equal(positionedScope(input, context('leaf', 'entry'), policy).score.value, entry);
});

test('position: ordinary cost penalties are weighted before unchanged severe deductions and caps', () => {
  const input = cost();
  assert.equal(positionedComplexity(input, context('leaf'), policy).score.value, 94);
  assert.equal(positionedComplexity(input, context('intermediate'), policy).score.value, 85);
  assert.equal(positionedComplexity(input, context('entry'), policy).score.value, 82);
  input.severe = [{ kind: 'leak', issueKey: 'resource', proof: yes }];
  for (const role of ['leaf', 'intermediate', 'global', 'entry', 'public'] as const) {
    const score = positionedComplexity(input, context(role), policy).score;
    assert.equal(score.value, 20); assert.equal(score.cap, 40);
    assert.equal(score.details['severeDeduction'], 60);
  }
});

test('position: unknown roles and missing budgets cannot become complete through lower weights', () => {
  const input = cost(); input.time.ratio = 1;
  assert.equal(positionedComplexity(input, unknown, policy).score.value, null);
  assert.equal(positionedScope(scope(), unknown, policy).score.value, null);
  input.time = { ratio: null, proof: unknownProof('No task budget') };
  const score = positionedComplexity(input, context('leaf'), policy).score;
  assert.equal(score.value, null);
  assert.ok(score.reasons.includes('No task budget'));
});

test('position: strict objects carry greater aggregation weight and severe caps reach ancestors', () => {
  const leaf = positionedComplexity(cost(), context('leaf'), policy).score;
  const critical = positionedComplexity(cost(), context('entry'), policy).score;
  const point = result({ lower: 100, upper: 100 }, [rule('placement', 'ok', 'placement', yes)]);
  const inputs = [leaf, leaf, critical].map((score) => ({ scope: score, complexity: score, placement: point }));
  const aggregate = aggregateScores(inputs, policy, 'fixture');
  assert.equal(aggregate.complexity.value, 88); // (94 + 94 + 82 * 2) / 4
  critical.cap = 40;
  const severe = aggregateScores(inputs, policy, 'fixture severe');
  assert.equal(severe.composite.cap, 40);
  assert.ok(severe.composite.interval!.upper <= 40);
});

test('position: policy versioning preserves v0 and rejects reversed severity and importance', async () => {
  const v0 = policySchema.parse(JSON.parse(await readFile(new URL('../../../config/scoring.v0.json', import.meta.url), 'utf8')));
  assert.equal(positionedComplexity(cost(), context('leaf'), v0).score.value, 88);
  const invalid = structuredClone(policy); invalid.positionWeighting!.profiles.entry.importance = 0.5;
  assert.equal(policySchema.safeParse(invalid).success, false);
  assert.equal(policySchema.safeParse({ ...policy, positionWeighting: undefined }).success, false);
});

test('position: changing configured multipliers changes results monotonically without changing baseline facts', () => {
  const adjusted = structuredClone(policy); adjusted.positionWeighting!.profiles.leaf.complexityPenalty = 0.75;
  const a = positionedComplexity(cost(), context('leaf'), policy).score;
  const b = positionedComplexity(cost(), context('leaf'), policySchema.parse(adjusted)).score;
  assert.equal(b.value, 91);
  assert.ok(b.value! < a.value!);
  assert.deepEqual(a.details['baseline'], b.details['baseline']);
});
