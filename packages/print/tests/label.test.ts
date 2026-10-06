import { describe, expect, it } from "vitest";
import { escapeZpl, renderBarcodeLabel, renderRxLabel } from "../src/zpl.js";
import { renderReceipt as renderThermalReceipt } from "../src/escpos.js";
import {
  renderDispenseLabelHtml,
  type DispenseLabelDocument,
} from "../src/templates.js";

/**
 * ZPL and ESC/POS are pure text/byte builders, so these tests need no printer
 * and no browser. They cover the escaping rules in particular: both languages
 * are injection surfaces, because patient names and drug sigs reach them as
 * free text.
 */

/** Bytes that follow the command byte, for each command the builder emits. */
const ESC_PARAM_BYTES: Record<number, number> = {
  0x40: 1, // ESC @  reset
  0x61: 2, // ESC a  alignment
  0x21: 2, // ESC !  character size
  0x45: 2, // ESC E  emphasis
  0x64: 2, // ESC d  feed
};
const GS_PARAM_BYTES: Record<number, number> = {
  0x56: 3, // GS V  cut
};

/**
 * Control sequences carry *printable* parameter bytes - "ESC !" is emphasis and
 * "ESC a" is alignment - so simply deleting control characters leaves debris
 * that looks like text overflow. Decode against the real command set so a width
 * assertion measures what the paper shows, not what the byte stream contains.
 */
function decodeLines(buf: Buffer): Array<{ text: string; columns: number }> {
  const lines: Array<{ text: string; columns: number }> = [];
  let text = "";
  let columns = 0;
  let doubleWidth = false;

  const flush = () => {
    lines.push({ text, columns });
    text = "";
    columns = 0;
  };

  for (let i = 0; i < buf.length; ) {
    const b = buf[i]!;

    if (b === 0x0a) {
      flush();
      i += 1;
      continue;
    }

    if (b === 0x1b || b === 0x1d) {
      const table = b === 0x1b ? ESC_PARAM_BYTES : GS_PARAM_BYTES;
      if (b === 0x1b && buf[i + 1] === 0x21) {
        doubleWidth = (buf[i + 2]! & 0x10) !== 0;
      }
      const paramCount = table[buf[i + 1]!];
      i += paramCount === undefined ? 1 : 1 + paramCount;
      continue;
    }

    text += String.fromCharCode(b);
    columns += doubleWidth ? 2 : 1;
    i += 1;
  }
  flush();
  return lines;
}

/** Control bytes the builder does not emit, i.e. injected from user text. */
function unknownControlBytes(buf: Buffer): number[] {
  const stray: number[] = [];
  for (let i = 0; i < buf.length; ) {
    const b = buf[i]!;
    if (b === 0x0a) {
      i += 1;
      continue;
    }
    if (b === 0x1b || b === 0x1d) {
      const table = b === 0x1b ? ESC_PARAM_BYTES : GS_PARAM_BYTES;
      const paramCount = table[buf[i + 1]!];
      if (paramCount === undefined) {
        stray.push(b);
        i += 1;
        continue;
      }
      i += 1 + paramCount;
      continue;
    }
    if (b < 0x20 || b === 0x7f) stray.push(b);
    i += 1;
  }
  return stray;
}

describe("escapeZpl", () => {
  it("neutralises the ZPL format prefix characters", () => {
    expect(escapeZpl("a^b~c")).toBe("a\\^b\\~c");
  });

  it("escapes backslash before the others so it is not double-processed", () => {
    expect(escapeZpl("a\\^b")).toBe("a\\\\\\^b");
  });

  it("folds newlines into spaces", () => {
    expect(escapeZpl("line1\nline2\r\nline3")).toBe("line1 line2 line3");
  });
});

describe("renderBarcodeLabel", () => {
  const base = { title: "LAB SPECIMEN", barcodeValue: "SPC-2026-0001" };

  it("emits a well-formed ZPL document", () => {
    const zpl = renderBarcodeLabel({
      ...base,
      lines: ["Dela Cruz, Juan", "Collected 09:00"],
    });

    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl.trimEnd().endsWith("^XZ")).toBe(true);
    expect(zpl).toContain("^BCN"); // Code 128
    expect(zpl).toContain("^FDLAB SPECIMEN^FS");
  });

  it("renders a label with no extra lines", () => {
    // `lines` is optional: a bare specimen barcode is a legitimate label.
    expect(() => renderBarcodeLabel(base)).not.toThrow();
  });

  it("adds a QR block only when a deep link is supplied", () => {
    expect(renderBarcodeLabel(base)).not.toContain("^BQN");
    expect(renderBarcodeLabel({ ...base, qrValue: "https://app.test/orders/1" })).toContain("^BQN");
  });

  it("rejects an empty barcode value", () => {
    expect(() => renderBarcodeLabel({ ...base, barcodeValue: "" })).toThrow(/must not be empty/);
  });

  it("cannot be used to inject ZPL commands through a patient name", () => {
    const zpl = renderBarcodeLabel({
      ...base,
      lines: ["^XZ^XA^FDINJECTED"],
      qrValue: "^XZ",
    });

    // Count only *unescaped* command tokens: the escaped form still contains
    // the characters "^XZ", but as inert field data.
    expect(zpl.match(/(?<!\\)\^XA/g)?.length ?? 0).toBe(1);
    expect(zpl.match(/(?<!\\)\^XZ/g)?.length ?? 0).toBe(1);
    expect(zpl).toContain("\\^XZ\\^XA\\^FDINJECTED");
  });

  it("omits the barcode rather than overflowing a short label", () => {
    const many = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const zpl = renderBarcodeLabel({ ...base, lines: many, size: "2x1" });

    expect(zpl).toContain("^FDline 11^FS");
    expect(zpl).not.toContain("^BCN");
  });
});

describe("renderRxLabel", () => {
  it("prints the fields a pharmacist and patient both need", () => {
    const zpl = renderRxLabel({
      patientName: "Santos, Maria",
      drugName: "Amoxicillin",
      strength: "500mg",
      sig: "1 tab 3x daily after meals",
      quantity: "21",
      batchNo: "B-7741",
      expiry: "2027-03",
      pharmacistName: "R. Lim",
      issuedAt: "2026-10-02 15:00",
    });

    expect(zpl.startsWith("^XA")).toBe(true);
    expect(zpl).toContain("MEDICATION");
    expect(zpl).toContain("Sig: 1 tab 3x daily after meals");
    expect(zpl).toContain("Batch: B-7741");
    expect(zpl).toContain("Pharmacist: R. Lim");
  });

  it("includes the controlled-drug serial when present", () => {
    const zpl = renderRxLabel({
      patientName: "P",
      drugName: "Morphine",
      strength: "10mg",
      sig: "as directed",
      quantity: "5",
      pharmacistName: "R. Lim",
      issuedAt: "2026-10-02",
      serialNo: "CD-0001-0001",
    });

    expect(zpl).toContain("Serial: CD-0001-0001");
  });

  it("cannot be used to inject ZPL commands through a sig", () => {
    const zpl = renderRxLabel({
      patientName: "P",
      drugName: "D",
      strength: "1mg",
      sig: "^XZ^XA^FDINJECTED",
      quantity: "1",
      pharmacistName: "R. Lim",
      issuedAt: "2026-10-02",
    });

    expect(zpl.match(/(?<!\\)\^XZ/g)?.length ?? 0).toBe(1);
    expect(zpl.match(/(?<!\\)\^XA/g)?.length ?? 0).toBe(1);
  });
});

describe("renderThermalReceipt", () => {
  const receipt = {
    clinicName: "Klinika ng Pagmamahal",
    receiptNo: "OR-000789",
    issuedAt: "2026-10-02 15:00",
    cashierName: "M. Aquino",
    patientName: "Garcia, Pedro",
    lines: [
      { label: "Consultation", value: "800.00" },
      { label: "CBC", value: "450.00" },
    ],
    subtotalLabel: "Subtotal",
    subtotalValue: "1,250.00",
    totalLabel: "TOTAL",
    totalValue: "1,150.00",
  };

  it("emits a valid ESC/POS stream starting with a printer reset", () => {
    const buf = renderThermalReceipt(receipt);

    expect(buf[0]).toBe(0x1b);
    expect(buf[1]).toBe(0x40); // ESC @
  });

  it("ends with a paper cut", () => {
    const buf = renderThermalReceipt(receipt);

    expect(buf.subarray(buf.length - 4)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x00]));
  });

  it("is byte-identical for the same input", () => {
    expect(renderThermalReceipt(receipt).equals(renderThermalReceipt(receipt))).toBe(true);
  });

  it("renders the total and marks a reprint", () => {
    const printed = decodeLines(
      renderThermalReceipt({ ...receipt, reprintOf: "OR-000100" }),
    )
      .map((l) => l.text)
      .join("\n");

    expect(printed).toContain("TOTAL");
    expect(printed).toContain("REPRINT OF OR-000100");
  });

  it("strips control characters so a patient name cannot drive the printer", () => {
    const esc = String.fromCharCode(27);
    const buf = renderThermalReceipt({
      ...receipt,
      patientName: `Evil ${String.fromCharCode(0)}${esc}${esc}[2J${esc}Test`,
    });

    // The invariant is not that the *text* "[2J" disappears - it is inert once
    // its ESC lead byte is stripped - but that no unrecognised control byte
    // survives anywhere, so nothing user-supplied reaches the printer as a
    // command.
    expect(unknownControlBytes(buf)).toEqual([]);

    const printed = decodeLines(buf)
      .map((l) => l.text)
      .join("\n");
    expect(printed).toContain("Evil");
    expect(printed).toContain("Test");
  });

  it("never prints wider than the 32-column roll, even in double width", () => {
    const buf = renderThermalReceipt({
      ...receipt,
      clinicName: "A Very Long Clinic Name That Will Not Fit On The Roll",
      patientName: "A".repeat(90),
    });

    const over = decodeLines(buf).filter((l) => l.columns > 32);

    expect(
      over.map((l) => ({ columns: l.columns, text: l.text })),
      "lines wider than 32 columns",
    ).toEqual([]);
  });

  it("wraps a long patient name instead of dropping or truncating it", () => {
    // "Z" appears nowhere else on the receipt, so the count is unambiguous.
    const printed = decodeLines(
      renderThermalReceipt({ ...receipt, patientName: "Z".repeat(90) }),
    )
      .map((l) => l.text)
      .join("\n");

    // No character may be discarded: a receipt that silently drops part of a
    // name disagrees with the charge record it is supposed to evidence.
    expect(printed.replace(/[^Z]/g, "")).toHaveLength(90);
    expect(printed).toContain("Patient:");
    expect(printed.split("\n").length).toBeGreaterThan(2);
  });
});

/**
 * The A4/A5 counterpart to the thermal dispense label (PHM-T3). The failure mode
 * that matters here is a mis-dispense: a box printed without the patient name,
 * without the sig, or split across two sheets. Each box therefore has to carry
 * its own patient identity and be kept whole by the print layout.
 */
describe("renderDispenseLabelHtml", () => {
  const base: DispenseLabelDocument = {
    clinicName: "Metro Health Clinic",
    branchName: "Main",
    dispenseNo: "DSP-2026-00311",
    dispensedAt: "2026-10-04 10:20",
    patientName: "Dela Cruz, Clara",
    patientHrn: "HRN-2026-0091",
    patientDob: "1988-04-12",
    pharmacistName: "RPh. M. Aquino",
    items: [
      {
        drugName: "Amoxicillin",
        genericName: "Amoxicillin trihydrate",
        strength: "500mg",
        dosageForm: "Capsule",
        directionsForUse: "1 cap PO TID x 7 days, after meals",
        quantity: 21,
        batchNo: "AMX-24517",
        expiryDate: "2027-04-30",
      },
      {
        drugName: "Paracetamol",
        strength: "500mg",
        dosageForm: "Tablet",
        directionsForUse: "1 tab PO PRN for fever, max 8 tabs/day",
        quantity: 10,
      },
    ],
  };

  it("prints the clinic, dispense number, and dispensing stamp", () => {
    const html = renderDispenseLabelHtml(base);

    expect(html).toContain("Metro Health Clinic");
    expect(html).toContain("DSP-2026-00311");
    expect(html).toContain("2026-10-04 10:20");
  });

  it("emits one self-contained label box per dispensed item", () => {
    const html = renderDispenseLabelHtml(base);

    expect(html.match(/class="rx-label-box"/g)?.length ?? 0).toBe(2);
    // Each box repeats the patient identity, so one box cut from a sheet is
    // still attributable to the right person.
    expect(html.match(/class="rx-label-patient"/g)?.length ?? 0).toBe(2);
    expect(html.match(/class="rx-label-sig"/g)?.length ?? 0).toBe(2);
    expect(html.match(/class="rx-label-footer"/g)?.length ?? 0).toBe(2);
  });

  it("keeps a label box whole instead of letting it split across sheets", () => {
    const html = renderDispenseLabelHtml(base);

    expect(html).toContain("break-inside: avoid");
  });

  it("prints the drug, strength, dosage form, sig, quantity, lot and expiry", () => {
    const html = renderDispenseLabelHtml(base);

    expect(html).toContain("Amoxicillin");
    expect(html).toContain("Amoxicillin trihydrate");
    expect(html).toContain("500mg");
    expect(html).toContain("Capsule");
    expect(html).toContain("1 cap PO TID x 7 days, after meals");
    expect(html).toContain("21");
    expect(html).toContain("AMX-24517");
    expect(html).toContain("2027-04-30");
  });

  it("prints the second item's own sig rather than repeating the first", () => {
    const html = renderDispenseLabelHtml(base);

    expect(html).toContain("1 tab PO PRN for fever, max 8 tabs/day");
    // Each sig appears in exactly one box: a sig duplicated across boxes would
    // mean one drug's directions were applied to the other bottle, and a sig
    // appearing twice in the sheet header would be just as dangerous.
    expect(html.match(/1 cap PO TID x 7 days, after meals/g)?.length ?? 0).toBe(1);
    expect(html.match(/1 tab PO PRN for fever, max 8 tabs\/day/g)?.length ?? 0).toBe(1);
  });

  it("omits optional fields cleanly when the record supplies none", () => {
    const html = renderDispenseLabelHtml({
      clinicName: "Metro Health Clinic",
      dispenseNo: "DSP-2026-00399",
      dispensedAt: "2026-10-04 11:00",
      patientName: "Solo, Patient",
      items: [
        {
          drugName: "Cetirizine",
          directionsForUse: "1 tab PO once daily at night",
          quantity: 5,
        },
      ],
    });

    expect(html).toContain("Cetirizine");
    // No branch, HRN, DOB, pharmacist, lot, or expiry was supplied.
    expect(html).not.toContain("HRN");
    expect(html).not.toContain("Lot:");
    expect(html).not.toContain("Exp:");
    expect(html).not.toContain("RPh:");
    expect(html).not.toContain("Dispensed by");
    // Not a controlled item, so no S2 marker anywhere.
    expect(html).not.toContain("S2");
  });

  it("marks a dangerous-drug dispense with its S2 serial and the RA 9165 note", () => {
    const html = renderDispenseLabelHtml({
      ...base,
      specialRxSerial: "S2-2026-0007",
    });

    expect(html).toContain("S2-2026-0007");
    expect(html).toContain("RA 9165");
    // One marker per box, so a controlled item is flagged on every label.
    expect(html.match(/class="rx-label-s2"/g)?.length ?? 0).toBe(2);
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderDispenseLabelHtml({
      clinicName: "<b>Clinic</b>",
      dispenseNo: "\"><script>",
      dispensedAt: "<script>alert(1)</script>",
      patientName: "<img src=x onerror=alert(2)>",
      patientHrn: "</div><script>alert(3)</script>",
      pharmacistName: "<script>alert(4)</script>",
      specialRxSerial: "<script>alert(5)</script>",
      items: [
        {
          drugName: "<script>alert(6)</script>",
          genericName: "<b>generic</b>",
          strength: "\"><script>",
          dosageForm: "<script>",
          directionsForUse: "<img src=x onerror=alert(7)>",
          quantity: "<script>1</script>",
          batchNo: "</div><script>alert(8)</script>",
          expiryDate: "<script>",
        },
      ],
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b>/i);
    expect(html).toContain("&lt;script&gt;");
  });
});
