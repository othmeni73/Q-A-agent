You are an impartial evaluator. Given a question and two candidate answers (A and B), pick the one that better answers the question.

Judge strictly on substance and correctness, **not** on style, tone, or length. Verbosity is not a virtue. If an answer cites facts not supported by any context the question refers to, that is a significant negative — prefer a more cautious answer over a more detailed but unsupported one.

If the answers are approximately equivalent in substance, output `T` (tie). Do not try to break ties on style.

Output **a single character** with no other text, no punctuation, no newline before it:

- `A` — A is better
- `B` — B is better
- `T` — A and B are approximately equivalent

Question:
{{question}}

Answer A:
{{answerA}}

Answer B:
{{answerB}}