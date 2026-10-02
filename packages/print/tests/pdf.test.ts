import { afterAll, describe, expect, it } from "vitest";
import {
  closePrintRenderer,
  normalizePdfDates,
  renderPdf,
  sha256Of,
  verifyDocument,
} from "../src/pdf.js";
import { renderCertificateHtml, renderLabReportHtml, renderReceiptHtml } from "../src/templates.js";

/**
 * These tests drive a real headless Chromium. They are the evidence that the
 * print pipeline actually renders, and that its digest is a *document* digest:
 * the original placeholder hashed a metadata string containing `Date.now()`,
 * which could not detect a changed document and changed on every run.
 */

afterAll(async () => {
  await closePrintRenderer();
});

describe("renderPdf", () => {
  it("renders real PDF bytes", async () => {
    const doc = await renderPdf("<html><body><h1>Hello</h1></body></html>");

    expect(doc.mediaType).toBe("application/pdf");
    expect(doc.byteLength).toBeGreaterThan(500);
    // A PDF always opens with the %PDF- magic and ends with %%EOF.
    expect(doc.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(doc.bytes.subarray(-6).toString("latin1").trim()).toBe("%%EOF");
  });

  it("hashes the bytes it returns, so the digest is verifiable", async () => {
    const doc = await renderPdf("<html><body><p>digest check</p></body></html>");

    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Of(doc.bytes)).toBe(doc.sha256);
  });

  it("is deterministic: identical HTML yields an identical digest", async () => {
    const html = "<html><body><h2>Repeatable</h2><p>same input</p></body></html>";

    const first = await renderPdf(html);
    // A real delay: Chromium's embedded timestamp has second resolution, so an
    // instant second render could land in the same second and pass trivially.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await renderPdf(html);

    expect(second.sha256).toBe(first.sha256);
    expect(second.bytes.equals(first.bytes)).toBe(true);
  });

  it("gives a different digest when the content differs", async () => {
    const a = await renderPdf("<html><body><p>version one</p></body></html>");
    const b = await renderPdf("<html><body><p>version two</p></body></html>");

    expect(a.sha256).not.toBe(b.sha256);
  });

  it("normalises Chromium's timestamps away", async () => {
    const doc = await renderPdf("<html><body><p>normalise</p></body></html>");
    const text = doc.bytes.toString("latin1");

    // The epoch itself is 14 digits, so "no /CreationDate (D:<14 digits>)" would
    // be trivially false. Assert no date *other than* the epoch survives.
    expect(text).toMatch(/\/CreationDate \(D:19700101000000\+00'00'\)/);
    expect(text).toMatch(/\/ModDate \(D:19700101000000\+00'00'\)/);
    expect(text).not.toMatch(/\/CreationDate \(D:(?!1970)/);
    expect(text).not.toMatch(/\/ModDate \(D:(?!1970)/);
  });

  it("detects tampering via verifyDocument", async () => {
    const doc = await renderPdf("<html><body><p>unaltered</p></body></html>");

    expect(verifyDocument(doc.bytes, doc.sha256).valid).toBe(true);

    // Flip one byte inside the body of the file. Chromium stores page text in
    // compressed content streams, so the literal words are not findable in the
    // bytes; any mutation must still break the digest, which is the property
    // that matters for tamper-evidence.
    const tampered = Buffer.from(doc.bytes);
    const target = Math.floor(tampered.byteLength / 2);
    tampered[target] = (tampered[target]! ^ 0xff) & 0xff;

    expect(verifyDocument(tampered, doc.sha256).valid).toBe(false);
  });

  it("survives a broken input without leaking a browser page", async () => {
    // Malformed CSS must not reject: Chromium recovers and still produces a
    // valid, hashable document.
    const doc = await renderPdf("<html><style>@media{</style><body><p>ok</p></body></html>");
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("honours landscape orientation", async () => {
    const portrait = await renderPdf("<html><body><p>page</p></body></html>", { format: "A4" });
    const landscape = await renderPdf("<html><body><p>page</p></body></html>", {
      format: "A4",
      landscape: true,
    });

    expect(landscape.sha256).not.toBe(portrait.sha256);
  });
});

describe("normalizePdfDates", () => {
  it("rewrites both dates and preserves byte length", () => {
    // Byte length must be preserved: PDF xref tables record byte offsets, so a
    // length-changing edit would corrupt the file.
    const input = Buffer.from(
      "%PDF-1.4\n/Info <</CreationDate (D:20261002022415+00'00')/ModDate (D:20261002022416+00'00')>>",
      "latin1",
    );
    const out = normalizePdfDates(input);

    expect(out.byteLength).toBe(input.byteLength);
    expect(out.toString("latin1")).toContain("D:19700101000000+00'00'");
    expect(out.toString("latin1")).not.toMatch(/D:2026/);
  });

  it("leaves a PDF with no dates untouched", () => {
    const input = Buffer.from("%PDF-1.4\nnothing to do here", "latin1");
    expect(normalizePdfDates(input).equals(input)).toBe(true);
  });
});

describe("document templates render and hash", () => {
  it("renders a certificate", async () => {
    const html = renderCertificateHtml({
      clinicName: "Klinika ng Pagmamahal",
      certificateNo: "CERT-000123",
      issuedAt: "2026-10-02 14:30",
      patientName: "Dela Cruz, Juan",
      patientAge: "34",
      diagnosis: "Acute upper respiratory tract infection",
      body: "Please allow the patient seven calendar days of rest.",
      unfitForDays: 7,
      clinicianName: "Dr. A. Reyes",
      clinicianLicenseNo: "PRC-123456",
      signedElectronically: true,
    });
    const doc = await renderPdf(html);

    expect(doc.byteLength).toBeGreaterThan(1000);
    expect(doc.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("renders a lab report with flags and a correction notice", async () => {
    const html = renderLabReportHtml({
      clinicName: "Klinika ng Pagmamahal",
      reportNo: "LAB-2026-000045",
      orderNo: "ORD-00021",
      version: 2,
      status: "CORRECTED",
      patientName: "Santos, Maria",
      patientAge: "52",
      collectedAt: "2026-10-02 09:00",
      releasedAt: "2026-10-02 11:15",
      verifiedBy: "Dr. B. Cruz",
      amendmentReason: "Haematology analyser recalibrated; potassium re-run.",
      results: [
        { test: "CBC", analyte: "Haemoglobin", value: "118", unit: "g/L", referenceRange: "120-160", flag: "L" },
        { test: "CBC", analyte: "Platelet count", value: "88", unit: "10^9/L", referenceRange: "150-400", flag: "CRITICAL" },
        { test: "Chem", analyte: "Potassium", value: "6.4", unit: "mmol/L", referenceRange: "3.5-5.1", flag: "HH" },
      ],
      interpretation: "Critical hyperkalaemia - urgent clinical review required.",
    });
    const doc = await renderPdf(html);

    expect(doc.byteLength).toBeGreaterThan(1000);
  });

  it("renders a receipt and keeps internal fee fields out of the template", async () => {
    const html = renderReceiptHtml({
      clinicName: "Klinika ng Pagmamahal",
      receiptNo: "OR-000789",
      issuedAt: "2026-10-02 15:00",
      cashierName: "M. Aquino",
      patientName: "Garcia, Pedro",
      payer: "Private cash",
      lines: [
        { description: "Consultation - new patient", qty: 1, unitPrice: 800, total: 800 },
        { description: "Complete blood count", qty: 1, unitPrice: 450, total: 450 },
      ],
      subtotal: 1250,
      discount: { label: "Senior citizen", amount: 100, idCaptured: true },
      total: 1150,
      amountTendered: 1200,
      changeGiven: 50,
    });
    const doc = await renderPdf(html);

    expect(doc.byteLength).toBeGreaterThan(1000);
    // Q-17: the patient receipt must not be able to carry a revenue-share rate.
    expect(html).not.toMatch(/pf_share|revenue.?share|profit.?share/i);
  });

  it("escapes hostile patient-supplied text", async () => {
    const html = renderCertificateHtml({
      clinicName: "Klinika",
      certificateNo: "CERT-000124",
      issuedAt: "2026-10-02",
      patientName: "<script>alert('xss')</script>",
      body: "<img src=x onerror=alert(1)>",
      clinicianName: "Dr. Test",
    });

    // Angle brackets are neutralised, so neither payload can become a tag.
    // The substring "onerror=" may legitimately survive as inert text.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/<img/i);
  });
});
