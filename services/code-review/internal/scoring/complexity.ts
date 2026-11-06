import type { ScoringPolicy } from './policy.js';
import { type Proof, type RuleResult } from './model.js';
import { rule } from './rules.js';
import { clamp, result } from './score.js';

export interface CostFact { ratio: number | null; proof: Proof; issueKeys?: string[]; relation?: 'exact' | 'upper-bound' }
export interface SevereFact { kind: 'nontermination' | 'leak'; issueKey: string; proof: Proof }
export interface ComplexityInput { unitId: string; time: CostFact; space: CostFact; severe: SevereFact[]; riskCoverage: Proof }

function regular(input: ComplexityInput, policy: ScoringPolicy, rules: RuleResult[], severe: Set<string>) {
  let lower = 0, upper = 0;
  for (const key of ['time', 'space'] as const) {
    const fact = input[key];
    if (fact.ratio !== null && (!Number.isFinite(fact.ratio) || fact.ratio < 0)) throw new Error('Invalid cost ratio');
    const known = fact.proof.state === 'verified' && fact.ratio !== null;
    const proof = known ? fact.proof : { ...fact.proof, state: fact.proof.state === 'verified' ? 'unknown' as const : fact.proof.state };
    const superseded = fact.issueKeys?.some((issue) => severe.has(issue)) ?? false;
    const item = rule(input.unitId, `C-${key}`, 'complexity', proof);
    if (known && !superseded && fact.ratio! > 1) {
      item.verdict = fact.relation === 'upper-bound' ? 'unknown' : 'violated';
      if (fact.relation === 'upper-bound') item.reason = 'Conservative cost bound exceeds budget; actual violation is not proven';
    }
    if (superseded) item.reason = 'Ordinary deduction suppressed by the severe issue owner';
    rules.push(item);
    const score = superseded ? 100 : known ? clamp(100 - policy.complexity.overBudgetLogPenalty[key] * Math.max(0, fact.ratio! > 0 ? Math.log2(fact.ratio!) : 0)) : null;
    lower += (score ?? 0) * policy.complexity.regularWeights[key];
    upper += (fact.relation === 'upper-bound' ? 100 : score ?? 100) * policy.complexity.regularWeights[key];
  }
  return { lower, upper };
}

export function scoreComplexity(input: ComplexityInput, policy: ScoringPolicy) {
  const ordered = [...input.severe].sort((a, b) => a.issueKey.localeCompare(b.issueKey)
    || ['verified', 'disproved', 'unknown', 'unsupported'].indexOf(a.proof.state) - ['verified', 'disproved', 'unknown', 'unsupported'].indexOf(b.proof.state)
    || a.kind.localeCompare(b.kind) || a.proof.evidenceIds.join().localeCompare(b.proof.evidenceIds.join()));
  for (const issue of ordered) if (issue.proof.state === 'verified' && ordered.some((other) => other.issueKey === issue.issueKey && other.proof.state === 'disproved'))
    throw new Error('Conflicting verified severe-risk proofs');
  const rules: RuleResult[] = [];
  const verifiedIssues = new Set(input.severe.filter((issue) => issue.proof.state === 'verified').map((issue) => issue.issueKey));
  const bounds = regular(input, policy, rules, verifiedIssues);
  let deduction = 0, dimensionCap = 100, compositeCap: number | null = null;
  const claimed = new Set<string>(), owners = new Map<string, string>();
  for (const [index, issue] of ordered.entries()) {
    const item = rule(input.unitId, `C-${issue.kind}/${issue.issueKey}`, 'complexity', issue.proof);
    item.id += `/${index}`;
    item.verdict = issue.proof.state === 'verified' ? 'violated' : issue.proof.state === 'disproved' ? 'satisfied' : 'unknown';
    item.issueKeys = [issue.issueKey];
    item.suppressedBy = owners.get(issue.issueKey) ?? null;
    rules.push(item);
    if (item.suppressedBy) continue;
    owners.set(issue.issueKey, item.id);
    if (issue.proof.state !== 'verified') continue;
    claimed.add(issue.issueKey);
    const severity = policy.complexity.verifiedSevereIssues[issue.kind];
    deduction += severity.deduction; dimensionCap = Math.min(dimensionCap, severity.dimensionCap);
    compositeCap = Math.min(compositeCap ?? 100, severity.compositeCap);
  }
  rules.push(rule(input.unitId, 'C-RISK-COVERAGE', 'complexity', input.riskCoverage.state === 'disproved'
    ? { ...input.riskCoverage, state: 'unknown' } : input.riskCoverage));
  const riskKnown = input.riskCoverage.state === 'verified' && rules.filter((item) => item.issueKeys.length && !item.suppressedBy)
    .every((item) => item.verdict !== 'unknown' && item.execution === 'complete');
  const score = result({ lower: riskKnown ? Math.min(dimensionCap, clamp(bounds.lower - deduction)) : 0,
    upper: Math.min(dimensionCap, clamp(bounds.upper - deduction)) }, rules,
  { regular: bounds, severeDeduction: deduction, dimensionCap, compositeCap, severeIssueCount: claimed.size }, compositeCap);
  return { score, rules };
}
