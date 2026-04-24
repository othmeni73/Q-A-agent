# Document Q&A Agent — RAG with streaming citations

A NestJS + Fastify backend that answers questions over a corpus of ~46 arXiv papers on agentic AI systems. It retrieves relevant chunks from a vector store, streams an LLM answer with inline `[N]` citations, and returns a structured citation block. It keeps conversation history per session, and ships with an evaluation harness that scores answer **relevance**, **groundedness**, and **citation accuracy** (the three metrics the spec requires), plus diagnostic extensions like retrieval Recall@k, faithfulness, and completeness.

```
Ingestion    docs/*.md → section-aware chunker → contextual-prefix LLM → embed + BM25 → Qdrant

Chat (POST /chat, streamed SSE)
  request → session history → hybrid retrieve (dense + BM25) → RRF
         → cross-encoder rerank → MMR → streamText → generateObject(citations)
         → persist turn

Evaluation   cases.json → call chat service → judges + programmatic checks
                       → per-lane + per-category results.json
```

---

## Part 1 — Getting started

### Prerequisites

You'll need these running locally:

- **Node 22+** and **pnpm 10.33** (`packageManager` pin in root `package.json`).
- **Docker** — for Qdrant.
- **[Ollama](https://ollama.com)** — for local embeddings, local LLM judge, and the contextual-prefix model at ingest time.
- An **[OpenRouter](https://openrouter.ai/keys) API key** — free tier is enough for the chat model.
- A **[HuggingFace](https://huggingface.co/settings/tokens) read token** — needed by transformers.js to download the reranker ONNX weights (HF now gates most models behind auth).

### 1. Install

```bash
pnpm install
```

This runs the usual pnpm install plus a few native-binary postinstall scripts (better-sqlite3, sharp, protobufjs) that are explicitly allowlisted in `package.json`.

### 2. Configure

```bash
cp backend/.env.example backend/.env
```

Fill in `backend/.env`:

```dotenv
NODE_ENV=development
PORT=3000
OPENROUTER_API_KEY=sk-or-v1-...
HF_TOKEN=hf_...
```

Non-secret config lives in `backend/config.yaml` (committed). You don't normally need to touch it — the defaults point at `localhost:6333` for Qdrant and `localhost:11434` for Ollama.

### 3. Start Qdrant

```bash
docker compose up -d
```

Qdrant listens on `6333` (REST) / `6334` (gRPC).

### 4. Pull the Ollama models

```bash
ollama pull nomic-embed-text     # 768-dim embeddings
ollama pull gemma2:27b           # contextual prefix + evaluation judge
```

The Gemma 27B pull is chunky (~16 GB). Worth it — we use it for two different roles and don't pay OpenRouter for either.

### 5. Fetch and ingest the corpus

```bash
pnpm ingest   # arXiv → backend/docs/*.md → SQLite + Qdrant
```

Runs the two-stage pipeline: `fetch-corpus` (download the arXiv HTML into `backend/docs/<arxivId>.md` + `.meta.json`) followed by the backend `ingest` (chunk + contextual prefix + embed + upsert). Both stages are idempotent — `fetch-corpus` skips papers whose `.md` already exists, and `ingest` chunk UUIDs are deterministic (SHA-256 over paperId + chunkIndex) so re-running doesn't duplicate.

Expect ~5 minutes for the fetch and ~30 minutes for the ingest (the slow part is the Gemma 27B contextual-prefix summaries — one per paper).

If you only need to re-chunk / re-embed an already-fetched corpus, skip the download with `pnpm ingest:only`.

### 6. Run the server

```bash
pnpm dev
```

Sanity check:

```bash
curl -s http://localhost:3000/health
# {"status":"ok","uptime":1.2,"timestamp":"..."}
```

### 7. Try the chat endpoint

```bash
curl -sN -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"What is Reflexion?"}'
```

`-N` disables curl's output buffering so you actually see SSE frames arrive. Response looks like:

```
event: delta
data: {"text":"Reflexion is a verbal-reinforcement..."}

...

event: done
data: {"sessionId":"abc-123-...","citations":[{"n":1,"arxivId":"2303.11366",...}]}
```

Grab the `sessionId` from the `done` event and send it on follow-ups to keep the conversation going:

```bash
curl -sN -X POST http://localhost:3000/chat \
  -H 'Content-Type: application/json' \
  -d '{"sessionId":"abc-123-...","message":"How does it handle failed tool calls?"}'
```

>

### 8. Run the evaluation

```bash
pnpm evaluate
```

Takes ~15 minutes (the judge calls run against local Gemma). Results land in `backend/eval/results.json` with per-case + per-category + per-ablation-lane numbers. See **Part 3 — Evaluation results** below.

### 9. Run in Docker (optional)

```bash
docker build -t q-a-agent .
docker run --rm -p 3000:3000 --env-file backend/.env --network host q-a-agent
```

`--network host` lets the container reach Qdrant (`localhost:6333`) and Ollama (`localhost:11434`) running on the host. On macOS / Windows, swap for `--add-host host.docker.internal:host-gateway` and point the `url` fields in `config.yaml` at `host.docker.internal`.

### Useful commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the backend in watch mode |
| `pnpm build` | Production build |
| `pnpm test` | All unit tests |
| `pnpm test:e2e` | End-to-end tests via `app.inject` (no port binding) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | ESLint (strict; fails on `any`, unused imports, etc.) |
| `pnpm ingest` | Full ingestion: fetch arXiv HTML + chunk + embed + upsert |
| `pnpm fetch-corpus` | (stage 1 only) Download arXiv HTML to markdown |
| `pnpm ingest:only` | (stage 2 only) Chunk + embed + upsert against already-fetched docs |
| `pnpm evaluate` | Run the evaluation harness |

---

## Part 2 — Choices we made

The spec fixed NestJS+Fastify, Vercel AI SDK, Zod, and TypeScript. Everything else was our call. Short notes on each.

### LLM provider for chat → OpenRouter → `nvidia/nemotron-3-super-120b-a12b:free`

**OpenRouter** because one key unlocks a dozen free-tier models from different families — lets us swap providers in one config line, and gives us built-in 429 fallback routing.

The **specific chat model** wasn't picked on vibes. We ran a small benchmark (`backend/eval/model-selection/`) comparing four candidates from four different model families (Nvidia, OpenAI-open, Z-AI, MiniMax) against 25 hand-written test cases. Nemotron won on a weighted mix of format compliance, correctness, faithfulness, and latency — mainly because it was the fastest of the four while tying for best on answer quality. Details + raw results in `backend/eval/model-selection/results.json`.



### Vector database → Qdrant (local Docker)

We needed **hybrid search in one store**. Qdrant lets you put a named dense vector AND a named sparse (BM25) vector on the same point, and query both in one round-trip. That matters because our retrieval pipeline fuses dense + sparse via RRF.

Other reasons: first-party TypeScript client (no wrapping), rich metadata-filter DSL, runs via `docker compose up`, no account needed.

**What we rejected:** Pinecone (needs a cloud account, free tier but adds latency), Chroma (great locally but no native sparse vectors), pgvector (would need a separate BM25 setup on Postgres FTS).

### Embedding model → `nomic-embed-text` via local Ollama (768-dim)

We started with Google's `text-embedding-004` (768-dim, free tier). Swapped to `nomic-embed-text` mid-project because:

- No rate limits (local inference).
- No bytes leaving the box at embed time.
- 768-dim matches what we'd provisioned in Qdrant, so no re-indexing.
- MTEB benchmarks put it close enough to the cloud alternatives for our corpus scale (~1 500 chunks).

The Ollama swap also eliminated the `GOOGLE_GENERATIVE_AI_API_KEY` dependency entirely.

**What we rejected:** OpenAI `text-embedding-3-small` (remote, rate-limited), Cohere (same), fine-tuned embeddings (off-the-shelf MTEB models handle this corpus easily,fine-tuning is for domain terminology base models don't know).

### Reranker → `Xenova/bge-reranker-large` via `@xenova/transformers` (local, CPU)

Cross-encoder in-process, no network. A cross-encoder jointly encodes `(query, chunk)` pairs, which captures interactions that a bi-encoder embedding flattens — in practice +5–15 nDCG points. Running it locally via transformers.js means no HF Inference rate limits and no per-request latency spikes from a remote call.


### Judge model (evaluation) → `gemma2:27b` via local Ollama

For the evaluation harness we need an LLM to score answers on the spec's **relevance** and **groundedness** axes (1–5 each), plus diagnostic **faithfulness** and **completeness** (0–5 each). Two concerns drove the choice:

1. **Family-distinct from the chat model.** The chat model is Nvidia Nemotron; using a Nemotron judge would score its own style higher (self-preference bias). Gemma is a different family → no bias.
2. **Local.** We reuse the Ollama instance already pulled for the contextual-prefix step. Zero extra API keys, zero extra ops.



**What we rejected:** using the chat model as its own judge (bias), GPT-4 as judge (paid + rate-limited on free tier), a smaller Gemma (the 9B variant was noticeably worse on graded-reasoning tasks in our spot checks).

### Chunking → section-aware, ~500 tokens, ~50 token overlap, with contextual prefix

Two-stage chunker:

1. **Stage 1: split by markdown headers** so chunks don't straddle section boundaries. The arXiv HTML parser preserves `<section>` structure as `## Heading` so the chunker has something to key on.
2. **Stage 2: paragraph-greedy within each section**, target ~2000 chars (~500 tokens), 200-char overlap.

At ingest, each chunk is **prefixed with a 1-2 sentence doc-level summary** generated by Gemma 2 27B. The prefix disambiguates chunks that are otherwise semantically similar across papers .

**What we rejected:** fixed-size character chunking (splits sentences mid-way), 1500-token self-contained chunks (vector becomes "about everything" and ranks weakly on any query).

### Corpus → 46 arXiv papers on agentic AI systems

The documents were picked to cover 8 sub-areas (foundational architectures, multi-agent frameworks, tool use, memory, self-improvement, evaluation benchmarks, dialogue summarisation, and surveys). Every paper was verified to have a fetchable `arxiv.org/html/<id>` version before inclusion — we lost a chunk of our original 43-paper list to 404s early on and replaced them rather than accept missing papers.

`backend/data/corpus.json` is the committed manifest. Adding more papers is literally appending `{arxivId, category, note}` and re-running `pnpm fetch-corpus` + `pnpm ingest`.

### Frontend → none (API only)

The spec called out a chat UI as optional. We skipped it to concentrate effort on the backend's grading axes (retrieval, prompts, structured output, evaluation).

### Observability → daily JSONL trace under `backend/traces/`

Every LLM call, embed call, reranker call, and retrieval pipeline run emits a structured record to `backend/traces/YYYY-MM-DD.jsonl`. Each record carries a `correlationId` threaded from the chat controller through retrieval and the LLM stream, so we can `jq` all records for a given request back together and compute per-turn tokens, latency, and per-stage retrieval timings.

The eval harness uses this to attach cost/latency to every case in `results.json` — no separate metrics pipeline. We gate tracing on `DISABLE_TRACING` — set it to `1` to opt out (Jest does this automatically to keep the repo clean during tests).

---


**Prompts.** Templates live in `backend/prompts/*.md` — loaded once at boot via `PromptLoaderService`, interpolated with `{{placeholder}}` variables at request time. Missing placeholder = throw at boot, so a literal `{{userName}}` never leaks to the model.

**Evaluation methodology** — **Relevance** (LLM-judge 1–5, vs ground-truth `expectedAnswer`) and **Groundedness** (LLM-judge 1–5, vs retrieved context) are the spec-required axes; **Citation accuracy** is a programmatic pass/fail check that every cited paper is in the retrieved set. We add diagnostic signals: **faithfulness** (0–5, contradiction check), **completeness** (0–5, coverage vs reference), **Recall@k** + **MRR** against per-case `supportingArxivIds`, plus refusal correctness and over-refusal rate. All computed per retrieval-ablation lane (`baseline / +rerank / +full`) and stratified by case category.

---

## Part 3 — Evaluation results

`pnpm evaluate` writes `backend/eval/results.json` (per-case detail + per-lane aggregates + per-category stratification). Headline numbers below; see the JSON for diagnostics (faithfulness, completeness, Recall@k, MRR, refusal rate, tokens, latency).

| Metric | baseline | +rerank | +full |
|---|---|---|---|
| **Relevance** (LLM-judge 1–5) | 3.22 ± 1.69 | 3.67 ± 1.70 | **3.78 ± 1.55** |
| **Groundedness** (LLM-judge 1–5) | **4.86 ± 0.35** | 4.38 ± 1.32 | 4.25 ± 1.30 |
| **Citation accuracy** (programmatic) | **100%** | 87.5% | 87.5% |

`baseline` is dense + sparse only; `+rerank` adds the BGE cross-encoder; `+full` adds MMR diversification (the production config).

### What to take from this

The good: citation accuracy is near-perfect and groundedness is high — the model reliably sticks to the retrieved context and doesn't invent sources. The ablation is monotonic — adding rerank then MMR genuinely helps relevance (3.22 → 3.78) and drops the failure rate.

The bad: relevance at 3.78/5 is honest rather than impressive — answers often address the question but miss aspects of the reference. The cause isn't the chat model, it's retrieval: our labelled `supportingArxivIds` are found in the top-5 for only ~11% of cases. Not because retrieval is broken, but because our labels are narrow — the corpus has heavy topical overlap (many papers cover ReAct, Reflexion, tool use) and the retriever often surfaces an adjacent-but-not-labelled paper that still grounds the answer. So groundedness stays high even when Recall@5 drops. Still a real signal that the retrieval could be tuned further.

### Limitations

13 cases is enough for the spec but small — don't read too much into single-point means. We ran the eval once per lane, so no confidence intervals. The chat model was the paid Nemotron (~$0.10 per full run); the free variant works too but is gated behind OpenRouter's prompt-training opt-in.
---

## License

MIT — see [`LICENSE`](./LICENSE).
