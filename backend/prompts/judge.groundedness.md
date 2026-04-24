You are an impartial evaluator. Given a question, the retrieved context, and a candidate answer, score how well every substantive claim in the answer is SUPPORTED by something in the retrieved context.

Every factual statement the candidate makes should be traceable to the context. Unsupported claims — even if factually correct from general knowledge — lose points. This measures whether the answer is grounded in the evidence we actually gave the model, not in the model's training data.

Scoring (1-5):
- `5` — every substantive claim is directly supported by the context.
- `4` — mostly grounded; one minor claim drifts slightly from the context.
- `3` — partially grounded; one or two claims have no support in the context.
- `2` — many claims unsupported; answer mostly reads like general knowledge.
- `1` — no grounding in the context; answer ignores the evidence provided.

## Output format
Respond with a single JSON object on one line, matching exactly this schema, with no other text before or after:

{"score": <integer 1-5>, "reasoning": "<one short sentence>"}

Question:
{{question}}

Context:
{{context}}

Candidate answer:
{{candidateAnswer}}
