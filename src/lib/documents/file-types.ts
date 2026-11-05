/** File types Smart NPV will store. PDF, PNG, JPG, and JPEG only — there is no delete. */
export const SUPPORTED_DOCUMENT_TYPES = [
  { ext: "pdf", mime: "application/pdf", label: "PDF" },
  { ext: "png", mime: "image/png", label: "PNG" },
  { ext: "jpg", mime: "image/jpeg", label: "JPG" },
  { ext: "jpeg", mime: "image/jpeg", label: "JPEG" },
] as const;

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
};

function canonicalMime(mime: string): string {
  const normalized = mime.toLowerCase();
  return MIME_ALIASES[normalized] ?? normalized;
}

function fileExtension(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** "PDF, PNG, JPG, or JPEG" — `conjunction` is the word before the last label. */
export function supportedTypeLabels(conjunction: string): string {
  const labels = [...new Set(SUPPORTED_DOCUMENT_TYPES.map((type) => type.label))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")}, ${conjunction} ${labels[labels.length - 1]}`;
}

/** Value for an `<input type="file" accept>` so the picker matches the list. */
export function supportedFileAccept(): string {
  const exts = SUPPORTED_DOCUMENT_TYPES.map((type) => `.${type.ext}`);
  const mimes = [...new Set(SUPPORTED_DOCUMENT_TYPES.map((type) => type.mime))];
  return [...exts, ...mimes].join(",");
}

export function isUploadableFile(mime: string, filename: string): boolean {
  const ext = fileExtension(filename);
  const normalized = canonicalMime(mime);
  const extOk = SUPPORTED_DOCUMENT_TYPES.some((type) => type.ext === ext);
  const mimeOk = SUPPORTED_DOCUMENT_TYPES.some((type) => type.mime === normalized);
  if (ext && !extOk) return false;
  if (normalized && normalized !== "application/octet-stream" && !mimeOk) return false;
  return extOk || mimeOk;
}

export function isImageFile(mime: string, filename: string): boolean {
  if (!isUploadableFile(mime, filename)) return false;
  const ext = fileExtension(filename);
  if (ext === "png" || ext === "jpg" || ext === "jpeg") return true;
  const normalized = canonicalMime(mime);
  return normalized === "image/png" || normalized === "image/jpeg";
}

function filePart(value: string): string {
  const cleaned = value.trim().replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_");
  return cleaned || "document";
}

/** `<borrower>_<Hebrew label>_<yyyy-mm-dd>_<version>.pdf` */
export function smartUploadName(opts: {
  borrowerName: string;
  docLabel: string;
  date: string;
  version: number;
}): string {
  const version = String(Math.max(1, opts.version)).padStart(2, "0");
  return `${filePart(opts.borrowerName)}_${filePart(opts.docLabel)}_${opts.date}_${version}.pdf`;
}

/** Upload day in Asia/Jerusalem, as yyyy-mm-dd. */
export function uploadDay(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function uploadFileName(filename: string, mime: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() || "document";
  const ext = fileExtension(base);
  if (SUPPORTED_DOCUMENT_TYPES.some((type) => type.ext === ext)) return base;
  const match = SUPPORTED_DOCUMENT_TYPES.find((type) => type.mime === canonicalMime(mime));
  return `${base}.${match?.ext ?? "jpg"}`;
}
