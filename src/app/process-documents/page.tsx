"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import pLimit from "p-limit";
import { useDropzone } from "react-dropzone";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useActiveModel, useSystemSettings } from "@/lib/hooks";
import Link from "next/link";
import {
  FileText,
  Upload,
  X,
  Download,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ExternalLink,
  Plus,
  Sparkles,
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type { Row } from "@/types";
import type { FieldDef, FileState } from "@/types";
import { documentExtractDirect, documentAnalyzeDirect } from "@/lib/llm-browser";
import { createRun, saveResults } from "@/lib/db-tauri";
import { downloadCSV } from "@/lib/export";
import { getPrompt, formatExtractionSchema } from "@/lib/prompts";

// ─── Constants ────────────────────────────────────────────────────────────────

const FIELD_TYPES: FieldDef["type"][] = ["text", "number", "date", "boolean", "list"];

const TEMPLATES: Record<string, { label: string; desc: string; fields: FieldDef[] }> = {
  custom: {
    label: "Custom",
    desc: "Define your own extraction schema",
    fields: [],
  },
  key_points: {
    label: "Key Points",
    desc: "Main claims, supporting evidence, and relevance",
    fields: [
      { name: "key_point", type: "text", description: "Main claim or finding" },
      { name: "supporting_evidence", type: "text", description: "Evidence supporting the claim" },
      { name: "relevance", type: "text", description: "Why this point is relevant" },
    ],
  },
  meeting_minutes: {
    label: "Meeting Minutes",
    desc: "Action items, decisions, owners, and dates",
    fields: [
      { name: "date", type: "date", description: "Meeting date" },
      { name: "agenda_item", type: "text", description: "Agenda item discussed" },
      { name: "decision_or_action", type: "text", description: "Decision made or action required" },
      { name: "owner", type: "text", description: "Person responsible" },
      { name: "due_date", type: "date", description: "Action item due date" },
    ],
  },
  research_summary: {
    label: "Research Summary",
    desc: "Research question, methodology, findings, conclusions",
    fields: [
      { name: "research_question", type: "text", description: "Main research question" },
      { name: "methodology", type: "text", description: "Research methodology used" },
      { name: "key_finding", type: "text", description: "Key finding or result" },
      { name: "conclusion", type: "text", description: "Main conclusion" },
      { name: "limitation", type: "text", description: "Study limitation" },
    ],
  },
  invoice: {
    label: "Invoice",
    desc: "Line items, prices, vendor, and totals",
    fields: [
      { name: "invoice_number", type: "text", description: "Invoice identifier" },
      { name: "date", type: "date", description: "Invoice date" },
      { name: "vendor", type: "text", description: "Vendor or supplier name" },
      { name: "item_description", type: "text", description: "Line item description" },
      { name: "quantity", type: "number", description: "Item quantity" },
      { name: "unit_price", type: "number", description: "Price per unit" },
      { name: "total", type: "number", description: "Line item total" },
    ],
  },
  contract: {
    label: "Contract",
    desc: "Parties, obligations, payment terms, key clauses",
    fields: [
      { name: "party", type: "text", description: "Party or organization name" },
      { name: "obligation", type: "text", description: "Key obligation or requirement" },
      { name: "payment_terms", type: "text", description: "Payment terms and conditions" },
      { name: "termination_conditions", type: "text", description: "Termination conditions" },
      { name: "key_clause", type: "text", description: "Important contract clause" },
    ],
  },
};

const FILE_TYPES = [
  { key: "txt_md",  label: "TXT/MD",   exts: [".txt", ".md"],        mime: ["text/plain", "text/markdown"] },
  { key: "pdf",     label: "PDF",       exts: [".pdf"],               mime: ["application/pdf"] },
  { key: "docx",    label: "DOCX",      exts: [".docx"],              mime: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  { key: "json_csv",label: "JSON/CSV",  exts: [".json", ".csv"],      mime: ["application/json", "text/csv"] },
  { key: "html",    label: "HTML",      exts: [".html", ".htm"],      mime: ["text/html"] },
];

const DEFAULT_TYPES = new Set(["txt_md", "pdf", "docx"]);

function getFileTypeKey(file: File): string | null {
  const name = file.name.toLowerCase();
  for (const ft of FILE_TYPES) {
    if (ft.exts.some((ext) => name.endsWith(ext))) return ft.key;
  }
  return null;
}

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ─── FieldEditor ──────────────────────────────────────────────────────────────

function FieldEditor({
  fields,
  onChange,
  presets,
  onSavePreset,
  onLoadPreset,
}: {
  fields: FieldDef[];
  onChange: (f: FieldDef[]) => void;
  presets: Record<string, FieldDef[]>;
  onSavePreset: (name: string) => void;
  onLoadPreset: (name: string) => void;
}) {
  const [quickInput, setQuickInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSavePreset, setShowSavePreset] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<FieldDef["type"]>("text");
  const [newDesc, setNewDesc] = useState("");
  const [presetName, setPresetName] = useState("");

  // "author, date:date, price:number" → FieldDef[]
  const submitQuickAdd = () => {
    const trimmed = quickInput.trim();
    if (!trimmed) return;
    const toAdd: FieldDef[] = [];
    trimmed.split(",").forEach((token) => {
      const [rawName, rawType] = token.trim().split(":");
      if (!rawName?.trim()) return;
      const name = rawName.trim().toLowerCase().replace(/\s+/g, "_");
      const type: FieldDef["type"] = FIELD_TYPES.includes(rawType?.trim() as FieldDef["type"])
        ? (rawType.trim() as FieldDef["type"])
        : "text";
      if (!fields.some((f) => f.name === name) && !toAdd.some((f) => f.name === name)) {
        toAdd.push({ name, type, description: "" });
      }
    });
    if (toAdd.length > 0) onChange([...fields, ...toAdd]);
    setQuickInput("");
  };

  const addAdvancedField = () => {
    if (!newName.trim()) return;
    const name = newName.trim().toLowerCase().replace(/\s+/g, "_");
    if (!fields.some((f) => f.name === name)) {
      onChange([...fields, { name, type: newType, description: newDesc.trim() }]);
    }
    setNewName(""); setNewType("text"); setNewDesc(""); setShowAdvanced(false);
  };

  const presetKeys = Object.keys(presets);

  return (
    <div className="space-y-3">
      {/* Chips */}
      <div className="min-h-[44px] flex flex-wrap gap-2 p-3 border rounded-lg bg-muted/10">
        {fields.length === 0 ? (
          <span className="text-xs text-muted-foreground italic self-center">
            No fields — type below, import from CSV, or use AI Suggest
          </span>
        ) : (
          fields.map((f, i) => (
            <Badge key={i} variant="secondary" className="flex items-center gap-1.5 text-xs py-1 px-2">
              <span className="font-mono">{f.name}</span>
              <span className="text-muted-foreground opacity-60">({f.type})</span>
              {f.description && (
                <span className="text-muted-foreground opacity-50 max-w-[80px] truncate" title={f.description}>
                  {f.description}
                </span>
              )}
              <button onClick={() => onChange(fields.filter((_, j) => j !== i))}
                className="ml-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))
        )}
      </div>

      {/* Quick-add */}
      <div className="flex gap-2">
        <Input
          value={quickInput}
          onChange={(e) => setQuickInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitQuickAdd()}
          placeholder="e.g.  title, author, date:date, price:number"
          className="h-8 text-xs font-mono flex-1"
        />
        <Button size="sm" variant="outline" className="h-8 px-3 shrink-0" onClick={submitQuickAdd}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1">
        Comma-separated names. Append <span className="font-mono">:type</span> for typed fields (text, number, date, boolean, list).
      </p>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {presetKeys.length > 0 && (
          <Select onValueChange={onLoadPreset}>
            <SelectTrigger className="h-7 text-xs w-36">
              <SelectValue placeholder="Load preset…" />
            </SelectTrigger>
            <SelectContent>
              {presetKeys.map((k) => (
                <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {fields.length > 0 && (
          <>
            <Button size="sm" variant="ghost" className="h-7 text-xs"
              onClick={() => setShowSavePreset(!showSavePreset)}>
              Save preset
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={() => onChange([])}>
              Clear all
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-xs ml-auto text-muted-foreground"
          onClick={() => setShowAdvanced(!showAdvanced)}>
          {showAdvanced ? "Hide" : "+ with description"}
        </Button>
      </div>

      {/* Advanced: single field with description */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-muted/5 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAdvancedField()}
              placeholder="field_name" className="h-8 text-xs font-mono w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={newType} onValueChange={(v) => setNewType(v as FieldDef["type"])}>
              <SelectTrigger className="h-8 text-xs w-24"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[160px]">
            <Label className="text-xs">Description (LLM hint)</Label>
            <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addAdvancedField()}
              placeholder="e.g. Full name of primary author" className="h-8 text-xs" />
          </div>
          <Button size="sm" onClick={addAdvancedField} className="h-8 text-xs">Add</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowAdvanced(false)} className="h-8 text-xs">Cancel</Button>
        </div>
      )}

      {/* Save preset */}
      {showSavePreset && (
        <div className="flex gap-2 items-center">
          <Input value={presetName} onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && presetName.trim()) {
                onSavePreset(presetName.trim()); setPresetName(""); setShowSavePreset(false);
              }
            }}
            placeholder="Preset name" className="h-7 text-xs flex-1 max-w-48" />
          <Button size="sm" className="h-7 text-xs" onClick={() => {
            if (presetName.trim()) {
              onSavePreset(presetName.trim()); setPresetName(""); setShowSavePreset(false);
            }
          }}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowSavePreset(false)}>Cancel</Button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ProcessDocumentsPage() {
  const activeModel = useActiveModel();
  const systemSettings = useSystemSettings();

  // ── Section 1: Documents
  const [inputMethod, setInputMethod] = useState<"upload" | "folder">("upload");
  const [folderPath, setFolderPath] = useState("");
  const [enabledTypes, setEnabledTypes] = useState<Set<string>>(new Set(DEFAULT_TYPES));
  const [fileStates, setFileStates] = useState<FileState[]>([]);

  // ── Section 2: Fields
  const [templateKey, setTemplateKey] = useState("custom");
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [suggestedFields, setSuggestedFields] = useState<FieldDef[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [presets, setPresets] = useState<Record<string, FieldDef[]>>({});
  const [customPrompt, setCustomPrompt] = useState("");

  // ── Processing
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [allResults, setAllResults] = useState<Row[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  const abortRef = useRef(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const csvImportRef = useRef<HTMLInputElement>(null);

  type RunMode = "preview" | "test" | "full";

  // Load presets from localStorage (avoid hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem("pd_field_presets");
    if (stored) {
      try { setPresets(JSON.parse(stored)); } catch { /* ignore */ }
    }
  }, []);

  // ── File drop ──────────────────────────────────────────────────────────────
  const acceptedMime: Record<string, string[]> = {};
  FILE_TYPES.filter((ft) => enabledTypes.has(ft.key)).forEach((ft) => {
    ft.mime.forEach((m) => { acceptedMime[m] = ft.exts; });
  });

  const onDrop = useCallback(
    (accepted: File[]) => {
      const valid = accepted.filter((f) => {
        const key = getFileTypeKey(f);
        return key && enabledTypes.has(key);
      });
      const skipped = accepted.length - valid.length;
      if (skipped > 0) toast.warning(`${skipped} file(s) skipped — type not enabled`);
      setFileStates((prev) => [
        ...prev,
        ...valid.map((f): FileState => ({ file: f, status: "pending" })),
      ]);
    },
    [enabledTypes]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, accept: acceptedMime, multiple: true,
  });

  const removeFile = (idx: number) =>
    setFileStates((prev) => prev.filter((_, i) => i !== idx));

  const toggleType = (key: string) =>
    setEnabledTypes((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    const valid = selected.filter((f) => { const k = getFileTypeKey(f); return k && enabledTypes.has(k); });
    const skipped = selected.length - valid.length;
    if (skipped > 0) toast.warning(`${skipped} file(s) skipped — type not enabled`);
    if (valid.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const folder = (valid[0] as any).webkitRelativePath?.split("/")[0] ?? "selected folder";
      setFolderPath(folder);
      setFileStates(valid.map((f): FileState => ({ file: f, status: "pending" })));
    }
    e.target.value = "";
  };

  // ── Template ───────────────────────────────────────────────────────────────
  const currentTemplate = TEMPLATES[templateKey] ?? TEMPLATES.custom;

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = TEMPLATES[key];
    if (t?.fields.length > 0) setFields(t.fields);
  };

  // ── Presets ────────────────────────────────────────────────────────────────
  const savePreset = (name: string) => {
    const updated = { ...presets, [name]: fields };
    setPresets(updated);
    localStorage.setItem("pd_field_presets", JSON.stringify(updated));
    toast.success(`Preset "${name}" saved`);
  };

  const loadPreset = (name: string) => {
    const preset = presets[name];
    if (preset) { setFields(preset); toast.success(`Preset "${name}" loaded`); }
  };

  // ── Import fields from CSV headers ─────────────────────────────────────────
  const handleCsvImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = (ev.target?.result as string) ?? "";
      const firstLine = text.split(/\r?\n/)[0] ?? "";
      const rawHeaders = firstLine
        .split(",")
        .map((h) => h.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      if (rawHeaders.length === 0) return toast.error("No columns found in CSV");
      const imported: FieldDef[] = rawHeaders.map((h) => ({
        name: h.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""),
        type: "text" as FieldDef["type"],
        description: h,
      }));
      setFields(imported);
      toast.success(`${imported.length} fields imported from CSV headers`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // ── AI Suggest ─────────────────────────────────────────────────────────────
  const analyzeSample = async () => {
    if (fileStates.length === 0) return toast.error("Upload at least one file first");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    setAnalyzing(true);
    try {
      let result: { fields: FieldDef[] };
      const sampleFile = fileStates[0].file;

      if (isTauri) {
        result = await documentAnalyzeDirect({
          file: sampleFile,
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          apiKey: activeModel.apiKey || "",
          baseUrl: activeModel.baseUrl,
        });
      } else {
        const buffer = await sampleFile.arrayBuffer();
        const base64 = btoa(new Uint8Array(buffer).reduce((d, b) => d + String.fromCharCode(b), ""));
        const ftKey = getFileTypeKey(sampleFile);
        const fileType = ftKey?.replace("txt_md", "txt").replace("json_csv", "json").replace("html", "html") ?? "txt";
        const res = await fetch("/api/document-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileContent: base64, fileType,
            fileName: sampleFile.name,
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            apiKey: activeModel.apiKey || "",
            baseUrl: activeModel.baseUrl,
          }),
        });
        result = await res.json();
      }

      if (result.fields?.length > 0) {
        setSuggestedFields(result.fields);
        toast.success(`${result.fields.length} fields suggested — review below`);
      } else {
        toast.info("No suggestions returned. Try with a more structured document.");
      }
    } catch (err: unknown) {
      toast.error("Analysis failed", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setAnalyzing(false);
    }
  };

  const acceptSuggestedField = (sf: FieldDef) => {
    setFields((prev) => prev.some((f) => f.name === sf.name) ? prev : [...prev, sf]);
  };

  const acceptAllSuggested = () => {
    setFields((prev) => {
      const toAdd = suggestedFields.filter((sf) => !prev.some((f) => f.name === sf.name));
      return [...prev, ...toAdd];
    });
  };

  // ── System prompt ──────────────────────────────────────────────────────────
  const buildSystemPrompt = (): string => {
    if (fields.length > 0) {
      return getPrompt("document.extraction").replace("{schema}", formatExtractionSchema(fields));
    }
    return (
      customPrompt.trim() ||
      getPrompt("document.extraction").replace(
        "{schema}",
        "(no schema defined — extract all logical records with appropriate column names)"
      )
    );
  };

  // ── File state updater ─────────────────────────────────────────────────────
  const updateFileState = useCallback(
    (idx: number, updates: Partial<Omit<FileState, "file">>) => {
      setFileStates((prev) => prev.map((fs, i) => (i === idx ? { ...fs, ...updates } : fs)));
    },
    []
  );

  // ── Process ────────────────────────────────────────────────────────────────
  const canProcess = fileStates.length > 0 || folderPath.trim().length > 0;

  const processFiles = async (mode: RunMode) => {
    if (fileStates.length === 0) return toast.error("No files uploaded");
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");

    const targets = (mode === "full" ? fileStates : fileStates.slice(0, 1)).map((fs, i) => ({ fs, idx: i }));
    const systemPrompt = buildSystemPrompt();

    abortRef.current = false;
    setRunId(null);
    setIsProcessing(true);
    setProgress({ completed: 0, total: targets.length });
    setFileStates((prev) =>
      prev.map((fs, i) =>
        i < targets.length ? { ...fs, status: "pending" as const, error: undefined, records: undefined } : fs
      )
    );

    let localRunId: string | null = null;
    try {
      if (isTauri) {
        const rd = await createRun({
          runType: "process-documents",
          provider: activeModel.providerId,
          model: activeModel.defaultModel,
          temperature: systemSettings.temperature,
          systemPrompt,
          inputFile: fileStates.map((f) => f.file.name).join(", ") || "unnamed",
          inputRows: targets.length,
        });
        localRunId = rd.id ?? null;
      } else {
        const runRes = await fetch("/api/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runType: "process-documents",
            provider: activeModel.providerId,
            model: activeModel.defaultModel,
            temperature: systemSettings.temperature,
            systemPrompt,
            inputFile: fileStates.map((f) => f.file.name).join(", ") || "unnamed",
            inputRows: targets.length,
          }),
        });
        if (!runRes.ok) throw new Error(`Server error ${runRes.status}`);
        const rd = await runRes.json();
        localRunId = rd.id ?? null;
      }
    } catch (err) {
      console.warn("Run creation failed:", err);
    }

    const resultsByIndex = new Map<number, Row[]>();
    const limit = pLimit(systemSettings.maxConcurrency);

    const tasks = targets.map(({ fs: entry, idx }) =>
      limit(async () => {
        if (abortRef.current) return;
        updateFileState(idx, { status: "extracting" });

        try {
          let data: {
            records?: Record<string, unknown>[];
            error?: string;
            fileName?: string;
            charCount?: number;
            truncated?: boolean;
            count?: number;
          };

          if (isTauri) {
            updateFileState(idx, { status: "analyzing" });
            data = await documentExtractDirect({
              file: entry.file,
              provider: activeModel.providerId,
              model: activeModel.defaultModel,
              apiKey: activeModel.apiKey || "",
              baseUrl: activeModel.baseUrl,
              systemPrompt,
              fields: fields.length > 0 ? fields : undefined,
            });
          } else {
            const buffer = await entry.file.arrayBuffer();
            const base64 = btoa(new Uint8Array(buffer).reduce((d, byte) => d + String.fromCharCode(byte), ""));
            const ftKey = getFileTypeKey(entry.file);
            const fileType = ftKey?.replace("txt_md", "txt").replace("json_csv", "json").replace("html", "html") ?? "txt";

            updateFileState(idx, { status: "analyzing" });
            const res = await fetch("/api/document-extract", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileContent: base64,
                fileType,
                fileName: entry.file.name,
                provider: activeModel.providerId,
                model: activeModel.defaultModel,
                apiKey: activeModel.apiKey || "local",
                baseUrl: activeModel.baseUrl,
                systemPrompt: fields.length === 0 ? systemPrompt : undefined,
                fields: fields.length > 0 ? fields : undefined,
              }),
            });
            if (!res.ok) throw new Error(`Server error ${res.status}`);
            data = await res.json();
          }

          if (data.error) throw new Error(data.error);

          const records = ((data.records ?? []) as Row[]).map((r) => ({
            document_name: entry.file.name,
            ...r,
          }));

          resultsByIndex.set(idx, records);
          updateFileState(idx, {
            status: "done",
            records: data.records,
            truncated: data.truncated,
            charCount: data.charCount,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          updateFileState(idx, { status: "error", error: msg });
          toast.error(`Failed: ${entry.file.name}`, { description: msg });
        }

        setProgress((prev) => ({ ...prev, completed: prev.completed + 1 }));
      })
    );

    await Promise.allSettled(tasks);

    const accumulated: Row[] = [];
    for (let i = 0; i < targets.length; i++) {
      const records = resultsByIndex.get(i);
      if (records) accumulated.push(...records);
    }

    setAllResults(accumulated);

    // Save results to history
    if (localRunId && accumulated.length > 0) {
      try {
        const resultRows = accumulated.map((r, i) => ({
          rowIndex: i,
          input: r as Record<string, unknown>,
          output: JSON.stringify(r),
          status: "success" as const,
        }));
        if (isTauri) {
          await saveResults(localRunId, resultRows);
        } else {
          await fetch("/api/results", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: localRunId, results: resultRows }),
          });
        }
      } catch (err) {
        console.warn("Failed to save results to history:", err);
      }
    }

    setRunId(localRunId);
    setIsProcessing(false);
    if (accumulated.length > 0) {
      toast.success(`Extracted ${accumulated.length} records from ${targets.length} file(s)`);
    }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const outputColumns =
    fields.length > 0
      ? `document_name, ${fields.map((f) => f.name).join(", ")}`
      : "document_name + [AI-defined columns]";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-4xl mx-auto space-y-0 pb-16">

      {/* Header */}
      <div className="pb-6 space-y-1">
        <h1 className="text-4xl font-bold">Process Documents</h1>
        <p className="text-muted-foreground text-sm">
          Extract structured tabular data from PDF, DOCX, or text documents using AI
        </p>
      </div>

      {/* ── 1. Select Documents ───────────────────────────────────────────── */}
      <div className="space-y-4 pb-8">
        <h2 className="text-2xl font-bold">1. Select Documents</h2>

        {/* Input method toggle */}
        <div className="flex items-center gap-6">
          {(["upload", "folder"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="inputMethod"
                value={m}
                checked={inputMethod === m}
                onChange={() => setInputMethod(m)}
                className="accent-primary"
              />
              <span className="text-sm font-medium">
                {m === "upload" ? "Upload Files" : "Folder Path"}
              </span>
            </label>
          ))}
        </div>

        {/* Folder path */}
        {inputMethod === "folder" ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label className="text-sm font-semibold">Folder Path</Label>
              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex gap-2">
              <Input
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="Click Browse to select a folder"
                className="flex-1 text-sm font-mono"
                readOnly
              />
              <Button variant="outline" className="shrink-0" onClick={() => folderInputRef.current?.click()}>
                Browse
              </Button>
              <input
                ref={folderInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                multiple
                className="hidden"
                onChange={handleFolderSelect}
              />
            </div>
            {fileStates.length > 0 && folderPath && (
              <p className="text-xs text-muted-foreground">
                {fileStates.length} file{fileStates.length !== 1 ? "s" : ""} found in{" "}
                <span className="font-mono">{folderPath}</span>
              </p>
            )}
          </div>
        ) : (
          /* Drop zone */
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/20"
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {isDragActive ? "Drop files here…" : "Drop files here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Accepts file types selected below
            </p>
          </div>
        )}

        {/* File list */}
        {fileStates.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground">{fileStates.length} file{fileStates.length !== 1 ? "s" : ""}</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => { setFileStates([]); setAllResults([]); toast.success("Cleared all files"); }}>
                <Trash2 className="h-3 w-3 mr-1" /> Clear All
              </Button>
            </div>
            {fileStates.map((entry, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border bg-muted/20">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="flex-1 truncate text-xs">{entry.file.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {(entry.file.size / 1024).toFixed(0)} KB
                  </span>

                  {entry.status === "pending" && (
                    <Badge variant="outline" className="text-[9px] shrink-0">Pending</Badge>
                  )}
                  {entry.status === "extracting" && (
                    <span className="flex items-center gap-1 text-[10px] text-blue-600 shrink-0">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Extracting
                    </span>
                  )}
                  {entry.status === "analyzing" && (
                    <span className="flex items-center gap-1 text-[10px] text-purple-600 shrink-0">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing
                    </span>
                  )}
                  {entry.status === "done" && (
                    <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {entry.records?.length ?? 0} records
                    </span>
                  )}
                  {entry.status === "error" && (
                    <span className="flex items-center gap-1 text-[10px] text-red-500 shrink-0" title={entry.error}>
                      <AlertCircle className="h-3.5 w-3.5" /> Error
                    </span>
                  )}

                  <button onClick={() => removeFile(idx)} className="text-muted-foreground hover:text-destructive shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {entry.truncated && entry.charCount !== undefined && (
                  <div className="ml-3 text-[10px] text-amber-600 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    Text truncated at 50K chars (full doc: {entry.charCount.toLocaleString()} chars)
                  </div>
                )}
                {entry.status === "error" && entry.error && (
                  <div className="ml-3 text-[10px] text-red-500 leading-snug">{entry.error}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* File types */}
        <div className="space-y-2">
          <div className="text-sm font-semibold">Accepted File Types</div>
          <div className="flex flex-wrap gap-5">
            {FILE_TYPES.map((ft) => (
              <label key={ft.key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledTypes.has(ft.key)}
                  onChange={() => toggleType(ft.key)}
                  className="accent-primary w-4 h-4"
                />
                <span className="text-sm font-medium">{ft.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 2. Define Fields ──────────────────────────────────────────────── */}
      <div className="space-y-5 py-8">
        <h2 className="text-2xl font-bold">2. Define Fields</h2>

        {/* Template */}
        <div className="space-y-2">
          <Label className="text-sm">Template</Label>
          <Select value={templateKey} onValueChange={applyTemplate}>
            <SelectTrigger className="w-full text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <SelectItem key={key} value={key} className="text-sm">{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{currentTemplate.desc}</p>
        </div>

        {/* Field editor */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Schema Fields</Label>
          <FieldEditor
            fields={fields}
            onChange={setFields}
            presets={presets}
            onSavePreset={savePreset}
            onLoadPreset={loadPreset}
          />
        </div>

        {/* Output columns preview */}
        <div className="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
          <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Output columns: </span>
          <span className="text-xs font-mono text-blue-600 dark:text-blue-400">{outputColumns}</span>
        </div>

        {/* Import from CSV / AI Suggest cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Import CSV */}
          <button
            type="button"
            onClick={() => csvImportRef.current?.click()}
            className="flex items-start gap-3 p-4 border-2 border-dashed rounded-lg hover:border-primary/60 hover:bg-muted/20 transition-colors text-left"
          >
            <Table2 className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
            <div>
              <div className="text-sm font-semibold">Import from CSV</div>
              <div className="text-xs text-muted-foreground mt-1">
                Upload a CSV file — its column headers become your extraction fields instantly
              </div>
            </div>
          </button>
          <input ref={csvImportRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvImport} />

          {/* AI Suggest */}
          <button
            type="button"
            disabled={fileStates.length === 0 || analyzing || !activeModel}
            onClick={analyzeSample}
            className="flex items-start gap-3 p-4 border-2 border-dashed rounded-lg hover:border-primary/60 hover:bg-muted/20 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {analyzing
              ? <Loader2 className="h-5 w-5 text-primary mt-0.5 shrink-0 animate-spin" />
              : <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            }
            <div>
              <div className="text-sm font-semibold">
                {analyzing ? "Analyzing document…" : "AI Suggest fields"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {fileStates.length === 0
                  ? "Upload a document first (Section 1)"
                  : !activeModel
                  ? "Configure a model in Settings first"
                  : "AI reads your document and suggests the best fields to extract"}
              </div>
            </div>
          </button>
        </div>

        {/* AI suggestions panel */}
        {suggestedFields.length > 0 && (
          <div className="p-4 border rounded-lg bg-muted/5 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-semibold">
                  {suggestedFields.length} fields suggested
                </span>
                <span className="text-xs text-muted-foreground ml-2">
                  — click a field to add it, or accept all
                </span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={acceptAllSuggested}>
                Accept All
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedFields.map((sf, i) => {
                const accepted = fields.some((f) => f.name === sf.name);
                return (
                  <button
                    key={i}
                    onClick={() => !accepted && acceptSuggestedField(sf)}
                    disabled={accepted}
                    title={sf.description}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                      accepted
                        ? "border-green-400 bg-green-50 text-green-700 dark:bg-green-950/20 dark:text-green-400 cursor-default"
                        : "border-primary/40 bg-primary/5 hover:bg-primary/15 cursor-pointer"
                    }`}
                  >
                    <span className="font-mono font-medium">{sf.name}</span>
                    <span className="opacity-60 text-[10px]">{sf.type}</span>
                    {accepted
                      ? <CheckCircle2 className="h-3 w-3 text-green-600" />
                      : <Plus className="h-3 w-3 opacity-40" />
                    }
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Hover a field to see its description. Accepted fields are highlighted in green.
            </p>
          </div>
        )}

        {/* Extraction Prompt — always visible */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Extraction Prompt</Label>
          {fields.length > 0 ? (
            <div className="relative">
              <Textarea
                value={buildSystemPrompt()}
                readOnly
                className="min-h-[180px] text-xs font-mono resize-y bg-muted/20 text-muted-foreground cursor-default"
              />
              <span className="absolute top-2 right-2 text-[10px] bg-background/90 text-muted-foreground px-1.5 py-0.5 rounded border">
                auto-generated
              </span>
            </div>
          ) : (
            <Textarea
              placeholder="Describe what to extract and how to structure the output. Leave blank for automatic extraction — the AI will decide the columns."
              className="min-h-[120px] text-sm resize-y"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
          )}
          <p className="text-xs text-muted-foreground">
            {fields.length > 0
              ? "Generated from your field schema above. Clear all fields to write a custom prompt instead."
              : "This prompt is sent to the AI for every document. Define fields above to get a structured, typed schema prompt automatically."}
          </p>
        </div>

        {/* Warnings */}
        {!canProcess ? (
          <div className="px-4 py-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300">
            Upload files or select a folder in Section 1 to get started.
          </div>
        ) : !activeModel ? (
          <Link href="/settings">
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 cursor-pointer hover:opacity-90 text-sm text-amber-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              No AI model configured — click here to add an API key in Settings
            </div>
          </Link>
        ) : null}
      </div>

      <div className="border-t" />

      {/* ── 3. Execute ────────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">3. Execute</h2>

        {isProcessing && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Processing {progress.completed} of {progress.total} files…</span>
              <div className="flex items-center gap-2">
                <span>
                  {progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0}%
                </span>
                <Button
                  variant="outline" size="sm"
                  onClick={() => { abortRef.current = true; }}
                  className="h-6 px-2 text-[11px] border-red-300 text-red-600 hover:bg-red-50"
                >
                  Stop
                </Button>
              </div>
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="outline" size="lg"
            className="h-12 text-sm border-dashed"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("preview")}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Preview (1 doc)
          </Button>
          <Button
            size="lg"
            className="h-12 text-base bg-primary hover:bg-primary/90"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("test")}
          >
            {isProcessing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Test (1 file)
          </Button>
          <Button
            variant="outline" size="lg"
            className="h-12 text-base"
            disabled={!canProcess || isProcessing || !activeModel}
            onClick={() => processFiles("full")}
          >
            {isProcessing ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <><FileText className="h-4 w-4 mr-2" /> Process All ({fileStates.length} file{fileStates.length !== 1 ? "s" : ""})</>
            )}
          </Button>
        </div>
      </div>

      {/* ── Results ───────────────────────────────────────────────────────── */}
      {allResults.length > 0 && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Extracted Data</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {allResults.length} records from {fileStates.filter((f) => f.status === "done").length} file(s)
              </p>
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link
                  href={`/history/${runId}`}
                  className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              <Button
                variant="outline" size="sm"
                onClick={() => void downloadCSV(allResults, "extracted_documents.csv")}
              >
                <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
              </Button>
            </div>
          </div>
          <div className="border rounded-lg overflow-hidden">
            <DataTable data={allResults} />
          </div>
        </div>
      )}
    </div>
  );
}
