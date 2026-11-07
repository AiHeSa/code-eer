import type { NativeFunctionModel, ExpressionModel, StatementModel } from './native-model.js';
import type { CostSummary } from './cost.js';
import type { Value, Cost } from './cost-expressions.js';

type Environment = Map<string, Value>;
const unknown = (): Value => ({ kind: 'unknown', value: null });
const zero = (): Cost => ({ time: 0, space: 0, value: unknown() });
type Calls = (id: string) => CostSummary | null;
function expression(model: ExpressionModel, env: Environment, calls: Calls): Cost | null {
  if (model.kind === 'value') return { time: 1, space: 0, value: model.value };
  if (model.kind === 'ref') return env.has(model.id) ? { time: 1, space: 0, value: env.get(model.id)! } : null;
  if (model.kind === 'call') {
    const target = calls(model.id), args = model.args.map((arg) => expression(arg, env, calls));
    return target && args.every(Boolean) ? { time: 1 + target.time + args.reduce((sum, arg) => sum + arg!.time, 0),
      space: target.space + args.reduce((sum, arg) => sum + arg!.space, 0), value: unknown() } : null;
  }
  const left = expression(model.left, env, calls), right = expression(model.right, env, calls);
  if (!left || !right) return null;
  const equality = ['===', '!==', 'is', 'is not'].includes(model.op);
  const numeric = ['+', '-', '*', '/', '%', '//', '<', '<=', '>', '>=', '==', '!='].includes(model.op)
    && left.value.kind === 'number' && right.value.kind === 'number';
  const boolean = ['&&', '||', 'and', 'or', '==', '!='].includes(model.op) && left.value.kind === 'boolean' && right.value.kind === 'boolean';
  if (!equality && !numeric && !boolean) return null;
  return { time: left.time + right.time + 1, space: Math.max(left.space, right.space),
    value: { kind: equality || boolean || ['<', '<=', '>', '>=', '==', '!='].includes(model.op) ? 'boolean' : 'number', value: null } };
}
function statement(model: StatementModel, env: Environment, calls: Calls): Cost | null {
  if (model.kind === 'return' || model.kind === 'value') {
    const cost = expression(model.value, env, calls); return cost ? { ...cost, time: cost.time + Number(model.kind === 'return') } : null;
  }
  if (model.kind === 'declare') {
    const cost = expression(model.value, env, calls); if (!cost || env.has(model.id)) return null;
    env.set(model.id, cost.value); return { ...cost, time: cost.time + 1, space: env.size + cost.space };
  }
  if (model.kind === 'if') {
    const condition = expression(model.condition, env, calls), yes = statement(model.yes, new Map(env), calls), no = statement(model.no, new Map(env), calls);
    return condition && yes && no ? { time: condition.time + Math.max(yes.time, no.time), space: Math.max(yes.space, no.space), value: unknown() } : null;
  }
  if (model.kind !== 'sequence') return null;
  const total = zero(), nested = new Map(env);
  for (const item of model.items) {
    const cost = statement(item, nested, calls); if (!cost) return null;
    total.time += cost.time; total.space = Math.max(total.space, cost.space);
  }
  return total;
}
export function evaluateNative(model: NativeFunctionModel, calls: Calls): CostSummary | null {
  if (!model.body) return null;
  const env = new Map(model.parameters.map((item) => [item.id, { kind: item.kind, value: null }] as const));
  const cost = statement(model.body, env, calls);
  return cost && Number.isFinite(cost.time) ? { time: cost.time, space: Math.max(1, env.size + cost.space), pure: true,
    isolated: false, model: 'native-primitive-source-operations-v1; compiler-checked scalar kinds; dynamic operators and resource lifetimes rejected' } : null;
}
export const nativePurityCandidate = (model: NativeFunctionModel) => evaluateNative(model,
  () => ({ time: 0, space: 0, pure: true, isolated: false, model: 'unverified-callee-candidate' })) !== null;
