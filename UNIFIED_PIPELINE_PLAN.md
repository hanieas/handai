# Unified Pipeline Plan for Handai

> Generated 2026-03-18 — Architecture proposal for standardizing the 10 tool pages.
> This is a proposal only. No code changes have been made.

---

## Part 1: Current Discrepancies

| Area | What's Inconsistent | Tools Affected |
|------|---------------------|----------------|
| **Upload banner** | Identical green success banner copy-pasted | 8 tools |
| **Column selection** | Same checkbox grid duplicated with minor label differences | 6 tools |
| **Prompt persistence** | Transform + Qual Coder save to localStorage; Consensus, Model Comparison, Generate do NOT | 5 tools missing persistence |
| **ETA calculation** | Only Transform has ETA; other tools just show counter | 6 tools missing ETA |
| **Progress bar color** | Blue, violet, indigo, purple — arbitrary per tool | 7 tools |
| **Tauri/web branching** | Same `isTauri ? directCall() : fetch("/api/...")` pattern duplicated per tool | All 10 tools |
| **Run creation** | Same `isTauri ? createRun({...}) : fetch("/api/runs", {...})` duplicated | 8 tools |
| **Export** | Some use `downloadCSV()` from export.ts, some inline their own CSV builder | 5 tools |
| **Abort mechanism** | `abortRef.current = true` — identical pattern, not cancelling in-flight requests | 7 tools |
| **No-model warning** | Same amber warning banner duplicated | 8 tools |

---

## Part 2: The 5 Common Pipeline Stages

Every batch-processing tool in Handai follows these 5 stages (with tool-specific variations):

### Stage 1 — Data Upload & Preview
- FileUploader (drag-drop, CSV/XLSX/JSON/RIS)
- SampleDatasetPicker dropdown
- Green success banner ("N rows loaded from filename")
- DataTable preview (first 5 rows)

### Stage 2 — Column / Schema Definition
- Checkbox grid of available columns
- "Select all / Deselect all" toggle
- "N of M columns selected" counter

### Stage 3 — Instruction / Prompt Input
- Textarea for system prompt / instructions
- Example prompts dropdown
- localStorage persistence (mount-safe read/write)
- Amber "No AI model configured" warning banner

### Stage 4 — Batch Processing & Execution
- Preview (3 rows) / Test (10 rows) / Full Run buttons
- pLimit concurrency control (systemSettings.maxConcurrency)
- Progress bar + counter (completed / total)
- ETA countdown
- Stop button (abort mechanism)
- Tauri/web branching for API dispatch
- Run record creation + result saving

### Stage 5 — Results Display & Export
- Stats banner (success count, error count, avg latency)
- DataTable with full results
- Export CSV button
- "View in History" link

---

## Part 3: Per-Tool Pipeline Shape

### 1. Transform Data

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
       + Row Filter & Select ........ CUSTOM (filterCol/filterOp/filterVal UI)
Stage 3: Prompt Input ............... SHARED (PromptEditor + example prompts + localStorage)
Stage 4: Execute .................... SHARED (ExecutionPanel: Preview/Test/Full + useBatchProcessor)
         processRow: build col:value pairs → dispatchProcessRow
Stage 5: Results .................... SHARED (ResultsPanel)
       + Re-transform button ........ CUSTOM (headerActions slot)
```
**Custom code remaining:** ~50 lines (row filter UI + re-transform logic)

---

### 2. Qualitative Coder

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
       + Sample codebook cards ....... CUSTOM (children slot)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
Stage 3: Prompt Input ............... SHARED (PromptEditor + example prompts + localStorage)
       + Codebook editor table ....... CUSTOM (code/description/example rows, CSV import/export)
       + Inject codebook toggle ...... CUSTOM (buildPrompt() appends codebook to prompt)
Stage 4: Execute .................... SHARED (ExecutionPanel: Preview/Test/Full + useBatchProcessor)
         processRow: dispatchProcessRow with buildPrompt() result
Stage 5: Results .................... SHARED (ResultsPanel)
```
**Custom code remaining:** ~115 lines (codebook editor + CSV import/export + buildPrompt + sample codebooks)

---

### 3. Consensus Coder

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
Stage 3: Prompt Input ............... SHARED (2x PromptEditor: worker + judge prompts)
       + Worker/Judge model config ... CUSTOM (WorkerCard component, multi-provider selection)
       + Toggle options .............. CUSTOM (quality scoring, disagreement analysis, worker 3)
Stage 4: Execute .................... SHARED (ExecutionPanel: Preview/Test/Full + useBatchProcessor)
         processRow: dispatchConsensusRow with workers array + judge config
Stage 5: Results .................... SHARED (ResultsPanel)
       + Kappa / agreement stats ..... CUSTOM (children slot)
```
**Custom code remaining:** ~130 lines (WorkerCard, worker/judge model selection, kappa display, preset prompts)

---

### 4. Model Comparison

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
Stage 3: Prompt Input ............... SHARED (PromptEditor, no examples)
       + Multi-provider selector ..... CUSTOM (checkbox grid to pick 2+ providers)
Stage 4: Execute .................... SHARED (ExecutionPanel: Preview/Test/Full + useBatchProcessor)
         processRow: dispatchComparisonRow with selected models array
Stage 5: Results .................... SHARED (ResultsPanel — per-model columns appear in DataTable)
```
**Custom code remaining:** ~40 lines (provider multi-select with API key filtering)

---

### 5. Automator (General Automator)

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
Stage 2: Column Selection ........... SHARED (ColumnSelector used per-step inside step builder)
       + Step builder UI ............. CUSTOM (step name, task textarea, input/output fields,
                                              add/remove/reorder, field inheritance between steps)
Stage 3: Prompt Input ............... CUSTOM (each step has inline task description, not a global prompt)
         Step persistence ........... CUSTOM (localStorage: handai_steps_automator)
Stage 4: Execute .................... SHARED (ExecutionPanel: Preview/Test/Full + useBatchProcessor)
         processRow: dispatchAutomatorRow with steps array
       + Output=input warning ........ CUSTOM
Stage 5: Results .................... SHARED (ResultsPanel)
```
**Custom code remaining:** ~150 lines (step builder UI, step persistence, field inheritance)

---

### 6. Codebook Generator

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
Stage 3: Prompt Input ............... NOT USED (prompts hardcoded from registry)
       + useAllRows toggle .......... CUSTOM
Stage 4: Execute .................... SHARED (ExecutionPanel with customButtons)
       + Two-phase execution ......... CUSTOM (Quick Discovery / Full Generation)
       + Phase A review UI ........... CUSTOM (editable theme cards, remove/rename before continuing)
       + 3-stage pipeline logic ...... CUSTOM (discovery → consolidation → definition)
Stage 5: Results .................... CUSTOM (markdown viewer, structured codebook, export MD/JSON)
```
**Custom code remaining:** ~170 lines (stage logic, Phase A review, codebook display, MD/JSON export)

---

### 7. Generate Data

```
Stage 1: Upload & Preview ........... NOT USED (no data upload)
       + Template file/CSV paste ..... CUSTOM (optional column schema import)
Stage 2: Column Selection ........... NOT USED — defines new columns instead
       + 3-mode column definition .... CUSTOM (AI Suggest / Manual / Suggested checklist)
Stage 3: Prompt Input ............... SHARED (PromptEditor with label="Dataset Description")
       + Row count slider ........... CUSTOM
       + Temperature slider ......... CUSTOM
       + Output format toggle ....... CUSTOM (tabular/JSON/freetext)
Stage 4: Execute .................... SHARED (ExecutionPanel variant="single", label="Generate")
         Single call: dispatchGenerateRow (no per-row concurrency)
Stage 5: Results .................... SHARED (ResultsPanel)
       + Raw text/JSON download ...... CUSTOM (when outputFormat != tabular)
```
**Custom code remaining:** ~280 lines (column definition 3-mode UI, AI suggestion flow, template import, controls)

---

### 8. AI Coder

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview for initial load)
       + Session recovery banner ..... CUSTOM (aic_autosave / aic_autosave_prev)
Stage 2: Column Selection ........... SHARED (ColumnSelector)
Stage 3: Prompt Input ............... CUSTOM (inline codebook editor with color palette)
Stage 4: Execute .................... CUSTOM (row-by-row interactive: AI suggests, user accepts/overrides)
         Uses dispatchProcessRow internally (from llm-dispatch.ts)
Stage 5: Results .................... CUSTOM (card-based coding UI, human vs AI columns, inline editing)
```
**Custom code remaining:** ~500+ lines (interactive coding interface is fundamentally unique)
**Shared utilities adopted:** `dispatchProcessRow` from llm-dispatch.ts, `usePersistedPrompt`

---

### 9. Abstract Screener

```
Stage 1: Upload & Preview ........... SHARED (UploadPreview for initial load)
       + Session recovery banner ..... CUSTOM (as_autosave, named sessions)
Stage 2: Column Selection ........... CUSTOM (column mapper: title/abstract/keywords/journal roles)
Stage 3: Prompt Input ............... SHARED (PromptEditor with label="Screening Criteria")
       + Word highlighter config ..... CUSTOM (include/exclude word lists)
Stage 4: Execute .................... CUSTOM (row-by-row manual: Include/Exclude/Maybe per abstract)
         Uses dispatchProcessRow internally (from llm-dispatch.ts)
Stage 5: Results .................... CUSTOM (screening summary, decision counts, word highlighting)
```
**Custom code remaining:** ~500+ lines (interactive screening interface is fundamentally unique)
**Shared utilities adopted:** `dispatchProcessRow` from llm-dispatch.ts, `usePersistedPrompt`

---

### 10. Process Documents

```
Stage 1: Upload & Preview ........... CUSTOM (drag-drop + folder picker, file type toggles, file status table)
Stage 2: Column Selection ........... CUSTOM (FieldEditor: quick-add syntax, advanced mode, templates, AI Suggest)
Stage 3: Prompt Input ............... NOT USED (prompts from registry with schema injection)
       + Template preset save/load ... CUSTOM (localStorage)
Stage 4: Execute .................... SHARED (ExecutionPanel variant="single", label="Extract All")
         processRow: dispatchDocumentExtract per file (via useBatchProcessor)
Stage 5: Results .................... SHARED (ResultsPanel per-file + combined)
       + Per-file result tables ...... CUSTOM
       + Combined export option ...... CUSTOM
```
**Custom code remaining:** ~300 lines (file upload UI, FieldEditor, template presets, AI suggest)

---

## Part 4: Visual Summary — Shared vs Custom per Tool

```
                    Upload    Columns   Prompt    Execute   Results
                    Preview   Selector  Editor    Panel     Panel
                    ───────   ────────  ──────    ───────   ───────
Transform            [x]       [x]       [x]       [x]       [x]
Qualitative Coder    [x]+      [x]       [x]+CB    [x]       [x]
Consensus Coder      [x]       [x]       [x]x2     [x]       [x]+κ
Model Comparison     [x]       [x]       [x]       [x]       [x]
Automator            [x]       per-step  custom    [x]       [x]
Codebook Generator   [x]       [x]       —         custom    custom
Generate             —         custom    [x]       single    [x]
Process Documents    custom    custom    —         single    [x]
AI Coder             [x]       [x]       custom    custom    custom
Abstract Screener    [x]       custom    [x]       custom    custom

Legend:
  [x]      = uses shared component as-is
  [x]+     = shared component + tool-specific extension via children/slots
  [x]+CB   = shared + codebook editor in children slot
  [x]+κ    = shared + kappa stats in children slot
  [x]x2    = two PromptEditor instances (worker + judge)
  custom   = tool-specific implementation
  —        = stage not applicable
  single   = ExecutionPanel variant="single" (one button instead of preview/test/full)
  per-step = ColumnSelector used inside step builder
```

---

## Part 5: New Shared Files to Create

| File | Type | Purpose |
|------|------|---------|
| `src/lib/llm-dispatch.ts` | Utility | Unified Tauri/web API dispatch + run persistence |
| `src/hooks/useBatchProcessor.ts` | Hook | Concurrency, progress, abort, ETA, run lifecycle |
| `src/hooks/usePersistedPrompt.ts` | Hook | Mount-safe localStorage prompt read/write |
| `src/hooks/useColumnSelection.ts` | Hook | Column toggle/toggleAll/selectAll state |
| `src/components/tools/UploadPreview.tsx` | Component | Upload + sample picker + banner + preview table |
| `src/components/tools/ColumnSelector.tsx` | Component | Checkbox grid with select all |
| `src/components/tools/PromptEditor.tsx` | Component | Textarea + examples dropdown + persistence |
| `src/components/tools/NoModelWarning.tsx` | Component | Amber "no model configured" banner |
| `src/components/tools/ExecutionPanel.tsx` | Component | Run buttons + progress bar + ETA + stop |
| `src/components/tools/ResultsPanel.tsx` | Component | Stats + DataTable + export + history link |

---

## Part 6: Migration Order

### Phase 0 — Foundation (no UI changes, zero risk)
1. Create `src/lib/llm-dispatch.ts`
2. Create `src/hooks/usePersistedPrompt.ts`
3. Create `src/hooks/useColumnSelection.ts`
4. Add shared types to `src/types/index.ts`

### Phase 1 — Shared Components (new files only)
1. `UploadPreview.tsx`
2. `ColumnSelector.tsx`
3. `PromptEditor.tsx` + `NoModelWarning.tsx`
4. `ExecutionPanel.tsx`
5. `ResultsPanel.tsx`
6. `useBatchProcessor.ts`

### Phase 2 — Migrate Transform (proving ground)
- Rewrite `transform/page.tsx` using all shared components
- Expected: ~549 lines → ~120-150 lines

### Phase 3 — Migrate Tier 1 tools (one at a time)
1. Qualitative Coder
2. Model Comparison
3. Consensus Coder
4. Automator

### Phase 4 — Migrate Tier 2 tools
1. Codebook Generator
2. Generate
3. Process Documents

### Phase 5 — Tier 3 tools (utilities only)
1. AI Coder — adopt `llm-dispatch.ts`
2. Abstract Screener — adopt `llm-dispatch.ts` + `usePersistedPrompt`

---

## Part 7: What Does NOT Change

- All `/api/*` routes remain unchanged
- `src/lib/llm-browser.ts` remains unchanged (wrapped, not modified)
- `src/lib/db-tauri.ts` remains unchanged
- `src/components/tools/DataTable.tsx` remains unchanged
- `src/components/tools/FileUploader.tsx` remains unchanged
- `src/lib/store.ts` (Zustand) remains unchanged
- All tool-specific features are preserved (codebook editors, step builders, etc.)
- All outputs, results, and exports are identical
- All API payloads and responses are identical

---

## Part 8: Expected Outcome

| Metric | Before | After |
|--------|--------|-------|
| Lines per Tier 1 tool page | 400-600 | 100-150 |
| Tauri/web branching locations | ~20 scattered | 1 (llm-dispatch.ts) |
| ETA calculation | Transform only | All batch tools |
| Prompt persistence | 3 tools | All tools with prompts |
| Code to add a new standard tool | ~500 lines | ~100 lines |
