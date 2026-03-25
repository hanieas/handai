"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, ChevronLeft, ChevronRight, Download, ChevronDown } from "lucide-react";
import * as XLSX from "xlsx";

interface DataTableProps {
    data: any[];
    maxRows?: number;
    showAll?: boolean;
}

type ExportFormat = "csv" | "tsv" | "json" | "xlsx";

function exportData(data: any[], format: ExportFormat, filename?: string) {
    if (format === "xlsx") {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Data");
        XLSX.writeFile(wb, `${filename || "data"}.xlsx`);
        return;
    }

    const headers = Object.keys(data[0] || {});
    let content: string;
    let mimeType: string;
    let ext: string;

    if (format === "csv") {
        content = [
            headers.join(","),
            ...data.map((r) =>
                headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
            ),
        ].join("\n");
        mimeType = "text/csv;charset=utf-8;";
        ext = "csv";
    } else if (format === "tsv") {
        content = [
            headers.join("\t"),
            ...data.map((r) =>
                headers.map((h) => String(r[h] ?? "").replace(/\t/g, " ")).join("\t")
            ),
        ].join("\n");
        mimeType = "text/tab-separated-values;charset=utf-8;";
        ext = "tsv";
    } else {
        content = JSON.stringify(data, null, 2);
        mimeType = "application/json;charset=utf-8;";
        ext = "json";
    }

    const blob = new Blob(["\uFEFF" + content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename || "data"}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
}

export function DataTable({ data, maxRows = 100, showAll = false }: DataTableProps) {
    const [expanded, setExpanded] = useState<{ col: string; value: string } | null>(null);
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
    const [searchQuery, setSearchQuery] = useState("");
    const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
    const [tablePage, setTablePage] = useState(0);
    const [showExportMenu, setShowExportMenu] = useState(false);

    useEffect(() => {
        setTablePage(0);
    }, [data]);

    if (!data || data.length === 0) return null;

    const headers = Object.keys(data[0]);

    // Column filters
    const hasColumnFilters = Object.values(columnFilters).some((v) => v.length > 0);

    // Filter: global search + per-column
    const filteredData = useMemo(() => {
        let result = data;
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            result = result.filter((row) =>
                headers.some((h) =>
                    String(row[h] ?? "").toLowerCase().includes(q)
                )
            );
        }
        if (hasColumnFilters) {
            result = result.filter((row) =>
                headers.every((h) => {
                    const filter = columnFilters[h];
                    if (!filter) return true;
                    return String(row[h] ?? "").toLowerCase().includes(filter.toLowerCase());
                })
            );
        }
        return result;
    }, [data, searchQuery, columnFilters, hasColumnFilters, headers]);

    // Sort
    const sortedData = sortCol
        ? [...filteredData].sort((a, b) => {
            const va = String(a[sortCol] ?? "");
            const vb = String(b[sortCol] ?? "");
            return sortDir === "asc"
                ? va.localeCompare(vb, undefined, { numeric: true })
                : vb.localeCompare(va, undefined, { numeric: true });
          })
        : filteredData;

    // Pagination (only when not showAll)
    const totalPages = showAll ? 1 : Math.ceil(sortedData.length / maxRows);
    const displayData = showAll ? sortedData : sortedData.slice(tablePage * maxRows, (tablePage + 1) * maxRows);

    const handleHeaderClick = (header: string) => {
        if (sortCol === header) {
            if (sortDir === "asc") setSortDir("desc");
            else { setSortCol(null); setSortDir("asc"); }
        } else {
            setSortCol(header);
            setSortDir("asc");
        }
    };

    const updateColumnFilter = (header: string, value: string) => {
        setColumnFilters((prev) => ({ ...prev, [header]: value }));
        setTablePage(0);
    };

    const isFiltered = filteredData.length < data.length;

    return (
        <div className="border border-gray-300 bg-card text-card-foreground">
            {data.length > 5 && (
                <div className="px-3 py-2 border-b flex items-center gap-2">
                    <div className="relative flex-1">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                        <Input
                            placeholder="Search all columns..."
                            className="pl-8 h-8 text-xs"
                            value={searchQuery}
                            onChange={(e) => { setSearchQuery(e.target.value); setTablePage(0); }}
                        />
                    </div>
                    {/* Export dropdown */}
                    <div className="relative">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 px-2.5 text-xs gap-1"
                            onClick={() => setShowExportMenu((v) => !v)}
                        >
                            <Download className="h-3 w-3" />
                            Export
                            <ChevronDown className="h-3 w-3 opacity-50" />
                        </Button>
                        {showExportMenu && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowExportMenu(false)} />
                                <div className="absolute right-0 top-full mt-1 z-50 border rounded-md bg-popover shadow-md py-1 min-w-[100px]">
                                    {(["csv", "tsv", "json", "xlsx"] as ExportFormat[]).map((fmt) => (
                                        <button
                                            key={fmt}
                                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors"
                                            onClick={() => {
                                                exportData(sortedData, fmt, "export");
                                                setShowExportMenu(false);
                                            }}
                                        >
                                            {fmt.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {showAll ? (
                <div className="w-full border-t border-gray-300 overflow-x-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-gray-100 z-10">
                            <TableRow>
                                {headers.map((header) => (
                                    <TableHead
                                        key={header}
                                        className="font-bold cursor-pointer hover:bg-gray-200 select-none"
                                        onClick={() => handleHeaderClick(header)}
                                    >
                                        <div className="flex items-center gap-1">
                                            {header}
                                            {sortCol === header && (
                                                <span className="text-xs opacity-60">
                                                    {sortDir === "asc" ? "↑" : "↓"}
                                                </span>
                                            )}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                            {data.length > 5 && (
                                <TableRow className="bg-gray-50">
                                    {headers.map((header) => (
                                        <TableHead key={`filter-${header}`} className="py-1 px-1">
                                            <Input
                                                placeholder="Filter…"
                                                className="h-6 text-[10px] px-1.5 border-muted-foreground/20 bg-background"
                                                value={columnFilters[header] || ""}
                                                onChange={(e) => updateColumnFilter(header, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </TableHead>
                                    ))}
                                </TableRow>
                            )}
                        </TableHeader>
                        <TableBody>
                            {displayData.map((row, i) => (
                                <TableRow key={i}>
                                    {headers.map((header) => (
                                        <TableCell
                                            key={`${i}-${header}`}
                                            className="whitespace-pre-wrap max-w-md truncate cursor-pointer hover:bg-muted/20"
                                            onClick={() => setExpanded({ col: header, value: String(row[header] ?? "") })}
                                        >
                                            {String(row[header] ?? "")}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ) : (
                <ScrollArea className="h-[400px] w-full border-t border-gray-300">
                    <Table>
                        <TableHeader className="sticky top-0 bg-gray-100 z-10">
                            <TableRow>
                                {headers.map((header) => (
                                    <TableHead
                                        key={header}
                                        className="font-bold cursor-pointer hover:bg-gray-200 select-none"
                                        onClick={() => handleHeaderClick(header)}
                                    >
                                        <div className="flex items-center gap-1">
                                            {header}
                                            {sortCol === header && (
                                                <span className="text-xs opacity-60">
                                                    {sortDir === "asc" ? "↑" : "↓"}
                                                </span>
                                            )}
                                        </div>
                                    </TableHead>
                                ))}
                            </TableRow>
                            {data.length > 5 && (
                                <TableRow className="bg-gray-50">
                                    {headers.map((header) => (
                                        <TableHead key={`filter-${header}`} className="py-1 px-1">
                                            <Input
                                                placeholder="Filter…"
                                                className="h-6 text-[10px] px-1.5 border-muted-foreground/20 bg-background"
                                                value={columnFilters[header] || ""}
                                                onChange={(e) => updateColumnFilter(header, e.target.value)}
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </TableHead>
                                    ))}
                                </TableRow>
                            )}
                        </TableHeader>
                        <TableBody>
                            {displayData.map((row, i) => (
                                <TableRow key={i}>
                                    {headers.map((header) => (
                                        <TableCell
                                            key={`${i}-${header}`}
                                            className="whitespace-pre-wrap max-w-md truncate cursor-pointer hover:bg-muted/20"
                                            onClick={() => setExpanded({ col: header, value: String(row[header] ?? "") })}
                                        >
                                            {String(row[header] ?? "")}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <ScrollBar orientation="horizontal" />
                </ScrollArea>
            )}
            <div className="px-3 py-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>
                    {isFiltered
                        ? `${filteredData.length} of ${data.length} rows shown`
                        : `${data.length} rows`}
                </span>
                {!showAll && totalPages > 1 && (
                    <div className="flex items-center gap-2">
                        <span>
                            {tablePage * maxRows + 1}–{Math.min((tablePage + 1) * maxRows, sortedData.length)} of {sortedData.length}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => setTablePage((p) => Math.max(0, p - 1))}
                            disabled={tablePage === 0}
                        >
                            <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-6 px-2"
                            onClick={() => setTablePage((p) => Math.min(totalPages - 1, p + 1))}
                            disabled={tablePage >= totalPages - 1}
                        >
                            <ChevronRight className="h-3 w-3" />
                        </Button>
                    </div>
                )}
            </div>

            <Dialog open={!!expanded} onOpenChange={() => setExpanded(null)}>
                <DialogContent className="max-w-2xl max-h-[80vh]">
                    <DialogHeader>
                        <DialogTitle className="text-sm font-mono">{expanded?.col}</DialogTitle>
                    </DialogHeader>
                    <pre className="text-sm font-mono whitespace-pre-wrap break-words overflow-y-auto max-h-[60vh] bg-muted/20 p-4 rounded border">
                        {expanded?.value}
                    </pre>
                </DialogContent>
            </Dialog>
        </div>
    );
}
