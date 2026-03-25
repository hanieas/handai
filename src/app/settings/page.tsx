"use client";

import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore, DEFAULT_SYSTEM_SETTINGS } from "@/lib/store";
import { useSystemSettings, useConfiguredProviders } from "@/lib/hooks";
import { PROMPTS, getPrompt, setPromptOverride, clearPromptOverride } from "@/lib/prompts";
import { toast } from "sonner";
import { Key, ShieldCheck, Loader2, Wifi, RotateCcw, ChevronDown, Bot, Sliders, RefreshCw, SlidersHorizontal, Minus, Plus, FolderOpen } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

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

const PROMPT_CATEGORIES = ["transform", "qualitative", "consensus", "codebook", "generate", "automator", "ai_coder", "document"];
const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  transform: "Transform Data",
  qualitative: "Qualitative Coder",
  consensus: "Consensus Coder",
  codebook: "Codebook Generator",
  generate: "Generate Data",
  automator: "Automator",
  ai_coder: "AI Coder",
  document: "Process Documents",
};

const BASE_URL_PROVIDERS = new Set(["openai", "together", "openrouter", "ollama", "lmstudio", "custom", "azure"]);

export default function SettingsPage() {
  const { providers, setProviderConfig } = useAppStore();
  const [isTesting, setIsTesting] = useState<string | null>(null);
  const [promptValues, setPromptValues] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState("providers");
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [localModels, setLocalModels] = useState<Record<string, string[]>>({});
  const [isDetecting, setIsDetecting] = useState(false);

  const providersRef = useRef<HTMLDivElement>(null);
  const systemRef = useRef<HTMLDivElement>(null);
  const promptsRef = useRef<HTMLDivElement>(null);

  const systemSettings = useSystemSettings();
  const setSystemSettings = useAppStore((s) => s.setSystemSettings);
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  const configured = useConfiguredProviders();
  const activeProviderId = useAppStore((s) => s.activeProviderId);
  const setActiveProvider = useAppStore((s) => s.setActiveProvider);

  useEffect(() => {
    setPromptValues(Object.fromEntries(Object.keys(PROMPTS).map((id) => [id, getPrompt(id)])));
    detectLocalModels();
  }, []);

  const detectLocalModels = async () => {
    setIsDetecting(true);
    try {
      const res = await fetch("/api/local-models");
      const data = await res.json();
      setLocalModels(data);
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
      const res = await fetch("/api/process-row", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: id,
          model: config.defaultModel,
          apiKey: config.apiKey || "local",
          baseUrl: config.baseUrl,
          systemPrompt: "You are a helpful assistant.",
          userContent: "Reply with the single word: OK",
          temperature: 0,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`${PROVIDER_LABELS[id] ?? id} — connected`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`${PROVIDER_LABELS[id] ?? id} failed`, { description: msg });
    } finally {
      setIsTesting(null);
    }
  };

  const scrollTo = (section: string) => {
    setActiveSection(section);
    const refs: Record<string, React.RefObject<HTMLDivElement | null>> = {
      providers: providersRef,
      system: systemRef,
      prompts: promptsRef,
    };
    refs[section]?.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const modifiedCount = Object.keys(PROMPTS).filter(
    (id) => (promptValues[id] ?? PROMPTS[id].defaultValue) !== PROMPTS[id].defaultValue
  ).length;

  const renderProvider = (id: string) => {
    const config = providers[id];
    const status = getStatus(id);
    const showBaseUrl = BASE_URL_PROVIDERS.has(id);
    const colCount = showBaseUrl ? (config.isLocal ? 2 : 3) : (config.isLocal ? 1 : 2);

    const dotColor =
      status === "ready" || status === "local"
        ? "bg-green-500"
        : status === "no-key"
        ? "bg-amber-400"
        : "bg-muted-foreground/25";

    return (
      <div
        key={id}
        className={`rounded-xl border transition-all ${
          config.isEnabled ? "border-border bg-card" : "border-border/30 bg-muted/10 opacity-55"
        }`}
      >
        {/* Header row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
          {config.isLocal ? (
            <Wifi className="h-3.5 w-3.5 text-green-500 shrink-0" />
          ) : (
            <Key className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="font-semibold text-sm flex-1 truncate">{PROVIDER_LABELS[id] ?? id}</span>
          {config.isLocal && (
            <>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-green-600 border-green-500/40">
                local
              </Badge>
              {localModels[id]?.length ? (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground">
                  {localModels[id].length} model{localModels[id].length !== 1 ? "s" : ""}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-muted-foreground/50">
                  not detected
                </Badge>
              )}
            </>
          )}
          {config.isLocal && (
            <button
              onClick={detectLocalModels}
              disabled={isDetecting}
              className="p-1 rounded hover:bg-muted/40 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
              title="Re-detect local models"
            >
              <RefreshCw className={`h-3 w-3 ${isDetecting ? "animate-spin" : ""}`} />
            </button>
          )}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-[11px] text-muted-foreground">Enabled</span>
            <Switch
              checked={config.isEnabled}
              onCheckedChange={(v) => setProviderConfig(id, { isEnabled: v })}
              size="sm"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2.5 ml-1"
            onClick={() => testConnection(id)}
            disabled={isTesting !== null || !config.isEnabled}
          >
            {isTesting === id ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">Test</span>
          </Button>
        </div>

        {/* Fields */}
        <div className={`px-4 pb-3.5 pt-0 grid gap-x-4 gap-y-2.5`}
          style={{ gridTemplateColumns: `repeat(${colCount}, 1fr)` }}
        >
          {!config.isLocal && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {id === "azure" ? "API Key" : "API Key"}
              </Label>
              <Input
                type="password"
                placeholder={id === "azure" ? "Azure API Key" : "sk-..."}
                value={config.apiKey}
                onChange={(e) => setProviderConfig(id, { apiKey: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">Default Model</Label>
            <Input
              placeholder="e.g. gpt-4o"
              value={config.defaultModel}
              onChange={(e) => setProviderConfig(id, { defaultModel: e.target.value })}
              className="h-8 text-xs font-mono"
            />
            {/* Detected models for local providers */}
            {config.isLocal && localModels[id]?.length ? (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {localModels[id].map((m) => (
                  <button
                    key={m}
                    onClick={() => setProviderConfig(id, { defaultModel: m })}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                      config.defaultModel === m
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : config.isLocal && !isDetecting ? (
              <p className="text-[10px] text-muted-foreground/60 pt-0.5">
                Not running — start {PROVIDER_LABELS[id]} to see available models
              </p>
            ) : null}
          </div>
          {showBaseUrl && (
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">
                {id === "azure" ? "Resource Name" : "Base URL"}
              </Label>
              <Input
                placeholder={
                  id === "azure"
                    ? "my-resource-name"
                    : id === "ollama"
                    ? "http://localhost:11434/v1"
                    : id === "lmstudio"
                    ? "http://localhost:1234/v1"
                    : "https://api.example.com/v1"
                }
                value={config.baseUrl ?? ""}
                onChange={(e) => setProviderConfig(id, { baseUrl: e.target.value })}
                className="h-8 text-xs font-mono"
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex gap-10 min-h-[calc(100vh-112px)]">

      {/* ── Sticky side nav ─────────────────────────────────── */}
      <nav className="w-40 shrink-0 pt-1">
        <div className="sticky top-6 space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-3 mb-2">
            Settings
          </p>
          {[
            { id: "providers", label: "AI Providers", icon: Bot },
            { id: "system", label: "System", icon: SlidersHorizontal },
            { id: "prompts", label: "Prompt Templates", icon: Sliders, badge: modifiedCount },
          ].map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                activeSection === id
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate">{label}</span>
              {badge ? (
                <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300">
                  {badge}
                </Badge>
              ) : null}
            </button>
          ))}
        </div>
      </nav>

      {/* ── Main content ────────────────────────────────────── */}
      <div className="flex-1 min-w-0 max-w-3xl space-y-14 pb-20">

        {/* ── AI Providers ───────────────────────────────────── */}
        <section ref={providersRef}>
          <div className="mb-5 pb-4 border-b">
            <h2 className="text-lg font-bold">AI Providers</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              The first enabled provider with a configured key is used by default across all tools.
            </p>
          </div>

          {configured.length > 1 && (
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <Label className="text-xs font-medium">Default AI Provider</Label>
              <Select
                value={activeProviderId ?? "__auto__"}
                onValueChange={(v) => setActiveProvider(v === "__auto__" ? null : v)}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__auto__" className="text-sm">Auto (first available)</SelectItem>
                  {configured.map((p) => (
                    <SelectItem key={p.providerId} value={p.providerId} className="text-sm">
                      {PROVIDER_LABELS[p.providerId] ?? p.providerId} — {p.defaultModel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Choose which provider is used by default across all tools, or leave on Auto to use the first available.
              </p>
            </div>
          )}

          <div className="space-y-8">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Cloud APIs
              </p>
              <div className="space-y-2">
                {CLOUD_PROVIDERS.map(renderProvider)}
              </div>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Local / Self-hosted
              </p>
              <div className="space-y-2">
                {LOCAL_PROVIDERS.map(renderProvider)}
              </div>
            </div>
          </div>
        </section>

        {/* ── System Settings ──────────────────────────────── */}
        <section ref={systemRef}>
          <div className="mb-5 pb-4 border-b">
            <h2 className="text-lg font-bold">System Settings</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Global defaults applied across all tools. Changes take effect immediately.
            </p>
          </div>

          <div className="space-y-6">
            {/* Model Defaults */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Model Defaults
              </p>
              <div className="rounded-xl border bg-card p-5 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Temperature</Label>
                    <Input
                      type="number"
                      min={0}
                      max={2}
                      step={0.1}
                      value={systemSettings.temperature}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v >= 0 && v <= 2) setSystemSettings({ temperature: v });
                      }}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">0 = deterministic, 2 = creative</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Max Tokens</Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="Provider default"
                      value={systemSettings.maxTokens ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === "") {
                          setSystemSettings({ maxTokens: null });
                        } else {
                          const v = parseInt(raw, 10);
                          if (!isNaN(v) && v > 0) setSystemSettings({ maxTokens: v });
                        }
                      }}
                      className="h-8 text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground">Empty = provider default</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Performance */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Performance
              </p>
              <div className="rounded-xl border bg-card p-5 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Max Concurrent Requests</Label>
                    <p className="text-[10px] text-muted-foreground">Parallel API calls per batch (1–20)</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-2 py-1 border rounded hover:bg-muted transition-colors"
                      onClick={() => setSystemSettings({ maxConcurrency: Math.max(1, systemSettings.maxConcurrency - 1) })}
                    >
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="px-3 border-x min-w-[2.5rem] text-center text-sm font-medium">
                      {systemSettings.maxConcurrency}
                    </span>
                    <button
                      className="px-2 py-1 border rounded hover:bg-muted transition-colors"
                      onClick={() => setSystemSettings({ maxConcurrency: Math.min(20, systemSettings.maxConcurrency + 1) })}
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Auto-retry</Label>
                    <p className="text-[10px] text-muted-foreground">Retry failed requests up to 3x with backoff</p>
                  </div>
                  <Switch
                    checked={systemSettings.autoRetry}
                    onCheckedChange={(v) => setSystemSettings({ autoRetry: v })}
                    size="sm"
                  />
                </div>
              </div>
            </div>

            {/* Storage */}
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-3 px-0.5">
                Storage
              </p>
              <div className="rounded-xl border bg-card p-5 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Auto-save Path</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly={!isTauri}
                      placeholder={isTauri ? "Select a folder…" : "Desktop app only"}
                      value={systemSettings.autoSavePath}
                      onChange={(e) => { if (isTauri) setSystemSettings({ autoSavePath: e.target.value }); }}
                      className="flex-1 h-8 text-xs font-mono"
                    />
                    <Button variant="outline" size="sm" className="h-8 px-2.5" onClick={handleBrowse}>
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Automatically save results to this folder after each run.
                  </p>
                </div>
              </div>
            </div>

            {/* Reset */}
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => {
                setSystemSettings(DEFAULT_SYSTEM_SETTINGS);
                toast.success("System settings reset to defaults");
              }}
            >
              <RotateCcw className="h-3 w-3 mr-1.5" />
              Reset System Settings
            </Button>
          </div>
        </section>

        {/* ── Prompt Templates ───────────────────────────────── */}
        <section ref={promptsRef}>
          <div className="mb-5 pb-4 border-b">
            <h2 className="text-lg font-bold">Prompt Templates</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Customize the system prompts used by each tool. Changes are saved to your browser and override the defaults.
            </p>
          </div>

          <div className="space-y-2">
            {PROMPT_CATEGORIES.map((category) => {
              const categoryPrompts = Object.values(PROMPTS).filter((p) => p.category === category);
              if (categoryPrompts.length === 0) return null;
              const isOpen = openCategories.has(category);
              const hasModified = categoryPrompts.some(
                (p) => (promptValues[p.id] ?? p.defaultValue) !== p.defaultValue
              );

              return (
                <div key={category} className="border rounded-xl overflow-hidden">
                  <button
                    onClick={() =>
                      setOpenCategories((prev) => {
                        const next = new Set(prev);
                        next.has(category) ? next.delete(category) : next.add(category);
                        return next;
                      })
                    }
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors text-left"
                  >
                    <span className="text-sm font-medium flex-1">
                      {PROMPT_CATEGORY_LABELS[category] ?? category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {categoryPrompts.length} {categoryPrompts.length === 1 ? "prompt" : "prompts"}
                    </span>
                    {hasModified && (
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300">
                        modified
                      </Badge>
                    )}
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
                        isOpen ? "rotate-180" : ""
                      }`}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-t divide-y">
                      {categoryPrompts.map((prompt) => {
                        const current = promptValues[prompt.id] ?? prompt.defaultValue;
                        const isModified = current !== prompt.defaultValue;
                        return (
                          <div key={prompt.id} className="px-4 py-4 space-y-2.5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{prompt.name}</span>
                                {isModified && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1.5 py-0 h-4 text-amber-600 border-amber-300 shrink-0"
                                  >
                                    modified
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs text-muted-foreground"
                                  disabled={!isModified}
                                  onClick={() => resetPrompt(prompt.id)}
                                >
                                  <RotateCcw className="h-3 w-3 mr-1" />
                                  Reset
                                </Button>
                                <Button
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => savePrompt(prompt.id)}
                                >
                                  Save
                                </Button>
                              </div>
                            </div>
                            <Textarea
                              className="font-mono text-xs min-h-[110px] resize-y"
                              value={current}
                              onChange={(e) =>
                                setPromptValues((prev) => ({ ...prev, [prompt.id]: e.target.value }))
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
