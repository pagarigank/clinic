import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sendPdf } from '../src/http/pdf-response.js';
import { ClinicalController } from '../src/clinical/clinical.controller.js';
import { PharmacyController } from '../src/pharmacy/pharmacy.controller.js';
import { SupplyController } from '../src/supply/supply.controller.js';
import { LabController } from '../src/lab/lab.controller.js';
import { BillingController } from '../src/billing/billing.controller.js';
import type { RequestWithAuth } from '../src/auth/auth-context.js';

/**
 * Every official document leaves the API as a PDF whose digest is published in
 * `x-document-sha256`. Two properties matter and are asserted here:
 *
 *  1. the advertised digest is the digest of the bytes actually sent, so a
 *     client can prove the copy it filed is byte-identical to the rendered one;
 *  2. no document endpoint quietly drops the header, because an unadvertised
 *     digest is indistinguishable from an untampered one.
 */

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const VISIT_ID = '33333333-3333-4333-8333-333333333333';
const RX_ID = '44444444-4444-4444-8444-444444444444';
const REPORT_ID = '55555555-5555-4555-8555-555555555555';

const mockReq = {
  tenantId: TENANT_ID,
  authContext: { userId: USER_ID },
} as unknown as RequestWithAuth;

type FakeReply = {
  reply: any;
  headers: Record<string, string>;
  body: Buffer | undefined;
};

/** Minimal FastifyReply stand-in that records the headers actually set. */
function fakeReply(): FakeReply {
  const headers: Record<string, string> = {};
  let body: Buffer | undefined;
  const chain: any = {
    status(code: number) {
      expect(code).toBe(200);
      return chain;
    },
    header(name: string, value: string | number) {
      headers[name.toLowerCase()] = String(value);
      return chain;
    },
    send(payload: Buffer) {
      body = payload;
      return chain;
    },
  };
  return { reply: chain, headers, get body() { return body; } } as FakeReply;
}

const PDF_BYTES = Buffer.from('%PDF-1.7\nsealed document bytes\n%%EOF\n', 'utf8');
const PDF_SHA = createHash('sha256').update(PDF_BYTES).digest('hex');

function renderedDoc() {
  return {
    bytes: PDF_BYTES,
    sha256: PDF_SHA,
    byteLength: PDF_BYTES.byteLength,
    mediaType: 'application/pdf' as const,
  };
}

describe('sendPdf', () => {
  it('publishes the digest of the bytes it sends, never a re-computed one', () => {
    const f = fakeReply();
    sendPdf(f.reply, renderedDoc(), 'Doc.pdf');

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-type']).toBe('application/pdf');
    expect(f.headers['content-disposition']).toBe('inline; filename="Doc.pdf"');
    expect(f.headers['content-length']).toBe(String(PDF_BYTES.byteLength));
    expect(f.body).toBe(PDF_BYTES);
    // The advertised digest must match the served bytes, not just look plausible.
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('omits content-length only when the payload does not report one', () => {
    const withLength = fakeReply();
    sendPdf(withLength.reply, renderedDoc(), 'Doc.pdf');
    expect(withLength.headers['content-length']).toBeDefined();

    const withoutLength = fakeReply();
    sendPdf(withoutLength.reply, { bytes: PDF_BYTES, sha256: PDF_SHA }, 'Doc.pdf');
    expect(withoutLength.headers['content-length']).toBeUndefined();
    expect(withoutLength.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(withoutLength.headers['content-type']).toBe('application/pdf');
  });
});

describe('PDF document endpoints advertise their digest', () => {
  const clinicalSvc = {
    renderPrescriptionPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderVisitPrescriptionPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderVisitLabRequisitionPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderVisitOrdersPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderCertificatePdf: vi.fn().mockResolvedValue(renderedDoc()),
  } as any;
  const clinical = new ClinicalController(clinicalSvc);

  const pharmacySvc = {
    getVerificationQueueDocument: vi.fn().mockResolvedValue({ rows: [] }),
  } as any;
  // The queue and consumption documents are rendered by the controller itself.
  const pharmacy = new PharmacyController(pharmacySvc);

  const supplySvc = {
    getConsumptionListDocument: vi.fn().mockResolvedValue({ rows: [] }),
  } as any;
  const supply = new SupplyController(supplySvc);

  it('serves the prescription PDF with its seal', async () => {
    const f = fakeReply();
    await clinical.getPrescriptionPdf(mockReq, RX_ID, {}, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('Prescription-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the visit prescription pad PDF with its seal', async () => {
    const f = fakeReply();
    await clinical.getVisitPrescriptionPdf(mockReq, VISIT_ID, {}, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the laboratory requisition PDF with its seal', async () => {
    const f = fakeReply();
    await clinical.getVisitLabRequisitionPdf(mockReq, VISIT_ID, {}, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the clinical orders PDF with its seal', async () => {
    const f = fakeReply();
    await clinical.getVisitOrdersPdf(mockReq, VISIT_ID, {}, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the medical certificate PDF with its seal', async () => {
    const f = fakeReply();
    await clinical.getCertificatePdf(mockReq, RX_ID, {}, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the prescription verification queue PDF with its seal', async () => {
    const f = fakeReply();
    await pharmacy.getQueuePdf(mockReq, 'ISSUED', f.reply);

    expect(f.headers['x-document-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  }, 60_000);

  it('serves the consumption / issuance list PDF with its seal', async () => {
    const f = fakeReply();
    await supply.getConsumptionPdf(mockReq, '2026-10-01', '2026-10-04', 'loc-1', f.reply);

    expect(f.headers['x-document-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  }, 60_000);

  const billingSvc = {
    renderPaymentReceiptPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderPatientStatementPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderShiftReportPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderReceivablesReportPdf: vi.fn().mockResolvedValue(renderedDoc()),
    renderDailyClosePdf: vi.fn().mockResolvedValue(renderedDoc()),
  } as any;
  const billing = new BillingController(billingSvc);

  it('serves the payment receipt PDF with its seal', async () => {
    const f = fakeReply();
    await billing.getPaymentReceiptPdf(mockReq, 'pay-1', f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('Receipt-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the patient statement of account (SOA) PDF with its seal', async () => {
    const f = fakeReply();
    await billing.getPatientStatementPdf(mockReq, 'pat-1', f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('Statement-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the cashier shift Z-report PDF with its seal', async () => {
    const f = fakeReply();
    await billing.getShiftZReportPdf(mockReq, 'sh-1', f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('Shift-ZReport-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the accounts receivables aging schedule PDF with its seal', async () => {
    const f = fakeReply();
    await billing.getReceivablesReportPdf(mockReq, '2026-10-05', undefined, undefined, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('Receivables-Aging-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('serves the daily close summary PDF with its seal', async () => {
    const f = fakeReply();
    await billing.getDailyClosePdf(mockReq, '2026-10-05', undefined, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.headers['content-disposition']).toContain('DailyClose-');
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });
});

describe('sealed stored report PDF', () => {
  const labSvc = {
    getReportArtifact: vi.fn(),
  } as any;
  const lab = new LabController(labSvc);

  it('serves the stored bytes and publishes their recorded seal', async () => {
    labSvc.getReportArtifact.mockResolvedValue({
      bytes: PDF_BYTES,
      fileName: 'report.pdf',
      sha256: PDF_SHA,
      byteLength: PDF_BYTES.byteLength,
    });
    const f = fakeReply();
    await lab.getReportPdf(mockReq, REPORT_ID, f.reply);

    expect(f.headers['x-document-sha256']).toBe(PDF_SHA);
    expect(f.body).toBe(PDF_BYTES);
    expect(createHash('sha256').update(f.body!).digest('hex')).toBe(f.headers['x-document-sha256']);
  });

  it('refuses to serve a report whose bytes no longer match the seal', async () => {
    labSvc.getReportArtifact.mockResolvedValue({
      bytes: Buffer.from('%PDF-1.7\ntampered\n%%EOF\n', 'utf8'),
      fileName: 'report.pdf',
      sha256: PDF_SHA,
      byteLength: 27,
    });
    const f = fakeReply();

    await expect(lab.getReportPdf(mockReq, REPORT_ID, f.reply)).rejects.toMatchObject({
      response: expect.objectContaining({ detail: expect.stringMatching(/no longer matches its recorded SHA-256/) }),
      status: 409,
    });
    // Nothing was served: a tampered clinical document must not reach a client.
    expect(f.body).toBeUndefined();
  });

  it('refuses to serve a report with no recorded seal', async () => {
    labSvc.getReportArtifact.mockResolvedValue({
      bytes: PDF_BYTES,
      fileName: 'report.pdf',
      sha256: null,
      byteLength: PDF_BYTES.byteLength,
    });
    const f = fakeReply();

    await expect(lab.getReportPdf(mockReq, REPORT_ID, f.reply)).rejects.toMatchObject({
      response: expect.objectContaining({ detail: expect.stringMatching(/no SHA-256 seal recorded/) }),
      status: 409,
    });
    expect(f.body).toBeUndefined();
  });
});
