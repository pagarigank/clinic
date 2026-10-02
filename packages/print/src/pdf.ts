import { createHash } from "node:crypto";
import { chromium } from "playwright";
import type { Browser } from "playwright";

/**
 * HTML -> PDF rendering and tamper-evident hashing (todo.md 3.2 print pipeline).
 *
 * Every numbered or PDF document in the platform - certificates, referrals, Rx
 * labels, lab reports, receipts - is rendered here, and the SHA-256 that
 * accompanies it is taken over the *rendered bytes*. That is the whole point:
 * a hash of metadata cannot evidence anything about the document a patient or
 * regulator actually receives.
 *
 * ## Determinism
 *
 * Chromium stamps `/CreationDate` and `/ModDate` into the PDF `/Info`
 * dictionary, so two renders of identical HTML one second apart differ in
 * exactly two bytes and therefore hash differently. That is verified by
 * `tests/pdf.test.ts`, which renders the same document twice and asserts the
 * digests match.
 *
 * `normalizePdfDates` rewrites both timestamps to a fixed epoch. The
 * replacement is the same byte length as the original, which matters: PDF
 * cross-reference tables record byte offsets, so a length-changing edit would
 * corrupt the file.
 */

export type PaperFormat = "A4" | "A5" | "Letter" | "Legal";

export interface PdfMargin {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

export interface PdfOptions {
  format?: PaperFormat;
  landscape?: boolean;
  printBackground?: boolean;
  margin?: PdfMargin;
  scale?: number;
}

/** A rendered document plus the integrity digest of its exact bytes. */
export interface RenderedDocument {
  /** The document as it will be served. Hash and serve the same buffer. */
  bytes: Buffer;
  /** SHA-256 (hex) over `bytes` after date normalisation. */
  sha256: string;
  byteLength: number;
  mediaType: "application/pdf";
}

const DEFAULT_OPTIONS: Required<Omit<PdfOptions, "margin">> & {
  margin: PdfMargin;
} = {
  format: "A4",
  landscape: false,
  printBackground: true,
  scale: 1,
  margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
};

/**
 * Fixed replacement for Chromium's build timestamp. `1970-01-01T00:00:00Z`
 * written in the PDF `D:` form is 23 characters, identical to the real stamp
 * (`D:20261002022415+00'00'`), so substituting it shifts no byte offsets.
 */
const EPOCH_PDF_DATE = "D:19700101000000+00'00'";

/**
 * Matches `/CreationDate (D:...)` and `/ModDate (D:...)` in the /Info dict.
 * Group 1 captures the key and its opening paren; the closing paren and the
 * date literal follow.
 */
const PDF_DATE_PATTERN = /(\/(?:CreationDate|ModDate)\s*)\(D:\d{14}[+-]\d{2}'\d{2}'\)/g;

let browserPromise: Promise<Browser> | null = null;

/**
 * Launch Chromium on first use and reuse it thereafter.
 *
 * Starting a browser costs ~150ms, so the pipeline keeps one warm instance
 * rather than paying that per document. `closePrintRenderer` must be called on
 * worker shutdown, and by tests, or the process will not exit.
 */
async function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium.launch();
  try {
    return await browserPromise;
  } catch (err) {
    // Do not cache a failed launch: the next call should retry rather than
    // replay a poisoned promise forever.
    browserPromise = null;
    throw err;
  }
}

/** Release the warm Chromium instance. Safe to call when none was started. */
export async function closePrintRenderer(): Promise<void> {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // Already closed, or the launch never completed. Nothing to reclaim.
  }
}

/**
 * Replace Chromium's wall-clock timestamps with a fixed epoch.
 *
 * Exported for its own sake: a document rendered earlier can be re-normalised
 * to confirm its digest still matches, which is how `verifyDocument` detects
 * tampering after the fact.
 */
export function normalizePdfDates(pdf: Buffer): Buffer {
  const text = pdf.toString("latin1");
  return Buffer.from(
    text.replace(PDF_DATE_PATTERN, (_match, prefix: string) => `${prefix}(${EPOCH_PDF_DATE})`),
    "latin1",
  );
}

/** SHA-256 (hex) over arbitrary bytes. */
export function sha256Of(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Render an HTML document to PDF and hash the result.
 *
 * The returned `bytes` are the bytes that were hashed. Callers must persist
 * and serve this exact buffer - re-rendering later is safe precisely because
 * the output is deterministic, but serving a freshly rendered copy while
 * advertising the stored digest would still be wrong.
 */
export async function renderPdf(html: string, options: PdfOptions = {}): Promise<RenderedDocument> {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const raw = await page.pdf({
      format: settings.format,
      landscape: settings.landscape,
      printBackground: settings.printBackground,
      scale: settings.scale,
      margin: settings.margin,
    });
    const bytes = normalizePdfDates(Buffer.from(raw));
    return {
      bytes,
      sha256: sha256Of(bytes),
      byteLength: bytes.byteLength,
      mediaType: "application/pdf",
    };
  } finally {
    // A leaked page holds a renderer process and eventually wedges the worker.
    await page.close().catch(() => undefined);
  }
}

/**
 * Confirm a stored document still matches its recorded digest.
 *
 * Re-normalises before hashing so a document produced by an older build (with
 * real timestamps) still verifies against a digest taken at render time.
 */
export function verifyDocument(
  bytes: Buffer,
  expectedSha256: string,
): { valid: boolean; actualSha256: string } {
  const actualSha256 = sha256Of(normalizePdfDates(bytes));
  return { valid: actualSha256 === expectedSha256.toLowerCase(), actualSha256 };
}
