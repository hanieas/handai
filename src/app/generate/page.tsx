"use client";

import React, { useState, useEffect, useCallback } from "react";
import { DataTable } from "@/components/tools/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useActiveModel } from "@/lib/hooks";
import { Sparkles, Plus, Trash2, Download, Loader2, Minus, ExternalLink, Check, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import type { GenerateColumn, Row } from "@/types";
import { dispatchGenerateRow, dispatchProcessRow, dispatchCreateRun, dispatchSaveResults } from "@/lib/llm-dispatch";
import { NoModelWarning } from "@/components/tools/NoModelWarning";
import { AIInstructionsSection } from "@/components/tools/AIInstructionsSection";
import { useAIInstructions, AI_INSTRUCTIONS_MARKER } from "@/hooks/useAIInstructions";
import { getPrompt } from "@/lib/prompts";
import * as XLSX from "xlsx";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SuggestedField {
  name: string;
  type: "text" | "number" | "boolean" | "list";
  description: string;
  checked: boolean;
}

// ─── Sample prompts ──────────────────────────────────────────────────────────
const SAMPLE_PROMPTS: Record<string, string> = {
  "Customer reviews": "Generate realistic customer product reviews including reviewer name, rating (1-5), review title, review body, product category, and whether the review was verified purchase.",
  "Job postings": "Generate realistic job postings with company name, job title, location, salary range, required experience (years), required skills, and job description.",
  "Survey responses": "Generate realistic employee engagement survey responses with respondent ID, department, tenure (years), satisfaction score (1-10), and open-ended feedback about workplace culture.",
  "Support tickets": "Generate realistic customer support tickets with ticket ID, customer name, issue category, priority (Low/Medium/High/Critical), issue description, and current status.",
  "Research interviews": "Generate realistic qualitative research interview excerpts with participant ID, age group, occupation, interview question, and participant response.",
  "Student feedback": "Generate student feedback on online courses with student ID, course name, completion status, rating (1-5), what they liked, and what could be improved.",
};

const COLUMN_TYPES = ["text", "number", "boolean", "list"] as const;

type OutputFormat = "tabular" | "json" | "freetext" | "excel";
type Structure = "ai_decide" | "define_columns" | "use_template";
type RunMode = "preview" | "test" | "full";

const VARIATION_LEVELS = [
  { label: "Low", value: 0.3 },
  { label: "Medium", value: 0.6 },
  { label: "High", value: 0.9 },
  { label: "Maximum", value: 1.0 },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseJsonResponse(text: string): Array<{ name: string; type: string; description: string }> {
  let cleaned = text.trim();
  // Strip markdown fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // Try array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch { /* fall through */ }
  }
  try { return JSON.parse(cleaned); } catch { return []; }
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function GeneratePage() {
  const activeModel = useActiveModel();

  const [description, setDescription] = useState("");
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("tabular");
  const [structure, setStructure] = useState<Structure>("ai_decide");
  const [rowCount, setRowCount] = useState(100);
  const [variationIdx, setVariationIdx] = useState(1); // Medium
  const [columns, setColumns] = useState<GenerateColumn[]>([
    { name: "", type: "text" },
  ]);
  const [templateText, setTemplateText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("full");
  const [generatedData, setGeneratedData] = useState<Row[]>([]);
  const [generatedRaw, setGeneratedRaw] = useState("");
  const [runId, setRunId] = useState<string | null>(null);

  // ── Suggested fields state ──
  const [suggestedFields, setSuggestedFields] = useState<SuggestedField[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [suggestionMode, setSuggestionMode] = useState<"ai" | "manual">("ai");

  const temperature = VARIATION_LEVELS[variationIdx].value;

  // ── Auto-generate AI Instructions ──
  const buildAutoInstructions = useCallback(() => {
    const lines: string[] = [];
    lines.push("You are a synthetic data generator. Produce realistic, diverse, high-quality data.");
    lines.push("");

    if (description.trim()) {
      lines.push("DATA DESCRIPTION:");
      lines.push(description.trim());
      lines.push("");
    }

    const namedCols = columns.filter((c) => c.name.trim());
    if (namedCols.length > 0) {
      lines.push("SCHEMA:");
      namedCols.forEach((c) => {
        lines.push(`- ${c.name} (${c.type})${c.description ? `: ${c.description}` : ""}`);
      });
      lines.push("");
    }

    lines.push("OUTPUT RULES:");
    lines.push(`- Format: ${outputFormat === "excel" ? "tabular" : outputFormat}`);
    lines.push(`- Rows: ${rowCount}`);
    lines.push(`- Variation level: ${VARIATION_LEVELS[variationIdx].label} (temperature ${temperature})`);
    lines.push("");
    lines.push("STRICTLY FORBIDDEN: markdown, code fences, placeholders, duplicate rows.");
    lines.push("");
    lines.push(AI_INSTRUCTIONS_MARKER);

    return lines.join("\n");
  }, [description, columns, outputFormat, rowCount, variationIdx, temperature]);

  // ── AI Instructions state ──
  const [aiInstructions, setAiInstructions] = useAIInstructions(buildAutoInstructions);

  const addColumn = () => setColumns((prev) => [...prev, { name: "", type: "text" }]);
  const removeColumn = (idx: number) => setColumns((prev) => prev.filter((_, i) => i !== idx));
  const updateColumn = (idx: number, updates: Partial<GenerateColumn>) =>
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updates } : c)));

  const canGenerate = description.trim().length > 0 && columns.some((c) => c.name.trim());

  // ── Suggested fields helpers ──

  const updateSuggestion = useCallback((idx: number, updates: Partial<SuggestedField>) => {
    setSuggestedFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...updates } : f)));
  }, []);

  const removeSuggestion = useCallback((idx: number) => {
    setSuggestedFields((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const addSuggestion = useCallback(() => {
    setSuggestedFields((prev) => [...prev, { name: "", type: "text", description: "", checked: true }]);
  }, []);

  // ── Sync suggested fields → columns ──
  useEffect(() => {
    const checked = suggestedFields.filter((f) => f.checked && f.name.trim());
    if (checked.length > 0) {
      setColumns(checked.map((f) => ({ name: f.name, type: f.type, description: f.description })));
      setStructure("define_columns");
    }
  }, [suggestedFields]);

  // ── AI suggest fields ──
  const suggestFields = async () => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (!description.trim()) return toast.error("Enter a description first.");

    setIsSuggesting(true);
    try {
      const systemPrompt = getPrompt("generate.column_suggestions");
      const { output } = await dispatchProcessRow({
        provider: activeModel.providerId,
        model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "",
        baseUrl: activeModel.baseUrl,
        systemPrompt,
        userContent: description,
      });
      const parsed = parseJsonResponse(output);
      if (parsed.length === 0) {
        toast.error("Could not parse AI suggestions. Try again.");
        return;
      }
      const validTypes = new Set(COLUMN_TYPES);
      const fields: SuggestedField[] = parsed.map((f) => ({
        name: f.name || "",
        type: validTypes.has(f.type as SuggestedField["type"]) ? (f.type as SuggestedField["type"]) : "text",
        description: f.description || "",
        checked: true,
      }));
      setSuggestedFields(fields);
      toast.success(`${fields.length} fields suggested`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Suggestion failed", { description: msg });
    } finally {
      setIsSuggesting(false);
    }
  };

  // ── Generate ──
  const generate = async (mode: RunMode) => {
    if (!activeModel) return toast.error("No model configured. Add an API key in Settings.");
    if (!description.trim() || !columns.some((c) => c.name.trim())) return toast.error("Cannot execute: Both a description and at least one schema column are required.");
    if (columns.some((c) => c.name.trim()) && columns.some((c) => !c.name.trim())) return toast.error("All column names must be filled in.");

    const count = mode === "preview" ? 3 : mode === "test" ? 10 : rowCount;
    // Auto-determine structure based on column definitions
    const effectiveStructure = columns.some((c) => c.name.trim()) ? "define_columns" : "ai_decide";

    setRunId(null);
    setIsGenerating(true);
    setRunMode(mode);
    setGeneratedData([]);
    setGeneratedRaw("");

    const localRunId = await dispatchCreateRun({
      runType: "generate",
      provider: activeModel.providerId,
      model: activeModel.defaultModel,
      temperature,
      inputFile: "synthetic",
      inputRows: count,
    });

    try {
      const data = await dispatchGenerateRow({
        provider: activeModel.providerId,
        model: activeModel.defaultModel,
        apiKey: activeModel.apiKey || "",
        baseUrl: activeModel.baseUrl,
        rowCount: count,
        columns: effectiveStructure === "define_columns" ? columns : undefined,
        freeformPrompt: description || undefined,
        outputFormat: outputFormat === "excel" ? "tabular" : outputFormat,
        temperature,
        systemPrompt: aiInstructions || undefined,
      });

      if (outputFormat === "tabular" || outputFormat === "excel") {
        setGeneratedData(data.rows as Row[]);
      } else {
        setGeneratedRaw(typeof data.raw === "string" ? data.raw : JSON.stringify(data.rows, null, 2));
      }

      // Save results to history
      if (localRunId) {
        const resultRows = (data.rows as Row[]).map((row, i) => ({
          rowIndex: i,
          input: row as Record<string, unknown>,
          output: JSON.stringify(row),
          status: "success" as const,
        }));
        await dispatchSaveResults(localRunId, resultRows);
      }

      setRunId(localRunId);
      toast.success(`Generated ${data.count ?? count} rows`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error("Generation failed", { description: msg });
    } finally {
      setIsGenerating(false);
    }
  };

  const exportXlsx = () => {
    if (generatedData.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(generatedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Generated Data");
    XLSX.writeFile(wb, `generated_data_${Date.now()}.xlsx`);
  };

  const exportCsv = () => {
    if (generatedData.length === 0) return;
    const headers = Object.keys(generatedData[0]);
    const csv = [
      headers.join(","),
      ...generatedData.map((row) =>
        headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
      ),
    ].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `generated_data_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const checkedCount = suggestedFields.filter((f) => f.checked).length;
  const hasSuggestions = suggestedFields.length > 0;

  return (
    <div className="space-y-0 pb-16">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="space-y-1 pb-6 max-w-3xl">
        <h1 className="text-4xl font-bold">Generate Data</h1>
        <p className="text-muted-foreground text-sm">
          Create synthetic datasets with AI-powered generation. Describe what you need and let AI build it for you.
        </p>
      </div>

      {/* ── 1. Describe Your Data ───────────────────────────────────────── */}
      <div className="space-y-3 pb-8">
        <h2 className="text-2xl font-bold">1. Describe Data</h2>
        <div className="flex gap-3 items-start">
          <Textarea
            placeholder="Example: Generate realistic customer profiles including full names, email addresses, and purchase history..."
            className="flex-1 min-h-[100px] text-sm resize-y"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="shrink-0">
            <Select
              onValueChange={(key) => {
                if (SAMPLE_PROMPTS[key]) {
                  setDescription(SAMPLE_PROMPTS[key]);
                }
              }}
            >
              <SelectTrigger className="w-[200px] h-9 text-xs">
                <SelectValue placeholder="-- Select a sample..." />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(SAMPLE_PROMPTS).map((key) => (
                  <SelectItem key={key} value={key} className="text-xs">{key}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="border-t" />

      {/* ── 2. Define Columns ─────────────────────────────────────────────── */}
        <div className="space-y-4 py-8">
          <h2 className="text-2xl font-bold">2. Define Columns</h2>
          <p className="text-sm text-muted-foreground -mt-2">
            Define your output columns using AI suggestions or manual entry.
          </p>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={suggestionMode === "ai" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => { setSuggestionMode("ai"); suggestFields(); }}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              AI Mode
            </Button>
            <Button
              variant={suggestionMode === "manual" ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => setSuggestionMode("manual")}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Manual Mode
            </Button>
          </div>

          {/* AI mode content */}
          {suggestionMode === "ai" && (
          <>
          {/* AI suggesting indicator */}
          {isSuggesting && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Suggesting columns...
            </div>
          )}

          {/* Suggested fields checklist */}
          {hasSuggestions && (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
                <span className="text-sm font-medium">Suggested Fields</span>
                <span className="text-xs text-muted-foreground">
                  {checkedCount} of {suggestedFields.length} selected
                </span>
              </div>
              <div className="p-3 space-y-1.5">
                {suggestedFields.map((field, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <input
                      type="checkbox"
                      checked={field.checked}
                      onChange={(e) => updateSuggestion(idx, { checked: e.target.checked })}
                      className="h-4 w-4 accent-primary shrink-0"
                    />
                    <Input
                      placeholder="field_name"
                      value={field.name}
                      onChange={(e) => updateSuggestion(idx, { name: e.target.value })}
                      className="flex-1 h-8 text-xs"
                    />
                    <Select
                      value={field.type}
                      onValueChange={(v) => updateSuggestion(idx, { type: v as SuggestedField["type"] })}
                    >
                      <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLUMN_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Description"
                      value={field.description}
                      onChange={(e) => updateSuggestion(idx, { description: e.target.value })}
                      className="flex-1 h-8 text-xs text-muted-foreground"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeSuggestion(idx)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-3 flex items-center gap-2">
                <Button variant="outline" size="sm" className="text-xs" onClick={addSuggestion}>
                  <Plus className="h-3 w-3 mr-1.5" /> Add Field
                </Button>
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSuggestedFields((prev) => prev.map((f) => ({ ...f, checked: true })))}
                >
                  <Check className="h-3 w-3 mr-1" /> Select All
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSuggestedFields([])}
                >
                  Clear
                </Button>
              </div>
            </div>
          )}
          </>
          )}

          {/* Manual mode content */}
          {suggestionMode === "manual" && (
            <div className="space-y-3">
              <div className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b bg-muted/20 text-sm font-medium">Column Schema</div>
                <div className="p-3 space-y-2">
                  {columns.map((col, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Input
                        placeholder="column_name"
                        value={col.name}
                        onChange={(e) => updateColumn(idx, { name: e.target.value })}
                        className="flex-1 h-8 text-xs"
                      />
                      <Select
                        value={col.type}
                        onValueChange={(v) => updateColumn(idx, { type: v as GenerateColumn["type"] })}
                      >
                        <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COLUMN_TYPES.map((t) => (
                            <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Description (optional)"
                        value={col.description || ""}
                        onChange={(e) => updateColumn(idx, { description: e.target.value })}
                        className="flex-1 h-8 text-xs text-muted-foreground"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeColumn(idx)}
                        disabled={columns.length === 1}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="px-3 pb-3">
                  <Button variant="outline" size="sm" className="w-full text-xs" onClick={addColumn}>
                    <Plus className="h-3 w-3 mr-2" /> Add Column
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="border-t" />

      {/* ── 3. Configure Output (merged with Generation Settings) ──────── */}
      <div className="py-8 space-y-5">
        <h2 className="text-2xl font-bold">3. Configure Output</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Output Format */}
          <div className="space-y-3">
            <div className="font-semibold text-sm">Output Format</div>
            <div className="space-y-2">
              {([
                { value: "tabular", label: "Tabular (CSV)", desc: "Structured rows and columns - best for spreadsheets and data analysis" },
                { value: "json", label: "JSON", desc: "Nested structured data - best for APIs and complex relationships" },
                { value: "freetext", label: "Free Text", desc: "Unstructured text output - best for qualitative data" },
                { value: "excel", label: "Excel (.xlsx)", desc: "Structured rows and columns exported as an Excel workbook" },
              ] as const).map(({ value, label, desc }) => (
                <label key={value} className="flex items-start gap-2.5 cursor-pointer group">
                  <input
                    type="radio"
                    name="outputFormat"
                    value={value}
                    checked={outputFormat === value}
                    onChange={() => setOutputFormat(value)}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <div className="text-sm font-medium leading-snug">{label}</div>
                    {outputFormat === value && (
                      <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Rows + Variation */}
          <div className="space-y-5">
            {/* Row count */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Rows to Generate</Label>
              <div className="flex items-center border rounded-lg overflow-hidden">
                <button
                  className="px-4 py-2.5 hover:bg-muted text-sm border-r transition-colors"
                  onClick={() => setRowCount((n) => Math.max(1, n - 10))}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={rowCount}
                  onChange={(e) => setRowCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                  className="flex-1 border-none h-10 text-center text-sm focus-visible:ring-0 rounded-none"
                />
                <button
                  className="px-4 py-2.5 hover:bg-muted text-sm border-l transition-colors"
                  onClick={() => setRowCount((n) => Math.min(500, n + 10))}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Variation level */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm text-muted-foreground">Variation Level</Label>
                <span className="text-sm font-semibold text-primary">{VARIATION_LEVELS[variationIdx].label}</span>
              </div>
              <input
                type="range"
                min={0}
                max={VARIATION_LEVELS.length - 1}
                step={1}
                value={variationIdx}
                onChange={(e) => setVariationIdx(parseInt(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Low</span>
                <span>Maximum</span>
              </div>
            </div>
          </div>
        </div>

        {/* Info / warning box */}
        {!canGenerate ? null : !activeModel ? (
          <NoModelWarning activeModel={activeModel} />
        ) : (
          <div className="px-4 py-3 rounded-lg bg-muted/30 border text-xs text-muted-foreground">
            Ready to generate {rowCount} rows using <strong>{activeModel.providerId} / {activeModel.defaultModel}</strong>
            {" "} · Variation: <strong>{VARIATION_LEVELS[variationIdx].label}</strong> (temp {temperature})
          </div>
        )}
      </div>

      <div className="border-t" />

      {/* ── 4. AI Instructions ─────────────────────────────────────────── */}
      <AIInstructionsSection
        sectionNumber={4}
        value={aiInstructions}
        onChange={setAiInstructions}
      />

      <div className="border-t" />

      {/* ── 5. Execute ──────────────────────────────────────────────────── */}
      <div className="space-y-4 py-8">
        <h2 className="text-2xl font-bold">5. Execute</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-sm border-dashed"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("preview")}
          >
            {isGenerating && runMode === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Preview (3 rows)
          </Button>
          <Button
            size="lg"
            className="h-12 text-base bg-red-500 hover:bg-red-600 text-white"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("test")}
          >
            {isGenerating && runMode === "test" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            Test (10 rows)
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="h-12 text-base"
            disabled={!canGenerate || isGenerating || !activeModel}
            onClick={() => generate("full")}
          >
            {isGenerating && runMode === "full" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {isGenerating && runMode === "full" ? `Generating…` : `Generate All (${rowCount} rows)`}
          </Button>
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────────────── */}
      {(generatedData.length > 0 || generatedRaw) && (
        <div className="space-y-4 border-t pt-6 pb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Generated Data</h2>
              {generatedData.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {generatedData.length} rows × {Object.keys(generatedData[0]).length} columns
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {runId && (
                <Link href={`/history/${runId}`} className="flex items-center gap-1.5 text-xs text-indigo-500 hover:underline">
                  <ExternalLink className="h-3 w-3" />
                  View in History
                </Link>
              )}
              {generatedData.length > 0 && outputFormat === "excel" && (
                <Button variant="outline" size="sm" onClick={exportXlsx}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export XLSX
                </Button>
              )}
              {generatedData.length > 0 && outputFormat !== "excel" && (
                <Button variant="outline" size="sm" onClick={exportCsv}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Export CSV
                </Button>
              )}
              {generatedRaw && outputFormat !== "tabular" && (
                <Button variant="outline" size="sm" onClick={() => {
                  const ext = outputFormat === "json" ? "json" : "txt";
                  const blob = new Blob([generatedRaw], { type: "text/plain;charset=utf-8;" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `generated_${Date.now()}.${ext}`; a.click();
                  URL.revokeObjectURL(url);
                }}>
                  <Download className="h-3.5 w-3.5 mr-1.5" /> Download
                </Button>
              )}
            </div>
          </div>

          {generatedData.length > 0 ? (
            <div className="border rounded-lg overflow-hidden">
              <DataTable data={generatedData} showAll />
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-muted/20 text-xs font-medium text-muted-foreground">Raw output</div>
              <pre className="p-4 text-xs font-mono whitespace-pre-wrap max-h-[500px] overflow-y-auto">{generatedRaw}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
