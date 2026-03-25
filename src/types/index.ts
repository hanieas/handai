// Shared TypeScript interfaces for Handai

export type Row = Record<string, string | number | boolean | null>;

export interface ProviderConfig {
  providerId: string;
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
  isEnabled: boolean;
  isLocal?: boolean;
}

export interface RunMeta {
  id: string;
  sessionId: string;
  runType: string;
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  inputFile: string;
  inputRows: number;
  status: string;
  startedAt: string;
  completedAt?: string;
  successCount: number;
  errorCount: number;
  avgLatency: number;
  _count?: { results: number };
}

export interface RunResult {
  id: string;
  runId: string;
  rowIndex: number;
  inputJson: string;
  output: string;
  status: string;
  latency: number;
  errorType?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface WorkerConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface JudgeConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface WorkerResult {
  id: string;
  output: string;
  latency: number;
}

export interface ConsensusResult {
  workerResults: WorkerResult[];
  judgeOutput: string;
  judgeLatency: number;
  consensusType: string;
  kappa: number;
  kappaLabel: string;
  agreementMatrix: AgreementMatrix;
}

export interface AgreementMatrix {
  labels: string[];
  values: number[][];
  pairLabels: string[];
  pairAgreements: number[];
}

export interface CodebookCode {
  id: string;
  name: string;
  definition: string;
  examples: string[];
  category?: string;
}

export interface CodingSession {
  data: Row[];
  codes: string[];
  codingData: Record<number, string[]>;
  currentIndex: number;
  runId?: string;
  dataName?: string;
}

export interface SampleDataset {
  name: string;
  description: string;
  data: Row[];
}

export interface Step {
  name: string;
  task: string;
  input_fields: string[];
  output_fields: OutputField[];
}

export interface OutputField {
  name: string;
  type: string;
  constraints?: string;
}

export interface GenerateColumn {
  name: string;
  type: "text" | "number" | "boolean" | "list";
  description?: string;
}

/** A single field definition in a document extraction schema. */
export interface FieldDef {
  name: string;         // snake_case identifier, e.g. "author_name"
  type: "text" | "number" | "date" | "boolean" | "list";
  description: string;  // LLM hint, e.g. "Full name of the primary author"
}

/** Per-file processing status during a document extraction batch. */
export type FileStatus = "pending" | "extracting" | "analyzing" | "done" | "error";

/** State for a single file in the process-documents queue. */
export interface FileState {
  file: File;
  status: FileStatus;
  error?: string;
  truncated?: boolean;
  charCount?: number;
  records?: Record<string, unknown>[];
}

export interface ModelEntry {
  id: string;
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
}

export interface ComparisonResult {
  id: string;
  output: string;
  latency?: number;
  success: boolean;
}

export interface SystemSettings {
  temperature: number;
  maxTokens: number | null;
  maxConcurrency: number;
  autoRetry: boolean;
  autoSavePath: string;
}

/** Standardized result entry for run history persistence. */
export interface ResultEntry {
  rowIndex: number;
  input: Record<string, unknown>;
  output: string | Record<string, unknown>;
  status?: string;
  latency?: number;
  errorType?: string;
  errorMessage?: string;
}
