import { z } from 'zod';

/**
 * A single evaluation test case. Built for end-to-end runs (real retrieval,
 * real chat, real judges). Distinct shape from Step 2's model-selection
 * cases — those had pre-stubbed context for isolated model grading.
 */
export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    'factual',
    'multi-doc',
    'follow-up',
    'out-of-scope',
    'adversarial',
    'ambiguous',
  ]),
  question: z.string().min(1),
  /** For follow-up cases: the prior user turn to run first, same session. */
  priorTurn: z.string().optional(),
  /** For out-of-scope / adversarial: assert the exact refusal is emitted. */
  mustRefuse: z.boolean().optional(),
  /**
   * Ground-truth reference answer. Relevance is graded by comparing the
   * generated answer to this string (via judge.relevance.md). Cases without it
   * skip relevance + completeness grading — set for factual / multi-doc /
   * follow-up cases; leave unset for ambiguous / OOS / adversarial.
   */
  expectedAnswer: z.string().optional(),
  /**
   * Supporting-document ground truth — arXiv ids of papers that contain
   * information necessary to answer the question. Used to compute Recall@k
   * and MRR (retrieval quality). NOT a "citation answer key" — it's a
   * source-availability label.
   */
  supportingArxivIds: z.array(z.string()).optional(),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCasesFileSchema = z.object({
  $schema: z.string().optional(),
  cases: z.array(EvalCaseSchema).min(1),
});
export type EvalCasesFile = z.infer<typeof EvalCasesFileSchema>;

/** Ablation lanes run per case. */
export const LANES = ['baseline', '+rerank', '+full'] as const;
export type EvalLane = (typeof LANES)[number];

export interface PerCaseResult {
  caseId: string;
  category: EvalCase['category'];
  lane: EvalLane;
  answer: string;
  isRefusal: boolean;
  citations: { arxivId?: string; sourceTitle: string; n: number }[];
  retrieval: {
    topKIds: (string | number)[];
    retrievedArxivIds: string[];
    /** Recall@k: (# supportingArxivIds hit in top-k) / |supportingArxivIds|. */
    recallAtK?: number;
    /** MRR: 1 / (rank of first supporting doc in retrieved, 1-indexed). */
    mrr?: number;
  };
  judge: {
    /** 1-5 vs ground-truth expected answer — spec's "Relevance". */
    relevance?: number;
    /** 1-5 support-for-claims — spec's "Groundedness". */
    groundedness?: number;
    /** 0-5 context-only contradiction check (diagnostic). */
    faithfulness?: number;
    /** 0-5 aspect coverage vs reference. */
    completeness?: number;
  };
  /** Spec's "Citation accuracy" — citations present AND every cited paper in retrieved set. */
  citationAccuracy: boolean;
  /** 1 iff relevance ≥ thr AND groundedness ≥ thr AND citationAccuracy. */
  answerSuccess?: 0 | 1;
  /** Only meaningful on must-refuse cases. */
  refusedCorrectly?: boolean;
  tokens: { input: number; output: number; total: number };
  latency: { totalMs: number; ttftMs?: number };
}

export interface MeanStd {
  mean: number;
  std: number;
  n: number;
}

export interface StratifiedAggregate {
  n: number;
  recallAtK?: number;
  mrr?: number;
  relevance?: MeanStd;
  groundedness?: MeanStd;
  faithfulness?: MeanStd;
  completeness?: MeanStd;
  citationAccuracyPct?: number;
  successRatePct?: number;
  failureRate?: number;
}

export interface LaneAggregate {
  recallAtK: number;
  mrr: number;
  relevance: MeanStd;
  groundedness: MeanStd;
  faithfulness: MeanStd;
  completeness: MeanStd;
  failureRate: number;
  citationAccuracyPct: number;
  refusalCorrectPct: number;
  refusalRatePct: number;
  successRatePct: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  byCategory: Partial<Record<EvalCase['category'], StratifiedAggregate>>;
}

export interface EvalRunResults {
  runId: string;
  startedAt: string;
  finishedAt: string;
  commit: string;
  lanes: Record<EvalLane, PerCaseResult[]>;
  aggregate: Record<EvalLane, LaneAggregate>;
}
