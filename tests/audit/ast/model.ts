import type { AnalyzeParams } from '../../../services/code-review/internal/ast/protocol.js';
import type { Fact, Language, Range } from '../../../services/code-review/internal/ast/schema.js';

export interface Selector {
  type?: Fact['type']; name?: string | null; nativeType?: string; data?: Record<string, unknown>;
}
export type Expectation =
  | { kind: 'facts'; file: string; selector: Selector; min: number; max?: number }
  | { kind: 'parent'; file: string; selector: Selector; parent: Selector }
  | { kind: 'range'; file: string; selector: Selector; range: Range }
  | { kind: 'diagnostics'; file: string; min: number }
  | { kind: 'framework'; file: string; value: 'react' | 'vue' }
  | { kind: 'absentFile'; file: string }
  | { kind: 'executed'; capability: 'symbols' | 'types' };

export interface AuditCase {
  id: string; title: string; backend: Language; scope: 'baseline' | 'planned'; requirement: string;
  files: Record<string, string>; entry: string[]; params?: Partial<AnalyzeParams>;
  expects: Expectation[]; implementation: string[];
  templateOracle?: string;
}
