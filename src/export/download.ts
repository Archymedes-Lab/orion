// Getting text out of the app: a file download, the print dialog, the clipboard, or the system share sheet.
// Each returns whether it worked, so the screen can say so instead of failing silently.
import { Platform, Share } from "react-native";

const web = () => Platform.OS === "web" && typeof document !== "undefined";

export function saveFile(filename: string, content: string, type: string): boolean {
  return download(filename, content, type);
}

/** The same download for a file that is bytes rather than text: a PDF, a workbook. */
export function saveBytes(filename: string, bytes: Uint8Array, type: string): boolean {
  return download(filename, bytes, type);
}

function download(filename: string, content: string | Uint8Array, type: string): boolean {
  if (!web()) return false;
  try {
    const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

/** Media types the two file exports are served with. */
export const PDF_TYPE = "application/pdf";
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Opens the report in a new tab and starts the print dialog ("Save as PDF" lives there). */
export function printPage(html: string): boolean {
  if (!web()) return false;
  try {
    const w = window.open("", "_blank");
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 250);
    return true;
  } catch { return false; }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (web() && navigator.clipboard) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  return false;
}

/** The phone's share sheet on native; the browser's, where it has one. */
export async function shareText(text: string, title: string): Promise<boolean> {
  try {
    if (web()) {
      const nav = navigator as Navigator & { share?: (data: { title: string; text: string }) => Promise<void> };
      if (!nav.share) return false;
      await nav.share({ title, text });
      return true;
    }
    await Share.share({ message: text, title });
    return true;
  } catch { return false; }
}
