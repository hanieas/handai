"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAppStore, DEFAULT_SYSTEM_SETTINGS } from "@/lib/store";
import { useSystemSettings } from "@/lib/hooks";
import { PROMPTS, getPrompt, setPromptOverride, clearPromptOverride } from "@/lib/prompts";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Key, ShieldCheck, Loader2, Wifi, RotateCcw, ChevronDown, RefreshCw,
  Minus, Plus, FolderOpen,
} from "lucide-react";
import { toast } from "sonner";

interface SettingsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google Gemini",
  groq: "Groq",
  together: "Together AI",
  azure: "Azure OpenAI",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  custom: "Custom",
};

const CLOUD_PROVIDERS = ["openai", "anthropic", "google", "groq", "together", "azure", "openrouter"];
const LOCAL_PROVIDERS = ["ollama", "lmstudio", "custom"];
const BASE_URL_PROVIDERS = new Set(["openai", "together", "openrouter", "ollama", "lmstudio", "custom", "azure"]);

const PROMPT_CATEGORIES = ["transform", "qualitative", "consensus", "codebook", "generate", "automator", "ai_coder"];
const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform Data",
  qualitative: "Qualitative Coder",
  consensus: "Consensus Coder",
  codebook: "Codebook Generator",
  generate: "Generate Data",
  automator: "Automator",
  ai_coder: "AI Coder",
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const isStatic = process.env.NEXT_PUBLIC_STATIC === "1";

export function SettingsSheet({ open, onOpenChange }: SettingsSheetProps) {
  const { providers, setProviderConfig } = useAppStore();
  const systemSettings = useSystemSettings();
  const setSystemSettings = useAppStore((s) => s.setSystemSettings);

  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [localModels, setLocalModels] = useState<Record<string, string[]>>({});
  const [isDetecting, setIsDetecting] = useState(false);
  const [activeTab, setActiveTab] = useState<"providers" | "system" | "prompts">("providers");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setPromptValues(Object.fromEntries(Object.keys(PROMPTS).map((id) => [id, getPrompt(id)])));
      detectLocalModels();
    }
  }, [open]);

  const detectLocalModels = async () => {
    setIsDetecting(true);
    try {
      if (isTauri || isStatic) {
        // No server endpoint — probe localhost directly (CORS may block in browsers)
        const [ollama, lm] = await Promise.all([
          fetch("http://localhost:11434/api/tags").then((r) => r.json()).catch(() => null),
          fetch("http://localhost:1234/v1/models").then((r) => r.json()).catch(() => null),
        ]);
        const result: Record<string, string[]> = {};
        if (ollama?.models) result.ollama = (ollama.models as { name: string }[]).map((m) => m.name);
        if (lm?.data) result.lmstudio = (lm.data as { id: string }[]).map((m) => m.id);
        setLocalModels(result);
      } else {
        const res = await fetch("/api/local-models");
        const data = await res.json();
        setLocalModels(data);
      }
    } catch {}
    finally { setIsDetecting(false); }
  };

  const savePrompt = (id: string) => {
    setPromptOverride(id, promptValues[id]);
    toast.success("Prompt saved");
  };

  const resetPrompt = (id: string) => {
    clearPromptOverride(id);
    setPromptValues((prev) => ({ ...prev, [id]: PROMPTS[id].defaultValue }));
    toast.success("Reset to default");
  };

  const testConnection = async (id: string) => {
    const config = providers[id];
    if (!config.isLocal && !config.apiKey) return toast.error("Enter an API key first");
    setIsTesting(id);
    try {
      const params = {
        provider: id, model: config.defaultModel,
        apiKey: config.apiKey || "local", baseUrl: config.baseUrl,
        systemPrompt: "You are a helpful assistant.",
        userContent: "Reply with the single word: OK",
        temperature: 0,
      };
      if (isTauri || isStatic) {
        const { processRowDirect } = await import("@/lib/llm-browser");
        await processRowDirect(params);
      } else {
        const res = await fetch("/api/process-row", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
      }
      toast.success(`${PROVIDER_LABELS[id] ?? id} — connected`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${PROVIDER_LABELS[id] ?? id} failed`, { description: msg });
    } finally {
      setIsTesting(null);
    }
  };

  const handleBrowse = async () => {
    if (!isTauri) {
      toast.info("Folder picker is available in the desktop app only");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = await (import("@tauri-apps/api/core") as any);
      const selected = await mod.invoke("plugin:dialog|open", { directory: true, multiple: false });
      if (typeof selected === "string") {
        setSystemSettings({ autoSavePath: selected });
      }
    } catch {
      toast.error("Could not open folder picker");
    }
  };

  const getStatus = (id: string) => {
    const c = providers[id];
    if (!c.isEnabled) return "disabled";
    if (c.isLocal) return "local";
    if (!c.apiKey) return "no-key";
    return "ready";
  };

  const renderProvider = (id: string) => {
    const config = providers[id];
    const status = getStatus(id);
    const showBaseUrl = BASE_URL_PROVIDERS.has(id);
    const dotColor =
      status === "ready" || status === "local" ? "bg-green-500"
      : status === "no-key" ? "bg-amber-400"
      : "bg-muted-foreground/25";

    return (
      <div key={id} className={`rounded-lg border transition-all ${config.isEnabled ? "border-border bg-card" : "border-border/30 bg-muted/10 opacity-55"}`}>
        <div className="flex items-center gap-2 px-3 py-2">
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
          {config.isLocal ? <Wifi className="h-3 w-3 text-green-500 shrink-0" /> : <Key className="h-3 w-3 text-muted-foreground shrink-0" />}
          <span className="font-medium text-xs flex-1 truncate">{PROVIDER_LABELS[id] ?? id}</span>
          {config.isLocal && localModels[id]?.length ? (
            <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">{localModels[id].length} models</Badge>
          ) : null}
          <Switch checked={config.isEnabled} onCheckedChange={(v) => setProviderConfig(id, { isEnabled: v })} size="sm" />
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-1.5" onClick={() => testConnection(id)} disabled={isTesting !== null || !config.isEnabled}>
            {isTesting === id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
          </Button>
        </div>
        <div className="px-3 pb-2.5 grid gap-2" style={{ gridTemplateColumns: `repeat(${showBaseUrl ? (config.isLocal ? 2 : 3) : (config.isLocal ? 1 : 2)}, 1fr)` }}>
          {!config.isLocal && (
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">API Key</Label>
              <Input type="password" placeholder="sk-..." value={config.apiKey} onChange={(e) => setProviderConfig(id, { apiKey: e.target.value })} className="h-7 text-[11px] font-mono" />
            </div>
          )}
          <div className="space-y-0.5">
            <Label className="text-[10px] text-muted-foreground">Model</Label>
            <Input placeholder="e.g. gpt-4o" value={config.defaultModel} onChange={(e) => setProviderConfig(id, { defaultModel: e.target.value })} className="h-7 text-[11px] font-mono" />
            {config.isLocal && localModels[id]?.length ? (
              <div className="flex flex-wrap gap-0.5 pt-0.5">
                {localModels[id].map((m) => (
                  <button key={m} onClick={() => setProviderConfig(id, { defaultModel: m })}
                    className={`text-[9px] px-1.5 py-0 rounded-full border transition-colors ${config.defaultModel === m ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary"}`}
                  >{m}</button>
                ))}
              </div>
            ) : null}
          </div>
          {showBaseUrl && (
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">{id === "azure" ? "Resource Name" : "Base URL"}</Label>
              <Input placeholder={id === "ollama" ? "http://localhost:11434/v1" : id === "lmstudio" ? "http://localhost:1234/v1" : "https://..."} value={config.baseUrl ?? ""} onChange={(e) => setProviderConfig(id, { baseUrl: e.target.value })} className="h-7 text-[11px] font-mono" />
            </div>
          )}
        </div>
      </div>
    );
  };

  const modifiedCount = Object.keys(PROMPTS).filter(
    (id) => (promptValues[id] ?? PROMPTS[id].defaultValue) !== PROMPTS[id].defaultValue
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-hidden flex flex-col sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Configure providers, defaults, and prompts without leaving your work.
          </SheetDescription>
        </SheetHeader>

        {/* Tab bar */}
        <div className="flex gap-1 px-4 shrink-0">
          {([
            { id: "providers" as const, label: "Providers" },
            { id: "system" as const, label: "System" },
            { id: "prompts" as const, label: `Prompts${modifiedCount ? ` (${modifiedCount})` : ""}` },
          ]).map(({ id, label }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); scrollRef.current?.scrollTo({ top: 0 }); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted/40"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">

          {/* ── Providers tab ────────────────────────────── */}
          {activeTab === "providers" && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Cloud APIs</p>
                <button onClick={detectLocalModels} disabled={isDetecting} className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className={`h-3 w-3 ${isDetecting ? "animate-spin" : ""}`} /> Detect local
                </button>
              </div>
              <div className="space-y-2">{CLOUD_PROVIDERS.map(renderProvider)}</div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-2">Local / Self-hosted</p>
              <div className="space-y-2">{LOCAL_PROVIDERS.map(renderProvider)}</div>
            </>
          )}

          {/* ── System tab ────────────────────────────── */}
          {activeTab === "system" && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Model Defaults</p>
              <div className="rounded-lg border bg-card p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Temperature</Label>
                    <Input type="number" min={0} max={2} step={0.1} value={systemSettings.temperature}
                      onChange={(e) => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0 && v <= 2) setSystemSettings({ temperature: v }); }}
                      className="h-7 text-[11px]" />
                    <p className="text-[9px] text-muted-foreground">0 = deterministic, 2 = creative</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Max Tokens</Label>
                    <Input type="number" min={1} placeholder="Provider default" value={systemSettings.maxTokens ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") setSystemSettings({ maxTokens: null });
                        else { const v = parseInt(raw, 10); if (!isNaN(v) && v > 0) setSystemSettings({ maxTokens: v }); }
                      }}
                      className="h-7 text-[11px]" />
                    <p className="text-[9px] text-muted-foreground">Empty = provider default</p>
                  </div>
                </div>
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-2">Performance</p>
              <div className="rounded-lg border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[10px]">Max Concurrent Requests</Label>
                    <p className="text-[9px] text-muted-foreground">Parallel API calls (1–20)</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button className="px-1.5 py-0.5 border rounded hover:bg-muted transition-colors" onClick={() => setSystemSettings({ maxConcurrency: Math.max(1, systemSettings.maxConcurrency - 1) })}>
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-2 min-w-[2rem] text-center text-xs font-medium">{systemSettings.maxConcurrency}</span>
                    <button className="px-1.5 py-0.5 border rounded hover:bg-muted transition-colors" onClick={() => setSystemSettings({ maxConcurrency: Math.min(20, systemSettings.maxConcurrency + 1) })}>
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-[10px]">Auto-retry</Label>
                    <p className="text-[9px] text-muted-foreground">Retry up to 3x with backoff</p>
                  </div>
                  <Switch checked={systemSettings.autoRetry} onCheckedChange={(v) => setSystemSettings({ autoRetry: v })} size="sm" />
                </div>
              </div>

              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 pt-2">Storage</p>
              <div className="rounded-lg border bg-card p-4 space-y-2">
                <Label className="text-[10px]">Auto-save Path</Label>
                <div className="flex gap-1.5">
                  <Input readOnly={!isTauri} placeholder={isTauri ? "Select a folder…" : "Desktop app only"} value={systemSettings.autoSavePath}
                    onChange={(e) => { if (isTauri) setSystemSettings({ autoSavePath: e.target.value }); }}
                    className="flex-1 h-7 text-[11px] font-mono" />
                  <Button variant="outline" size="sm" className="h-7 px-2" onClick={handleBrowse}>
                    <FolderOpen className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              <Button variant="outline" size="sm" className="text-[10px] mt-2"
                onClick={() => { setSystemSettings(DEFAULT_SYSTEM_SETTINGS); toast.success("Reset to defaults"); }}>
                <RotateCcw className="h-3 w-3 mr-1" /> Reset System Settings
              </Button>
            </>
          )}

          {/* ── Prompts tab ────────────────────────────── */}
          {activeTab === "prompts" && (
            <div className="space-y-2">
              {PROMPT_CATEGORIES.map((category) => {
                const categoryPrompts = Object.values(PROMPTS).filter((p) => p.category === category);
                if (categoryPrompts.length === 0) return null;
                const isOpen = openCategories.has(category);
                const hasModified = categoryPrompts.some((p) => (promptValues[p.id] ?? p.defaultValue) !== p.defaultValue);
                return (
                  <div key={category} className="border rounded-lg overflow-hidden">
                    <button
                      onClick={() => setOpenCategories((prev) => { const next = new Set(prev); next.has(category) ? next.delete(category) : next.add(category); return next; })}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/20 transition-colors text-left"
                    >
                      <span className="text-xs font-medium flex-1">{PROMPT_CATEGORY_LABELS[category] ?? category}</span>
                      <span className="text-[10px] text-muted-foreground">{categoryPrompts.length}</span>
                      {hasModified && <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 text-amber-600 border-amber-300">modified</Badge>}
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                    </button>
                    {isOpen && (
                      <div className="border-t divide-y">
                        {categoryPrompts.map((prompt) => {
                          const current = promptValues[prompt.id] ?? prompt.defaultValue;
                          const isModified = current !== prompt.defaultValue;
                          return (
                            <div key={prompt.id} className="px-3 py-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-medium truncate">{prompt.name}</span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isModified && (
                                    <button onClick={() => resetPrompt(prompt.id)} className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                                      <RotateCcw className="h-2.5 w-2.5" /> Reset
                                    </button>
                                  )}
                                  <Button size="sm" className="h-6 text-[10px] px-2" onClick={() => savePrompt(prompt.id)}>Save</Button>
                                </div>
                              </div>
                              <Textarea className="font-mono text-[10px] min-h-[80px] resize-y" value={current}
                                onChange={(e) => setPromptValues((prev) => ({ ...prev, [prompt.id]: e.target.value }))} />
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
