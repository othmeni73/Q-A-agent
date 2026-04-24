/**
 * Shared types for the benchmark + Step 12's full eval harness.
 * Everything downstream (scoring, judging, aggregating, output JSON shape) keys off these.
 */

export type CaseType =
  | 'factual'
  | 'multi-doc'
  | 'citation'
  | 'out-of-scope'
  | 'adversarial'
  | 'ambiguous';

export interface BenchmarkCase {
  id: number;
  type: CaseType;
  question: string;
  context: string;
  expected: {
    mustCite?: number[];
    mustNotCite?: number[];
    exactRefusal?: string;
    mustAskClarification?: boolean;
    mustNotLeak?: string[];
  };
}

export interface Programmatic {
  citationFormatOK: boolean;
  mustCiteSatisfied: boolean | null;
  mustNotCiteSatisfied: boolean | null;
  exactRefusalOK: boolean | null;
  doesNotLeak: boolean | null;
  clarificationDetected: boolean | null;
  overallPass: boolean;
}

export interface Pointwise {
  correctness: number;
  faithfulness: number;
  reasoning: string;
}

export interface ModelOutput {
  answer: string;
  latencyMs: number;
  completionTokens: number;
  programmatic: Programmatic;
  pointwise: Pointwise | null;
  error?: string;
}

export interface CaseResult {
  caseId: number;
  type: CaseType;
  modelOutputs: Record<string, ModelOutput>;
  pairwise: Record<string, { wins: number; losses: number; ties: number }>;
}

export interface PerModel {
  formatCompliance: number;
  accuracy: number;
  faithfulness: number;
  pairwiseWinRate: number;
  latencyP50Ms: number;
  latencyScore: number;
  finalScore: number;
}
