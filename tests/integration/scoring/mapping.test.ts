import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadPolicy, policySchema } from '../../../services/code-review/internal/scoring/policy.js';
import { scoreScope, type ScopeInput } from '../../../services/code-review/internal/scoring/scope.js';
import { scoreComplexity, type ComplexityInput } from '../../../services/code-review/internal/scoring/complexity.js';
import { scorePlacement } from '../../../services/code-review/internal/scoring/placement.js';
import { composite, grade } from '../../../services/code-review/internal/scoring/composite.js';
import { result, unavailable, weighted } from '../../../services/code-review/internal/scoring/score.js';
import { rule, deduplicateRules, scheduleRules } from '../../../services/code-review/internal/scoring/rules.js';
import { unknownProof, type Proof } from '../../../services/code-review/internal/scoring/model.js';
import { fuseSources } from '../../../services/code-review/internal/scoring/sources.js';

const policy = await loadPolicy();
const yes: Proof = { state: 'verified', evidenceIds: ['proof'], reason: 'Independent verified fixture' };
const no: Proof = { state: 'disproved', evidenceIds: ['proof'], reason: 'Condition demonstrably absent' };

function scope(): ScopeInput {
    return {
        unitId: 'fn',
        category: 'local',
        bonuses: { pure: yes, isolatedIife: yes, temporary: null },
        impact: {
            methods: 0,
            files: 0,
            modules: 0,
            chainLength: 0,
            stateCategories: 0,
            complete: true,
            evidenceIds: ['closed-boundary'],
        },
    };
}

function cost(): ComplexityInput {
    return {
        unitId: 'fn',
        time: { ratio: 2, proof: yes },
        space: { ratio: 1, proof: yes },
        severe: [],
        riskCoverage: yes,
    };
}

const point = (value: number) => result({ lower: value, upper: value }, [rule('point', 'verified', 'scope', yes)]);

test('scope: base-relative bonuses and logarithmic impacts match documented arithmetic', () => {
    assert.equal(scoreScope(scope(), policy).score.value, 91);
    const input = scope();
    input.bonuses = { pure: null, isolatedIife: null, temporary: null };
    input.impact = { ...input.impact, methods: 3, files: 1, modules: 1, chainLength: 2 };
    assert.equal(scoreScope(input, policy).score.value, 53);
});

test('scope: unknown bonuses and impact coverage preserve bounds, never a complete number', () => {
    const input = scope();
    input.bonuses = { pure: unknownProof('Missing purity'), isolatedIife: null, temporary: null };
    assert.deepEqual(scoreScope(input, policy).score.interval, { lower: 70, upper: 84 });
    assert.equal(scoreScope(input, policy).score.value, null);
    input.impact.complete = false;
    assert.deepEqual(scoreScope(input, policy).score.interval, { lower: 5, upper: 84 });
    input.impact.methods = -1;
    assert.throws(() => scoreScope(input, policy), /Invalid impact/);
});

test('complexity: budget mapping is time-prioritized and monotone', () => {
    assert.equal(scoreComplexity(cost(), policy).score.value, 88);
    const input = cost();
    input.time.ratio = 4;
    assert.equal(scoreComplexity(input, policy).score.value, 76);
    input.time.ratio = 0;
    assert.equal(scoreComplexity(input, policy).score.value, 100);
    input.time.ratio = Number.NaN;
    assert.throws(() => scoreComplexity(input, policy), /Invalid cost/);
});

test('complexity: a proven upper bound can establish compliance but cannot prove a violation', () => {
    const input = cost();
    input.time.relation = 'upper-bound';
    const score = scoreComplexity(input, policy).score;
    assert.deepEqual(score.interval, { lower: 88, upper: 100 });
    assert.equal(score.value, null);
    input.time.ratio = 0.5;
    assert.equal(scoreComplexity(input, policy).score.value, 100);
});

test('complexity: confirmed severe risks deduct once and impose caps; candidates do not', () => {
    const input = cost();
    input.severe = [
        { kind: 'nontermination', issueKey: 'loop', proof: yes },
        { kind: 'leak', issueKey: 'loop', proof: yes },
    ];
    const result = scoreComplexity(input, policy);
    assert.equal(result.score.value, 20);
    assert.equal(result.score.cap, 40);
    assert.equal(result.score.details['severeIssueCount'], 1);
    assert.ok(result.rules.some((rule) => rule.suppressedBy));
    input.severe = [{ kind: 'nontermination', issueKey: 'loop', proof: unknownProof('Candidate') }];
    assert.equal(scoreComplexity(input, policy).score.cap, null);
    assert.equal(scoreComplexity(input, policy).score.value, null);
});

test('complexity: the severe owner suppresses an ordinary deduction for the same issue', () => {
    const input = cost();
    input.time.ratio = 1024;
    input.time.issueKeys = ['loop'];
    input.severe = [{ kind: 'nontermination', issueKey: 'loop', proof: yes }];
    assert.equal(scoreComplexity(input, policy).score.value, 20);
    input.riskCoverage = unknownProof('Other risk paths not covered');
    assert.deepEqual(scoreComplexity(input, policy).score.interval, { lower: 0, upper: 20 });
});

test('complexity: confirmed risk supersedes its candidate independently of input order', () => {
    const input = cost();
    input.severe = [
        { kind: 'leak', issueKey: 'one', proof: unknownProof('Earlier candidate') },
        { kind: 'leak', issueKey: 'one', proof: yes },
    ];
    const a = scoreComplexity(input, policy);
    assert.equal(a.score.value, 20);
    input.severe.reverse();
    assert.deepEqual(scoreComplexity(input, policy), a);
    input.severe.push({ kind: 'leak', issueKey: 'one', proof: no });
    assert.throws(() => scoreComplexity(input, policy), /Conflicting/);
});

test('placement: explicit applicability determines denominator without dropping unknown rules', () => {
    const rules = [
        rule('file', 'P-DEPENDENCY-BOUNDARY', 'placement', yes),
        rule('file', 'P-ROLE-MIXING', 'placement', no),
    ];
    assert.ok(Math.abs(scorePlacement(rules, policy).score.value! - (100 * 2) / 3) < 1e-9);
    rules.push(rule('file', 'P-ENTRY-CONTRACT', 'placement', unknownProof('Unknown role')));
    const score = scorePlacement(rules, policy).score;
    assert.equal(score.value, null);
    assert.ok(score.interval!.lower < score.interval!.upper);
});

test('ledger: priority removes duplicate quality issues across rules and dimensions', () => {
    const a = rule('unit', 'P-DEPENDENCY-BOUNDARY', 'placement', no),
        b = rule('unit', 'P-PUBLIC-BUSINESS-COUPLING', 'placement', no);
    a.issueKeys = ['one'];
    b.issueKeys = ['one'];
    b.priority = 1;
    const scored = scorePlacement([a, b], policy);
    assert.equal(scored.score.details['denominator'], 4);
    assert.equal(scored.rules.find((item) => item.ruleId === a.ruleId)?.suppressedBy, b.id);
    assert.throws(() => deduplicateRules([a, a]), /Duplicate/);
});

test('composite: fixed weights, serious cap and missing dimensions match specification', () => {
    const scores = { scope: point(91), complexity: point(88), placement: point((100 * 2) / 3) };
    assert.ok(Math.abs(composite(scores, policy).value! - 86.15) < 1e-9);
    scores.complexity = point(20);
    scores.complexity.cap = 40;
    assert.equal(composite(scores, policy).value, 40);
    scores.complexity = point(88);
    scores.placement = unavailable('Missing');
    const score = composite(scores, policy);
    assert.equal(score.value, null);
    assert.ok(Math.abs(score.interval!.lower - 76.15) < 1e-9);
    assert.ok(Math.abs(score.interval!.upper - 91.15) < 1e-9);
});

test('aggregation: failed/N-A members stay explicit and no known-score renormalization occurs', () => {
    const score = weighted(
        [
            { score: point(100), weight: 1 },
            { score: unavailable('Failed', 'failed'), weight: 1 },
        ],
        'two manifest files',
    );
    assert.deepEqual(score.interval, { lower: 50, upper: 100 });
    assert.equal(score.value, null);
    const na = weighted(
        [
            { score: point(100), weight: 1 },
            { score: unavailable('N/A', 'not-applicable'), weight: 1 },
        ],
        'reduced scope',
    );
    assert.equal(na.value, null);
    assert.throws(() => weighted([{ score: point(100), weight: 0 }], 'invalid'), /Invalid/);
});

test('rules: dependency order is deterministic and invalid graphs are rejected', () => {
    assert.deepEqual(
        scheduleRules([
            { id: 'b', requires: ['a'] },
            { id: 'a', requires: [] },
        ]).map((item) => item.id),
        ['a', 'b'],
    );
    assert.throws(() => scheduleRules([{ id: 'a', requires: ['a'] }]), /Cyclic/);
    assert.throws(() => scheduleRules([{ id: 'a', requires: ['missing'] }]), /missing/);
});

test('sources: missing/mismatched/disagreeing model results never produce a formal grade', () => {
    const internal = {
        source: 'internal' as const,
        snapshotDigest: 'snapshot',
        policyDigest: 'policy',
        configurationDigest: 'config',
        positionContextDigest: 'positions',
        scope: point(80),
        complexity: point(80),
        placement: point(80),
    };
    assert.equal(fuseSources(internal, null, policy).grade.value, null);
    const model = { ...internal, source: 'model' as const };
    assert.equal(fuseSources(internal, model, policy).grade.value, 'B');
    assert.throws(() => fuseSources(internal, { ...model, snapshotDigest: 'other' }, policy), /different snapshots/);
    assert.throws(() => fuseSources(internal, { ...model, configurationDigest: 'other' }, policy), /position contexts/);
    assert.throws(
        () => fuseSources(internal, { ...model, positionContextDigest: 'other' }, policy),
        /position contexts/,
    );
    assert.equal(fuseSources(internal, { ...model, scope: point(50) }, policy).grade.value, null);
    assert.equal(grade(point(100), policy).value, null);
});

test('policy: invalid weights, boundaries and design-only configuration cannot execute', () => {
    assert.equal(policySchema.safeParse({ ...policy, runtimeEnabled: false }).success, false);
    assert.equal(
        policySchema.safeParse({ ...policy, compositeWeights: { scope: 1, complexity: 1, placement: 1 } }).success,
        false,
    );
    assert.equal(
        policySchema.safeParse({ ...policy, gradeLowerBounds: { A: 50, B: 80, C: 65, D: 50, E: 0 } }).success,
        false,
    );
});
