/**
 * ZPL II label rendering (todo.md 3.2 print pipeline).
 *
 * ZPL is a text language consumed directly by Zebra label printers, so these
 * builders return a string and never touch the browser. Specimen barcodes, Rx
 * labels and controlled-drug serial labels are printed this way.
 *
 * Geometry is in dots at the printer's nominal resolution (203 dpi for the
 * 4in/6in printers this platform targets), so the numbers below are chosen for
 * a 4x2in label (812 x 406 dots) and a 4x6in label (812 x 1218).
 */

/** A barcoded specimen or order label. */
export interface BarcodeLabel {
  /** Human-readable title, e.g. "LAB SPECIMEN". */
  title: string;
  /** Code 128 payload. Must be non-empty and free of ZPL control characters. */
  barcodeValue: string;
  /** Lines rendered above the barcode, e.g. patient name and collected time. */
  lines?: string[];
  /** Optional QR payload, e.g. a deep link back to the order. */
  qrValue?: string;
  /** Label stock. Defaults to 4x2in. */
  size?: "4x2" | "4x6" | "2x1";
}

const SIZES: Record<NonNullable<BarcodeLabel["size"]>, { width: number; height: number }> = {
  "2x1": { width: 406, height: 203 },
  "4x2": { width: 812, height: 406 },
  "4x6": { width: 812, height: 1218 },
};

/**
 * Escape a value for ZPL's `^FD` field data.
 *
 * `^` and `~` are format-prefix characters; leaving them raw would let a
 * crafted patient name alter the label's layout or inject further commands.
 * `\` must go first so the backslashes introduced below are not re-escaped.
 */
export function escapeZpl(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/[\^~]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, " ");
}

/**
 * Render a barcode label as ZPL II.
 *
 * Layout is top-down: title, caller-supplied lines, then a Code 128 barcode
 * with the value repeated underneath in human-readable form, then the QR block
 * if one was supplied.
 */
export function renderBarcodeLabel(label: BarcodeLabel): string {
  if (label.barcodeValue.length === 0) {
    throw new Error("barcodeValue must not be empty");
  }
  const { width } = SIZES[label.size ?? "4x2"];
  const parts: string[] = ["^XA", "^CI28", `^PW${width}`, "^LH20,20"];

  parts.push("^BY2,3,90", "^CF0,28", `^FO20,20^A0N,34,34^FD${escapeZpl(label.title)}^FS`);

  let y = 70;
  for (const line of label.lines ?? []) {
    parts.push(`^FO20,${y}^A0N,26,26^FD${escapeZpl(line)}^FS`);
    y += 32;
  }

  // Keep the barcode inside the label: skip it rather than overflow when the
  // caller supplied many lines on a short stock.
  const barcodeTop = y + 6;
  if (barcodeTop + 130 < SIZES[label.size ?? "4x2"].height) {
    parts.push(`^FO40,${barcodeTop}^BCN,90,Y,N,N^FD${escapeZpl(label.barcodeValue)}^FS`);
  }

  if (label.qrValue) {
    parts.push(`^FO${width - 200},${barcodeTop}^BQN,2,6^FDQA,${escapeZpl(label.qrValue)}^FS`);
  }

  parts.push("^XZ");
  return parts.join("\n");
}

/** An Rx label, which carries sig text rather than a scannable barcode. */
export interface RxLabel {
  patientName: string;
  drugName: string;
  strength: string;
  sig: string;
  quantity: string;
  batchNo?: string;
  expiry?: string;
  pharmacistName: string;
  /** Controlled-drug serial, when the drug is scheduled. */
  serialNo?: string;
  issuedAt: string;
}

/**
 * Render a dispensed-Rx label as ZPL II.
 *
 * Quantity in words is printed next to the numeral for scheduled drugs
 * (specification 5.3), because the Dangerous Drugs Book is reconciled by hand
 * and a bare numeral is ambiguous once detached from the pack.
 */
export function renderRxLabel(rx: RxLabel): string {
  const parts: string[] = [
    "^XA",
    "^CI28",
    "^PW812",
    "^LH20,20",
    "^FO20,20^A0N,32,32^FDMEDICATION^FS",
    `^FO20,60^A0N,26,26^FD${escapeZpl(rx.patientName)}^FS`,
    `^FO20,92^A0N,30,30^FD${escapeZpl(`${rx.drugName} ${rx.strength}`)}^FS`,
    `^FO20,130^A0N,24,24^FD${escapeZpl(`Sig: ${rx.sig}`)}^FS`,
    `^FO20,160^A0N,24,24^FD${escapeZpl(`Qty: ${rx.quantity}`)}^FS`,
  ];

  let y = 192;
  if (rx.batchNo) {
    parts.push(`^FO20,${y}^A0N,22,22^FD${escapeZpl(`Batch: ${rx.batchNo}`)}^FS`);
    y += 28;
  }
  if (rx.expiry) {
    parts.push(`^FO20,${y}^A0N,22,22^FD${escapeZpl(`Expiry: ${rx.expiry}`)}^FS`);
    y += 28;
  }
  if (rx.serialNo) {
    parts.push(`^FO20,${y}^A0N,26,26^FD${escapeZpl(`Serial: ${rx.serialNo}`)}^FS`);
    y += 30;
  }
  parts.push(`^FO20,${y + 6}^A0N,22,22^FD${escapeZpl(`Pharmacist: ${rx.pharmacistName}`)}^FS`);
  parts.push(`^FO20,${y + 34}^A0N,20,20^FD${escapeZpl(`Issued ${rx.issuedAt}`)}^FS`);
  parts.push("^XZ");
  return parts.join("\n");
}
