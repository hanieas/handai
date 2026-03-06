"use client";

import { Bot, Database, Edit3, Users, Wand2, Columns, History, BookOpen, Sparkles, FileArchive, ArrowRight, MoreVertical, Printer, Video, RefreshCw, Settings, Clock } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  {
    name: "Qualitative Analysis",
    tools: [
      {
        title: "Qualitative Coder",
        description: "AI-assisted qualitative coding — apply codes to each row of your dataset.",
        icon: Edit3,
        href: "/qualitative-coder",
        color: "text-orange-500",
        bg: "bg-orange-50 dark:bg-orange-950/30",
        border: "hover:border-orange-200 dark:hover:border-orange-800",
      },
      {
        title: "Consensus Coder",
        description: "Multi-model consensus coding with inter-rater reliability (Cohen's Kappa).",
        icon: Users,
        href: "/consensus-coder",
        color: "text-purple-500",
        bg: "bg-purple-50 dark:bg-purple-950/30",
        border: "hover:border-purple-200 dark:hover:border-purple-800",
      },
      {
        title: "AI Coder",
        description: "Interactive thematic analysis with AI-assisted suggestions and manual review.",
        icon: Bot,
        href: "/ai-coder",
        color: "text-orange-400",
        bg: "bg-orange-50 dark:bg-orange-950/30",
        border: "hover:border-orange-200 dark:hover:border-orange-800",
      },
      {
        title: "Codebook Generator",
        description: "3-stage AI pipeline: Discovery → Consolidation → Definition.",
        icon: BookOpen,
        href: "/codebook-generator",
        color: "text-emerald-500",
        bg: "bg-emerald-50 dark:bg-emerald-950/30",
        border: "hover:border-emerald-200 dark:hover:border-emerald-800",
      },
      {
        title: "Model Comparison",
        description: "Compare outputs from multiple LLMs side-by-side on your dataset.",
        icon: Columns,
        href: "/model-comparison",
        color: "text-blue-500",
        bg: "bg-blue-50 dark:bg-blue-950/30",
        border: "hover:border-blue-200 dark:hover:border-blue-800",
      },
    ],
  },
  {
    name: "Data Processing",
    tools: [
      {
        title: "Transform Data",
        description: "AI-powered transformation, enrichment, and classification of tabular data.",
        icon: Wand2,
        href: "/transform",
        color: "text-blue-400",
        bg: "bg-blue-50 dark:bg-blue-950/30",
        border: "hover:border-blue-200 dark:hover:border-blue-800",
      },
      {
        title: "General Automator",
        description: "Build and run custom multi-step AI pipelines for any data task.",
        icon: Database,
        href: "/automator",
        color: "text-indigo-500",
        bg: "bg-indigo-50 dark:bg-indigo-950/30",
        border: "hover:border-indigo-200 dark:hover:border-indigo-800",
      },
      {
        title: "Generate Data",
        description: "Create realistic synthetic datasets — define a schema or describe freely.",
        icon: Sparkles,
        href: "/generate",
        color: "text-cyan-500",
        bg: "bg-cyan-50 dark:bg-cyan-950/30",
        border: "hover:border-cyan-200 dark:hover:border-cyan-800",
      },
      {
        title: "Process Documents",
        description: "Extract structured data from PDF, DOCX, TXT, and MD files using AI.",
        icon: FileArchive,
        href: "/process-documents",
        color: "text-violet-500",
        bg: "bg-violet-50 dark:bg-violet-950/30",
        border: "hover:border-violet-200 dark:hover:border-violet-800",
      },
    ],
  },
  {
    name: "System",
    tools: [
      {
        title: "Historical Runs",
        description: "Review past sessions, results, and performance metrics.",
        icon: History,
        href: "/history",
        color: "text-slate-500",
        bg: "bg-slate-50 dark:bg-slate-900/30",
        border: "hover:border-slate-300 dark:hover:border-slate-600",
      },
    ],
  },
];

export default function HomePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-16 animate-in fade-in duration-500">

      {/* Hero */}
      <div className="space-y-2 pb-2 flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight">Welcome to Handai</h1>
          <p className="text-lg text-muted-foreground">
            Your AI-powered qualitative research and data science suite.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 mt-1">
              <MoreVertical className="h-5 w-5" />
              <span className="sr-only">Actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => window.print()}>
              <Printer className="h-4 w-4" />
              Print Page
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toast.info("Coming soon")}>
              <Video className="h-4 w-4" />
              Screencast
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/history">
                <Clock className="h-4 w-4" />
                Historical Runs
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Categories */}
      {CATEGORIES.map((cat) => (
        <div key={cat.name} className="space-y-4">
          <h2 className="text-2xl font-bold">{cat.name}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {cat.tools.map((tool) => (
              <Link key={tool.title} href={tool.href} className="group">
                <div className={`h-full rounded-xl border bg-card p-5 transition-all duration-200 hover:shadow-md ${tool.border}`}>
                  {/* Icon */}
                  <div className={`inline-flex items-center justify-center w-11 h-11 rounded-lg ${tool.bg} mb-4`}>
                    <tool.icon className={`w-6 h-6 ${tool.color}`} />
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-semibold mb-1 group-hover:text-primary transition-colors">
                    {tool.title}
                  </h3>

                  {/* Description */}
                  <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                    {tool.description}
                  </p>

                  {/* CTA */}
                  <div className="flex items-center gap-1 text-xs font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                    Open <ArrowRight className="h-3 w-3" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
