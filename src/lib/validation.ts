import { z } from 'zod';

// ── Shared sub-schemas ─────────────────────────────────────────────────────────

const ProviderFieldsLocal = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(''),
  baseUrl: z.string().optional(),
});

// ── /api/process-row ──────────────────────────────────────────────────────────
export const ProcessRowSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
  systemPrompt: z.string(),
  userContent: z.string(),
  rowIdx: z.number().int().optional(),
  runId: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

// ── /api/consensus-row ────────────────────────────────────────────────────────
export const ConsensusRowSchema = z.object({
  workers: z.array(ProviderFieldsLocal).min(2),
  judge: ProviderFieldsLocal,
  workerPrompt: z.string(),
  judgePrompt: z.string(),
  userContent: z.string(),
  rowIdx: z.number().int().optional(),
  runId: z.string().optional(),
  enableQualityScoring: z.boolean().optional(),
  enableDisagreementAnalysis: z.boolean().optional(),
});

// ── /api/comparison-row ───────────────────────────────────────────────────────
export const ComparisonRowSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      provider: z.string().min(1),
      model: z.string().min(1),
      apiKey: z.string().default(""),
      baseUrl: z.string().optional(),
    })
  ).min(2),
  systemPrompt: z.string(),
  userContent: z.string(),
  temperature: z.number().min(0).max(2).optional(),
});

// ── /api/automator-row ────────────────────────────────────────────────────────
export const AutomatorRowSchema = z.object({
  row: z.record(z.string(), z.unknown()),
  steps: z.array(
    z.object({
      name: z.string(),
      task: z.string(),
      input_fields: z.array(z.string()),
      output_fields: z.array(
        z.object({
          name: z.string(),
          type: z.string(),
          constraints: z.string().optional(),
        })
      ),
    })
  ).min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
});

// ── /api/generate-row ─────────────────────────────────────────────────────────
export const GenerateRowSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
  rowCount: z.number().int().min(1).max(500),
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['text', 'number', 'boolean', 'list']),
      description: z.string().optional(),
    })
  ).optional(),
  freeformPrompt: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

// ── Document shared sub-schemas ───────────────────────────────────────────────

const FieldDefSchema = z.object({
  name: z.string(),
  type: z.enum(['text', 'number', 'date', 'boolean', 'list']),
  description: z.string(),
});

const DocumentFileTypeEnum = z.enum(['pdf', 'docx', 'excel', 'txt', 'md', 'json', 'html', 'csv']);

// ── /api/document-extract ─────────────────────────────────────────────────────
export const DocumentExtractSchema = z.object({
  fileContent: z.string().min(1),
  fileType: DocumentFileTypeEnum,
  fileName: z.string().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
  systemPrompt: z.string().optional(),
  fields: z.array(FieldDefSchema).optional(),
});

// ── /api/document-analyze ─────────────────────────────────────────────────────
export const DocumentAnalyzeSchema = z.object({
  fileContent: z.string().min(1),
  fileType: DocumentFileTypeEnum,
  fileName: z.string().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().default(""),
  baseUrl: z.string().optional(),
  hint: z.string().optional(),
});

// ── /api/runs POST ────────────────────────────────────────────────────────────
export const RunCreateSchema = z.object({
  sessionId: z.string().optional(),
  runType: z.string().default('full'),
  provider: z.string().default('openai'),
  model: z.string().default('unknown'),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  schemaJson: z.string().optional(),
  variablesJson: z.string().optional(),
  inputFile: z.string().default('unnamed'),
  inputRows: z.number().int().min(0).default(0),
  jsonMode: z.boolean().optional(),
  maxConcurrency: z.number().int().positive().optional(),
  config: z.string().optional(),
});

// ── /api/results POST ─────────────────────────────────────────────────────────
export const ResultsBatchSchema = z.object({
  runId: z.string().min(1),
  results: z.array(
    z.object({
      rowIndex: z.number().int(),
      input: z.record(z.string(), z.unknown()),
      output: z.union([z.string(), z.record(z.string(), z.unknown())]),
      status: z.string().default('success'),
      latency: z.number().optional(),
      errorType: z.string().optional(),
      errorMessage: z.string().optional(),
    })
  ),
});
