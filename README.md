# Agentive Service — Car Rental Knowledge Pipeline

## 1. Project Overview

**Agentive Service** is the backend for a car-rental AI agent, built with NestJS. The system's eventual goal is a conversational agent that can answer customer questions about a car rental business and, later, take actions on their behalf (search cars, check availability, book, pay).

Building that agent well requires it to ground its answers in the business's real policies and services rather than guessing. So the project started with the foundation that a trustworthy agent needs first: a **knowledge ingestion and retrieval pipeline**. Two source documents — a services list and a rental policy document — are converted into searchable, semantically meaningful chunks stored in a vector database, so that a natural-language question can be matched against the most relevant real content.

### What exists today

- PDF text extraction
- Structure-aware chunking of that text into `KnowledgeChunk`s
- Gemini-based embedding of those chunks (and of user queries)
- Storage and indexing of embeddings in Qdrant
- Semantic similarity search: given a question, retrieve the most relevant chunks

### What does not exist yet

- Turning retrieved chunks into a natural-language answer (RAG generation)
- An agent / tool-calling loop
- Any car inventory, availability, booking, or payment functionality
- Conversation memory or a chat interface
- Any HTTP API surface for the above (the app currently only exposes NestJS's default scaffold `GET /` endpoint)

Everything below documents what is actually implemented, verified against the current source tree — not the eventual vision.

## 2. Current Architecture

The system currently has two independent flows built from the same shared services.

**Ingestion (offline, run via dev scripts):**

```
PDF file → Text Extraction → Chunking → Gemini Embedding (document) → Qdrant
```

**Retrieval (online, callable at request time):**

```
User Query → Gemini Query Embedding (query) → Qdrant Similarity Search → Relevant KnowledgeChunks
```

| Component | Responsibility |
|---|---|
| `PdfExtractionService` | Reads a PDF file and returns its plain text, page by page. No knowledge of chunking or embeddings. |
| `ChunkingService` | Splits extracted text into `KnowledgeChunk[]`, following the document's own headings/bullets instead of fixed character counts. |
| `EmbeddingProvider` / `GeminiEmbeddingProvider` | Converts text into a 768-dimensional vector via Gemini, tagged with a task (`document` or `query`). |
| `EmbeddingService` | Thin, provider-agnostic wrapper other services depend on instead of a concrete provider. |
| `KnowledgeStore` / `QdrantKnowledgeStoreService` | Owns the Qdrant connection: creates/verifies the collection, upserts embedded chunks, runs similarity search. |
| `RetrievalService` | The single entry point for semantic search: embeds a question as a `query`, asks the `KnowledgeStore` for matches, and maps results back into `KnowledgeChunk`s with scores. |

Both flows share the same `EmbeddingService` and `KnowledgeStore` — nothing about embedding or vector storage is duplicated between indexing and retrieval.

## 3. Architecture Flow Diagrams

### 3.1 Knowledge ingestion / indexing flow

```mermaid
flowchart LR
    A["PDF file\ncar-rental-services.pdf\ncar-rental-policies.pdf"] --> B["PdfExtractionService\n(pdf-parse)"]
    B -->|"plain text, per page"| C["ChunkingService"]
    C -->|"KnowledgeChunk[]"| D["EmbeddingService.embedChunks()\ntask = 'document'"]
    D --> E["GeminiEmbeddingProvider\ngemini-embedding-001\ntaskType = RETRIEVAL_DOCUMENT"]
    E -->|"EmbeddedChunk[]\n768-dim vectors"| F["QdrantKnowledgeStoreService.indexChunks()"]
    F -->|"upsert by deterministic\nUUIDv5 point id"| G[("Qdrant\ncollection: car_rental_knowledge")]
```

### 3.2 Query / retrieval flow

```mermaid
flowchart LR
    Q["User question\n(natural language)"] --> R["RetrievalService.search()"]
    R -->|"task = 'query'"| S["EmbeddingService.embedText()"]
    S --> T["GeminiEmbeddingProvider\ngemini-embedding-001\ntaskType = RETRIEVAL_QUERY"]
    T -->|"query vector, 768-dim"| U["QdrantKnowledgeStoreService.search()"]
    U --> V[("Qdrant\ncollection: car_rental_knowledge")]
    V -->|"cosine similarity,\ntop-N + score"| W["RetrievedKnowledgeChunk[]\n{ score, chunk }"]
```

### 3.3 High-level current architecture

```mermaid
flowchart TB
    subgraph Ingestion["Ingestion (dev scripts only)"]
        PDFMOD["PdfExtractionModule"]
        CHKMOD["ChunkingModule"]
    end

    subgraph Shared["Shared, injectable services (NestJS modules)"]
        EMBMOD["EmbeddingModule\n(EmbeddingProvider abstraction)"]
        QDRMOD["QdrantModule\n(KnowledgeStore abstraction)"]
    end

    subgraph Query["Retrieval"]
        RETMOD["RetrievalModule"]
    end

    PDFMOD --> CHKMOD --> EMBMOD --> QDRMOD
    RETMOD --> EMBMOD
    RETMOD --> QDRMOD

    EMBMOD -.->|"HTTPS"| GEMINI[("Gemini Embedding API")]
    QDRMOD -.->|"HTTP (localhost:6333)"| QDRANT[("Qdrant\n(Docker container)")]
```

All five modules are wired together in `AppModule`, but there is currently **no controller** exposing chunking, embedding, indexing, or retrieval over HTTP — they're used via NestJS dependency injection internally and via the dev scripts described in [§7](#7-commands).

## 4. Step-by-Step Implementation

### Step 1.1 — PDF Text Extraction

- **Files:** `src/pdf-extraction/pdf-extraction.service.ts`, `pdf-extraction.module.ts`
- **Library:** [`pdf-parse`](https://www.npmjs.com/package/pdf-parse) (v2, native TypeScript, ESM/CJS dual build)
- **How it works:** `PdfExtractionService.extractText(filePath)` validates the path ends in `.pdf`, reads the file into a `Buffer`, and calls `new PDFParse({ data }).getText()`, returning the concatenated plain text of every page. Missing/invalid files and corrupt PDFs raise clear errors.
- **Why its own service:** Extraction is the one piece of the pipeline with no knowledge of chunking, embeddings, or Qdrant. Isolating it means the chunking logic can be tested and reasoned about independently of how text was obtained.

### Step 1.2 — Chunking

- **Files:** `src/chunking/chunking.service.ts`, `chunking.module.ts`, `knowledge-chunk.interface.ts`
- **`KnowledgeChunk` structure:**

```typescript
interface KnowledgeChunk {
  id: string;           // deterministic, e.g. "car-rental-policies-section-2"
  text: string;          // verbatim excerpt — never summarized or rewritten
  metadata: {
    source: string;       // e.g. "car-rental-policies.pdf"
    section?: string;     // e.g. "Payment & Security Deposit"
    documentTitle?: string; // e.g. "Terms & Rental Policies"
    page?: number;         // 1-based page the chunk starts on
    chunkIndex: number;    // 0-based order within the source
  };
}
```

- **How sections are chunked:** `ChunkingService` parses the extracted text's own structure — a title line, numbered headings (`"1. Driver Eligibility & Required Documents"`), and bullet points (`●` / `•`) — and turns each numbered section into one chunk, keeping every bullet under a heading together in the same chunk.
- **Max chunk size:** `1200` characters (`DEFAULT_MAX_CHUNK_CHARS`), configurable via `ChunkingOptions.maxChunkChars`. If a section exceeds this, it's split only at bullet-block boundaries (never mid-sentence), with the section heading repeated on each part for context.
- **Deterministic chunk IDs:** IDs are derived from the source filename and section number (e.g. `car-rental-services-section-1`), not random UUIDs — the same PDF always produces the same chunk IDs.
- **Why coherent sections are preserved:** Splitting mid-sentence or separating a heading from its bullets would produce chunks that are individually meaningless or misleading when embedded and retrieved later. Keeping a full logical section together (e.g. all of "Payment & Security Deposit") ensures a retrieved chunk is self-contained and answerable.

### Step 1.3 — Embeddings

- **Files:** `src/embedding/embedding-provider.interface.ts`, `gemini-embedding.provider.ts`, `embedding.service.ts`, `embedding.module.ts`, `embedding.constants.ts`
- **Provider abstraction:**

```typescript
type EmbeddingTask = 'document' | 'query';

interface EmbeddingProvider {
  readonly dimensions: number;
  embedText(text: string, task: EmbeddingTask): Promise<number[]>;
  embedTexts(texts: string[], task: EmbeddingTask): Promise<number[][]>;
}
```

`EmbeddingService` depends on this interface (injected via the `EMBEDDING_PROVIDER` token), not on `GeminiEmbeddingProvider` directly — a different provider could be substituted by changing one binding in `embedding.module.ts`.

- **Model:** `gemini-embedding-001` (Google's Gemini embedding API, via `@google/genai`), default configurable via `GEMINI_EMBEDDING_MODEL`.
- **Dimensions:** `768` by default (`EMBEDDING_OUTPUT_DIMENSIONS`), requested explicitly via Gemini's `outputDimensionality` config parameter.
- **Document vs. query task types:** `EmbeddingService.embedChunks()` always embeds with task `'document'`; `RetrievalService.search()` always embeds the user's question with task `'query'`.
  - **Why `RETRIEVAL_DOCUMENT` for indexing:** this task type is Gemini's recommended setting for text meant to be *found* by a search — it's what every stored knowledge chunk represents.
  - **Why `RETRIEVAL_QUERY` for retrieval:** Gemini's asymmetric retrieval design produces measurably better ranking when a search query is embedded with the query-specific task type rather than the document one, while the vector stays the same 768 dimensions and remains directly comparable via cosine similarity. This was adopted specifically because of a ranking problem found in evaluation — see Step 2.1.

### Step 1.4 — Qdrant Storage

- **Files:** `src/qdrant/knowledge-store.interface.ts`, `qdrant-knowledge-store.service.ts`, `qdrant.module.ts`, `qdrant.constants.ts`, `point-id.util.ts`
- **Collection name:** `car_rental_knowledge` (default, overridable via `QDRANT_COLLECTION`)
- **Vector size:** `768`, read from `EmbeddingService.dimensions` at collection-creation/verification time — never hardcoded in the Qdrant code
- **Distance:** `Cosine`
- **Payload structure** (stored alongside each vector):

```typescript
interface KnowledgeChunkPayload {
  text: string;
  source: string;
  section?: string;
  documentTitle?: string;
  page?: number;
  chunkIndex: number;
  chunkId: string; // the original KnowledgeChunk.id, for traceability
}
```

- **Deterministic point IDs:** Qdrant only accepts unsigned integers or UUID strings as point IDs, so `KnowledgeChunk.id` (e.g. `"car-rental-policies-section-2"`) is mapped to a UUID via **UUIDv5** (`toQdrantPointId`), using a fixed namespace constant. The same chunk id always produces the same UUID.
- **Idempotent upsert/indexing:** Because point IDs are deterministic, `indexChunks()` calling Qdrant's `upsert` replaces an existing point with the same ID rather than creating a new one — re-running indexing on the same PDFs updates the 8 existing points in place.
- **Local Docker setup:** a minimal `docker-compose.yml` at the project root runs `qdrant/qdrant:latest`, exposing the REST API on `6333` and gRPC on `6334`, with a named volume for persistence. No auth, no production configuration — local development only.

### Step 2 — Retrieval

- **Files:** `src/retrieval/retrieval.service.ts`, `retrieval.interface.ts`, `retrieval.module.ts`
- **Search interface:**

```typescript
interface SearchOptions {
  limit?: number;               // defaults to 5
  scoreThreshold?: number;      // optional minimum similarity score
  filter?: { source?: string; section?: string }; // simple exact-match filter
}

interface RetrievedKnowledgeChunk {
  score: number;
  chunk: KnowledgeChunk;
}

class RetrievalService {
  search(query: string, options?: SearchOptions): Promise<RetrievedKnowledgeChunk[]>;
}
```

- **Similarity search:** `RetrievalService.search()` validates the query is non-empty, embeds it (task `'query'`), and calls `KnowledgeStore.search()`, which runs Qdrant's `query()` API (cosine similarity against the stored 768-dim vectors).
- **Score threshold / limit:** both are optional `SearchOptions` passed straight through to Qdrant's `score_threshold` and `limit` parameters; `limit` defaults to 5.
- **Metadata filtering:** a deliberately simple, flat exact-match filter on `source` and/or `section` (e.g. `{ source: 'car-rental-policies.pdf' }`), translated into a Qdrant `must` filter — not a general filter DSL.
- **Returned shape:** each result's Qdrant payload is mapped back into a full `KnowledgeChunk` (id, verbatim text, metadata) paired with its similarity `score`, preserving Qdrant's ranking order.

### Step 2.1 — Retrieval Quality Fix

- **Original problem:** both document indexing and query embedding used Gemini's `RETRIEVAL_DOCUMENT` task type, since query embedding simply reused the same code path as document embedding.
- **Initial evaluation result:** **4 / 6** expected sections ranked #1 on the representative test questions (see [§9](#9-retrieval-evaluation)). The two failures were both "Payment & Security Deposit" questions, which ranked #2 and #3 behind "Cancellation & Modification Policy."
- **Diagnosis:** Gemini's embedding API supports distinct task types for asymmetric retrieval — `RETRIEVAL_DOCUMENT` for indexed content, `RETRIEVAL_QUERY` for search questions. Using `RETRIEVAL_DOCUMENT` for both is valid (vectors are still 768-dim and comparable) but not optimal for ranking quality.
- **The fix:** `EmbeddingProvider.embedText`/`embedTexts` now take an explicit `task: 'document' | 'query'` parameter. `EmbeddingService.embedChunks()` always passes `'document'`; `RetrievalService.search()` always passes `'query'`. `GeminiEmbeddingProvider` maps these to `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` respectively.
- **Re-indexing requirement:** because the stored vectors' *content* is unchanged by this fix (documents already used `RETRIEVAL_DOCUMENT`), re-indexing was done to ensure the ingestion path explicitly and verifiably uses the correct task type going forward, not because the previously stored vectors were wrong.
- **Final evaluation result:** **6 / 6** expected sections ranked #1, per `npm run evaluate:retrieval` run against the local Docker Qdrant instance and live Gemini API after the fix.

## 5. Project Structure

```
agentive-service/
├── docker-compose.yml          # local Qdrant (no auth, dev only)
├── .env.example                 # documented environment variables (no real secrets)
├── car-rental-services.pdf      # knowledge source document
├── car-rental-policies.pdf      # knowledge source document
├── scripts/                     # standalone dev/eval scripts (not part of `npm test`)
│   ├── extract-pdfs.ts            # demo: PdfExtractionService only
│   ├── print-chunks.ts            # demo: extraction + chunking
│   ├── generate-embeddings.ts     # demo: extraction + chunking + embedding
│   ├── index-knowledge.ts         # full ingestion: PDFs → Qdrant
│   ├── verify-qdrant-idempotency.ts # indexes twice, checks point count is stable
│   ├── search-knowledge.ts        # ad-hoc single-query search from the CLI
│   └── evaluate-retrieval.ts      # runs the 6 representative test questions
├── src/
│   ├── main.ts                    # NestJS bootstrap (default scaffold)
│   ├── app.module.ts              # wires all feature modules together
│   ├── app.controller.ts / app.service.ts  # default Nest "Hello World" endpoint (unmodified)
│   ├── pdf-extraction/
│   │   ├── pdf-extraction.service.ts   # PDF → plain text
│   │   └── pdf-extraction.module.ts
│   ├── chunking/
│   │   ├── chunking.service.ts         # text → KnowledgeChunk[]
│   │   ├── knowledge-chunk.interface.ts
│   │   └── chunking.module.ts
│   ├── embedding/
│   │   ├── embedding-provider.interface.ts  # EmbeddingProvider + EmbeddingTask
│   │   ├── gemini-embedding.provider.ts     # Gemini implementation
│   │   ├── embedding.service.ts             # provider-agnostic entry point
│   │   ├── embedding.constants.ts           # EMBEDDING_PROVIDER DI token
│   │   └── embedding.module.ts
│   ├── qdrant/
│   │   ├── knowledge-store.interface.ts     # KnowledgeStore + payload/search types
│   │   ├── qdrant-knowledge-store.service.ts # Qdrant implementation
│   │   ├── point-id.util.ts                 # deterministic UUIDv5 point IDs
│   │   ├── qdrant.constants.ts              # KNOWLEDGE_STORE DI token
│   │   └── qdrant.module.ts
│   └── retrieval/
│       ├── retrieval.service.ts             # question → RetrievedKnowledgeChunk[]
│       ├── retrieval.interface.ts           # SearchOptions, RetrievedKnowledgeChunk
│       └── retrieval.module.ts
└── test/
    └── app.e2e-spec.ts            # e2e boot test for the default endpoint
```

Every `*.service.ts` above has a matching `*.spec.ts` unit test (mocked dependencies — no live Gemini/Qdrant required for `npm test`).

## 6. Configuration

Environment variables, as declared in `.env.example` and read in code:

| Variable | Required | Default | Used by |
|---|---|---|---|
| `GEMINI_API_KEY` | Yes | — | `GeminiEmbeddingProvider` (throws a clear error if missing when an embedding is actually requested) |
| `GEMINI_EMBEDDING_MODEL` | No | `gemini-embedding-001` | `GeminiEmbeddingProvider` |
| `EMBEDDING_OUTPUT_DIMENSIONS` | No | `768` | `GeminiEmbeddingProvider` (also read by `QdrantKnowledgeStoreService` via `EmbeddingService.dimensions`, never duplicated) |
| `QDRANT_URL` | No | `http://localhost:6333` | `QdrantKnowledgeStoreService` |
| `QDRANT_COLLECTION` | No | `car_rental_knowledge` | `QdrantKnowledgeStoreService` |
| `PORT` | No | `3000` | `src/main.ts` (default Nest HTTP listener, unrelated to the pipeline above) |

Copy `.env.example` to `.env` and fill in `GEMINI_API_KEY` before running any script that talks to Gemini or Qdrant. `.env` is git-ignored.

## 7. Commands

All commands below are the actual scripts defined in `package.json`, run from `agentive-service/`.

**Local Qdrant (Docker):**
```bash
docker compose up -d      # start Qdrant (REST :6333, gRPC :6334)
docker compose down       # stop it
```

**Knowledge pipeline:**
```bash
npm run extract:pdfs             # demo: PDF text extraction only
npm run chunk:pdfs               # demo: extraction + chunking, prints chunks
npm run embed:pdfs               # demo: extraction + chunking + embedding, prints vector samples
npm run index:knowledge          # full pipeline: PDFs → Qdrant, prints a collection summary
npm run verify:qdrant-idempotency  # indexes twice, confirms point count doesn't grow
npm run search:knowledge -- "How much is the security deposit?"   # ad-hoc search
npm run evaluate:retrieval       # runs the 6 representative test questions, reports PASS/FAIL
```

**Standard NestJS/dev commands:**
```bash
npm test              # unit tests (vitest) — mocked Gemini/Qdrant, no live services needed
npm run test:e2e       # e2e boot test
npm run test:cov       # unit tests with coverage
npm run build          # nest build (TypeScript compile)
npm run lint           # oxlint over src/ and test/
npm run start:dev      # run the Nest app in watch mode
```

## 8. Knowledge Base

Two source PDFs currently make up the entire knowledge base:

| Document | Contents (high level) |
|---|---|
| `car-rental-services.pdf` | "Services Breakdown & Offerings" — three sections: **Daily & Short-Term Rentals** (economy/SUV/luxury tiers), **Long-Term Rentals** (weekly/monthly/corporate lease options), **Special Mobility Services** (airport pickup, chauffeur service, one-way rentals, add-ons like GPS/child seat). |
| `car-rental-policies.pdf` | "Terms & Rental Policies" — five sections: **Driver Eligibility & Required Documents**, **Payment & Security Deposit**, **Insurance & Damage Policy**, **Cancellation & Modification Policy**, **Vehicle Use Rules & Conditions** (fuel policy, mileage limits, prohibited uses, late returns). |

These two documents currently produce **8 knowledge chunks** in total (3 + 5), one per numbered section in each document.

## 9. Retrieval Evaluation

A small, fixed set of 6 representative questions is used to sanity-check retrieval quality — this is **not** a comprehensive or statistically significant test suite, just a repeatable check exercised by `npm run evaluate:retrieval`.

| # | Question | Expected top section |
|---|---|---|
| 1 | "How much is the security deposit?" | Payment & Security Deposit |
| 2 | "Can a 20 year old rent a car?" | Driver Eligibility & Required Documents |
| 3 | "What services do you offer at the airport?" | Special Mobility Services |
| 4 | "Can I cancel my booking and get a refund?" | Cancellation & Modification Policy |
| 5 | "Can I bring my pet in the rental car?" | Vehicle Use Rules & Conditions |
| 6 | "What payment methods do you accept?" | Payment & Security Deposit |

**Before the Step 2.1 fix** (both documents and queries embedded with `RETRIEVAL_DOCUMENT`): **4 / 6** — questions 1 and 6 both ranked "Cancellation & Modification Policy" above "Payment & Security Deposit" (scores were close: e.g. 0.7601 vs. 0.7565 for question 1).

**After the fix** (documents embedded with `RETRIEVAL_DOCUMENT`, queries with `RETRIEVAL_QUERY`), re-indexed and re-evaluated against the live Gemini API and local Qdrant: **6 / 6** expected sections ranked #1.

This result confirms the fix resolved the specific ranking problem observed on these 6 questions. It does not, by itself, demonstrate production-level retrieval quality across a broader or more adversarial set of questions — the evaluation set is intentionally small and specific to this stage of the project.

## 10. Current Limitations

Verified against the current codebase — the system does **not** yet do any of the following:

- Generate a final natural-language answer from retrieved chunks (no RAG answer generation / no LLM prompting step after retrieval)
- Run as an agent (no planning loop, no tool calling, no function-calling schema)
- Query or store any car inventory data
- Check real-time car availability
- Create, modify, or cancel a booking
- Process payments
- Maintain conversation memory or multi-turn context (each `RetrievalService.search()` call is stateless)
- Expose any of the above over HTTP — the only HTTP endpoint in the app is the unmodified NestJS scaffold `GET /` returning `"Hello World!"`

## 11. Development Roadmap

| Phase | Description | Status |
|---|---|---|
| 1 | Knowledge ingestion (PDF → text → chunks → embeddings → Qdrant) | **Implemented** |
| 2 | Retrieval (query → embedding → similarity search → chunks) | **Implemented** |
| 3 | RAG answer generation (LLM synthesizes an answer from retrieved chunks) | Planned |
| 4 | Agent / tool calling | Planned |
| 5 | Car inventory / data | Planned |
| 6 | Real-time availability | Planned |
| 7 | Booking | Planned |
| 8 | Payment | Planned |

Phases 3–8 are not implemented and nothing in the current codebase anticipates their exact shape beyond the provider/interface abstractions described in [§12](#12-design-decisions).

## 12. Design Decisions

- **Provider abstraction for embeddings (`EmbeddingProvider`):** `EmbeddingService` depends on an interface, not on `GeminiEmbeddingProvider` directly, bound via a DI token (`EMBEDDING_PROVIDER`). Swapping embedding vendors later means writing one new class and changing one binding.
- **Separate document/query embedding task types:** Discovered to matter empirically (Step 2.1) — modeled as an explicit, required `EmbeddingTask` parameter rather than a default, so every call site states its intent instead of a provider silently guessing.
- **Qdrant as the vector store, behind a `KnowledgeStore` interface:** Chosen for cosine-similarity search with a straightforward local Docker setup. The interface (`ensureCollection`, `indexChunks`, `search`, `getCollectionInfo`) means a different vector database could be substituted without touching chunking, embedding, or retrieval code.
- **Deterministic IDs everywhere:** chunk IDs are derived from filename + section number; Qdrant point IDs are derived from chunk IDs via UUIDv5. No randomness anywhere in the pipeline, so the same input always produces the same output — essential for testability and for idempotent re-indexing.
- **Idempotent indexing:** a direct consequence of deterministic point IDs — `indexChunks()` can be run repeatedly (e.g. after every deployment or content update) without accumulating duplicate points in Qdrant.
- **Keeping retrieval separate from answer generation:** `RetrievalService` returns raw, scored `KnowledgeChunk`s and stops there. No prompting, summarization, or LLM call happens after retrieval yet — this keeps retrieval quality independently testable and evaluable (as in Step 2.1) before any generation step is layered on top.
- **Local Docker Qdrant for development:** a minimal `docker-compose.yml` with no authentication or production configuration, since the current goal is a working local pipeline, not a deployment story.
