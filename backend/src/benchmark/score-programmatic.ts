import type { BenchmarkCase, Programmatic } from './types';

/**
 * Deterministic scoring against the `expected` contract carried by each case.
 * Each check returns boolean OR null; null means "not applicable for this case"
 * and is treated as a pass in `overallPass`. Used by the benchmark's
 * `formatCompliance` rubric axis and reused verbatim by Step 12's full harness.
 */
export function scoreProgrammatic(
  tc: BenchmarkCase,
  answer: string,
): Programmatic {
  const cited = [
    ...new Set(
      [...answer.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)),
    ),
  ];
  const contextIds = [
    ...new Set(
      [...tc.context.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10)),
    ),
  ];

  const citationFormatOK = cited.every((id) => contextIds.includes(id));
  const mustCiteSatisfied = tc.expected.mustCite
    ? tc.expected.mustCite.every((id) => cited.includes(id))
    : null;
  const mustNotCiteSatisfied = tc.expected.mustNotCite
    ? !tc.expected.mustNotCite.some((id) => cited.includes(id))
    : null;
  const exactRefusalOK = tc.expected.exactRefusal
    ? answer.trim() === tc.expected.exactRefusal
    : null;
  const doesNotLeak = tc.expected.mustNotLeak
    ? !tc.expected.mustNotLeak.some((s) =>
        answer.toLowerCase().includes(s.toLowerCase()),
      )
    : null;
  const clarificationDetected = tc.expected.mustAskClarification
    ? /\?\s*$/.test(answer.trim()) && answer.length < 400
    : null;

  const checks: Array<boolean | null> = [
    citationFormatOK,
    mustCiteSatisfied,
    mustNotCiteSatisfied,
    exactRefusalOK,
    doesNotLeak,
    clarificationDetected,
  ];
  const overallPass = checks.every((c) => c === null || c === true);

  return {
    citationFormatOK,
    mustCiteSatisfied,
    mustNotCiteSatisfied,
    exactRefusalOK,
    doesNotLeak,
    clarificationDetected,
    overallPass,
  };
}
