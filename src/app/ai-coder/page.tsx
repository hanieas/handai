"use client";

import React, { useState, useEffect, useRef } from "react";
import { FileUploader } from "@/components/tools/FileUploader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { downloadCSV } from "@/lib/export";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import {
  ChevronRight,
  ChevronDown,
  Save,
  FolderOpen,
  Download,
  Bot,
  Trash2,
  Minus,
  Plus,
  X,
  Sparkles,
  Loader2,
  BarChart2,
  AlertCircle,
  Check,
  ArrowLeft,
} from "lucide-react";
import { SampleDatasetPicker } from "@/components/tools/SampleDatasetPicker";
import { toast } from "sonner";
import pLimit from "p-limit";
import type { Row } from "@/types";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { processRowDirect } from "@/lib/llm-browser";
import { createRun, saveResults } from "@/lib/db-tauri";

// ─── Palette (matches Python CODE_COLORS) ─────────────────────────────────
const CODE_COLORS = [
  "#FFF3BF", "#C3FAE8", "#D0EBFF", "#F3D9FA",
  "#FFE8CC", "#FFDEEB", "#D3F9D8", "#E3FAFC",
];

function codeColor(code: string, allCodes: string[]): string {
  return CODE_COLORS[allCodes.indexOf(code) % CODE_COLORS.length];
}

const SAMPLE_CODES: Record<string, string[]> = {
  product_reviews: ["Positive", "Negative", "Neutral", "Mixed", "Quality Issue", "Shipping Issue"],
  healthcare_interviews: ["Burnout", "Resilience", "Team Support", "Resource Issue", "Leadership", "Work-Life Balance"],
  support_tickets: ["Bug", "Feature Request", "Billing", "Account Issue", "Shipping", "Refund"],
  learning_experience: ["Positive Experience", "Negative Experience", "Technical Issue", "Engagement", "Isolation", "Flexibility"],
  exit_interviews: ["Compensation", "Career Growth", "Management", "Work-Life Balance", "Culture", "Relocation"],
  mixed_feedback: ["Positive", "Negative", "Neutral", "Detailed", "Brief"],
};

// ─── Storage ────────────────────────────────────────────────────────────────
const SESSIONS_KEY = "aic_named_sessions";
const SETTINGS_KEY = "aic_settings";
const AUTOSAVE_KEY = "aic_autosave";
const AUTOSAVE_PREV_KEY = "aic_autosave_prev";

interface AISuggestion {
  codes: string[];
  confidence: Record<string, number>;
  reasoning?: string;
}

interface AICSession {
  name: string;
  savedAt: string;
  data: Row[];
  codes: string[];
  highlights: Record<string, string>;
  codingData: Record<number, string[]>;
  aiData: Record<number, AISuggestion>;
  currentIndex: number;
  textCols: string[];
  dataName?: string;
}

interface AICSettings {
  contextRows: number;
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalCodes: boolean;
  buttonsAboveText: boolean;
  autoAcceptThreshold: number;
}

interface AICAutosave {
  data: Row[]; codes: string[]; highlights: Record<string, string>;
  codingData: Record<number, string[]>; aiData: Record<number, AISuggestion>;
  currentIndex: number; textCols: string[]; dataName: string;
  sessionName: string; savedAt: string;
}

function listSessions(): AICSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as AICSession[]).sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  } catch { return []; }
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

function loadSettings(): AICSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {
      contextRows: 2, autoAdvance: false, lightMode: true,
      horizontalCodes: true, buttonsAboveText: false, autoAcceptThreshold: 0.9,
    };
  } catch {
    return {
      contextRows: 2, autoAdvance: false, lightMode: true,
      horizontalCodes: true, buttonsAboveText: false, autoAcceptThreshold: 0.9,
    };
  }
}

function saveSettings(s: AICSettings) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

async function exportCSV(
  data: Row[],
  codes: string[],
  codingData: Record<number, string[]>,
  aiData: Record<number, AISuggestion>,
  mode: "standard" | "onehot" | "withAI",
  dataName: string
) {
  const base = dataName.replace(/\.[^.]+$/, "") || "session";
  let rows: Record<string, unknown>[];
  let filename: string;
  if (mode === "standard") {
    rows = data.map((row, i) => ({ ...row, codes: (codingData[i] || []).join("; ") }));
    filename = `${base}_ai_coded.csv`;
  } else if (mode === "onehot") {
    rows = data.map((row, i) => {
      const applied = codingData[i] || [];
      const oneHot: Record<string, number> = {};
      codes.forEach((c) => (oneHot[c] = applied.includes(c) ? 1 : 0));
      return { ...row, ...oneHot };
    });
    filename = `${base}_ai_onehot.csv`;
  } else {
    rows = data.map((row, i) => ({
      ...row,
      human_codes: (codingData[i] || []).join("; "),
      ai_codes: (aiData[i]?.codes || []).join("; "),
      ai_reasoning: aiData[i]?.reasoning || "",
      agreement: JSON.stringify((codingData[i] || []).every((c) => (aiData[i]?.codes || []).includes(c))),
    }));
    filename = `${base}_ai_full.csv`;
  }
  downloadCSV(rows, filename);
}

function highlightText(text: string, color: string, words: string): string {
  if (!words.trim()) return text;
  const terms = words.split(",").map((w) => w.trim()).filter(Boolean);
  let result = text;
  terms.forEach((term) => {
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    result = result.replace(regex, `<mark style="background-color:${color};padding:0 2px;border-radius:2px;">$1</mark>`);
  });
  return result;
}

function applyAllHighlights(text: string, appliedCodes: string[], allCodes: string[], highlights: Record<string, string>): string {
  let result = text;
  appliedCodes.forEach((code) => {
    const color = codeColor(code, allCodes);
    if (highlights[code]) result = highlightText(result, color, highlights[code]);
  });
  return result;
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ─── Main Page ──────────────────────────────────────────────────────────────
export default function AICoderPage() {
  const [data, setData] = useState<Row[]>([]);
  const [codes, setCodes] = useState<string[]>(["Positive", "Negative", "Neutral", "Detailed", "Brief"]);
  const [highlights, setHighlights] = useState<Record<string, string>>({});
  const [codingData, setCodingData] = useState<Record<number, string[]>>({});
  const [aiData, setAiData] = useState<Record<number, AISuggestion>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [textCols, setTextCols] = useState<string[]>([]);
  const [dataName, setDataName] = useState("");
  const [sessionName, setSessionName] = useState("");
  const [settings, setSettings] = useState<AICSettings>({
    contextRows: 2, autoAdvance: false, lightMode: true,
    horizontalCodes: true, buttonsAboveText: false, autoAcceptThreshold: 0.9,
  });
  const [sessions, setSessions] = useState<AICSession[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showHighlighter, setShowHighlighter] = useState(false);
  const [showTextColPicker, setShowTextColPicker] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [codesInput, setCodesInput] = useState("Positive\nNegative\nNeutral\nDetailed\nBrief");
  const batchAbortRef = useRef(false);
  const stateRef = useRef<AICAutosave>({
    data: [], codes: [], highlights: {}, codingData: {},
    aiData: {},
    currentIndex: 0, textCols: [], dataName: "", sessionName: "", savedAt: "",
  });
  const [recovered, setRecovered] = useState<{ codedCount: number; savedAt: string; sessionName: string } | null>(null);
  const [autosaveTime, setAutosaveTime] = useState<Date | null>(null);
  const [autosaveDisplay, setAutosaveDisplay] = useState("");
  const [pendingLoad, setPendingLoad] = useState<{ data: Row[]; name: string; sampleKey?: string } | null>(null);

  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();
  const [batchConcurrency, setBatchConcurrency] = useState(systemSettings.maxConcurrency);

  useEffect(() => {
    setSettings(loadSettings());
    setSessions(listSessions());
    let raw: string | null = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch {}
    if (!raw) { try { raw = localStorage.getItem(AUTOSAVE_PREV_KEY); } catch {} }
    if (!raw) return;
    try {
      const s = JSON.parse(raw);
      if (!s.data?.length) return;
      setData(s.data); setCodes(s.codes || []); setHighlights(s.highlights || {});
      setCodingData(s.codingData || {});
      setAiData(s.aiData || {});
      setCurrentIndex(s.currentIndex || 0); setTextCols(s.textCols || []);
      setDataName(s.dataName || "");
      setSessionName(s.sessionName || (s.dataName || "").replace(/\.[^.]+$/, ""));
      setCodesInput((s.codes || []).join("\n"));
      const cnt = Object.keys(s.codingData || {}).filter(
        k => (s.codingData[+k] || []).length > 0
      ).length;
      setRecovered({ codedCount: cnt, savedAt: s.savedAt || new Date().toISOString(), sessionName: s.sessionName || "" });
    } catch {}
  }, []);

  // Autosave whenever coding state changes
  useEffect(() => {
    if (data.length === 0) return;
    const payload = {
      data, codes, highlights, codingData, aiData,
      currentIndex, textCols, dataName, sessionName,
      savedAt: new Date().toISOString(),
    };
    stateRef.current = payload;
    try {
      const existing = localStorage.getItem(AUTOSAVE_KEY);
      if (existing) localStorage.setItem(AUTOSAVE_PREV_KEY, existing);
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      setAutosaveTime(new Date());
    } catch {}
  }, [data, codes, highlights, codingData, aiData, currentIndex, textCols, dataName, sessionName]);

  useEffect(() => {
    const onBeforeUnload = () => {
      const s = stateRef.current;
      if (!s.data.length) return;
      try {
        const payload = { ...s, savedAt: new Date().toISOString() };
        const existing = localStorage.getItem(AUTOSAVE_KEY);
        if (existing) localStorage.setItem(AUTOSAVE_PREV_KEY, existing);
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      } catch {}
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data.length === 0) return;
    stateRef.current = {
      data, codes, highlights, codingData, aiData,
      currentIndex, textCols, dataName, sessionName,
      savedAt: stateRef.current.savedAt,
    };
  });

  useEffect(() => {
    if (!autosaveTime) return;
    setAutosaveDisplay(timeAgo(autosaveTime));
    const id = setInterval(() => setAutosaveDisplay(timeAgo(autosaveTime)), 15_000);
    return () => clearInterval(id);
  }, [autosaveTime]);

  const totalRows = data.length;
  const currentRow = data[currentIndex] as Row | undefined;
  const appliedCodes = codingData[currentIndex] || [];
  const currentSuggestion = aiData[currentIndex];
  const allColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const codedCount = Object.keys(codingData).filter((k) => (codingData[parseInt(k)] || []).length > 0).length;
  const aiCount = Object.keys(aiData).length;

  const doDataLoaded = (newData: Row[], name: string, sampleKey?: string) => {
    setRecovered(null);
    setData(newData);
    setDataName(name);
    setCodingData({});
    setAiData({});
    setCurrentIndex(0);
    const cols = Object.keys(newData[0] || {});
    const textish = cols.filter((c) => String(newData[0][c] || "").length > 20);
    setTextCols(textish.length > 0 ? textish : cols);
    const sName = name.replace(/\.[^.]+$/, "");
    setSessionName(sName);
    if (sampleKey && SAMPLE_CODES[sampleKey]) {
      const sc = SAMPLE_CODES[sampleKey];
      setCodes(sc);
      setCodesInput(sc.join("\n"));
    }
    toast.success(`Loaded ${newData.length} rows`);
  };

  const handleDataLoaded = (newData: Row[], name: string, sampleKey?: string) => {
    if (codedCount > 0) {
      setPendingLoad({ data: newData, name, sampleKey });
    } else {
      doDataLoaded(newData, name, sampleKey);
    }
  };

  const loadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (s) handleDataLoaded(s.data as Row[], s.name, key);
  };

  const applyCodesFromInput = () => {
    const parsed = codesInput.split("\n").map((c) => c.trim()).filter(Boolean);
    if (parsed.length > 0) setCodes(parsed);
  };

  const toggleCode = (code: string) => {
    const wasApplied = appliedCodes.includes(code);
    setCodingData((prev) => {
      const cur = prev[currentIndex] || [];
      return { ...prev, [currentIndex]: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] };
    });
    if (!wasApplied && settings.autoAdvance && currentIndex < totalRows - 1) {
      setTimeout(() => setCurrentIndex((i) => Math.min(i + 1, totalRows - 1)), 200);
    }
  };

  const navigate = (dir: number) => setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));

  useEffect(() => {
    if (data.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft"  || e.key === "h") { e.preventDefault(); navigate(-1); }
      const n = parseInt(e.key);
      if (!isNaN(n) && n >= 1 && n <= codes.length) { e.preventDefault(); toggleCode(codes[n - 1]); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentIndex, codes, totalRows, data.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSettings = (patch: Partial<AICSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
  };

  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: AICSession = { name: n, savedAt: new Date().toISOString(), data, codes, highlights, codingData, aiData, currentIndex, textCols, dataName };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: AICSession) => {
    setData(s.data); setCodes(s.codes); setCodesInput(s.codes.join("\n"));
    setHighlights(s.highlights || {}); setCodingData(s.codingData);
    setAiData(s.aiData || {}); setCurrentIndex(s.currentIndex);
    setTextCols(s.textCols); setDataName(s.dataName || ""); setSessionName(s.name);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  const getRowText = (row: Row): string => {
    const displayCols = textCols.length > 0 ? textCols : allColumns;
    return displayCols.map((col) => `${col}: ${String(row[col] ?? "")}`).join("\n");
  };

  const getAiSuggestion = async (rowIdx?: number): Promise<AISuggestion | null> => {
    if (!activeModel) {
      if (rowIdx === undefined) toast.error("No model configured. Go to Settings.");
      return null;
    }
    const idx = rowIdx ?? currentIndex;
    const row = data[idx];
    if (!row) return null;
    if (rowIdx === undefined) setIsAiLoading(true);
    try {
      const rowText = getRowText(row);
      const systemPrompt = `You are a qualitative coding assistant. Analyze the text and return ONLY valid JSON:
{"codes": ["Code1"], "confidence": {"Code1": 0.95}, "reasoning": "brief explanation"}
Available codes: ${codes.join(", ")}
Only use codes from the list. Confidence 0.0–1.0.`;
      let result: { output?: string; error?: string };
      if (isTauri) {
        result = await processRowDirect({
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          apiKey: activeModel.apiKey || "",
          baseUrl: activeModel.baseUrl,
          systemPrompt,
          userContent: rowText,
          temperature: systemSettings.temperature,
        });
      } else {
        const res = await fetch("/api/process-row", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "local",
            baseUrl: activeModel.baseUrl,
            systemPrompt,
            userContent: rowText,
            temperature: systemSettings.temperature,
          }),
        });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        result = await res.json();
      }
      if (result.error) throw new Error(result.error);

      let suggestion: AISuggestion = { codes: [], confidence: {} };
      try {
        const clean = (result.output as string).replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const json = JSON.parse(clean);
        const validCodes = Array.isArray(json.codes) ? json.codes.filter((c: string) => codes.includes(c)) : [];
        let conf: Record<string, number> = {};
        if (json.confidence && typeof json.confidence === "object" && !Array.isArray(json.confidence)) {
          conf = json.confidence as Record<string, number>;
        } else if (typeof json.confidence === "number") {
          validCodes.forEach((c: string) => { conf[c] = json.confidence as number; });
        }
        suggestion = { codes: validCodes, confidence: conf, reasoning: json.reasoning ?? "" };
      } catch {
        suggestion = {
          codes: codes.filter((c) => (result.output as string).toLowerCase().includes(c.toLowerCase())),
          confidence: {},
        };
      }

      setAiData((prev) => ({ ...prev, [idx]: suggestion }));

      // Suggestions stored — user must explicitly accept them
      return suggestion;
    } catch (err) {
      if (rowIdx === undefined) toast.error(`AI failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    } finally {
      if (rowIdx === undefined) setIsAiLoading(false);
    }
  };

  const runBatch = async () => {
    if (!activeModel) { toast.error("No model configured"); return; }
    setBatchRunning(true);
    setBatchProgress(0);
    batchAbortRef.current = false;
    let processed = 0;

    // Create a history run
    let localRunId: string | null = null;
    try {
      const runParams = { runType: "ai-coder", provider: activeModel.providerId, model: activeModel.defaultModel, temperature: systemSettings.temperature, systemPrompt: "AI qualitative coding", inputFile: dataName || "unnamed", inputRows: data.length };
      if (isTauri) {
        const rd = await createRun(runParams);
        localRunId = rd.id ?? null;
      } else {
        const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(runParams) });
        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const rd = await res.json();
        localRunId = rd.id ?? null;
      }
    } catch (err) { console.warn("Run creation failed:", err); }

    const batchResults: { rowIndex: number; output: string; latency: number }[] = [];
    const limit = pLimit(batchConcurrency);
    const tasks = data.map((_, i) =>
      limit(async () => {
        if (batchAbortRef.current) return;
        const t0 = performance.now();
        const suggestion = await getAiSuggestion(i);
        const latency = (performance.now() - t0) / 1000;
        if (suggestion) {
          batchResults.push({ rowIndex: i, output: JSON.stringify(suggestion), latency });
        }
        processed++;
        setBatchProgress(processed);
      })
    );
    await Promise.all(tasks);
    setBatchRunning(false);
    toast.success(`AI processed ${processed} rows`);

    // Save results to history
    if (localRunId && batchResults.length > 0) {
      try {
        const resultRows = batchResults.map((r) => ({
          rowIndex: r.rowIndex,
          input: data[r.rowIndex] as Record<string, unknown>,
          output: r.output,
          status: "success" as const,
          latency: r.latency,
        }));
        if (isTauri) {
          await saveResults(localRunId, resultRows);
        } else {
          const saveRes = await fetch("/api/results", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: localRunId, results: resultRows }) });
          if (!saveRes.ok) throw new Error(`Server error ${saveRes.status}`);
        }
      } catch (err) { console.warn("Failed to save results to history:", err); }
    }
  };

  const stopBatch = () => { batchAbortRef.current = true; setBatchRunning(false); };

  const getRowHtml = (row: Row, rowIdx: number, isCurrent: boolean): string => {
    const displayCols = textCols.length > 0 ? textCols : allColumns;
    const allApplied = codingData[rowIdx] || [];
    let html = "";
    if (isCurrent) {
      const badges = allApplied.map((c) => `<span style="background:${codeColor(c, codes)};padding:1px 6px;border-radius:3px;font-size:0.8em;margin-left:4px;">${c}</span>`).join("");
      html += `<strong>► Row ${rowIdx + 1} of ${totalRows}</strong>${badges}<br/>`;
    }
    displayCols.forEach((col) => {
      const val = String(row[col] ?? "");
      const highlighted = applyAllHighlights(val, allApplied, codes, highlights);
      if (displayCols.length > 1 || !isCurrent) {
        html += `<b>${col}:</b> ${highlighted} `;
      } else {
        html += highlighted;
      }
    });
    return html;
  };

  const contextRange = (() => {
    const n = settings.contextRows;
    const rows: number[] = [];
    for (let i = Math.max(0, currentIndex - n); i <= Math.min(totalRows - 1, currentIndex + n); i++) rows.push(i);
    return rows;
  })();

  const lightBg = settings.lightMode ? "#FFFEF5" : "#1a1a2e";
  const lightText = settings.lightMode ? "#1a1a1a" : "#eee";
  const ctxBg = settings.lightMode ? "#F8F9FA" : "rgba(128,128,128,0.15)";
  const ctxText = settings.lightMode ? "#555" : "#bbb";

  // ─── Config screen ────────────────────────────────────────────────────────
  if (data.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-5 pb-16">
        <div className="space-y-1">
          <h1 className="text-4xl font-bold">AI Coder</h1>
          <p className="text-muted-foreground text-sm">AI-assisted qualitative coding with inter-rater analytics</p>
        </div>

        {!activeModel && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-800 dark:text-amber-200">No AI model configured</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
                You can code manually, but AI suggestions won&apos;t be available.{" "}
                <Link href="/settings" className="underline font-medium">Configure a model →</Link>
              </p>
            </div>
          </div>
        )}

        {/* Saved sessions */}
        {sessions.length > 0 && (
          <div className="border rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b font-medium text-sm">Resume a Session</div>
            <div className="p-3 space-y-2">
              {sessions.slice(0, 6).map((s) => {
                const coded = Object.keys(s.codingData).filter((k) => (s.codingData[parseInt(k)] || []).length > 0).length;
                const ai = Object.keys(s.aiData || {}).length;
                return (
                  <div key={s.name} className="flex items-center justify-between p-2.5 rounded border hover:bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.data.length} rows · {coded} coded · {ai} AI · {new Date(s.savedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => loadSession(s)}>Load</Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => { deleteStoredSession(s.name); setSessions(listSessions()); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium text-sm">Load Data</div>
          <div className="p-4">
            <FileUploader onDataLoaded={handleDataLoaded} />
            <div className="mt-4">
              <SampleDatasetPicker onSelect={loadSample} />
            </div>
          </div>
        </div>

        {/* Define codes */}
        <div className="border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b font-medium text-sm">Define Codes (optional — set before loading)</div>
          <div className="p-4 space-y-2">
            <textarea
              value={codesInput}
              onChange={(e) => setCodesInput(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm font-mono resize-none h-28 bg-background"
              placeholder="One code per line..."
            />
            <Button size="sm" variant="outline" onClick={applyCodesFromInput}>Apply Codes</Button>
            <p className="text-[11px] text-muted-foreground">These will be auto-set when loading a sample dataset.</p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Analytics screen ─────────────────────────────────────────────────────
  if (showAnalytics) {
    const codeStats = codes.map((code) => {
      const humanCount = Object.values(codingData).filter((cds) => cds.includes(code)).length;
      const aiSuggested = Object.values(aiData).filter((s) => s.codes.includes(code)).length;
      const aiAccepted = Object.keys(codingData).filter((k) => {
        const idx = parseInt(k);
        return (codingData[idx] || []).includes(code) && (aiData[idx]?.codes || []).includes(code);
      }).length;
      const precision = aiSuggested > 0 ? ((aiAccepted / aiSuggested) * 100).toFixed(0) : "—";
      const recall = humanCount > 0 ? ((aiAccepted / humanCount) * 100).toFixed(0) : "—";
      return { code, humanCount, aiSuggested, aiAccepted, precision, recall };
    });
    const totalAISuggested = codeStats.reduce((sum, s) => sum + s.aiSuggested, 0);
    const totalAIAccepted = codeStats.reduce((sum, s) => sum + s.aiAccepted, 0);
    const agreementRate = totalAISuggested > 0 ? ((totalAIAccepted / totalAISuggested) * 100).toFixed(1) : "—";

    // Rows where AI and human disagree
    const disagreements = Object.keys(codingData).map((k) => {
      const idx = parseInt(k);
      const human = new Set(codingData[idx] || []);
      const ai = new Set(aiData[idx]?.codes || []);
      const onlyHuman = [...human].filter((c) => !ai.has(c));
      const onlyAI = [...ai].filter((c) => !human.has(c));
      if (onlyHuman.length === 0 && onlyAI.length === 0) return null;
      return { idx, onlyHuman, onlyAI, reasoning: aiData[idx]?.reasoning };
    }).filter(Boolean).slice(0, 10);

    return (
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowAnalytics(false)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Coding
          </Button>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BarChart2 className="h-5 w-5 text-orange-500" /> Analytics
          </h2>
          <span className="text-sm text-muted-foreground">— {sessionName || dataName}</span>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "Total Rows", value: totalRows, color: "text-foreground" },
            { label: "Human Coded", value: `${codedCount} (${Math.round((codedCount / totalRows) * 100)}%)`, color: "text-green-600" },
            { label: "AI Processed", value: `${aiCount} (${Math.round((aiCount / totalRows) * 100)}%)`, color: "text-orange-500" },
            { label: "AI→Human Accept", value: `${agreementRate}%`, color: "text-blue-600" },
          ].map((stat) => (
            <div key={stat.label} className="border rounded-lg p-4">
              <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Human coding progress</span><span>{codedCount}/{totalRows}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div className="bg-green-500 h-full transition-all" style={{ width: `${(codedCount / totalRows) * 100}%` }} />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>AI processing progress</span><span>{aiCount}/{totalRows}</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div className="bg-orange-400 h-full transition-all" style={{ width: `${(aiCount / totalRows) * 100}%` }} />
          </div>
        </div>

        {/* Per-code table */}
        <div className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b font-medium text-sm bg-muted/20">Code Frequency &amp; AI Agreement</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="text-left px-4 py-2">Code</th>
                  <th className="text-right px-4 py-2">Human</th>
                  <th className="text-right px-4 py-2">AI Suggested</th>
                  <th className="text-right px-4 py-2">AI Accepted</th>
                  <th className="text-right px-4 py-2">Precision</th>
                  <th className="text-right px-4 py-2">Recall</th>
                  <th className="px-4 py-2">Distribution</th>
                </tr>
              </thead>
              <tbody>
                {codeStats.map(({ code, humanCount, aiSuggested, aiAccepted, precision, recall }) => {
                  const color = codeColor(code, codes);
                  const pct = totalRows > 0 ? (humanCount / totalRows) * 100 : 0;
                  return (
                    <tr key={code} className="border-b hover:bg-muted/10">
                      <td className="px-4 py-2">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium" style={{ backgroundColor: color }}>{code}</span>
                      </td>
                      <td className="text-right px-4 py-2 text-xs">{humanCount}</td>
                      <td className="text-right px-4 py-2 text-xs text-orange-500">{aiSuggested}</td>
                      <td className="text-right px-4 py-2 text-xs text-blue-600">{aiAccepted}</td>
                      <td className="text-right px-4 py-2 text-xs">{precision}{precision !== "—" ? "%" : ""}</td>
                      <td className="text-right px-4 py-2 text-xs">{recall}{recall !== "—" ? "%" : ""}</td>
                      <td className="px-4 py-2 w-32">
                        <div className="bg-muted rounded h-4 overflow-hidden">
                          <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Disagreements */}
        {disagreements.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b font-medium text-sm bg-muted/20">
              Disagreements — rows where AI and human differ ({disagreements.length} shown)
            </div>
            <div className="divide-y">
              {disagreements.map((d) => {
                if (!d) return null;
                const displayCols = textCols.length > 0 ? textCols : allColumns;
                const row = data[d.idx];
                const preview = displayCols.map((c) => String(row?.[c] ?? "")).join(" · ").slice(0, 100);
                return (
                  <div key={d.idx} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium mb-1">Row {d.idx + 1}</div>
                        <div className="text-xs text-muted-foreground truncate">{preview}…</div>
                        {d.reasoning && <div className="text-[11px] italic text-muted-foreground/70 mt-1">AI: {d.reasoning}</div>}
                      </div>
                      <div className="shrink-0 text-xs space-y-1">
                        {d.onlyHuman.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-green-600">Human only:</span>
                            {d.onlyHuman.map((c) => <span key={c} className="px-1.5 py-0.5 rounded text-[10px]" style={{ backgroundColor: codeColor(c, codes) }}>{c}</span>)}
                          </div>
                        )}
                        {d.onlyAI.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span className="text-orange-500">AI only:</span>
                            {d.onlyAI.map((c) => <span key={c} className="px-1.5 py-0.5 rounded text-[10px] border border-dashed" style={{ backgroundColor: codeColor(c, codes) + "50" }}>{c}</span>)}
                          </div>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="mt-1 h-6 text-[11px] text-muted-foreground"
                      onClick={() => { setCurrentIndex(d.idx); setShowAnalytics(false); }}>
                      Go to row →
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Export from analytics */}
        {codedCount > 0 && (
          <div className="flex gap-3 flex-wrap border rounded-lg p-4">
            <Button variant="outline" onClick={() => { void exportCSV(data, codes, codingData, aiData, "standard", dataName); }}>
              <Download className="h-4 w-4 mr-2" /> Export Human Codes
            </Button>
            {aiCount > 0 && (
              <Button variant="outline" onClick={() => { void exportCSV(data, codes, codingData, aiData, "withAI", dataName); }}>
                <Download className="h-4 w-4 mr-2" /> Export with AI
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Code buttons (reusable JSX) ──────────────────────────────────────────
  const codeButtonsSection = (
    <>
      {settings.horizontalCodes ? (
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${codes.length}, 1fr)` }}>
          {codes.map((code, idx) => {
            const color = codeColor(code, codes);
            const isApplied = appliedCodes.includes(code);
            const conf = currentSuggestion?.confidence[code];
            const isSuggested = currentSuggestion?.codes.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleCode(code)}
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
                <span>{code}</span>
                {conf !== undefined && (
                  <span className="text-[10px] opacity-60">{Math.round(conf * 100)}%</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1">
          {codes.map((code, idx) => {
            const color = codeColor(code, codes);
            const isApplied = appliedCodes.includes(code);
            const conf = currentSuggestion?.confidence[code];
            const isSuggested = currentSuggestion?.codes.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggleCode(code)}
                className="relative w-full rounded border text-sm py-2 px-4 text-left transition-all hover:shadow-sm active:scale-[0.99] flex items-center justify-between"
                style={{
                  backgroundColor: isApplied ? color : isSuggested ? color + "30" : "transparent",
                  borderTopColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                  borderRightColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                  borderBottomColor: isApplied ? color : isSuggested ? color : "#e2e8f0",
                  borderLeftWidth: "4px",
                  borderLeftColor: color,
                  fontWeight: isApplied ? 600 : 400,
                }}
              >
                {idx < 9 && <span className="text-[9px] opacity-40 absolute top-0.5 right-1">{idx + 1}</span>}
                <span>{code}</span>
                <div className="flex items-center gap-2">
                  {conf !== undefined && <span className="text-xs opacity-60">{Math.round(conf * 100)}%</span>}
                  {isApplied && <Check className="h-3.5 w-3.5 opacity-70" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* AI action area */}
      <div className="flex items-center gap-2 mt-1">
        {!activeModel ? (
          <Link href="/settings" className="flex-1">
            <Button variant="outline" size="sm" className="w-full text-xs border-dashed text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5 mr-1.5 text-amber-500" />
              Configure model for AI
            </Button>
          </Link>
        ) : (
          <>
            <Button
              variant="outline"
              size="sm"
              className="border-orange-200 hover:bg-orange-50 text-xs"
              disabled={isAiLoading}
              onClick={() => getAiSuggestion()}
            >
              {isAiLoading
                ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
                : <Sparkles className="h-3 w-3 mr-1.5 text-orange-500" />}
              {currentSuggestion ? "Refresh AI" : "✨ Ask AI"}
            </Button>
            {currentSuggestion && currentSuggestion.codes.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-200 hover:bg-green-50 text-xs"
                  onClick={() => {
                    setCodingData((prev) => {
                      const cur = prev[currentIndex] || [];
                      return { ...prev, [currentIndex]: [...new Set([...cur, ...currentSuggestion.codes])] };
                    });
                    toast.success("Accepted all AI suggestions");
                  }}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Accept All AI
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground"
                  onClick={() => {
                    setAiData((prev) => {
                      const next = { ...prev };
                      delete next[currentIndex];
                      return next;
                    });
                  }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Dismiss
                </Button>
              </>
            )}
            {currentSuggestion?.codes.length ? (
              <span className="text-[11px] text-orange-600 flex items-center gap-1">
                AI suggests: {currentSuggestion.codes.join(", ")}
              </span>
            ) : null}
            {currentSuggestion?.reasoning && (
              <span className="text-[10px] italic text-muted-foreground truncate flex-1">
                {currentSuggestion.reasoning}
              </span>
            )}
          </>
        )}
      </div>
    </>
  );

  // ─── Coding interface ──────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-3">

      {/* ── Recovery banner ───────────────────────────────────────────────── */}
      {recovered && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Session recovered</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {recovered.sessionName && <><strong>{recovered.sessionName}</strong> · </>}
                {recovered.codedCount} row{recovered.codedCount !== 1 ? "s" : ""} coded
                {" · "}saved {timeAgo(new Date(recovered.savedAt))}
              </p>
            </div>
          </div>
          <button onClick={() => setRecovered(null)}
            className="shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-0.5"
            aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Session bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="text-sm">
          <span className="font-medium">Session: </span>
          <code className="text-orange-600 dark:text-orange-400 text-xs bg-orange-50 dark:bg-orange-950/30 px-1.5 py-0.5 rounded">
            {sessionName || dataName || "untitled"}
          </code>
          <span className="text-muted-foreground ml-2 text-xs">({codedCount}/{totalRows} coded, {aiCount} AI)</span>
        </div>
        {autosaveTime && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="text-green-500">✓</span>
            Autosaved {autosaveDisplay}
          </span>
        )}
        <div className="flex gap-2 ml-auto">
          <Button size="sm" variant="outline" onClick={() => setShowSaveDialog((v) => !v)}>
            <Save className="h-3.5 w-3.5 mr-1" /> Save
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSessions((v) => !v)}>
            <FolderOpen className="h-3.5 w-3.5 mr-1" /> Load
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAnalytics(true)}>
            <BarChart2 className="h-3.5 w-3.5 mr-1" /> Analytics
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setData([]); setCodingData({}); setAiData({}); }} title="Close session">
            <X className="h-4 w-4" />
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
              const coded = Object.keys(s.codingData).filter((k) => (s.codingData[parseInt(k)] || []).length > 0).length;
              const ai = Object.keys(s.aiData || {}).length;
              return (
                <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                  <div>
                    <span className="text-sm font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-2">
                      {s.data.length} rows · {coded} coded · {ai} AI · {new Date(s.savedAt).toLocaleDateString()}
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

      {/* ── AI Batch Processing (collapsible) ─────────────────────────────── */}
      <Collapsible open={showBatch} onOpenChange={setShowBatch}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm w-full px-3 py-2 rounded border hover:bg-muted/30 transition-colors">
          {showBatch ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-orange-500" />
          AI Batch Processing
          {aiCount > 0 && <span className="ml-auto text-xs text-orange-600">{aiCount}/{totalRows} processed</span>}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 border rounded-lg p-4 bg-muted/10 space-y-3">
            {!activeModel ? (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <AlertCircle className="h-4 w-4" />
                <span>No model configured. <Link href="/settings" className="underline">Configure one →</Link></span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Concurrency:</span>
                  <button className="px-2 py-0.5 border rounded hover:bg-muted transition-colors" onClick={() => setBatchConcurrency((c) => Math.max(1, c - 1))}>−</button>
                  <span className="px-2 border-x min-w-[1.5rem] text-center">{batchConcurrency}</span>
                  <button className="px-2 py-0.5 border rounded hover:bg-muted transition-colors" onClick={() => setBatchConcurrency((c) => Math.min(10, c + 1))}>+</button>
                  <span className="text-[10px]">(parallel AI calls)</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground flex-1">
                    Run AI on all {totalRows} rows. Results are cached in session.
                    <span className="ml-1 font-medium">{activeModel.providerId}/{activeModel.defaultModel}</span>
                  </div>
                  {!batchRunning ? (
                    <Button size="sm" onClick={runBatch} className="bg-orange-500 hover:bg-orange-600 text-white shrink-0">
                      <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Run AI Batch
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={stopBatch} className="border-red-300 text-red-600 hover:bg-red-50 shrink-0">
                      Stop
                    </Button>
                  )}
                </div>
                {batchRunning && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Processing row {batchProgress} of {totalRows}…</span>
                      <span>{Math.round((batchProgress / totalRows) * 100)}%</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                      <div className="bg-orange-400 h-full transition-all duration-300"
                        style={{ width: `${(batchProgress / totalRows) * 100}%` }} />
                    </div>
                  </div>
                )}
                {!batchRunning && aiCount > 0 && (
                  <div className="text-xs text-green-600">
                    ✓ AI suggestions ready for {aiCount}/{totalRows} rows
                    {aiCount < totalRows && (
                      <span className="text-orange-500 ml-2">({totalRows - aiCount} remaining)</span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Word Highlighter (collapsible) ────────────────────────────────── */}
      <Collapsible open={showHighlighter} onOpenChange={setShowHighlighter}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm w-full px-3 py-2 rounded border hover:bg-muted/30 transition-colors">
          {showHighlighter ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Word Highlighter — Define words to highlight for each code
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 border rounded-lg p-3 space-y-2 bg-muted/10">
            {codes.map((code) => {
              const color = codeColor(code, codes);
              return (
                <div key={code} className="flex items-center gap-3">
                  <div className="text-xs font-semibold px-2 py-1 rounded shrink-0 w-36 text-center" style={{ backgroundColor: color }}>
                    {code}
                  </div>
                  <Input
                    value={highlights[code] || ""}
                    onChange={(e) => setHighlights((prev) => ({ ...prev, [code]: e.target.value }))}
                    placeholder="word1, word2, phrase..."
                    className="h-7 text-xs flex-1"
                  />
                </div>
              );
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Text Columns selector (collapsible) ───────────────────────────── */}
      <Collapsible open={showTextColPicker} onOpenChange={setShowTextColPicker}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm w-full px-3 py-2 rounded border hover:bg-muted/30 transition-colors">
          {showTextColPicker ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Text Columns: <strong className="ml-1">{textCols.join(", ")}</strong>
          <span className="text-muted-foreground text-xs ml-1">(click to change)</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-1 border rounded-lg p-3 bg-muted/10">
            <div className="flex flex-wrap gap-2">
              {allColumns.map((col) => (
                <Badge
                  key={col}
                  variant={textCols.includes(col) ? "default" : "outline"}
                  className="cursor-pointer text-xs hover:opacity-80"
                  onClick={() => setTextCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col])}
                >
                  {col}
                </Badge>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Settings toggles row ──────────────────────────────────────────── */}
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
        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-xs">Context</Label>
          <div className="flex items-center border rounded overflow-hidden">
            <button className="px-2 py-1 hover:bg-muted" onClick={() => updateSettings({ contextRows: Math.max(0, settings.contextRows - 1) })}>
              <Minus className="h-3 w-3" />
            </button>
            <span className="px-3 py-1 text-sm border-x min-w-[2rem] text-center">{settings.contextRows}</span>
            <button className="px-2 py-1 hover:bg-muted" onClick={() => updateSettings({ contextRows: Math.min(5, settings.contextRows + 1) })}>
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* ── Buttons above text (when enabled) ────────────────────────────── */}
      {settings.buttonsAboveText && codeButtonsSection}

      {/* ── Text display with context ─────────────────────────────────────── */}
      <div className="rounded-lg border overflow-hidden" style={{ minHeight: "280px" }}>
        {contextRange.map((rowIdx) => {
          const isCurrent = rowIdx === currentIndex;
          const row = data[rowIdx];
          if (!row) return null;
          return (
            <div
              key={rowIdx}
              className="px-4 py-3"
              style={isCurrent
                ? { backgroundColor: lightBg, color: lightText, borderLeft: "4px solid #4CAF50", fontSize: "1.05em" }
                : { backgroundColor: ctxBg, color: ctxText, borderLeft: "4px solid transparent", fontSize: "0.93em", opacity: 0.85 }
              }
              dangerouslySetInnerHTML={{ __html: getRowHtml(row, rowIdx, isCurrent) }}
            />
          );
        })}
      </div>

      {/* ── Buttons below text (default) ─────────────────────────────────── */}
      {!settings.buttonsAboveText && codeButtonsSection}

      {/* ── Big Next button ───────────────────────────────────────────────── */}
      <Button
        className="w-full h-10 text-base"
        disabled={currentIndex >= totalRows - 1}
        onClick={() => navigate(1)}
      >
        Next ▶
      </Button>

      {/* ── Navigation bar ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(-5)} disabled={currentIndex === 0}>◀◀</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)} disabled={currentIndex === 0}>◀ Prev</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(1)} disabled={currentIndex >= totalRows - 1}>Next ▶</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(totalRows - 1 - currentIndex)} disabled={currentIndex >= totalRows - 1}>▶▶</Button>
      </div>
      <div className="text-[10px] text-muted-foreground text-center">
        ← → or h/l navigate &nbsp;·&nbsp; 1–9 toggle codes
      </div>

      {/* ── Progress counter + applied codes ──────────────────────────────── */}
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

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
        <div className="bg-orange-400 h-full transition-all duration-500" style={{ width: `${(codedCount / totalRows) * 100}%` }} />
      </div>

      {/* ── Pending load dialog ───────────────────────────────────────────── */}
      <Dialog open={!!pendingLoad} onOpenChange={(open) => { if (!open) setPendingLoad(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Replace current session?</DialogTitle>
            <DialogDescription>
              You have <strong>{codedCount} coded row{codedCount !== 1 ? "s" : ""}</strong>
              {aiCount > 0 && <> and <strong>{aiCount} AI annotations</strong></>} in the
              current session. Loading new data will replace all of this.
              {" "}Your session has been autosaved and can be restored.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLoad(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (pendingLoad) doDataLoaded(pendingLoad.data, pendingLoad.name, pendingLoad.sampleKey);
              setPendingLoad(null);
            }}>Load anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Export Results section ────────────────────────────────────────── */}
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b bg-muted/20 font-medium text-sm">Export Results</div>
        <div className="p-4">
          {codedCount === 0 ? (
            <p className="text-sm text-muted-foreground">Code some rows before exporting</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => { void exportCSV(data, codes, codingData, aiData, "standard", dataName); }}>
                <Download className="h-4 w-4 mr-2" /> CSV (standard)
              </Button>
              <Button variant="outline" onClick={() => { void exportCSV(data, codes, codingData, aiData, "onehot", dataName); }}>
                <Download className="h-4 w-4 mr-2" /> CSV (one-hot)
              </Button>
              {aiCount > 0 && (
                <Button variant="outline" onClick={() => { void exportCSV(data, codes, codingData, aiData, "withAI", dataName); }}>
                  <Download className="h-4 w-4 mr-2" /> CSV (with AI comparison)
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
