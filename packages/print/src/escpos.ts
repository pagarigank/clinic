/**
 * ESC/POS thermal receipt rendering (todo.md 3.2 print pipeline, JOB-50).
 *
 * Thermal cashier printers speak ESC/POS, a byte protocol rather than a page
 * description language, so this builder emits `Buffer`s of control sequences
 * interleaved with text. 58mm stock is assumed (32 half-width columns at the
 * default font), which is what the cashier hardware in the clinic spec uses.
 *
 * A receipt is encoded ASCII-ish with the printer's own code page. The builder
 * therefore strips control characters and folds anything unencodable rather
 * than emitting bytes that print as garbage.
 */

/** Text-only receipt; a 58mm roll cannot render the internal fields anyway. */
export interface ReceiptLine {
  label: string;
  value: string;
  /** Right-aligns the value against the 32-column margin. */
  alignRight?: boolean;
}

export interface Receipt {
  /** Tenant display name, printed as the receipt header. */
  clinicName: string;
  /** Receipt / document number. */
  receiptNo: string;
  issuedAt: string;
  cashierName: string;
  /** Patient name. Omitted for walk-in OTC sales. */
  patientName?: string;
  lines: ReceiptLine[];
  subtotalLabel?: string;
  subtotalValue?: string;
  discountLabel?: string;
  discountValue?: string;
  totalLabel?: string;
  totalValue?: string;
  /** Set for a reprint; the caller must have already audited it. */
  reprintOf?: string;
  footer?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const COLUMNS = 32;

/** Left-align. */
const ALIGN_LEFT = 0x00;
/** Centre. */
const ALIGN_CENTER = 0x01;

const WIDTH_DOUBLE = 0x11;
const ON = 0x01;
const OFF = 0x00;

/**
 * Strip control characters and fold characters the printer cannot render.
 *
 * Patient names are free text and reach this builder, so an embedded ESC or
 * CR would otherwise drive the printer directly.
 */
function sanitize(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
}

function truncate(value: string, max: number): string {
  const clean = sanitize(value);
  return clean.length <= max ? clean : `${clean.slice(0, Math.max(0, max - 1))}~`;
}

/** Pad/truncate to exactly `width` columns. */
function column(value: string, width: number, align: "left" | "right"): string {
  const clean = truncate(value, width);
  const pad = " ".repeat(Math.max(0, width - clean.length));
  return align === "right" ? pad + clean : clean + pad;
}

/**
 * Wrap free text across the receipt width on word boundaries.
 *
 * A single token longer than the roll (a long unhyphenated surname, or a value
 * with no spaces) is hard-broken rather than sliced: silently discarding the
 * tail would print a receipt that disagrees with the charge record, which is
 * exactly the discrepancy a reprint is meant to resolve.
 */
function wrap(value: string): string[] {
  const clean = sanitize(value);
  const out: string[] = [];
  let line = "";

  for (const word of clean.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (rest.length > 0) {
      if (line.length === 0) {
        const take = Math.min(rest.length, COLUMNS);
        line = rest.slice(0, take);
        rest = rest.slice(take);
        if (line.length === COLUMNS) {
          out.push(line);
          line = "";
        }
      } else if (line.length + 1 + rest.length <= COLUMNS) {
        line += ` ${rest}`;
        rest = "";
      } else {
        out.push(line);
        line = "";
      }
    }
  }
  if (line) out.push(line);
  return out;
}

function cmd(...bytes: number[]): Buffer {
  return Buffer.from(bytes);
}

function text(value: string): Buffer {
  return Buffer.from(sanitize(value), "ascii");
}

/**
 * Truncate to a printed width, halving the budget for double-width output.
 *
 * A 58mm roll is 32 columns at the default font but only 16 at double width,
 * so an unadjusted truncation would emit a heading that silently wraps.
 */
function truncatePrintable(value: string, columns: number, doubleWidth = false): string {
  return truncate(value, doubleWidth ? Math.floor(columns / 2) : columns);
}

/** A centred, double-width heading. */
function heading(value: string): Buffer {
  return Buffer.concat([
    cmd(ESC, 0x61, ALIGN_CENTER),
    cmd(ESC, 0x21, WIDTH_DOUBLE),
    text(truncatePrintable(value, COLUMNS, true)),
    cmd(0x0a),
    cmd(ESC, 0x21, OFF),
    cmd(ESC, 0x61, ALIGN_LEFT),
  ]);
}

/** Bold single-width text, used for the totals block. */
function bold(value: string, align: "left" | "right" = "left"): Buffer {
  return Buffer.concat([
    cmd(ESC, 0x45, ON),
    text(column(value, COLUMNS, align)),
    cmd(0x0a),
    cmd(ESC, 0x45, OFF),
  ]);
}

function plain(value: string): Buffer {
  return Buffer.concat([text(value), cmd(0x0a)]);
}

/**
 * Render a receipt as an ESC/POS byte stream ready to write to the printer.
 *
 * Trailing feed plus a full cut is appended so each receipt separates cleanly
 * from the next on a continuous roll.
 */
export function renderReceipt(receipt: Receipt): Buffer {
  const chunks: Buffer[] = [
    // ESC @ - reset the printer to its power-on state. Without this, a wedged
    // previous job can leak character size or emphasis into this receipt.
    cmd(ESC, 0x40),
    heading(receipt.clinicName),
    plain(column(`Receipt ${truncate(receipt.receiptNo, 18)}`, COLUMNS, "left")),
    plain(`Issued: ${truncate(receipt.issuedAt, 21)}`),
  ];

  if (receipt.patientName) {
    for (const line of wrap(`Patient: ${receipt.patientName}`)) chunks.push(plain(line));
  }
  chunks.push(plain(`Cashier: ${truncate(receipt.cashierName, 21)}`));

  if (receipt.reprintOf) {
    chunks.push(plain(""));
    chunks.push(plain(column(`REPRINT OF ${truncate(receipt.reprintOf, 18)}`, COLUMNS, "left")));
  }

  chunks.push(plain("-".repeat(COLUMNS)));

  for (const line of receipt.lines) {
    const combined = `${line.label} ${line.value}`.trim();
    if (line.alignRight === false) {
      for (const w of wrap(combined)) chunks.push(plain(w));
    } else {
      chunks.push(
        plain(column(truncate(line.label, 16), 16, "left") + truncate(line.value, 15)),
      );
    }
  }

  chunks.push(plain("-".repeat(COLUMNS)));

  if (receipt.subtotalLabel && receipt.subtotalValue) {
    chunks.push(plain(column(receipt.subtotalLabel, 18, "left") + column(receipt.subtotalValue, 14, "right")));
  }
  if (receipt.discountLabel && receipt.discountValue) {
    chunks.push(
      plain(column(receipt.discountLabel, 18, "left") + column(receipt.discountValue, 14, "right")),
    );
  }
  if (receipt.totalLabel && receipt.totalValue) {
    chunks.push(bold(column(receipt.totalLabel, 17, "left"), "left"));
    chunks.push(bold(column(receipt.totalValue, 15, "right")));
  }

  if (receipt.footer) {
    chunks.push(plain(""));
    for (const line of wrap(receipt.footer)) chunks.push(plain(line));
  }

  chunks.push(plain(""));
  // Feed 4 lines then cut, so the tear-off edge is past the last line of text.
  chunks.push(cmd(ESC, 0x64, 0x04));
  chunks.push(cmd(GS, 0x56, 0x42, 0x00));

  return Buffer.concat(chunks);
}
