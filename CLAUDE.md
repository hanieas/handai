# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Handai is a qualitative/quantitative data analysis suite powered by LLMs. It runs as a Next.js web app or a Tauri desktop app (~10 MB) from the same codebase. Users upload CSV/XLSX files, pick an analysis tool and LLM provider, and run batch processing. Results are stored in SQLite and exportable as CSV.

## Prerequisites

Node.js 20+ and npm 10+. For the Tauri desktop app: Rust toolchain + Tauri CLI.

## Commands

```bash
npm run dev          # Dev server at http://localhost:3000 (uses Webpack, not Turbopack)
npm run build        # Production build (standalone output, 0 TS errors required)
npm start            # Serve production build on port 3000
npm run build:tauri  # Static export for Tauri desktop (produces out/)
npm test             # Vitest — run all 80 tests across 4 suites
npm run test:watch   # Vitest in watch mode
npm run lint         # ESLint (flat config, next/core-web-vitals + next/typescript)
npx tsc --noEmit     # TypeScript type-check (strict mode)
```

Run a single test file: `npx vitest run src/lib/__tests__/retry.test.ts`

Run a single test by name: `npx vitest run -t "test name pattern"`

Test files live in `src/lib/__tests__/` (analytics, prompts, retry, validation).

### Tauri Desktop Development

From `desktop/tauri/`:
```bash
npm run tauri dev        # Dev mode with hot reload + Rust compilation
npm run tauri build      # Production native installer (~10 MB)
```

### First-Time Setup

`npm install` runs `postinstall` which triggers Prisma codegen + copies the PDF worker. Then `npx prisma migrate dev` creates `prisma/dev.db`. The only env var needed is `DATABASE_URL="file:./dev.db"` (see `.env.example`).

After schema changes: `npx prisma migrate dev --name <description>` to generate and apply a migration. To regenerate the Prisma client without migrating: `npx prisma generate`. To reset the database: `npx prisma migrate reset`.

For web deployments, server-side API key defaults can be set in `.env.local` (e.g., `OPENAI_API_KEY=sk-...`). Keys entered in the Settings UI take precedence.

## Architecture

For exhaustive detail, see `ARCHITECTURE.md`. Below is what you need to get productive quickly.

### Dual LLM Call Path

The core architectural decision: the same React components work in both web and Tauri contexts, but LLM calls take different paths:

- **Web**: Browser → `/api/process-row` (Next.js API route) → `src/lib/ai/providers.ts` (`getModel()`) → Provider API. Results logged via Prisma to SQLite.
- **Tauri**: Browser → `src/lib/llm-browser.ts` (`getModel()`) → Provider API (direct from WebView, no server). Results logged via `src/lib/db-tauri.ts` to SQLite (tauri-plugin-sql).

`src/lib/llm-dispatch.ts` is the unified dispatch layer — tool pages call its functions (e.g., `dispatchProcessRow`, `dispatchCreateRun`, `dispatchSaveResults`) which internally branch on `isTauri` to route to the correct path. Use this instead of checking Tauri context in page code.

### Build Targets

Controlled by `TAURI_BUILD` env var in `next.config.ts`:
- `output: "standalone"` (default) — web deployment/Docker
- `output: "export"` (when `TAURI_BUILD=1`) — static HTML for Tauri. The `build:tauri` script temporarily moves `src/app/api/` out because static export can't include API routes.

### Key Libraries

| Layer | What | Where |
|---|---|---|
| Provider registry | `getModel()` — returns Vercel AI SDK model for any of 10 providers | `src/lib/ai/providers.ts` |
| Unified dispatch | Tauri/Web branching for LLM calls, run history, and results | `src/lib/llm-dispatch.ts` |
| State | Zustand store persisted to localStorage as `handai-storage` | `src/lib/store.ts` |
| Validation | Zod schemas for all API route request bodies | `src/lib/validation.ts` |
| Retry | `withRetry()` — exponential backoff, fast-fail on auth/400 errors | `src/lib/retry.ts` |
| Prompts | Prompt registry with per-tool localStorage overrides | `src/lib/prompts.ts` |
| Analytics | Cohen's kappa, pairwise agreement calculations | `src/lib/analytics.ts` |
| DB (web) | Prisma 6 + SQLite (`prisma/dev.db`) | `src/lib/prisma.ts` |
| DB (Tauri) | tauri-plugin-sql + SQLite (no Prisma at runtime) | `src/lib/db-tauri.ts` |
| CSV export | `downloadCSV()` — blob download or Tauri native save dialog | `src/lib/export.ts` |
| Types | Shared interfaces (Row, ProviderConfig, RunMeta, etc.) | `src/types/index.ts` |

### API Routes (web only)

All in `src/app/api/`. Each route validates input with Zod schemas from `src/lib/validation.ts`:

- `process-row` — Core single-row LLM dispatch (used by Transform, Qualitative Coder, AI Coder, Codebook Generator, Abstract Screener)
- `consensus-row` — Multi-worker + judge for Consensus Coder
- `comparison-row` — Parallel multi-model dispatch for Model Comparison
- `automator-row` — Multi-step pipeline execution
- `generate-row` — Synthetic data generation
- `document-extract` / `document-analyze` — PDF/DOCX processing (web uses Node.js `pdf-parse` + `mammoth`; Tauri uses `pdfjs-dist` WASM + mammoth browser build via `src/lib/document-browser.ts`)
- `local-models` — Probes Ollama (port 11434) + LM Studio (port 1234)
- `runs` / `runs/[id]` / `results` — CRUD for run history

### Database Schema (Prisma)

Models: `Session`, `Run`, `RunResult`, `LogEntry`, `ProviderSetting`, `ConfiguredProvider`, `SystemPromptOverride`. Schema at `prisma/schema.prisma`.

### Page Structure

Each tool is a page at `src/app/<tool-name>/page.tsx`. Pages are `"use client"` components that use the Zustand store for provider config and `p-limit` for concurrency control (governed by `systemSettings.maxConcurrency`).

12 tool pages: `abstract-screener`, `ai-coder`, `automator`, `codebook-generator`, `consensus-coder`, `generate`, `model-comparison`, `process-documents`, `qualitative-coder`, `transform` + `settings` and `history` (with `history/[id]` dynamic route).

### Shared Hooks (`src/hooks/`)

| Hook | Purpose |
|---|---|
| `useBatchProcessor` | Reusable parallel batch LLM processing with progress, abort, stats, and run history logging. Used by most tool pages. |
| `useColumnSelection` | Manages which CSV columns are selected for processing. |
| `usePersistedPrompt` | Persists a prompt textarea to localStorage with a given key. |

### Shared Tool Components (`src/components/tools/`)

| Component | Purpose |
|---|---|
| `UploadPreview` | CSV/XLSX file upload + data preview table, with optional sample dataset picker |
| `ColumnSelector` | Checkbox grid for selecting which columns to process |
| `ExecutionPanel` | Preview/Test/Full run buttons + progress bar (wraps `useBatchProcessor` UI) |
| `ResultsPanel` | DataTable for batch results + export buttons + run history link |
| `NoModelWarning` | Inline warning when no LLM provider is configured |
| `PromptEditor` | Textarea with prompt persistence and reset-to-default |
| `DataTable` | Sortable/filterable table for displaying Row[] data |
| `FileUploader` | Drag-and-drop file upload zone |

UI primitives from shadcn/ui in `src/components/ui/`.

### AI Coder Architecture

AI Coder (`src/app/ai-coder/`) is the most complex tool page. Unlike other tools that use batch-only processing, AI Coder has an **interactive row-by-row coding interface** with optional batch processing:

- **page.tsx** — Main page with 6 sections: Upload, Columns, Codebook, AI Instructions, Code Data (interactive), Export Results. Does NOT use `useBatchProcessor` — implements its own inline batch loop.
- **AnalyticsDialog.tsx** — Near-full-screen dialog showing code frequency, AI vs human agreement (precision/recall), and disagreement list. Uses `codingData` (human codes) and `aiData` (AI suggestions) for metrics.
- **ReviewPanel.tsx** — Row-by-row review panel for correcting AI batch results. Exports `CodeEntry` type used across all AI Coder components.

Key state in page.tsx:
- `codingData: Record<number, string[]>` — Human-applied codes per row index
- `aiData: Record<number, AISuggestion>` — AI suggestions per row (codes + confidence + reasoning)
- `codebook: CodeEntry[]` — Code definitions (code, description, highlights) — replaces the old `codes: string[]`
- `settings: AICSettings` — 6 UI settings (contextRows, autoAdvance, lightMode, horizontalCodes, buttonsAboveText, autoAcceptThreshold)

localStorage keys: `aic_autosave` (session recovery), `aic_settings` (UI settings), `aic_named_sessions` (saved sessions), `handai_codebook_aicoder` (codebook persistence).

6 sample datasets are available in `src/lib/sample-data.ts` (product reviews, healthcare interviews, support tickets, learning experiences, exit interviews, stakeholder feedback) — all tools can use these for testing without requiring file uploads.

### Conventions

- All fetch calls must check `if (!res.ok) throw new Error(...)` before `res.json()`
- Concurrency is controlled globally via `pLimit(systemSettings.maxConcurrency)`, not per-page state
- `@/*` path alias maps to `./src/*`
- API keys are stored in browser localStorage (Zustand persist), never in `.env` for local dev
- `db-tauri.ts` has pre-existing TS errors (Tauri types only resolve in Tauri build context) — this is expected
- Tauri runtime detection: `typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window`
- 10 LLM providers supported: OpenAI, Anthropic, Google, Groq, Together, Azure, OpenRouter, Ollama, LM Studio, Custom — all configured via `src/lib/store.ts`
- Each tool page mirrors its API route in `src/lib/llm-browser.ts` for Tauri (e.g., `processRowDirect()` mirrors `/api/process-row`)
- Validate all API route inputs with Zod schemas from `src/lib/validation.ts` — add a new schema there when adding a new route
- The `build:tauri` script uses bash `trap` to temporarily move `src/app/api/` and `src/app/history/[id]/page.tsx` out of the source tree during static export, then restores them
- When adding a new tool page: create `src/app/<tool-name>/page.tsx` as a `"use client"` component, add its API route in `src/app/api/`, add a matching browser-side function in `src/lib/llm-browser.ts`, and add navigation entry in `src/components/AppSidebar.tsx`
- DB logging is async and non-blocking — a Prisma/SQLite failure must never mask a successful LLM result
- Worker failures are isolated with `Promise.allSettled` (consensus workers, comparison workers) — one failing model must not abort others
- All localStorage reads must happen inside `useEffect(() => {}, [])` to avoid SSR/hydration mismatches
- TypeScript strict mode is enforced — builds must produce 0 new TS errors (pre-existing `db-tauri.ts` errors are the exception)
