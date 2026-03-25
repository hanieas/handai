"use client"

import * as React from "react"
import {
    BookOpen,
    Bot,
    Columns,
    Database,
    Edit3,
    FlaskConical,
    History,
    LayoutDashboard,
    Settings,
    Users,
    Wand2,
    Sparkles,
    FileArchive,
    AlertCircle,
    Cpu,
    ChevronUp,
} from "lucide-react"

import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/components/ui/sidebar"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useActiveModel, useConfiguredProviders } from "@/lib/hooks"
import { useAppStore } from "@/lib/store"
import Link from "next/link"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

const PROVIDER_LABELS: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    groq: "Groq",
    together: "Together",
    azure: "Azure",
    openrouter: "OpenRouter",
    ollama: "Ollama",
    lmstudio: "LM Studio",
    custom: "Custom",
}

const data = {
    navMain: [
        {
            title: "Data Processing",
            items: [
                {
                    title: "Transform Data",
                    url: "/transform",
                    icon: Wand2,
                },
                {
                    title: "General Automator",
                    url: "/automator",
                    icon: Database,
                },
                {
                    title: "Generate Data",
                    url: "/generate",
                    icon: Sparkles,
                },
                {
                    title: "Process Documents",
                    url: "/process-documents",
                    icon: FileArchive,
                },
            ],
        },
        {
            title: "Qualitative Analysis",
            items: [
                {
                    title: "Qualitative Coder",
                    url: "/qualitative-coder",
                    icon: Edit3,
                },
                {
                    title: "Consensus Coder",
                    url: "/consensus-coder",
                    icon: Users,
                },
                {
                    title: "AI Coder",
                    url: "/ai-coder",
                    icon: Bot,
                },
                {
                    title: "Model Comparison",
                    url: "/model-comparison",
                    icon: Columns,
                },
                {
                    title: "Codebook Generator",
                    url: "/codebook-generator",
                    icon: BookOpen,
                },
                {
                    title: "Abstract Screener",
                    url: "/abstract-screener",
                    icon: FlaskConical,
                },
            ],
        },
        {
            title: "System",
            items: [
                {
                    title: "Historical Runs",
                    url: "/history",
                    icon: History,
                },
                {
                    title: "Settings",
                    url: "/settings",
                    icon: Settings,
                },
            ],
        },
    ],
}

function ProviderSelector({ onOpenSettings }: { onOpenSettings: () => void }) {
    const model = useActiveModel()
    const configured = useConfiguredProviders()
    const activeProviderId = useAppStore((s) => s.activeProviderId)
    const setActiveProvider = useAppStore((s) => s.setActiveProvider)

    // 0 providers configured: amber warning
    if (!model) {
        return (
            <button
                onClick={onOpenSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400 hover:opacity-80 transition-opacity border border-amber-200 dark:border-amber-800 w-full text-left"
            >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">No model configured</span>
            </button>
        )
    }

    // 1 provider configured: non-interactive indicator
    if (configured.length <= 1) {
        return (
            <button
                onClick={onOpenSettings}
                className="flex items-center gap-2 px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors border border-border w-full text-left"
            >
                <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
                        {PROVIDER_LABELS[model.providerId] ?? model.providerId}
                    </div>
                    <div className="font-medium truncate leading-none">{model.defaultModel}</div>
                </div>
            </button>
        )
    }

    // 2+ providers: dropdown with radio group
    const value = activeProviderId ?? "__auto__"

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-2 rounded-md text-xs hover:bg-muted/50 transition-colors border border-border w-full text-left">
                    <Cpu className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-0.5">
                            {PROVIDER_LABELS[model.providerId] ?? model.providerId}
                        </div>
                        <div className="font-medium truncate leading-none">{model.defaultModel}</div>
                    </div>
                    <ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[220px]">
                <DropdownMenuRadioGroup
                    value={value}
                    onValueChange={(v) => setActiveProvider(v === "__auto__" ? null : v)}
                >
                    <DropdownMenuRadioItem value="__auto__">
                        Auto (first available)
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                    {configured.map((p) => (
                        <DropdownMenuRadioItem key={p.providerId} value={p.providerId}>
                            <div className="min-w-0">
                                <div className="text-sm">{PROVIDER_LABELS[p.providerId] ?? p.providerId}</div>
                                <div className="text-[10px] text-muted-foreground truncate">{p.defaultModel}</div>
                            </div>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

// Placeholder model names used in the store defaults — safe to overwrite
const LOCAL_PLACEHOLDERS: Record<string, string[]> = {
    ollama: ["gpt-oss:latest", ""],
    lmstudio: ["local-model", ""],
};

function useLocalProviderDetection() {
    const { providers, setProviderConfig } = useAppStore();

    React.useEffect(() => {
        const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

        const fetchDetected = isTauri
            ? Promise.all([
                  fetch("http://localhost:11434/api/tags").then((r) => r.json()).catch(() => null),
                  fetch("http://localhost:1234/v1/models").then((r) => r.json()).catch(() => null),
              ]).then(([ollama, lm]) => {
                  const result: Record<string, string[]> = {};
                  if (ollama?.models) {
                      result.ollama = (ollama.models as { name: string }[]).map((m) => m.name);
                  }
                  if (lm?.data) {
                      result.lmstudio = (lm.data as { id: string }[]).map((m) => m.id);
                  }
                  return result;
              })
            : fetch("/api/local-models").then((r) => r.json());

        fetchDetected
            .then((detected: Record<string, string[]>) => {
                for (const [provider, models] of Object.entries(detected)) {
                    if (!models.length) continue;
                    const current = providers[provider];
                    if (!current) continue;

                    const isPlaceholder = LOCAL_PLACEHOLDERS[provider]?.includes(current.defaultModel);
                    const modelMissing = !models.includes(current.defaultModel);

                    const updates: Record<string, unknown> = { isEnabled: true };
                    if (isPlaceholder || modelMissing) updates.defaultModel = models[0];

                    const wasDisabled = !current.isEnabled;
                    const modelChanged = updates.defaultModel !== undefined;

                    setProviderConfig(provider, updates as Parameters<typeof setProviderConfig>[1]);

                    if (wasDisabled || modelChanged) {
                        const label = provider === "ollama" ? "Ollama" : "LM Studio";
                        toast.success(`${label} detected`, {
                            description: `${models.length} model${models.length !== 1 ? "s" : ""} available · using ${updates.defaultModel ?? current.defaultModel}`,
                            duration: 4000,
                        });
                    }
                }
            })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    useLocalProviderDetection();
    const router = useRouter();

    return (
        <Sidebar collapsible="icon" {...props}>
                <SidebarHeader>
                    <SidebarMenu>
                        <SidebarMenuItem>
                            <SidebarMenuButton size="lg" asChild>
                                <Link href="/">
                                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                                        <LayoutDashboard className="size-4" />
                                    </div>
                                    <div className="flex flex-col gap-0.5 leading-none">
                                        <span className="font-semibold">Handai</span>
                                        <span className="">AI Data Suite</span>
                                    </div>
                                </Link>
                            </SidebarMenuButton>
                        </SidebarMenuItem>
                    </SidebarMenu>
                </SidebarHeader>
                <SidebarContent>
                    {data.navMain.map((group) => (
                        <SidebarGroup key={group.title}>
                            <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
                            <SidebarGroupContent>
                                <SidebarMenu>
                                    {group.items.map((item) => (
                                        <SidebarMenuItem key={item.title}>
                                            <SidebarMenuButton asChild tooltip={item.title}>
                                                <Link href={item.url}>
                                                    <item.icon />
                                                    <span>{item.title}</span>
                                                </Link>
                                            </SidebarMenuButton>
                                        </SidebarMenuItem>
                                    ))}
                                </SidebarMenu>
                            </SidebarGroupContent>
                        </SidebarGroup>
                    ))}
                </SidebarContent>
                <SidebarFooter className="p-2">
                    <ProviderSelector onOpenSettings={() => router.push("/settings")} />
                </SidebarFooter>
                <SidebarRail />
        </Sidebar>
    )
}
