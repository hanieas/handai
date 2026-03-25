"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { Plus, Minus, Trash2, Upload, Save, FolderOpen, BarChart2, Download, Check, Loader2, X, ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import pLimit from "p-limit";

import { usePersistedPrompt } from "@/hooks/usePersistedPrompt";
import { useColumnSelection } from "@/hooks/useColumnSelection";
import { dispatchProcessRow, dispatchCreateRun, dispatchSaveResults, type ResultEntry } from "@/lib/llm-dispatch";

import { UploadPreview } from "@/components/tools/UploadPreview";
import { ColumnSelector } from "@/components/tools/ColumnSelector";
import { NoModelWarning } from "@/components/tools/NoModelWarning";

import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { downloadCSV as downloadCSVFile, downloadXLSX } from "@/lib/export";
import { AnalyticsDialog } from "./AnalyticsDialog";
import type { CodeEntry } from "./ReviewPanel";

type Row = Record<string, unknown>;

// ─── Color palette for code buttons ─────────────────────────────────────────
const CODE_COLORS = [
  "#f97316", "#8b5cf6", "#06b6d4", "#ec4899",
  "#22c55e", "#eab308", "#3b82f6", "#ef4444",
  "#14b8a6", "#a855f7", "#f59e0b", "#6366f1",
];

function codeColor(code: string, allCodes: string[]): string {
  const idx = allCodes.indexOf(code);
  return CODE_COLORS[idx >= 0 ? idx % CODE_COLORS.length : 0];
}

// ─── Settings type ───────────────────────────────────────────────────────────
interface AICSettings {
  contextRows: number;
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalCodes: boolean;
  buttonsAboveText: boolean;
  autoAcceptThreshold: number;
}

const DEFAULT_SETTINGS: AICSettings = {
  contextRows: 2,
  autoAdvance: false,
  lightMode: true,
  horizontalCodes: true,
  buttonsAboveText: false,
  autoAcceptThreshold: 0.9,
};

// ─── AI suggestion type ─────────────────────────────────────────────────────
interface AISuggestion {
  codes: string[];
  confidence: Record<string, number>;
  reasoning?: string;
}

// ─── Storage keys ────────────────────────────────────────────────────────────
const CODEBOOK_KEY = "handai_codebook_aicoder";
const SESSIONS_KEY = "aic_named_sessions";
const AUTOSAVE_KEY = "aic_autosave";
const SETTINGS_KEY = "aic_settings";

// ─── Default prompt ──────────────────────────────────────────────────────────
const DEFAULT_PROMPT = `Analyze the provided data and assign qualitative codes.

Instructions:
- Read the text carefully
- For EVERY code in the codebook, estimate the probability (0-100) that it applies
- Return a JSON object mapping each code label to its probability
- Example: {"Burnout": 80, "Resilience": 10, "Team Support": 5, "Other": 5}
- All probabilities must sum to 100
- If no codes apply well, distribute low values

Respond with ONLY the JSON object. Nothing else.`;

// ─── Sample codebooks (with highlights) ──────────────────────────────────────
type SampleCodeEntry = Omit<CodeEntry, "id">;

const SAMPLE_CODEBOOKS: Record<string, SampleCodeEntry[]> = {
  product_reviews: [
    { code: "Positive", description: "Satisfaction, praise, or happiness", highlights: "love,great,excellent,amazing,best" },
    { code: "Negative", description: "Dissatisfaction or criticism", highlights: "terrible,worst,awful,hate,disappointing" },
    { code: "Neutral / Mixed", description: "Balanced or ambivalent views", highlights: "" },
    { code: "Quality Issue", description: "Defects, durability problems, or poor construction", highlights: "broke,defective,cheap,flimsy" },
    { code: "Shipping / Packaging", description: "Delivery delays, damaged packaging", highlights: "shipping,delivery,arrived,package" },
    { code: "Value for Money", description: "Price relative to quality", highlights: "price,expensive,overpriced,worth,cheap" },
  ],
  healthcare_interviews: [
    { code: "Burnout", description: "Emotional, physical, or mental exhaustion", highlights: "exhausted,burned,tired,overwhelmed,drained" },
    { code: "Resilience", description: "Capacity to cope with stress or persevere", highlights: "resilient,cope,strength,adapt,persevere" },
    { code: "Team Support", description: "Positive collegial relationships", highlights: "team,colleagues,support,together" },
    { code: "Resource Shortage", description: "Understaffing, overwork, inadequate tools", highlights: "understaffed,shortage,overworked,underpaid" },
    { code: "Administrative Burden", description: "Paperwork, bureaucracy", highlights: "paperwork,admin,bureaucracy,documentation" },
    { code: "Work-Life Impact", description: "Effects on personal life or relationships", highlights: "family,personal,relationship,sleep" },
  ],
  support_tickets: [
    { code: "Bug Report", description: "Software defects or crashes", highlights: "crash,bug,error,broken,freeze" },
    { code: "Feature Request", description: "New functionality requests", highlights: "would love,wish,feature,add,need" },
    { code: "Billing Issue", description: "Charges, invoices, or refund requests", highlights: "charge,invoice,refund,billing,payment" },
    { code: "Access / Login", description: "Authentication or permissions issues", highlights: "login,password,access,locked,authenticate" },
    { code: "Performance", description: "Slowness or system degradation", highlights: "slow,timeout,loading,performance,lag" },
    { code: "Critical / Blocking", description: "Issues preventing business operations", highlights: "blocking,critical,urgent,emergency,down" },
  ],
  learning_experience: [
    { code: "Positive Experience", description: "Satisfaction with online learning", highlights: "great,enjoy,love,flexible,convenient" },
    { code: "Negative Experience", description: "Frustration with the online format", highlights: "frustrating,difficult,hate,struggle" },
    { code: "Technical Issue", description: "Platform or connectivity problems", highlights: "crash,internet,audio,video,platform" },
    { code: "Social Isolation", description: "Disconnection or loneliness", highlights: "isolated,lonely,miss,disconnect" },
    { code: "Engagement", description: "Motivation and participation quality", highlights: "engaged,motivated,participate,interact" },
    { code: "Flexibility", description: "Self-paced or asynchronous learning", highlights: "pace,flexible,schedule,time,convenient" },
  ],
  exit_interviews: [
    { code: "Compensation", description: "Salary or benefits dissatisfaction", highlights: "salary,pay,compensation,benefits,underpaid" },
    { code: "Career Growth", description: "Lack of advancement opportunities", highlights: "promotion,growth,career,advancement,stagnant" },
    { code: "Management", description: "Poor leadership or communication", highlights: "manager,leadership,micromanage,communication" },
    { code: "Work-Life Balance", description: "Excessive hours or difficulty balancing", highlights: "hours,overtime,balance,weekend,burnout" },
    { code: "Culture", description: "Workplace environment or values", highlights: "culture,toxic,political,environment,values" },
    { code: "Relocation", description: "Geographic reasons for leaving", highlights: "move,relocate,commute,city" },
  ],
  mixed_feedback: [
    { code: "Positive", description: "Favorable impressions or praise", highlights: "great,impressive,excellent,love" },
    { code: "Negative", description: "Unfavorable impressions", highlights: "disappointing,poor,terrible,bad" },
    { code: "Neutral", description: "Balanced or uncommitted", highlights: "" },
    { code: "Detailed", description: "Specific reasoning or examples", highlights: "because,specifically,example,reason" },
    { code: "Brief", description: "Short responses without elaboration", highlights: "" },
  ],
};

const SAMPLE_PROMPTS: Record<string, string> = {
  product_reviews: `Analyze this product review and assign qualitative codes from the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  healthcare_interviews: `Analyze this healthcare worker interview excerpt and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  support_tickets: `Classify this customer support ticket using the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  learning_experience: `Analyze this student response about online learning and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  exit_interviews: `Analyze this employee exit interview response and assign qualitative codes.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
  mixed_feedback: `Classify this feedback using the codebook.\n\n- For EVERY code, estimate the probability (0-100) that it applies\n- Return a JSON object mapping each code to its probability\n- All probabilities must sum to 100\n\nRespond with ONLY the JSON object. Nothing else.`,
};

// ─── Session types ───────────────────────────────────────────────────────────
interface AICSession {
  name: string;
  savedAt: string;
  data: Row[];
  codebook: CodeEntry[];
  selectedCols: string[];
  results: Row[];
  overrides: Record<number, string[]>;
  dataName: string;
  systemPrompt: string;
  codingData?: Record<number, string[]>;
  aiData?: Record<number, AISuggestion>;
  currentIndex?: number;
}

// Old session format for migration
interface OldAICSession {
  name: string;
  savedAt: string;
  data: Row[];
  codes?: string[];
  highlights?: Record<string, string>;
  codingData?: Record<number, string[]>;
  aiData?: Record<number, unknown>;
  currentIndex?: number;
  textCols?: string[];
  dataName?: string;
  codebook?: CodeEntry[];
}

function listSessions(): AICSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OldAICSession[];
    return parsed
      .map(migrateSession)
      .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
  } catch { return []; }
}

function migrateSession(s: OldAICSession): AICSession {
  if (s.codebook && Array.isArray(s.codebook)) {
    return s as unknown as AICSession;
  }
  const codes = s.codes ?? [];
  const highlights = s.highlights ?? {};
  const codebook: CodeEntry[] = codes.map((code) => ({
    id: crypto.randomUUID(),
    code,
    description: "",
    highlights: highlights[code] ?? "",
  }));
  return {
    name: s.name,
    savedAt: s.savedAt,
    data: s.data,
    codebook,
    selectedCols: s.textCols ?? [],
    results: [],
    overrides: s.codingData ?? {},
    dataName: s.dataName ?? "",
    systemPrompt: "",
  };
}

function upsertSession(s: AICSession) {
  const all = listSessions();
  const i = all.findIndex((x) => x.name === s.name);
  if (i >= 0) all[i] = s; else all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

function deleteStoredSession(name: string) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(listSessions().filter((s) => s.name !== name)));
}

// ─── CSV parsing ─────────────────────────────────────────────────────────────
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { result.push(current); current = ""; }
      else { current += ch; }
    }
  }
  result.push(current);
  return result;
}

// ─── Text highlighting ──────────────────────────────────────────────────────
function highlightText(text: string, keywords: string[], color: string): string {
  if (!keywords.length) return text;
  const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  return text.replace(regex, `<mark style="background:${color}40;border-bottom:2px solid ${color};padding:0 1px;border-radius:2px">$1</mark>`);
}

function applyAllHighlights(text: string, codes: string[], highlightsMap: Record<string, string>): string {
  let result = text;
  codes.forEach((code) => {
    const kwStr = highlightsMap[code];
    if (!kwStr) return;
    const keywords = kwStr.split(",").map((k) => k.trim()).filter(Boolean);
    const color = codeColor(code, codes);
    result = highlightText(result, keywords, color);
  });
  return result;
}

// ─── AI response parser ──────────────────────────────────────────────────────
function parseAIResponse(output: string): { codes: string[]; confidence: Record<string, number> } {
  let confidence: Record<string, number> = {};
  try {
    const jsonStr = output.replace(/^```json?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(jsonStr);
    if (typeof parsed === "object" && parsed !== null) {
      // Strip descriptions from keys (LLMs sometimes return "Code — Description")
      const raw = parsed as Record<string, number>;
      for (const [key, val] of Object.entries(raw)) {
        const cleanKey = key.split(/\s*[—–]\s/)[0].trim();
        confidence[cleanKey] = (confidence[cleanKey] ?? 0) + (typeof val === "number" ? val : 0);
      }
    }
  } catch {
    // Fallback: comma-separated codes (backward compat)
    const fallback = output.split(",").map((s) => s.trim()).filter((s) => s && s !== "Uncoded");
    fallback.forEach((c) => { confidence[c] = 80; });
  }
  // Normalize to sum = 100
  const total = Object.values(confidence).reduce((s, v) => s + v, 0);
  if (total > 0) {
    Object.keys(confidence).forEach((k) => { confidence[k] = (confidence[k] / total) * 100; });
  }
  // Codes sorted by probability descending, filter > 0
  const codes = Object.entries(confidence)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
  return { codes, confidence };
}

// ─── Export functions ─────────────────────────────────────────────────────────
function exportCSV(
  data: Row[],
  codes: string[],
  codingData: Record<number, string[]>,
  aiData: Record<number, AISuggestion>,
  mode: "standard" | "onehot" | "withAI",
  dataName: string
) {
  const rows: Record<string, unknown>[] = data.map((row, i) => {
    const humanCodes = codingData[i] ?? [];
    const ai = aiData[i];

    if (mode === "standard") {
      return { ...row, codes: humanCodes.join("; ") };
    }
    if (mode === "onehot") {
      const oneHot: Record<string, unknown> = { ...row };
      codes.forEach((c) => { oneHot[c] = humanCodes.includes(c) ? 1 : 0; });
      return oneHot;
    }
    // withAI — compare human codes against only the top AI code
    const aiCodes = ai?.codes ?? [];
    const topAiCode = aiCodes.length > 0 ? aiCodes[0] : "";
    const agree = humanCodes.length > 0 && topAiCode
      ? humanCodes.includes(topAiCode)
      : false;
    return {
      ...row,
      human_codes: humanCodes.join("; "),
      ai_codes: topAiCode,
      ai_reasoning: ai?.reasoning ?? "",
      agreement: String(agree),
    };
  });

  const headers = Object.keys(rows[0] ?? {});
  const csvLines = [
    headers.map((h) => `"${h}"`).join(","),
    ...rows.map((r) =>
      headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ];
  const blob = new Blob(["\uFEFF" + csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const base = (dataName || "data").replace(/\.[^.]+$/, "");
  a.download = `${base}_${mode}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Build export row arrays ─────────────────────────────────────────────────
function buildExportRows(
  data: Row[],
  codes: string[],
  codingData: Record<number, string[]>,
  aiData: Record<number, AISuggestion>,
  mode: "standard" | "onehot" | "withAI"
): Record<string, unknown>[] {
  return data.map((row, i) => {
    const humanCodes = codingData[i] ?? [];
    const ai = aiData[i];

    if (mode === "standard") {
      return { ...row, codes: humanCodes.join("; ") };
    }
    if (mode === "onehot") {
      const oneHot: Record<string, unknown> = { ...row };
      codes.forEach((c) => { oneHot[c] = humanCodes.includes(c) ? 1 : 0; });
      return oneHot;
    }
    // withAI — compare human codes against only the top AI code
    const aiCodes = ai?.codes ?? [];
    const topAiCode = aiCodes.length > 0 ? aiCodes[0] : "";
    const agree = humanCodes.length > 0 && topAiCode
      ? humanCodes.includes(topAiCode)
      : false;
    return {
      ...row,
      human_codes: humanCodes.join("; "),
      ai_codes: topAiCode,
      ai_confidence: ai?.confidence ? JSON.stringify(ai.confidence) : "",
      agreement: String(agree),
    };
  });
}

function exportJSON(rows: Record<string, unknown>[], filename: string) {
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function AICoderPage() {
  // Data
  const [data, setData] = useState<Row[]>([]);
  const [dataName, setDataName] = useState("");

  // Codebook
  const [codebook, setCodebook] = useState<CodeEntry[]>([]);

  // Prompt
  const [systemPrompt, setSystemPrompt] = usePersistedPrompt("handai_prompt_aicoder", DEFAULT_PROMPT);
  // Columns
  const provider = useActiveModel();
  const systemSettings = useSystemSettings();
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const { selectedCols, setSelectedCols, toggleCol, toggleAll } = useColumnSelection(allColumns, false);

  // ── Coding state (restored) ──────────────────────────────────────────────
  const [currentIndex, setCurrentIndex] = useState(0);
  const [codingData, setCodingData] = useState<Record<number, string[]>>({});
  const [aiData, setAiData] = useState<Record<number, AISuggestion>>({});
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [settings, setSettings] = useState<AICSettings>(DEFAULT_SETTINGS);

  // Batch processing state
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0 });
  const [batchConcurrency, setBatchConcurrency] = useState(3);
  const batchAbortRef = useRef(false);

  // Sessions
  const [sessions, setSessions] = useState<AICSession[]>([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [sessionName, setSessionName] = useState("");

  // Analytics
  const [showAnalytics, setShowAnalytics] = useState(false);

  // Hydration
  const [isMounted, setIsMounted] = useState(false);
  const csvImportRef = useRef<HTMLInputElement>(null);

  // ── Derived values ─────────────────────────────────────────────────────────
  const codes = codebook.filter((e) => e.code.trim()).map((e) => e.code);
  const highlightsMap: Record<string, string> = {};
  codebook.forEach((e) => { if (e.highlights) highlightsMap[e.code] = e.highlights; });
  const totalRows = data.length;
  const currentRow = data[currentIndex];
  const appliedCodes = codingData[currentIndex] || [];
  const currentSuggestion = aiData[currentIndex];
  const codedCount = Object.keys(codingData).filter((k) => (codingData[+k] || []).length > 0).length;
  const aiCount = Object.keys(aiData).length;

  // ── Load settings + codebook + sessions from localStorage ────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CODEBOOK_KEY) || "[]");
      if (Array.isArray(saved) && saved.length > 0) setCodebook(saved);
    } catch {}

    try {
      const savedSettings = localStorage.getItem(SETTINGS_KEY);
      if (savedSettings) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) });
    } catch {}

    setSessions(listSessions());

    // Check autosave
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.data?.length) {
          setData(s.data);
          setDataName(s.dataName ?? "");
          setSessionName(s.sessionName ?? "");
          if (s.codebook) setCodebook(s.codebook);
          if (s.selectedCols) setSelectedCols(s.selectedCols);
          if (s.codingData) setCodingData(s.codingData);
          if (s.aiData) setAiData(s.aiData);
          if (typeof s.currentIndex === "number") setCurrentIndex(s.currentIndex);
        }
      }
    } catch {}

    setIsMounted(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist codebook
  useEffect(() => {
    if (!isMounted) return;
    localStorage.setItem(CODEBOOK_KEY, JSON.stringify(codebook));
  }, [codebook, isMounted]);

  // ── Settings persistence ────────────────────────────────────────────────
  const updateSettings = useCallback((patch: Partial<AICSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // ── Build auto instructions ─────────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a qualitative coding assistant. Apply codes to each row of the dataset.");
    lines.push("");

    lines.push("INSTRUCTIONS:");
    if (systemPrompt.trim()) {
      lines.push(systemPrompt.trim());
    }
    lines.push("- For EVERY code in the codebook, estimate the probability (0-100) that it applies");
    lines.push('- Return a JSON object mapping each code label to its probability (e.g. {"Code1": 70, "Code2": 20, "Code3": 10})');
    lines.push("- All probabilities must sum to 100");
    lines.push("- Use ONLY the exact code labels from the codebook (no descriptions)");
    lines.push("- Do not include any explanation");
    lines.push("");

    if (selectedCols.length > 0) {
      lines.push("SELECTED COLUMNS:");
      selectedCols.forEach((c) => lines.push(`- ${c}`));
      lines.push("");
    }

    const validCodes = codebook.filter((e) => e.code.trim());
    if (validCodes.length > 0) {
      lines.push("CODEBOOK:");
      validCodes.forEach((e, i) =>
        lines.push(`${i + 1}. ${e.code}${e.description ? ` — ${e.description}` : ""}`)
      );
      lines.push("");
    }
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [systemPrompt, selectedCols, codebook]);

  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── Autosave ────────────────────────────────────────────────────────────
  const doAutosave = useCallback(() => {
    if (data.length === 0) return;
    try {
      const payload = {
        data,
        dataName,
        sessionName,
        codebook,
        selectedCols,
        codingData,
        aiData,
        currentIndex,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
    } catch {}
  }, [data, dataName, sessionName, codebook, selectedCols, codingData, aiData, currentIndex]);

  useEffect(() => {
    if (!isMounted || data.length === 0) return;
    doAutosave();
  }, [data, codingData, aiData, currentIndex, isMounted]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle code on current row ──────────────────────────────────────────
  const toggleCode = useCallback((code: string) => {
    setCodingData((prev) => {
      const cur = prev[currentIndex] ?? [];
      const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
      return { ...prev, [currentIndex]: next };
    });
    if (settings.autoAdvance) {
      setTimeout(() => {
        setCurrentIndex((i) => Math.min(totalRows - 1, i + 1));
      }, 150);
    }
  }, [currentIndex, settings.autoAdvance, totalRows]);

  // ── Navigation ──────────────────────────────────────────────────────────
  const navigate = useCallback((dir: number) => {
    setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));
  }, [totalRows]);

  // ── Get AI suggestion for single row ────────────────────────────────────
  const getAiSuggestion = useCallback(async (rowIdx?: number) => {
    const idx = rowIdx ?? currentIndex;
    if (!provider) { toast.error("No model configured. Go to Settings."); return; }
    if (codes.length === 0) { toast.error("Define at least one code first"); return; }

    setIsAiLoading(true);
    try {
      const row = data[idx];
      const subset: Row = {};
      if (selectedCols.length > 0) {
        selectedCols.forEach((col) => (subset[col] = row[col]));
      } else {
        Object.assign(subset, row);
      }

      const result = await dispatchProcessRow({
        provider: provider.providerId,
        model: provider.defaultModel,
        apiKey: provider.apiKey || "",
        baseUrl: provider.baseUrl,
        systemPrompt: aiInstructions,
        userContent: JSON.stringify(subset),
        temperature: systemSettings.temperature,
      });

      const output = result.output.trim();
      const { codes: parsedCodes, confidence } = parseAIResponse(output);

      const suggestion: AISuggestion = { codes: parsedCodes, confidence, reasoning: undefined };
      setAiData((prev) => ({ ...prev, [idx]: suggestion }));
    } catch (err) {
      toast.error(`AI error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsAiLoading(false);
    }
  }, [currentIndex, provider, codes, data, selectedCols, aiInstructions, systemSettings.temperature]);

  // ── Batch AI processing ─────────────────────────────────────────────────
  const runBatch = useCallback(async () => {
    if (!provider) { toast.error("No model configured"); return; }
    if (data.length === 0) { toast.error("No data loaded"); return; }
    if (codes.length === 0) { toast.error("Define at least one code"); return; }

    batchAbortRef.current = false;
    const scrollY = window.scrollY;
    setBatchProcessing(true);
    setBatchProgress({ completed: 0, total: data.length });
    requestAnimationFrame(() => window.scrollTo(0, scrollY));

    const runId = await dispatchCreateRun({
      runType: "ai-coder",
      provider: provider.providerId,
      model: provider.defaultModel,
      temperature: systemSettings.temperature,
      systemPrompt: aiInstructions,
      inputFile: dataName || "unnamed",
      inputRows: data.length,
    });

    const limit = pLimit(batchConcurrency);
    const batchResults: Row[] = [...data];
    const newAiData: Record<number, AISuggestion> = {};

    const tasks = data.map((row, idx) =>
      limit(async () => {
        if (batchAbortRef.current) return;
        try {
          const subset: Row = {};
          if (selectedCols.length > 0) {
            selectedCols.forEach((col) => (subset[col] = row[col]));
          } else {
            Object.assign(subset, row);
          }

          const result = await dispatchProcessRow({
            provider: provider.providerId,
            model: provider.defaultModel,
            apiKey: provider.apiKey || "",
            baseUrl: provider.baseUrl,
            systemPrompt: aiInstructions,
            userContent: JSON.stringify(subset),
            temperature: systemSettings.temperature,
          });

          const output = result.output.trim();
          const { codes: parsedCodes, confidence } = parseAIResponse(output);
          newAiData[idx] = { codes: parsedCodes, confidence, reasoning: undefined };
          batchResults[idx] = { ...row, ai_codes: output, status: "success", latency_ms: result.latency };
        } catch (err) {
          batchResults[idx] = { ...row, status: "error", error_msg: String(err) };
        }
        setBatchProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.all(tasks);

    // Save results to history
    if (runId) {
      const resultEntries: ResultEntry[] = batchResults.map((r, i) => ({
        rowIndex: i,
        input: r as Record<string, unknown>,
        output: (r.ai_codes as string) ?? "",
        status: (r.status as string) ?? "success",
        latency: r.latency_ms as number | undefined,
        errorMessage: r.error_msg as string | undefined,
      }));
      await dispatchSaveResults(runId, resultEntries);
    }

    setAiData((prev) => ({ ...prev, ...newAiData }));
    setBatchProcessing(false);

    const errorCount = batchResults.filter((r) => r.status === "error").length;
    if (errorCount > 0) {
      toast.warning(`Batch done — ${errorCount} errors`);
    } else {
      toast.success(`AI suggestions ready for ${Object.keys(newAiData).length}/${data.length} rows`);
    }

    doAutosave();
  }, [provider, data, codes, selectedCols, aiInstructions, systemSettings.temperature, batchConcurrency, dataName, doAutosave]);

  // ── Get row HTML with highlighting ──────────────────────────────────────
  const getRowHtml = useCallback((row: Row, _rowIdx: number, isCurrent: boolean) => {
    const cols = selectedCols.length > 0 ? selectedCols : Object.keys(row);
    const parts = cols.map((col) => {
      const val = String(row[col] ?? "");
      if (isCurrent) {
        return applyAllHighlights(val, codes, highlightsMap);
      }
      return val.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    });
    return parts.join(" — ");
  }, [selectedCols, codes, highlightsMap]);

  // ── Keyboard handler ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); navigate(1); }
      else if (e.key === "ArrowLeft" || e.key === "h") { e.preventDefault(); navigate(-1); }
      else {
        const n = parseInt(e.key);
        if (!isNaN(n) && n >= 1 && n <= codes.length) {
          e.preventDefault();
          toggleCode(codes[n - 1]);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, toggleCode, codes]);

  // ── Data loading ────────────────────────────────────────────────────────
  const handleDataLoaded = (newData: Row[], name: string) => {
    setData(newData);
    setDataName(name);
    setCurrentIndex(0);
    setCodingData({});
    setAiData({});
    toast.success(`Loaded ${newData.length} rows from ${name}`);
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    handleDataLoaded(s.data as Row[], s.name);
    const cb = SAMPLE_CODEBOOKS[key];
    if (cb) {
      setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
    }
    const sp = SAMPLE_PROMPTS[key];
    if (sp) setSystemPrompt(sp);
  };

  // ── Codebook management ─────────────────────────────────────────────────
  const addCode = () =>
    setCodebook((prev) => [...prev, { id: crypto.randomUUID(), code: "", description: "", highlights: "" }]);

  const updateCode = (id: string, field: keyof CodeEntry, value: string) =>
    setCodebook((prev) => prev.map((e) => e.id === id ? { ...e, [field]: value } : e));

  const deleteCode = (id: string) =>
    setCodebook((prev) => prev.filter((e) => e.id !== id));

  const importCodebookCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) { toast.error("CSV must have a header row and at least one data row"); return; }
      const headers = parseCSVLine(lines[0]).map((h) => h.trim().toLowerCase());
      const codeIdx = headers.indexOf("code");
      const descIdx = headers.indexOf("description");
      const hlIdx = headers.indexOf("highlights");
      if (codeIdx === -1) { toast.error("CSV must have a 'code' column"); return; }
      const entries: CodeEntry[] = lines.slice(1).map((line) => {
        const cols = parseCSVLine(line);
        return {
          id: crypto.randomUUID(),
          code: (cols[codeIdx] ?? "").trim(),
          description: descIdx !== -1 ? (cols[descIdx] ?? "").trim() : "",
          highlights: hlIdx !== -1 ? (cols[hlIdx] ?? "").trim() : "",
        };
      }).filter((entry) => entry.code.length > 0);
      setCodebook(entries);
      toast.success(`Imported ${entries.length} codes`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const exportCodebookCSV = () => {
    if (codebook.length === 0) { toast.error("Codebook is empty"); return; }
    const rows = [
      "code,description,highlights",
      ...codebook.map((e) =>
        [`"${e.code.replace(/"/g, '""')}"`, `"${e.description.replace(/"/g, '""')}"`, `"${e.highlights.replace(/"/g, '""')}"`].join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "codebook.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Sessions ────────────────────────────────────────────────────────────
  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: AICSession = {
      name: n,
      savedAt: new Date().toISOString(),
      data,
      codebook,
      selectedCols,
      results: [],
      overrides: {},
      dataName,
      systemPrompt,
      codingData,
      aiData,
      currentIndex,
    };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: AICSession) => {
    setData(s.data);
    setCodebook(s.codebook);
    if (s.selectedCols?.length) setSelectedCols(s.selectedCols);
    if (s.systemPrompt) setSystemPrompt(s.systemPrompt);
    setDataName(s.dataName ?? "");
    setSessionName(s.name);
    setCodingData(s.codingData ?? s.overrides ?? {});
    setAiData(s.aiData ?? {});
    setCurrentIndex(s.currentIndex ?? 0);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  // ── Theme colors ────────────────────────────────────────────────────────
  const lightBg = settings.lightMode ? "#FFFEF5" : "#1a1a2e";
  const lightText = settings.lightMode ? "#1a1a1a" : "#eee";
  const ctxBg = settings.lightMode ? "#F8F9FA" : "rgba(128,128,128,0.15)";
  const ctxText = settings.lightMode ? "#555" : "#bbb";

  // ── Batch progress percentage ───────────────────────────────────────────
  const batchPct = batchProgress.total > 0 ? Math.round((batchProgress.completed / batchProgress.total) * 100) : 0;

  // ── Render ──────────────────────────────────────────────────────────────
  if (!isMounted) return null;

  return (
    <div className="space-y-0 pb-16">
      <div className="pb-4 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">AI Coder</h1>
        <p className="text-muted-foreground text-sm">AI-assisted qualitative coding with review &amp; analytics</p>
      </div>

      {/* ── Info bar ──────────────────────────────────────────────────────── */}
      {(sessionName || dataName || data.length > 0) && (
        <div className="flex items-center gap-2 pb-6 flex-wrap">
          <span className="ml-auto text-xs text-muted-foreground">
            {sessionName || dataName ? (
              <code className="text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/30 px-1.5 py-0.5 rounded">
                {sessionName || dataName}
              </code>
            ) : null}
            {data.length > 0 && <span className="ml-2">{data.length} rows</span>}
          </span>
        </div>
      )}

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <UploadPreview
          data={data}
          dataName={dataName}
          onDataLoaded={handleDataLoaded}
          samplePickerPosition="above"
          customSamplePicker={
            <Select onValueChange={loadSample}>
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_DATASETS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">
                    {SAMPLE_DATASETS[key].name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>

      <div className="border-t" />

      {/* ── 2. Define Columns ─────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">2. Define Columns</h2>
        <ColumnSelector
          allColumns={allColumns}
          selectedCols={selectedCols}
          onToggleCol={toggleCol}
          onToggleAll={toggleAll}
          description="Choose which columns contain the text to be coded."
        />
      </div>

      <div className="border-t" />

      {/* ── 3. Define Codes with Highlights ───────────────────────────────── */}
      <div className="space-y-4 py-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold">3. Define Codes</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Define your codes below. Highlight keywords are optional — used for visual emphasis during review.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={csvImportRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importCodebookCSV} />
            <Button variant="outline" size="sm" onClick={() => csvImportRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Import CSV
            </Button>
            <Button variant="outline" size="sm" disabled={codebook.length === 0} onClick={exportCodebookCSV}>
              <Upload className="h-3.5 w-3.5 mr-1.5" />Export CSV
            </Button>
            <Select onValueChange={(key) => {
              const cb = SAMPLE_CODEBOOKS[key];
              if (cb) {
                setCodebook(cb.map((e) => ({ ...e, id: crypto.randomUUID() })));
                toast.success(`Loaded "${key}" sample codebook`);
              }
            }}>
              <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Load an example..." /></SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_CODEBOOKS).map((k) => (
                  <SelectItem key={k} value={k} className="text-xs">{k.replace(/_/g, " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/20">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[20%]">Code</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[35%]">Description</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground text-xs w-[30%]">Highlight Keywords</th>
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {codebook.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-xs text-muted-foreground italic">No codes yet — click &ldquo;Add Code&rdquo; below or import a CSV file.</td></tr>
              ) : (
                codebook.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0 hover:bg-muted/10 transition-colors">
                    <td className="px-2 py-1.5"><Input value={entry.code} onChange={(e) => updateCode(entry.id, "code", e.target.value)} placeholder="Code label" className="h-7 text-sm font-medium border-0 shadow-none bg-transparent focus-visible:ring-1 px-1" /></td>
                    <td className="px-2 py-1.5"><Input value={entry.description} onChange={(e) => updateCode(entry.id, "description", e.target.value)} placeholder="What this code means…" className="h-7 text-sm border-0 shadow-none bg-transparent focus-visible:ring-1 px-1" /></td>
                    <td className="px-2 py-1.5"><Input value={entry.highlights} onChange={(e) => updateCode(entry.id, "highlights", e.target.value)} placeholder="word1, word2, phrase…" className="h-7 text-sm border-0 shadow-none bg-transparent focus-visible:ring-1 px-1" /></td>
                    <td className="px-2 py-1.5 text-center">
                      <button onClick={() => deleteCode(entry.id)} className="text-muted-foreground hover:text-destructive transition-colors p-0.5" aria-label="Delete code">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t bg-muted/5">
            <button onClick={addCode} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add Code
            </button>
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={provider} />
      </AIInstructionsSection>

      <div className="border-t" />

      {/* ── 5. Code Data ───────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Code Data</h2>

        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Upload data and define codes to start coding.</p>
        ) : codes.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Define at least one code in Section 3 to begin.</p>
        ) : (
          <>
            {/* ── Settings toggles row ──────────────────────────────────── */}
            <div className="flex items-center gap-5 flex-wrap text-sm border rounded-lg px-4 py-2.5 bg-muted/10">
              <div className="flex items-center gap-2">
                <Switch id="aic-light" checked={settings.lightMode} onCheckedChange={(v) => updateSettings({ lightMode: v })} />
                <Label htmlFor="aic-light" className="text-xs cursor-pointer">Light mode</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-horiz" checked={settings.horizontalCodes} onCheckedChange={(v) => updateSettings({ horizontalCodes: v })} />
                <Label htmlFor="aic-horiz" className="text-xs cursor-pointer">Horizontal codes</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-above" checked={settings.buttonsAboveText} onCheckedChange={(v) => updateSettings({ buttonsAboveText: v })} />
                <Label htmlFor="aic-above" className="text-xs cursor-pointer">Buttons above text</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="aic-auto" checked={settings.autoAdvance} onCheckedChange={(v) => updateSettings({ autoAdvance: v })} />
                <Label htmlFor="aic-auto" className="text-xs cursor-pointer">Auto-advance</Label>
              </div>
            </div>

            {/* ── Code buttons (above text if setting) ────────────────────── */}
            {settings.buttonsAboveText && (
              <CodeButtonsPanel
                codes={codes}
                appliedCodes={appliedCodes}
                currentSuggestion={currentSuggestion}
                horizontal={settings.horizontalCodes}
                onToggle={toggleCode}
              />
            )}

            {/* ── Text display with context rows ──────────────────────────── */}
            <div className="rounded-lg border overflow-hidden" style={{ minHeight: "280px" }}>
              {(() => {
                const contextRange: number[] = [];
                for (let i = Math.max(0, currentIndex - settings.contextRows); i <= Math.min(totalRows - 1, currentIndex + settings.contextRows); i++) {
                  contextRange.push(i);
                }
                return contextRange.map((rowIdx) => {
                  const isCurrent = rowIdx === currentIndex;
                  const row = data[rowIdx];
                  if (!row) return null;
                  return (
                    <div
                      key={rowIdx}
                      className="px-4 py-3"
                      style={isCurrent
                        ? { backgroundColor: lightBg, color: lightText, borderLeft: "4px solid #4CAF50", fontSize: "1.05em" }
                        : { backgroundColor: ctxBg, color: ctxText, borderLeft: "4px solid transparent", fontSize: "0.93em", opacity: 0.85 }}
                      dangerouslySetInnerHTML={{ __html: getRowHtml(row, rowIdx, isCurrent) }}
                    />
                  );
                });
              })()}
            </div>

            {/* ── Code buttons (below text if setting) ────────────────────── */}
            {!settings.buttonsAboveText && (
              <CodeButtonsPanel
                codes={codes}
                appliedCodes={appliedCodes}
                currentSuggestion={currentSuggestion}
                horizontal={settings.horizontalCodes}
                onToggle={toggleCode}
              />
            )}

            {/* ── AI action bar ───────────────────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
              {provider ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void getAiSuggestion()}
                  disabled={isAiLoading}
                  className="border-orange-400 text-orange-600 hover:bg-orange-50"
                >
                  {isAiLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
                  {currentSuggestion ? "Refresh AI" : "Ask AI"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  <a href="/settings" className="text-orange-500 underline">Configure model</a> for AI suggestions
                </span>
              )}
            </div>

            {/* ── Batch Processing (collapsible) ─────────────────────────── */}
            <div className="border rounded-lg overflow-hidden">
              <button
                className="w-full px-4 py-3 text-left text-sm font-medium flex items-center justify-between bg-muted/20 hover:bg-muted/30 transition-colors"
                onClick={() => setShowBatch(!showBatch)}
              >
                <span>AI Batch Processing</span>
                <span className="text-xs text-muted-foreground">{showBatch ? "▲" : "▼"}</span>
              </button>
              {showBatch && (
                <div className="p-4 space-y-3 border-t">
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">Concurrency:</span>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setBatchConcurrency((c) => Math.max(1, c - 1))}>−</Button>
                      <span className="text-sm font-mono w-6 text-center">{batchConcurrency}</span>
                      <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setBatchConcurrency((c) => Math.min(20, c + 1))}>+</Button>
                    </div>
                    {provider && (
                      <span className="text-xs text-muted-foreground">
                        Model: <span className="text-foreground">{provider.defaultModel}</span>
                      </span>
                    )}
                    {!batchProcessing && (
                      <Button
                        onClick={runBatch}
                        disabled={!provider || batchProcessing}
                        size="sm"
                        className="ml-auto bg-orange-500 hover:bg-orange-600 text-white"
                      >
                        Run AI Batch ({data.length} rows)
                      </Button>
                    )}
                  </div>
                  {batchProcessing && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Processing {batchProgress.total} rows...
                        </span>
                        <div className="flex items-center gap-2">
                          <span>{batchProgress.completed} / {batchProgress.total}</span>
                          <Button
                            size="sm" variant="outline"
                            className="h-6 px-2 text-[11px] border-red-300 text-red-600"
                            onClick={() => { batchAbortRef.current = true; }}
                          >
                            Stop
                          </Button>
                        </div>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="bg-orange-500 h-full transition-all duration-300" style={{ width: `${batchPct}%` }} />
                      </div>
                    </div>
                  )}
                  {!batchProcessing && aiCount > 0 && (
                    <p className="text-xs text-green-600">
                      ✓ AI suggestions ready for {aiCount}/{data.length} rows
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* ── Big Next button ──────────────────────────────────────────── */}
            <Button className="w-full h-10 text-base" disabled={currentIndex >= totalRows - 1} onClick={() => navigate(1)}>
              Next ▶
            </Button>

            {/* ── Navigation bar (5 elements) ────────────────────────────────── */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
              <Button variant="outline" size="sm" onClick={() => setCurrentIndex(0)} disabled={currentIndex === 0}>◀◀</Button>
              <Button variant="outline" size="sm" onClick={() => navigate(-1)} disabled={currentIndex === 0}>◀</Button>
              <div className="text-center text-sm font-medium border rounded px-3 py-1.5">
                {currentIndex + 1} / {totalRows}
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate(1)} disabled={currentIndex >= totalRows - 1}>▶</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentIndex(totalRows - 1)} disabled={currentIndex >= totalRows - 1}>▶▶</Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ← → or h/l navigate &nbsp;·&nbsp; 1–9 toggle codes
            </div>

            {/* ── Session bar (below navigation) ────────────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">Session: </span>
                <code className="text-blue-600 dark:text-blue-400 text-xs bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded">
                  {sessionName || dataName || "untitled"}
                </code>
                <span className="text-muted-foreground ml-2 text-xs">
                  ({codedCount}/{totalRows} coded · {aiCount} AI)
                </span>
              </div>
              <div className="flex gap-2 ml-auto flex-wrap">
                <Button size="sm" variant="outline" onClick={() => setShowSaveDialog((v) => !v)}>
                  <Save className="h-3.5 w-3.5 mr-1" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowSessions((v) => !v)}>
                  <FolderOpen className="h-3.5 w-3.5 mr-1" /> Load
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowTable((v) => !v)}>
                  Table
                </Button>
              </div>
            </div>

            {/* Save dialog */}
            {showSaveDialog && (
              <div className="flex gap-2 items-center p-3 bg-muted/30 rounded-lg border">
                <Input value={sessionName} onChange={(e) => setSessionName(e.target.value)}
                  placeholder="Session name..." className="h-8 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && saveSession()} autoFocus />
                <Button size="sm" onClick={() => saveSession()}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => setShowSaveDialog(false)}>Cancel</Button>
              </div>
            )}

            {/* Session browser */}
            {showSessions && (
              <div className="border border-dashed rounded-xl overflow-hidden">
                <div className="px-4 py-2 border-b text-sm font-medium">Saved Sessions</div>
                <div className="p-3 space-y-1.5 max-h-64 overflow-y-auto">
                  {sessions.length > 0 ? sessions.map((s) => {
                    const coded = Object.values(s.codingData || {}).filter((c) => c.length > 0).length;
                    return (
                      <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                        <div>
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {s.data.length} rows · {coded} coded · {new Date(s.savedAt).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => loadSession(s)}>Load</Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => { deleteStoredSession(s.name); setSessions(listSessions()); }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  }) : <p className="text-sm text-muted-foreground p-2">No saved sessions</p>}
                </div>
              </div>
            )}

            {/* Table panel */}
            {showTable && (
              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b font-medium text-sm flex items-center justify-between">
                  <span>Records</span>
                  <span className="text-xs text-muted-foreground font-normal">{totalRows} rows</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y">
                  {data.map((row, i) => {
                    const rowCodes = codingData[i] ?? [];
                    const firstCol = Object.values(row).map(String).join(" · ").slice(0, 80);
                    return (
                      <button key={i} onClick={() => { setCurrentIndex(i); setShowTable(false); }}
                        className={cn(
                          "w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3",
                          i === currentIndex && "bg-muted/50"
                        )}>
                        <span className="text-xs text-muted-foreground w-8 shrink-0">{i + 1}</span>
                        <span className="text-sm flex-1 truncate">{firstCol}</span>
                        <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end max-w-[50%]">
                          {aiData[i]?.codes?.slice(0, 1).map((c) => (
                            <span key={`ai-${c}`} className="text-[10px] px-1.5 py-0.5 rounded border border-orange-300 text-orange-600 dark:border-orange-800 dark:text-orange-400 truncate max-w-[80px]">
                              {c}
                            </span>
                          ))}
                          {rowCodes.map((c) => (
                            <span key={`h-${c}`} className="text-[10px] px-1.5 py-0.5 rounded font-medium truncate max-w-[80px]"
                              style={{ backgroundColor: codeColor(c, codes), color: "#1a1a1a" }}>
                              {c}
                            </span>
                          ))}
                          {!aiData[i]?.codes?.length && rowCodes.length === 0 && (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Progress + applied codes ──────────────────────────────────── */}
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span>{codedCount}/{totalRows} coded · {aiCount} AI</span>
              <div className="flex flex-wrap gap-1.5 justify-end">
                {appliedCodes.map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium cursor-pointer hover:opacity-70"
                    style={{ backgroundColor: codeColor(code, codes) }}
                    onClick={() => toggleCode(code)}
                    title="Click to remove"
                  >
                    {code} <X className="h-2.5 w-2.5" />
                  </span>
                ))}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="bg-orange-400 h-full transition-all duration-500" style={{ width: `${totalRows > 0 ? (codedCount / totalRows) * 100 : 0}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="border-t" />

      {/* ── 6. Export Results ───────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Export Results</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Analytics */}
          <Button variant="outline" size="sm" onClick={() => setShowAnalytics(true)} disabled={codedCount === 0 && aiCount === 0}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </Button>

          {/* Export Human Codes */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={codedCount === 0}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Human Codes <ChevronDown className="h-3 w-3 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_standard.csv`);
              }}>CSV (standard)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "onehot"), `${base}_human_onehot.csv`);
              }}>CSV (one-hot)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                void downloadXLSX(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_codes`);
              }}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                const base = (dataName || "data").replace(/\.[^.]+$/, "");
                exportJSON(buildExportRows(data, codes, codingData, aiData, "standard"), `${base}_human_codes.json`);
              }}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export with AI */}
          {aiCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export with AI <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai.csv`);
                }}>CSV (standard)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadCSVFile(buildExportRows(data, codes, codingData, aiData, "onehot"), `${base}_with_ai_onehot.csv`);
                }}>CSV (one-hot)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  void downloadXLSX(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai`);
                }}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const base = (dataName || "data").replace(/\.[^.]+$/, "");
                  exportJSON(buildExportRows(data, codes, codingData, aiData, "withAI"), `${base}_with_ai.json`);
                }}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ── Analytics Dialog ───────────────────────────────────────────────── */}
      <AnalyticsDialog
        open={showAnalytics}
        onOpenChange={setShowAnalytics}
        codebook={codebook}
        results={data.map((row, i) => ({
          ...row,
          ai_codes: (aiData[i]?.codes ?? []).join(", "),
        }))}
        overrides={codingData}
        onGoToRow={(idx) => {
          setCurrentIndex(idx);
        }}
      />
    </div>
  );
}

// ─── Code Buttons Panel Component ────────────────────────────────────────────
function CodeButtonsPanel({
  codes,
  appliedCodes,
  currentSuggestion,
  horizontal,
  onToggle,
}: {
  codes: string[];
  appliedCodes: string[];
  currentSuggestion?: AISuggestion;
  horizontal: boolean;
  onToggle: (code: string) => void;
}) {
  const suggestedCodes = currentSuggestion?.codes ?? [];
  const confidence = currentSuggestion?.confidence ?? {};
  // Only the highest-probability code gets the "AI suggested" highlight
  const topSuggested = suggestedCodes.length > 0 ? suggestedCodes[0] : null;

  if (horizontal) {
    return (
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${codes.length}, 1fr)` }}>
        {codes.map((code, idx) => {
          const color = codeColor(code, codes);
          const isApplied = appliedCodes.includes(code);
          const confValue = confidence[code] ?? 0;
          const isSuggested = code === topSuggested;
          return (
            <button
              key={code}
              onClick={() => onToggle(code)}
              className={cn(
                "relative rounded border text-xs py-2 px-1 transition-all hover:shadow-sm active:scale-[0.98] flex flex-col items-center gap-0.5",
                isApplied ? "font-semibold shadow-sm" : "font-normal"
              )}
              style={{
                backgroundColor: isApplied ? color : isSuggested ? color + "30" : "transparent",
                borderTopWidth: "4px",
                borderTopColor: color,
                borderRightColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                borderBottomColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                borderLeftColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              }}
            >
              {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
              <span>
                {code}
                {confValue > 0 && <span className="text-[10px] opacity-60 ml-1">({Math.round(confValue)}%)</span>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // Vertical list
  return (
    <div className="space-y-1">
      {codes.map((code, idx) => {
        const color = codeColor(code, codes);
        const isApplied = appliedCodes.includes(code);
        const confValue = confidence[code] ?? 0;
        const isSuggested = code === topSuggested;
        return (
          <button
            key={code}
            onClick={() => onToggle(code)}
            className="relative w-full rounded border text-sm py-2 px-4 text-left transition-all hover:shadow-sm active:scale-[0.99] flex items-center justify-between"
            style={{
              backgroundColor: isApplied ? color : isSuggested ? color + "30" : "transparent",
              borderLeftWidth: "4px",
              borderLeftColor: color,
              borderRightColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              borderBottomColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
              borderTopColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
            }}
          >
            {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
            <span>
              {code}
              {confValue > 0 && <span className="text-[10px] opacity-60 ml-1">({Math.round(confValue)}%)</span>}
            </span>
            <div className="flex items-center gap-2">
              {isApplied && <Check className="h-3.5 w-3.5 opacity-70" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}
