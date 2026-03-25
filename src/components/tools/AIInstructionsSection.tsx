"use client";

import { useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface AIInstructionsSectionProps {
  sectionNumber: number;
  value: string;
  onChange: (value: string) => void;
  children?: ReactNode;
}

export function AIInstructionsSection({
  sectionNumber,
  value,
  onChange,
  children,
}: AIInstructionsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState("");

  const startEditing = () => {
    setDraftValue(value);
    setIsEditing(true);
  };

  const saveEditing = () => {
    onChange(draftValue);
    setIsEditing(false);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  return (
    <div className="space-y-3 py-8">
      <h2 className="text-2xl font-bold">
        {sectionNumber}. AI Instructions
      </h2>

      <div className="border rounded-lg overflow-hidden">
        <button
          type="button"
          className="w-full px-4 py-3 text-left text-sm font-medium flex items-center justify-between bg-muted/20 hover:bg-muted/30 transition-colors"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span>System prompt sent to the AI. Auto-updates from your configuration.</span>
          <span className="text-xs text-muted-foreground">{isOpen ? "▲" : "▼"}</span>
        </button>

        {isOpen && (
          <div className="border-t p-4 space-y-3">
            <div className="flex items-center justify-end">
              {!isEditing && (
                <Button variant="outline" size="sm" onClick={startEditing}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit Prompt
                </Button>
              )}
              {isEditing && (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={cancelEditing}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={saveEditing}>
                    Save
                  </Button>
                </div>
              )}
            </div>

            {isEditing ? (
              <Textarea
                className="min-h-[200px] font-mono text-sm leading-relaxed resize-y bg-slate-50 dark:bg-slate-900/50"
                value={draftValue}
                onChange={(e) => setDraftValue(e.target.value)}
              />
            ) : (
              <pre className="font-mono text-sm leading-relaxed whitespace-pre-wrap break-words p-3 rounded-md bg-slate-50 dark:bg-slate-900/50">
                {value}
              </pre>
            )}
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
