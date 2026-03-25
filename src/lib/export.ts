/**
 * Shared CSV download utility.
 *
 * In a browser: builds a blob URL and triggers an anchor-click download.
 * In Tauri (WKWebView): the HTML `download` attribute is not supported, so
 * we detect Tauri via `window.__TAURI_INTERNALS__` and invoke the native
 * `save_file` command which shows a system save-file dialog.
 */
import * as XLSX from "xlsx";

export async function downloadXLSX(rows: Record<string, unknown>[], filename: string): Promise<void> {
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const fname = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const content = String.fromCharCode(...new Uint8Array(buf));
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_file", { filename: fname, content });
    return;
  }

  XLSX.writeFile(wb, fname);
}

export async function downloadCSV(rows: Record<string, unknown>[], filename: string): Promise<void> {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      headers
        .map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`)
        .join(",")
    ),
  ].join("\n");
  const content = "\uFEFF" + csv;

  // Tauri WebView (WKWebView on macOS) does not support the HTML download
  // attribute — use the native save-file dialog via a Tauri command instead.
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_file", { filename, content });
    return;
  }

  // Browser: standard blob URL download
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
