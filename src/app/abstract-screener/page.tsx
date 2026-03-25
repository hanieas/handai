"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { UploadPreview } from "@/components/tools/UploadPreview";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SAMPLE_DATASETS } from "@/lib/sample-data";
import { downloadCSV, downloadXLSX } from "@/lib/export";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { dispatchProcessRow, dispatchCreateRun, dispatchSaveResults } from "@/lib/llm-dispatch";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Save, FolderOpen, BarChart2, Download, X, Trash2,
  AlertCircle, ChevronDown, ChevronRight,
  Highlighter,
} from "lucide-react";
import type { Row } from "@/types";
import { cn } from "@/lib/utils";
import { ScreenerAnalyticsDialog } from "./ScreenerAnalyticsDialog";

// ─── Types ────────────────────────────────────────────────────────────────────

type Decision = "include" | "exclude" | "maybe" | null;

interface AIScreenResult {
  decision: "include" | "exclude";
  confidence: number;
  reasoning: string;
  highlightTerms: string[];
  latency: number;
}

interface ColMap {
  title: string;
  abstract: string;
  keywords: string;
  journal: string;
}

interface WordHighlighter {
  include: string;
  exclude: string;
}

interface ASSession {
  name: string;
  savedAt: string;
  data: Row[];
  aiResults: Record<number, AIScreenResult>;
  decisions: Record<number, Decision>;
  criteria: string;
  colMap: ColMap;
  wordHighlighter: WordHighlighter;
  currentIndex: number;
  dataName: string;
}

interface ASAutosave extends ASSession {
  sessionName: string;
}

interface ASSettings {
  autoAdvance: boolean;
  lightMode: boolean;
  horizontalDecisions: boolean;
  buttonsAboveText: boolean;
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

const AUTOSAVE_KEY  = "as_autosave";
const AUTOSAVE_PREV = "as_autosave_prev";
const SESSIONS_KEY  = "as_named_sessions";
const SETTINGS_KEY  = "as_settings";

// ─── Default criteria pre-fill ────────────────────────────────────────────────

const DEFAULT_CRITERIA: Record<string, string> = {
  "Systematic Review Abstracts": `Include if:
- Randomised controlled trial (RCT) or systematic review/meta-analysis
- Human adults (≥18 years)
- Depression or anxiety as primary outcome

Exclude if:
- Animal studies
- Non-English language
- Case reports, editorials, or opinion pieces
- Paediatric or adolescent populations only`,
};

// ─── Storage helpers ──────────────────────────────────────────────────────────

function listSessions(): ASSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as ASSession[]).sort(
      (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );
  } catch { return []; }
}

function upsertSession(s: ASSession) {
  const all = listSessions();
  const i = all.findIndex((x) => x.name === s.name);
  if (i >= 0) all[i] = s; else all.unshift(s);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
}

function deleteStoredSession(name: string) {
  localStorage.setItem(
    SESSIONS_KEY,
    JSON.stringify(listSessions().filter((s) => s.name !== name))
  );
}

function loadSettings(): ASSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const defaults: ASSettings = { autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false };
    return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<ASSettings>) } : defaults;
  } catch { return { autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false }; }
}

function saveSettingsToStorage(s: ASSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function timeAgo(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function extractJson(text: string): Record<string, unknown> | null {
  try { return JSON.parse(text) as Record<string, unknown>; } catch { /* fall through */ }
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return null;
}

function autoDetectColMap(cols: string[]): ColMap {
  const norm = (s: string) => s.toLowerCase().replace(/[_\s-]/g, "");
  const find = (...candidates: string[]) =>
    cols.find((c) => candidates.includes(norm(c))) ?? "";
  return {
    title:    find("title", "ti", "t1", "articletitle"),
    abstract: find("abstract", "ab", "abs", "summary"),
    keywords: find("keywords", "kw", "tags", "keyword"),
    journal:  find("journal", "jo", "jf", "t2", "source", "publication", "venue"),
  };
}

// ─── Multi-group abstract highlighter ────────────────────────────────────────

function highlightAbstract(
  text: string,
  aiTerms: string[],
  includeWords: string[],
  excludeWords: string[]
): React.ReactNode {
  const termMap = new Map<string, string>();

  const push = (terms: string[], cls: string) => {
    for (const t of terms) {
      const clean = t.trim();
      if (clean) termMap.set(clean.toLowerCase(), cls);
    }
  };

  push(includeWords, "bg-green-200 dark:bg-green-900/50 rounded px-0.5");
  push(excludeWords, "bg-red-200 dark:bg-red-900/50 rounded px-0.5");
  push(aiTerms,      "bg-amber-200 dark:bg-amber-800 rounded px-0.5");

  if (!termMap.size) return text;

  const allTerms = [...termMap.keys()].sort((a, b) => b.length - a.length);
  const pattern  = allTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re       = new RegExp(`(${pattern})`, "gi");
  const parts    = text.split(re);

  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const cls = termMap.get(part.toLowerCase());
    return cls ? <mark key={i} className={cls}>{part}</mark> : part;
  });
}

function parseWordList(raw: string): string[] {
  return raw.split(/[,\n]/).map((w) => w.trim()).filter(Boolean);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AbstractScreenerPage() {
  // ── Core state ─────────────────────────────────────────────────────────────
  const [data, setData]                 = useState<Row[]>([]);
  const [aiResults, setAiResults]       = useState<Record<number, AIScreenResult>>({});
  const [decisions, setDecisions]       = useState<Record<number, Decision>>({});
  const [includeCriteria, setIncludeCriteria] = useState("");
  const [excludeCriteria, setExcludeCriteria] = useState("");
  const [colMap, setColMap]             = useState<ColMap>({ title: "", abstract: "", keywords: "", journal: "" });
  const [wordHighlighter, setWordHighlighter] = useState<WordHighlighter>({ include: "", exclude: "" });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dataName, setDataName]         = useState("");
  const [sessionName, setSessionName]   = useState("");

  const criteria = includeCriteria || excludeCriteria
    ? `Include if:\n${includeCriteria}\n\nExclude if:\n${excludeCriteria}`
    : "";

  // ── UI state ───────────────────────────────────────────────────────────────
  const [isBatching, setIsBatching]       = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchErrors, setBatchErrors]     = useState(0);
  const [showBatchPanel, setShowBatchPanel] = useState(false);
  const [concurrency, setConcurrency]     = useState(5);
  const [askingAI, setAskingAI]           = useState(false);
  const [showHighlighter, setShowHighlighter] = useState(false);
  const [showAnalytics, setShowAnalytics]   = useState(false);
  const [showTable, setShowTable]           = useState(false);
  const [tableFilter, setTableFilter]       = useState<"all" | "include" | "exclude" | "maybe" | "undecided">("all");
  const [showSessions, setShowSessions]     = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showAIReasoning, setShowAIReasoning] = useState(false);
  const [sessions, setSessions]             = useState<ASSession[]>([]);
  const [settings, setSettings]             = useState<ASSettings>({ autoAdvance: false, lightMode: true, horizontalDecisions: true, buttonsAboveText: false });
  const [recovered, setRecovered]           = useState<{ count: number; savedAt: string; sessionName: string } | null>(null);
  const [autosaveTime, setAutosaveTime]     = useState<Date | null>(null);
  const [autosaveDisplay, setAutosaveDisplay] = useState("");
  const [pendingLoad, setPendingLoad]       = useState<{ data: Row[]; name: string } | null>(null);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef<ASAutosave>({
    name: "", savedAt: "", data: [], aiResults: {}, decisions: {},
    criteria: "", colMap: { title: "", abstract: "", keywords: "", journal: "" },
    wordHighlighter: { include: "", exclude: "" },
    currentIndex: 0, dataName: "", sessionName: "",
  });

  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Auto-generate AI Instructions ──────────────────────────────────────────
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are an abstract screener for systematic literature reviews.");
    lines.push("");

    if (criteria.trim()) {
      lines.push("CRITERIA:");
      lines.push(criteria.trim());
      lines.push("");
    }

    const mappedCols = Object.entries(colMap).filter(([, v]) => v);
    if (mappedCols.length > 0) {
      lines.push("COLUMN MAPPING:");
      mappedCols.forEach(([field, col]) => lines.push(`- ${field}: ${col}`));
      lines.push("");
    }

    lines.push("RULES:");
    lines.push("- For each abstract, decide: include or exclude");
    lines.push('- Return a JSON object: {"decision": "include"|"exclude", "confidence": 0-1, "reasoning": "...", "highlight_terms": ["..."]}');
    lines.push("- Base decisions strictly on the criteria above");
    lines.push("- Do not include markdown or code fences");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [criteria, colMap]);

  // AI Instructions
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  // ── On mount: restore settings + autosave ──────────────────────────────────
  useEffect(() => {
    setSettings(loadSettings());
    setSessions(listSessions());

    let raw: string | null = null;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch { /* ignore */ }
    if (!raw) { try { raw = localStorage.getItem(AUTOSAVE_PREV); } catch { /* ignore */ } }
    if (!raw) return;

    try {
      const s = JSON.parse(raw) as ASAutosave;
      if (!s.data?.length) return;
      setData(s.data);
      setAiResults(s.aiResults || {});
      setDecisions(s.decisions || {});
      const savedCriteria = s.criteria || "";
      const includeMatch = savedCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
      const excludeMatch = savedCriteria.match(/Exclude if:\n([\s\S]*?)$/);
      setIncludeCriteria(includeMatch ? includeMatch[1].trim() : savedCriteria);
      setExcludeCriteria(excludeMatch ? excludeMatch[1].trim() : "");
      setColMap(s.colMap || { title: "", abstract: "", keywords: "", journal: "" });
      setWordHighlighter(s.wordHighlighter || { include: "", exclude: "" });
      setCurrentIndex(s.currentIndex || 0);
      setDataName(s.dataName || "");
      setSessionName(s.sessionName || (s.dataName || "").replace(/\.[^.]+$/, ""));
      const cnt = Object.values(s.decisions || {}).filter(Boolean).length;
      setRecovered({ count: cnt, savedAt: s.savedAt || new Date().toISOString(), sessionName: s.sessionName || "" });
    } catch { /* corrupt autosave */ }
  }, []);

  // ── Autosave on state change ─────────────────────────────────────────────
  useEffect(() => {
    if (data.length === 0) return;
    const payload: ASAutosave = {
      name: sessionName, savedAt: new Date().toISOString(),
      data, aiResults, decisions, criteria, colMap, wordHighlighter,
      currentIndex, dataName, sessionName,
    };
    stateRef.current = payload;
    try {
      const existing = localStorage.getItem(AUTOSAVE_KEY);
      if (existing) localStorage.setItem(AUTOSAVE_PREV, existing);
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      setAutosaveTime(new Date());
    } catch { /* storage full */ }
  }, [data, aiResults, decisions, includeCriteria, excludeCriteria, colMap, wordHighlighter, currentIndex, dataName, sessionName]);

  // ── Sync stateRef every render ───────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (data.length === 0) return;
    stateRef.current = {
      name: sessionName, savedAt: stateRef.current.savedAt,
      data, aiResults, decisions, criteria, colMap, wordHighlighter,
      currentIndex, dataName, sessionName,
    };
  });

  // ── beforeunload sync write ──────────────────────────────────────────────
  useEffect(() => {
    const handler = () => {
      const s = stateRef.current;
      if (!s.data.length) return;
      try {
        const payload = { ...s, savedAt: new Date().toISOString() };
        const existing = localStorage.getItem(AUTOSAVE_KEY);
        if (existing) localStorage.setItem(AUTOSAVE_PREV, existing);
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(payload));
      } catch { /* ignore */ }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Autosave ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!autosaveTime) return;
    setAutosaveDisplay(timeAgo(autosaveTime));
    const id = setInterval(() => setAutosaveDisplay(timeAgo(autosaveTime)), 15_000);
    return () => clearInterval(id);
  }, [autosaveTime]);

  // ── Derived values ───────────────────────────────────────────────────────
  const totalRows       = data.length;
  const currentRow      = data[currentIndex] as Row | undefined;
  const currentAI       = aiResults[currentIndex];
  const currentDecision = decisions[currentIndex] ?? null;
  const allColumns      = data.length > 0 ? Object.keys(data[0]) : [];
  const aiCount         = Object.keys(aiResults).length;

  const decidedEntries  = Object.values(decisions).filter(Boolean);
  const decidedCount    = decidedEntries.length;
  const includeCount    = decidedEntries.filter((d) => d === "include").length;
  const excludeCount    = decidedEntries.filter((d) => d === "exclude").length;
  const maybeCount      = decidedEntries.filter((d) => d === "maybe").length;
  const undecidedCount  = totalRows - decidedCount;

  const aiAgreementData = Object.entries(decisions).reduce(
    (acc, [i, dec]) => {
      const ai = aiResults[Number(i)];
      if (!ai || !dec || dec === "maybe") return acc;
      acc.total++;
      if (dec === ai.decision) acc.match++;
      return acc;
    },
    { total: 0, match: 0 }
  );
  const aiAgreementRate = aiAgreementData.total > 0
    ? Math.round((aiAgreementData.match / aiAgreementData.total) * 100)
    : null;

  // ── Navigation ───────────────────────────────────────────────────────────
  const navigate = (dir: number) =>
    setCurrentIndex((i) => Math.max(0, Math.min(totalRows - 1, i + dir)));

  const goToNextUndecided = () => {
    for (let i = currentIndex + 1; i < totalRows; i++) {
      if (!decisions[i]) { setCurrentIndex(i); return; }
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!decisions[i]) { setCurrentIndex(i); return; }
    }
    if (currentIndex < totalRows - 1) setCurrentIndex(currentIndex + 1);
  };

  // ── Decision toggling ────────────────────────────────────────────────────
  const setDecision = (d: Decision) => {
    const wasActive = currentDecision === d;
    const next: Decision = wasActive ? null : d;
    setDecisions((prev) => ({ ...prev, [currentIndex]: next }));
    if (!wasActive && settings.autoAdvance) {
      setTimeout(goToNextUndecided, 200);
    }
  };

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    if (data.length === 0 || isBatching) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); navigate(1); }
      if (e.key === "ArrowLeft"  || e.key === "h") { e.preventDefault(); navigate(-1); }
      if (e.key === "y") { e.preventDefault(); setDecision("include"); }
      if (e.key === "n") { e.preventDefault(); setDecision("exclude"); }
      if (e.key === "m") { e.preventDefault(); setDecision("maybe"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.length, isBatching, currentIndex, decisions, settings.autoAdvance]);

  // ── Data loading ─────────────────────────────────────────────────────────
  const doDataLoaded = (newData: Row[], name: string, autoFillCriteria?: string) => {
    setRecovered(null);
    setData(newData);
    setDataName(name);
    setAiResults({});
    setDecisions({});
    setCurrentIndex(0);
    const sName = name.replace(/\.[^.]+$/, "");
    setSessionName(sName);
    const cols = Object.keys(newData[0] || {});
    setColMap(autoDetectColMap(cols));
    if (autoFillCriteria) {
      const includeMatch = autoFillCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
      const excludeMatch = autoFillCriteria.match(/Exclude if:\n([\s\S]*?)$/);
      setIncludeCriteria(includeMatch ? includeMatch[1].trim() : autoFillCriteria);
      setExcludeCriteria(excludeMatch ? excludeMatch[1].trim() : "");
    }
    toast.success(`Loaded ${newData.length} records`);
  };

  const handleDataLoaded = (newData: Row[], name: string) => {
    if (decidedCount > 0) {
      setPendingLoad({ data: newData, name });
    } else {
      doDataLoaded(newData, name);
    }
  };

  const handleLoadSample = (key: string) => {
    const s = SAMPLE_DATASETS[key];
    if (!s) return;
    const autoFill = DEFAULT_CRITERIA[s.name];
    if (decidedCount > 0) {
      setPendingLoad({ data: s.data as Row[], name: s.name });
    } else {
      doDataLoaded(s.data as Row[], s.name, autoFill);
    }
  };

  // ── Session management ───────────────────────────────────────────────────
  const updateSettings = (patch: Partial<ASSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettingsToStorage(next);
  };

  const saveSession = (name?: string) => {
    const n = (name || sessionName || dataName || "Session").trim();
    const s: ASSession = {
      name: n, savedAt: new Date().toISOString(),
      data, aiResults, decisions, criteria, colMap, wordHighlighter, currentIndex, dataName,
    };
    upsertSession(s);
    setSessions(listSessions());
    setSessionName(n);
    setShowSaveDialog(false);
    toast.success(`Saved "${n}"`);
  };

  const loadSession = (s: ASSession) => {
    setData(s.data);
    setAiResults(s.aiResults || {});
    setDecisions(s.decisions || {});
    const loadedCriteria = s.criteria || "";
    const lInclude = loadedCriteria.match(/Include if:\n([\s\S]*?)(?:\n\nExclude if:|$)/);
    const lExclude = loadedCriteria.match(/Exclude if:\n([\s\S]*?)$/);
    setIncludeCriteria(lInclude ? lInclude[1].trim() : loadedCriteria);
    setExcludeCriteria(lExclude ? lExclude[1].trim() : "");
    setColMap(s.colMap || { title: "", abstract: "", keywords: "", journal: "" });
    setWordHighlighter(s.wordHighlighter || { include: "", exclude: "" });
    setCurrentIndex(s.currentIndex || 0);
    setDataName(s.dataName || "");
    setSessionName(s.name);
    setShowSessions(false);
    toast.success(`Loaded "${s.name}"`);
  };

  // ── Batch AI pre-screening ───────────────────────────────────────────────
  const runBatch = async () => {
    if (!activeModel) {
      toast.error("No model configured — go to Settings to add one.");
      return;
    }
    if (!criteria.trim()) {
      toast.error("Please enter inclusion/exclusion criteria before running AI.");
      return;
    }
    if (!colMap.title && !colMap.abstract && !colMap.keywords && !colMap.journal) {
      toast.error("Map at least one column (title, abstract, etc.) before running AI.");
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsBatching(true);
    setBatchProgress(0);
    setBatchErrors(0);

    const systemPrompt = aiInstructions;
    const results: Record<number, AIScreenResult> = {};
    let errorCount = 0;

    const localRunId = await dispatchCreateRun({ runType: "abstract-screener", provider: activeModel.providerId, model: activeModel.defaultModel, temperature: systemSettings.temperature, systemPrompt, inputFile: dataName || "unnamed", inputRows: data.length });

    for (let i = 0; i < data.length; i++) {
      if (ctrl.signal.aborted) break;
      const row = data[i];

      const parts = [
        colMap.title    && row[colMap.title]    ? `Title: ${String(row[colMap.title])}` : "",
        colMap.journal  && row[colMap.journal]  ? `Journal: ${String(row[colMap.journal])}` : "",
        colMap.keywords && row[colMap.keywords] ? `Keywords: ${String(row[colMap.keywords])}` : "",
        colMap.abstract && row[colMap.abstract] ? `Abstract: ${String(row[colMap.abstract])}` : "",
      ].filter(Boolean);

      if (parts.length === 0) { setBatchProgress(i + 1); continue; }
      const userContent = parts.join("\n\n");

      try {
        const { output } = await dispatchProcessRow({
          provider: activeModel.providerId, model: activeModel.defaultModel,
          apiKey: activeModel.apiKey || "", baseUrl: activeModel.baseUrl,
          systemPrompt, userContent, temperature: systemSettings.temperature,
        });

        const parsed = extractJson(output);
        const rawConf = typeof parsed?.confidence === "number" ? parsed.confidence : 0.8;
        results[i] = {
          decision:
            parsed?.decision === "include" || parsed?.decision === "exclude"
              ? (parsed.decision as "include" | "exclude") : "exclude",
          confidence: Math.max(0, Math.min(1, rawConf)),
          reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : "",
          highlightTerms: Array.isArray(parsed?.highlight_terms)
            ? (parsed.highlight_terms as unknown[]).filter((t): t is string => typeof t === "string")
            : [],
          latency: 0,
        };
      } catch (err) {
        errorCount++;
        setBatchErrors(errorCount);
        console.error(`Row ${i} failed:`, err);
      }

      setBatchProgress(i + 1);
    }

    setAiResults(results);
    setDecisions((prev) => {
      const merged: Record<number, Decision> = { ...prev };
      Object.entries(results).forEach(([idx, r]) => {
        if (merged[Number(idx)] == null) merged[Number(idx)] = r.decision;
      });
      return merged;
    });

    if (localRunId) {
      const resultRows = Object.entries(results).map(([idx, r]) => ({
        rowIndex: Number(idx),
        input: data[Number(idx)] as Record<string, unknown>,
        output: JSON.stringify(r),
        status: "success" as const,
        latency: r.latency,
      }));
      await dispatchSaveResults(localRunId, resultRows);
    }

    setIsBatching(false);

    const processed = Object.keys(results).length;
    if (errorCount > 0) {
      toast.warning(`AI finished: ${processed} processed, ${errorCount} failed. Check your API key and model.`);
    } else {
      toast.success(`AI pre-screened ${processed} abstracts`);
    }
  };

  const stopBatch = () => { abortRef.current?.abort(); setIsBatching(false); };

  // ── Per-row AI suggestion ──────────────────────────────────────────────────
  const askAI = async () => {
    if (!activeModel || !criteria.trim() || !currentRow) return;
    setAskingAI(true);
    try {
      const parts = [
        colMap.title    && currentRow[colMap.title]    ? `Title: ${String(currentRow[colMap.title])}` : "",
        colMap.journal  && currentRow[colMap.journal]  ? `Journal: ${String(currentRow[colMap.journal])}` : "",
        colMap.keywords && currentRow[colMap.keywords] ? `Keywords: ${String(currentRow[colMap.keywords])}` : "",
        colMap.abstract && currentRow[colMap.abstract] ? `Abstract: ${String(currentRow[colMap.abstract])}` : "",
      ].filter(Boolean);
      if (parts.length === 0) { setAskingAI(false); return; }

      const { output } = await dispatchProcessRow({
        provider: activeModel.providerId, model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "", baseUrl: activeModel.baseUrl,
        systemPrompt: aiInstructions, userContent: parts.join("\n\n"),
        temperature: systemSettings.temperature,
      });

      const parsed = extractJson(output);
      const rawConf = typeof parsed?.confidence === "number" ? parsed.confidence : 0.8;
      const result: AIScreenResult = {
        decision: parsed?.decision === "include" || parsed?.decision === "exclude"
          ? (parsed.decision as "include" | "exclude") : "exclude",
        confidence: Math.max(0, Math.min(1, rawConf)),
        reasoning: typeof parsed?.reasoning === "string" ? parsed.reasoning : "",
        highlightTerms: Array.isArray(parsed?.highlight_terms)
          ? (parsed.highlight_terms as unknown[]).filter((t): t is string => typeof t === "string")
          : [],
        latency: 0,
      };
      setAiResults((prev) => ({ ...prev, [currentIndex]: result }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("AI suggestion failed", { description: msg });
    }
    setAskingAI(false);
  };

  // ── Export functions ────────────────────────────────────────────────────────

  // ── Human-only export (original data + final_decision) ──
  const buildHumanRows = () => data.map((row, i) => ({
    ...row,
    final_decision: decisions[i] ?? "",
  }));

  const buildHumanDecisionsOnly = () => data.map((row, i) => ({
    title:          colMap.title   ? String(row[colMap.title]   ?? "") : "",
    journal:        colMap.journal ? String(row[colMap.journal] ?? "") : "",
    year:           String(row.year ?? row.Year ?? ""),
    final_decision: decisions[i] ?? "",
  }));

  const exportHumanCsv = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildHumanRows(), `${base}_human_full.csv`);
  };

  const exportHumanDecisions = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildHumanDecisionsOnly(), `${base}_human_decisions.csv`);
  };

  const exportHumanXlsx = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadXLSX(buildHumanRows(), `${base}_human_codes`);
  };

  const exportHumanJson = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    const blob = new Blob([JSON.stringify(buildHumanRows(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${base}_human_codes.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── With-AI export (original data + ai columns + final_decision) ──
  const buildWithAIRows = () => data.map((row, i) => ({
    ...row,
    ai_decision: aiResults[i]?.decision ?? "",
    ai_confidence: aiResults[i]?.confidence != null
      ? `${Math.round(aiResults[i].confidence * 100)}%` : "",
    ai_reasoning: aiResults[i]?.reasoning ?? "",
    final_decision: decisions[i] ?? "",
  }));

  const buildWithAIDecisionsOnly = () => data.map((row, i) => ({
    title:          colMap.title   ? String(row[colMap.title]   ?? "") : "",
    journal:        colMap.journal ? String(row[colMap.journal] ?? "") : "",
    year:           String(row.year ?? row.Year ?? ""),
    ai_decision: aiResults[i]?.decision ?? "",
    ai_confidence: aiResults[i]?.confidence != null
      ? `${Math.round(aiResults[i].confidence * 100)}%` : "",
    final_decision: decisions[i] ?? "",
  }));

  const exportWithAICsv = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildWithAIRows(), `${base}_with_ai.csv`);
  };

  const exportWithAIDecisions = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadCSV(buildWithAIDecisionsOnly(), `${base}_with_ai_decisions.csv`);
  };

  const exportWithAIXlsx = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    void downloadXLSX(buildWithAIRows(), `${base}_with_ai`);
  };

  const exportWithAIJson = () => {
    const base = dataName.replace(/\.[^.]+$/, "") || "session";
    const blob = new Blob([JSON.stringify(buildWithAIRows(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${base}_with_ai.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const getField = (row: Row | undefined, field: string) =>
    field && row ? String(row[field] ?? "") : "";

  // ── Screening view derived values ──────────────────────────────────────────
  const abstractText = getField(currentRow, colMap.abstract);
  const titleText    = getField(currentRow, colMap.title);
  const journalText  = getField(currentRow, colMap.journal);
  const keywordsText = getField(currentRow, colMap.keywords);
  const yearText     = String(currentRow?.year ?? currentRow?.Year ?? "");

  const aiTerms      = currentAI?.highlightTerms ?? [];
  const includeWords = parseWordList(wordHighlighter.include);
  const excludeWords = parseWordList(wordHighlighter.exclude);

  const keywordPills = keywordsText
    ? keywordsText.split(/[;,]/).map((k) => k.trim()).filter(Boolean)
    : [];

  const tableRows = data
    .map((row, i) => ({
      i,
      title: getField(row, colMap.title) || `Record ${i + 1}`,
      decision: decisions[i] ?? null,
      aiDecision: aiResults[i]?.decision ?? null,
      aiConf: aiResults[i]?.confidence ?? null,
    }))
    .filter((r) => {
      if (tableFilter === "all") return true;
      if (tableFilter === "undecided") return !r.decision;
      return r.decision === tableFilter;
    });

  const canRunAI = !!activeModel && !!criteria.trim() && (!!colMap.title || !!colMap.abstract || !!colMap.keywords || !!colMap.journal);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER — Single scrollable page with 6 numbered sections
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-0 pb-16">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="pb-6 space-y-1 max-w-3xl">
        <h1 className="text-4xl font-bold">Abstract Screener</h1>
        <p className="text-muted-foreground text-sm">
          AI-assisted systematic review screening — batch pre-screen then review
        </p>
      </div>

      {/* ── Recovery banner ──────────────────────────────────────────────── */}
      {recovered && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700 mb-4">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Session recovered</p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                {recovered.sessionName && <><strong>{recovered.sessionName}</strong> · </>}
                {recovered.count} record{recovered.count !== 1 ? "s" : ""} screened
                {" · "}saved {timeAgo(new Date(recovered.savedAt))}
              </p>
            </div>
          </div>
          <button onClick={() => setRecovered(null)}
            className="shrink-0 text-amber-500 hover:text-amber-700 p-0.5" aria-label="Dismiss">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ── Session resume (when no data loaded) ─────────────────────────── */}
      {data.length === 0 && sessions.length > 0 && (
        <div className="border rounded-xl overflow-hidden mb-4">
          <div className="px-4 py-3 border-b font-medium text-sm">Resume a Session</div>
          <div className="p-3 space-y-2">
            {sessions.slice(0, 5).map((s) => {
              const decided = Object.values(s.decisions || {}).filter(Boolean).length;
              return (
                <div key={s.name} className="flex items-center justify-between p-2.5 rounded border hover:bg-muted/30">
                  <div>
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {s.data.length} records · {decided} screened · {new Date(s.savedAt).toLocaleDateString()}
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

      {/* ── 1. Upload Data ────────────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Upload Data</h2>
        <UploadPreview
          data={data}
          dataName={dataName}
          onDataLoaded={handleDataLoaded}
          samplePickerPosition="above"
          customSamplePicker={
            <Select onValueChange={handleLoadSample}>
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
        <p className="text-sm text-muted-foreground -mt-2">
          Map your CSV columns to the fields the AI needs. Auto-detected on upload.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(["title", "abstract", "keywords", "journal"] as const).map((field) => (
            <div key={field} className="space-y-1">
              <Label className="text-xs capitalize">{field}</Label>
              <select
                className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                value={colMap[field]}
                onChange={(e) => setColMap((prev) => ({ ...prev, [field]: e.target.value }))}
              >
                <option value="">(none)</option>
                {allColumns.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t" />

      {/* ── 3. Define Criteria ────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Define Criteria</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-green-700 dark:text-green-400 font-medium">Include if</Label>
            <textarea
              value={includeCriteria}
              onChange={(e) => setIncludeCriteria(e.target.value)}
              className={cn(
                "w-full border rounded px-3 py-2 text-sm resize-none h-28 bg-background font-mono transition-colors",
                !includeCriteria.trim() && !excludeCriteria.trim() && "border-amber-400 dark:border-amber-600"
              )}
              placeholder={"- RCT or systematic review\n- Adults (≥18 years)\n- Depression or anxiety as primary outcome"}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-red-700 dark:text-red-400 font-medium">Exclude if</Label>
            <textarea
              value={excludeCriteria}
              onChange={(e) => setExcludeCriteria(e.target.value)}
              className={cn(
                "w-full border rounded px-3 py-2 text-sm resize-none h-28 bg-background font-mono transition-colors",
                !includeCriteria.trim() && !excludeCriteria.trim() && "border-amber-400 dark:border-amber-600"
              )}
              placeholder={"- Animal studies\n- Non-English language\n- Case reports, editorials"}
            />
          </div>
        </div>
        {!criteria.trim() && (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Criteria required to run AI
          </p>
        )}

        {/* Word Highlighter (collapsible) */}
        <div className="border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowHighlighter((v) => !v)}
            className="flex items-center gap-2 text-sm w-full px-3 py-2 hover:bg-muted/30 transition-colors"
          >
            {showHighlighter ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <Highlighter className="h-3.5 w-3.5 text-muted-foreground" />
            Word Highlighter
            {(wordHighlighter.include || wordHighlighter.exclude) && (
              <span className="ml-auto flex gap-1.5">
                {wordHighlighter.include && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    include: {parseWordList(wordHighlighter.include).length}
                  </span>
                )}
                {wordHighlighter.exclude && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    exclude: {parseWordList(wordHighlighter.exclude).length}
                  </span>
                )}
              </span>
            )}
          </button>
          {showHighlighter && (
            <div className="border-t p-3 bg-muted/5 space-y-3">
              <p className="text-xs text-muted-foreground">
                Words highlighted in abstracts: <span className="text-green-600 font-medium">include terms</span> in green,{" "}
                <span className="text-red-600 font-medium">exclude terms</span> in red,{" "}
                <span className="text-amber-600 font-medium">AI terms</span> in amber.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-green-700 dark:text-green-400">Include keywords</Label>
                  <textarea
                    value={wordHighlighter.include}
                    onChange={(e) => setWordHighlighter((p) => ({ ...p, include: e.target.value }))}
                    className="w-full border border-green-300 dark:border-green-800 rounded px-2 py-1.5 text-xs resize-none h-20 bg-background font-mono"
                    placeholder="RCT, randomised, adults, depression&#10;(comma or one per line)"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs font-medium text-red-700 dark:text-red-400">Exclude keywords</Label>
                  <textarea
                    value={wordHighlighter.exclude}
                    onChange={(e) => setWordHighlighter((p) => ({ ...p, exclude: e.target.value }))}
                    className="w-full border border-red-300 dark:border-red-800 rounded px-2 py-1.5 text-xs resize-none h-20 bg-background font-mono"
                    placeholder="animal, rat, mouse, mice&#10;children, adolescent"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ────────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      >
        <NoModelWarning activeModel={activeModel} />
      </AIInstructionsSection>

      <div className="border-t" />

      {/* ── 5. Screen Data ────────────────────────────────────────────────── */}
      <div className="space-y-3 py-8">
        <h2 className="text-2xl font-bold">5. Screen Data</h2>

        {data.length > 0 && (
          <div className="space-y-3">

            {/* ── Settings bar ──────────────────────────────────────────── */}
            <div className="flex items-center gap-5 flex-wrap text-sm border rounded-lg px-4 py-2.5 bg-muted/10">
              <div className="flex items-center gap-2">
                <Switch id="as-light" checked={settings.lightMode} onCheckedChange={(v) => updateSettings({ lightMode: v })} />
                <Label htmlFor="as-light" className="text-xs cursor-pointer">Light mode</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-horiz" checked={settings.horizontalDecisions} onCheckedChange={(v) => updateSettings({ horizontalDecisions: v })} />
                <Label htmlFor="as-horiz" className="text-xs cursor-pointer">Horizontal decisions</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-above" checked={settings.buttonsAboveText} onCheckedChange={(v) => updateSettings({ buttonsAboveText: v })} />
                <Label htmlFor="as-above" className="text-xs cursor-pointer">Buttons above text</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="as-auto" checked={settings.autoAdvance} onCheckedChange={(v) => updateSettings({ autoAdvance: v })} />
                <Label htmlFor="as-auto" className="text-xs cursor-pointer">Auto-advance</Label>
              </div>
            </div>

            {/* ── Decision buttons (above text if setting on) ──────────── */}
            {settings.buttonsAboveText && (
              <div className={settings.horizontalDecisions ? "flex gap-2" : "space-y-2"}>
                {(
                  [
                    { d: "include" as const, label: "✓ Include", shortcut: "y",
                      active: "bg-green-500 hover:bg-green-600 text-white border-green-500",
                      inactive: "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30" },
                    { d: "maybe" as const, label: "? Maybe", shortcut: "m",
                      active: "bg-amber-500 hover:bg-amber-600 text-white border-amber-500",
                      inactive: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30" },
                    { d: "exclude" as const, label: "✗ Exclude", shortcut: "n",
                      active: "bg-red-500 hover:bg-red-600 text-white border-red-500",
                      inactive: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30" },
                  ] as const
                ).map(({ d, label, shortcut, active, inactive }) => {
                  const isActive = currentDecision === d;
                  const conf = currentAI?.decision === d ? currentAI.confidence : null;
                  return (
                    <button key={d} onClick={() => setDecision(d)}
                      className={cn(
                        "relative border-2 rounded-lg py-3 px-4 text-sm font-medium transition-all flex flex-col items-center gap-0.5 flex-1",
                        isActive ? active : inactive
                      )}
                    >
                      <span>{label}</span>
                      {conf !== null && conf > 0 && (
                        <span className={cn("text-[10px]", isActive ? "opacity-80" : "opacity-60")}>
                          AI {Math.round(conf * 100)}%
                        </span>
                      )}
                      <span className="absolute bottom-1 right-2 text-[9px] opacity-30">{shortcut}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Content: Abstract display card ────────────────────────── */}
            <div className={cn(
              "border rounded-xl overflow-hidden",
              settings.lightMode ? "bg-slate-50 dark:bg-slate-900/50" : "bg-slate-900 text-slate-100"
            )}>
              <div className="p-5 space-y-3">
                {titleText ? (
                  <h2 className="text-xl font-semibold leading-snug">{titleText}</h2>
                ) : (
                  <h2 className="text-xl font-semibold leading-snug text-muted-foreground italic">
                    Record {currentIndex + 1}
                  </h2>
                )}

                {(journalText || yearText) && (
                  <p className={cn("text-sm", settings.lightMode ? "text-muted-foreground" : "text-slate-400")}>
                    {[journalText, yearText].filter(Boolean).join(" · ")}
                  </p>
                )}

                {keywordPills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {keywordPills.map((kw, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-normal">{kw}</Badge>
                    ))}
                  </div>
                )}

                {abstractText ? (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {(aiTerms.length > 0 || includeWords.length > 0 || excludeWords.length > 0)
                      ? highlightAbstract(abstractText, aiTerms, includeWords, excludeWords)
                      : abstractText}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No abstract text available</p>
                )}
              </div>
            </div>

            {/* AI result badge + reasoning */}
            {currentAI && (
              <div className="flex items-start gap-3 px-4 py-3 border rounded-lg">
                <span className={cn(
                  "shrink-0 text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                  currentAI.decision === "include"
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                )}>
                  AI: {currentAI.decision}
                  {currentAI.confidence > 0 && (
                    <span className="ml-1 opacity-70">{Math.round(currentAI.confidence * 100)}%</span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <button onClick={() => setShowAIReasoning((v) => !v)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                    {showAIReasoning ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    {showAIReasoning ? "Hide" : "Show"} reasoning
                  </button>
                  {showAIReasoning && currentAI.reasoning && (
                    <p className="text-xs text-muted-foreground mt-1 italic">{currentAI.reasoning}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Decision buttons (below text if setting off) ─────────── */}
            {!settings.buttonsAboveText && (
              <div className={settings.horizontalDecisions ? "flex gap-2" : "space-y-2"}>
                {(
                  [
                    { d: "include" as const, label: "✓ Include", shortcut: "y",
                      active: "bg-green-500 hover:bg-green-600 text-white border-green-500",
                      inactive: "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-400 dark:hover:bg-green-950/30" },
                    { d: "maybe" as const, label: "? Maybe", shortcut: "m",
                      active: "bg-amber-500 hover:bg-amber-600 text-white border-amber-500",
                      inactive: "border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950/30" },
                    { d: "exclude" as const, label: "✗ Exclude", shortcut: "n",
                      active: "bg-red-500 hover:bg-red-600 text-white border-red-500",
                      inactive: "border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30" },
                  ] as const
                ).map(({ d, label, shortcut, active, inactive }) => {
                  const isActive = currentDecision === d;
                  const conf = currentAI?.decision === d ? currentAI.confidence : null;
                  return (
                    <button key={d} onClick={() => setDecision(d)}
                      className={cn(
                        "relative border-2 rounded-lg py-3 px-4 text-sm font-medium transition-all flex flex-col items-center gap-0.5 flex-1",
                        isActive ? active : inactive
                      )}
                    >
                      <span>{label}</span>
                      {conf !== null && conf > 0 && (
                        <span className={cn("text-[10px]", isActive ? "opacity-80" : "opacity-60")}>
                          AI {Math.round(conf * 100)}%
                        </span>
                      )}
                      <span className="absolute bottom-1 right-2 text-[9px] opacity-30">{shortcut}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Ask AI (per-row) ─────────────────────────────────────── */}
            {activeModel && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm"
                  className="border-orange-300 text-orange-600 hover:bg-orange-50 dark:border-orange-700 dark:text-orange-400"
                  disabled={askingAI || !canRunAI}
                  onClick={() => void askAI()}>
                  {askingAI ? "Asking AI…" : currentAI ? "Refresh AI" : "Ask AI"}
                </Button>
              </div>
            )}

            {/* ── AI Batch Processing (collapsible) ────────────────────── */}
            <div className="border rounded-lg overflow-hidden">
              <button
                onClick={() => setShowBatchPanel((v) => !v)}
                className="flex items-center justify-between w-full px-3 py-2 text-sm hover:bg-muted/30 transition-colors"
              >
                <span className="font-medium">AI Batch Processing</span>
                <span className="text-muted-foreground text-xs">{showBatchPanel ? "▲" : "▼"}</span>
              </button>
              {showBatchPanel && (
                <div className="border-t p-3 space-y-3">
                  {!isBatching ? (
                    <>
                      <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Concurrency:</span>
                          <Button variant="outline" size="sm" className="h-6 w-6 p-0"
                            onClick={() => setConcurrency((c) => Math.max(1, c - 1))}>−</Button>
                          <span className="w-5 text-center font-mono">{concurrency}</span>
                          <Button variant="outline" size="sm" className="h-6 w-6 p-0"
                            onClick={() => setConcurrency((c) => Math.min(20, c + 1))}>+</Button>
                        </div>
                        {activeModel && (
                          <span className="text-muted-foreground">
                            Model: <strong>{activeModel.defaultModel}</strong>
                          </span>
                        )}
                      </div>
                      <Button size="sm" disabled={!canRunAI || data.length === 0}
                        onClick={() => void runBatch()}
                        className="bg-orange-500 hover:bg-orange-600 text-white w-full">
                        Run AI Batch ({totalRows} rows)
                      </Button>
                      {aiCount > 0 && (
                        <p className="text-xs text-green-600">✓ AI suggestions ready for {aiCount}/{totalRows} rows</p>
                      )}
                    </>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span>Processing {totalRows} rows… {batchProgress}/{totalRows}
                          {batchErrors > 0 && <span className="text-amber-600 ml-2">({batchErrors} errors)</span>}
                        </span>
                        <Button variant="outline" size="sm" onClick={stopBatch}
                          className="border-red-300 text-red-600 hover:bg-red-50">
                          Stop
                        </Button>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
                        <div className="bg-orange-500 h-full transition-all duration-300 rounded-full"
                          style={{ width: `${totalRows > 0 ? Math.round((batchProgress / totalRows) * 100) : 0}%` }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Next button ──────────────────────────────────────────── */}
            <Button className="w-full h-10 text-base"
              onClick={() => navigate(1)}
              disabled={currentIndex >= totalRows - 1}>
              Next →
            </Button>

            {/* ── Navigation bar (5 elements) ──────────────────────────── */}
            <div className="grid grid-cols-5 gap-1.5 items-center">
              <Button variant="outline" size="sm" onClick={() => setCurrentIndex(0)}
                disabled={currentIndex === 0}>◀◀</Button>
              <Button variant="outline" size="sm" onClick={() => navigate(-1)}
                disabled={currentIndex === 0}>◀</Button>
              <div className="text-center text-sm font-medium border rounded px-3 py-1.5">
                {currentIndex + 1} / {totalRows}
              </div>
              <Button variant="outline" size="sm" onClick={() => navigate(1)}
                disabled={currentIndex >= totalRows - 1}>▶</Button>
              <Button variant="outline" size="sm" onClick={() => setCurrentIndex(totalRows - 1)}
                disabled={currentIndex >= totalRows - 1}>▶▶</Button>
            </div>
            <div className="text-[10px] text-muted-foreground text-center">
              ← → or h/l navigate &nbsp;·&nbsp; y include &nbsp;·&nbsp; n exclude &nbsp;·&nbsp; m maybe
            </div>

            {/* ── Session bar (below navigation) ──────────────────────── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="text-sm">
                <span className="font-medium">Session: </span>
                <code className="text-blue-600 dark:text-blue-400 text-xs bg-blue-50 dark:bg-blue-950/30 px-1.5 py-0.5 rounded">
                  {sessionName || dataName || "untitled"}
                </code>
                <span className="text-muted-foreground ml-2 text-xs">
                  ({decidedCount}/{totalRows} screened, {aiCount} AI)
                </span>
              </div>
              {autosaveTime && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <span className="text-green-500">✓</span> Autosaved {autosaveDisplay}
                </span>
              )}
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
                    const decided = Object.values(s.decisions || {}).filter(Boolean).length;
                    return (
                      <div key={s.name} className="flex items-center justify-between p-2 rounded hover:bg-muted/30 border">
                        <div>
                          <span className="text-sm font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">
                            {s.data.length} records · {decided} screened · {new Date(s.savedAt).toLocaleDateString()}
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

            {/* ── Progress bar ─────────────────────────────────────────── */}
            <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
              <div className="bg-blue-500 h-full transition-all duration-500"
                style={{ width: `${totalRows > 0 ? (decidedCount / totalRows) * 100 : 0}%` }} />
            </div>

            {/* Table panel */}
            {showTable && (
              <div className="border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b font-medium text-sm flex items-center gap-2 flex-wrap">
                  <span>Records</span>
                  <div className="flex gap-1 flex-wrap">
                    {(["all", "include", "exclude", "maybe", "undecided"] as const).map((f) => (
                      <button key={f} onClick={() => setTableFilter(f)}
                        className={cn("px-2 py-0.5 rounded text-xs border",
                          tableFilter === f
                            ? "bg-foreground text-background border-foreground"
                            : "border-muted-foreground/30 text-muted-foreground hover:border-foreground/50"
                        )}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                  <span className="ml-auto text-xs text-muted-foreground">{tableRows.length} rows</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y">
                  {tableRows.map(({ i, title, decision, aiDecision, aiConf }) => (
                    <button key={i} onClick={() => { setCurrentIndex(i); setShowTable(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2.5 hover:bg-muted/30 transition-colors flex items-center gap-3",
                        i === currentIndex && "bg-muted/50"
                      )}>
                      <span className="text-xs text-muted-foreground w-8 shrink-0">{i + 1}</span>
                      <span className="text-sm flex-1 truncate">{title}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {aiDecision && (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded border",
                            aiDecision === "include"
                              ? "border-green-300 text-green-600 dark:border-green-800 dark:text-green-400"
                              : "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400"
                          )}>
                            AI{aiConf ? ` ${Math.round(aiConf * 100)}%` : ""}
                          </span>
                        )}
                        {decision ? (
                          <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium",
                            decision === "include" ? "bg-green-500 text-white" :
                            decision === "maybe"   ? "bg-amber-500 text-white" : "bg-red-500 text-white"
                          )}>{decision}</span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 6. Export Results ──────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">6. Export Results</h2>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Analytics */}
          <Button variant="outline" size="sm" onClick={() => setShowAnalytics(true)}
            disabled={decidedCount === 0 && aiCount === 0}>
            <BarChart2 className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </Button>

          {/* Export Human Codes */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={decidedCount === 0}>
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export Human Codes <ChevronDown className="h-3 w-3 ml-1.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={exportHumanCsv}>CSV (full)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanDecisions}>CSV (decisions only)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanXlsx}>Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={exportHumanJson}>JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Export with AI */}
          {aiCount > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={decidedCount === 0}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export with AI <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={exportWithAICsv}>CSV (full)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIDecisions}>CSV (decisions only)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIXlsx}>Excel (.xlsx)</DropdownMenuItem>
                <DropdownMenuItem onClick={exportWithAIJson}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* ── Analytics Dialog ───────────────────────────────────────────────── */}
      <ScreenerAnalyticsDialog
        open={showAnalytics}
        onOpenChange={setShowAnalytics}
        data={data}
        decisions={decisions}
        aiResults={aiResults}
        colMap={colMap}
        onGoToRow={(idx) => { setCurrentIndex(idx); }}
      />

      {/* ── Pending load dialog ───────────────────────────────────────────── */}
      <Dialog open={!!pendingLoad} onOpenChange={(open) => { if (!open) setPendingLoad(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Replace current session?</DialogTitle>
            <DialogDescription>
              You have{" "}
              <strong>{decidedCount} screened record{decidedCount !== 1 ? "s" : ""}</strong>{" "}
              in the current session. Loading new data will replace all of this.
              Your session has been autosaved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingLoad(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => {
              if (pendingLoad) doDataLoaded(pendingLoad.data, pendingLoad.name);
              setPendingLoad(null);
            }}>Load anyway</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
