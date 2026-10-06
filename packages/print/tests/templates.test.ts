import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderCertificateHtml,
  renderLabReportHtml,
  renderReceiptHtml,
  renderPrescriptionHtml,
  renderLabRequisitionHtml,
  renderEncounterOrdersHtml,
  type PrescriptionDocument,
  type LabRequisitionDocument,
} from "../src/templates.js";



/**
 * Template tests. No browser needed: these assert *which fields appear* in the
 * generated HTML, which is the part that matters legally and financially.
 *
 * A medical certificate and an official receipt are documents a patient can
 * present to an employer, a school, or a regulator. If a required field stops
 * printing - a licence number, a corrected-report notice, a discount - the
 * document is still a valid PDF and no renderer test would notice. So each
 * optional field is asserted in both states: present and omitted.
 */

describe("escapeHtml", () => {
  it("escapes every character that could start a tag or attribute", () => {
    expect(escapeHtml(`<>&"`)).toBe("&lt;&gt;&amp;&quot;");
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("renders nullish and non-string values safely", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(false)).toBe("false");
  });
});

describe("renderCertificateHtml", () => {
  const minimal = {
    clinicName: "Klinika ng Pagmamahal",
    certificateNo: "CERT-000123",
    issuedAt: "2026-10-02 14:30",
    patientName: "Dela Cruz, Juan",
    body: "Please allow seven calendar days of rest.",
    clinicianName: "Dr. A. Reyes",
  };

  it("omits every optional field when none is supplied", () => {
    const html = renderCertificateHtml(minimal);

    expect(html).toContain("CERT-000123");
    expect(html).toContain("Dela Cruz, Juan");
    expect(html).toContain("Dr. A. Reyes");
    // None of these may appear when the caller supplied nothing.
    expect(html).not.toContain("Lic. No.");
    expect(html).not.toContain("Age");
    expect(html).not.toContain("Sex");
    expect(html).not.toContain("Diagnosis");
    expect(html).not.toContain("unfit for work");
    expect(html).not.toContain("Electronically signed");
  });

  it("prints the clinic address, demographics, diagnosis, and licence when supplied", () => {
    const html = renderCertificateHtml({
      ...minimal,
      clinicAddress: "123 Katipunan Ave, Quezon City",
      patientAge: "34",
      patientSex: "M",
      diagnosis: "Acute upper respiratory tract infection",
      unfitForDays: 7,
      clinicianLicenseNo: "PRC-123456",
      signedElectronically: true,
    });

    expect(html).toContain("123 Katipunan Ave, Quezon City");
    expect(html).toContain("Age");
    expect(html).toContain("34");
    expect(html).toContain("Sex");
    expect(html).toContain("Acute upper respiratory tract infection");
    expect(html).toContain("unfit for work for 7 day(s)");
    expect(html).toContain("Lic. No. PRC-123456");
    expect(html).toContain("Electronically signed");
  });

  it("treats a zero-day fitness note as supplied rather than absent", () => {
    // A falsy check would silently drop the "fit for work today" wording.
    const html = renderCertificateHtml({ ...minimal, unfitForDays: 0 });

    expect(html).toContain("unfit for work for 0 day(s)");
  });

  it("carries the void-if-altered notice on every certificate", () => {
    expect(renderCertificateHtml(minimal)).toContain("This document is void if altered.");
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderCertificateHtml({
      ...minimal,
      clinicName: "<b>Clinic</b>",
      patientName: "<script>alert('xss')</script>",
      body: "<img src=x onerror=alert(1)>",
      diagnosis: "</div><script>alert(2)</script>",
      clinicianName: "Dr. <script>",
      clinicianLicenseNo: "\"><script>",
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain("</div><script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderLabReportHtml", () => {
  const base = {
    clinicName: "Klinika ng Pagmamahal",
    reportNo: "LAB-2026-000045",
    orderNo: "ORD-00021",
    version: 1,
    status: "PRELIMINARY" as const,
    patientName: "Santos, Maria",
    results: [
      { test: "CBC", analyte: "Haemoglobin", value: "118", unit: "g/L", referenceRange: "120-160" },
    ],
  };

  it("marks a preliminary report as not for clinical use", () => {
    const html = renderLabReportHtml(base);

    expect(html).toContain("Status: PRELIMINARY");
    expect(html).toContain("NOT FOR CLINICAL USE");
    expect(html).toContain("Version 1");
  });

  it("marks a released report as electronically verified", () => {
    const html = renderLabReportHtml({ ...base, status: "RELEASED" });

    expect(html).toContain("Electronically verified");
    expect(html).not.toContain("NOT FOR CLINICAL USE");
  });

  it("states that a corrected version supersedes every earlier one", () => {
    const html = renderLabReportHtml({
      ...base,
      status: "CORRECTED",
      version: 3,
      amendmentReason: "Analyser recalibrated; potassium re-run.",
    });

    expect(html).toContain("supersedes all earlier versions");
    expect(html).toContain("Version 3");
    expect(html).toContain("Analyser recalibrated");
    expect(html).toContain("Electronically verified");
  });

  it("omits the amendment reason when the report is not an amendment", () => {
    expect(renderLabReportHtml(base)).not.toContain("Reason for amendment");
  });

  it("marks every abnormal flag distinctly", () => {
    const html = renderLabReportHtml({
      ...base,
      results: [
        { test: "T", analyte: "high", value: "1", flag: "H" },
        { test: "T", analyte: "low", value: "1", flag: "L" },
        { test: "T", analyte: "very high", value: "1", flag: "HH" },
        { test: "T", analyte: "very low", value: "1", flag: "LL" },
        { test: "T", analyte: "critical", value: "1", flag: "CRITICAL" },
        { test: "T", analyte: "normal", value: "1", flag: null },
        { test: "T", analyte: "unflagged", value: "1" },
      ],
    });

    // H and L are lettered; the life-threatening levels share a filled marker.
    expect(html).toContain("<strong>H</strong>");
    expect(html).toContain("<strong>L</strong>");
    expect(html.match(/<strong>&#9679;<\/strong>/g)?.length ?? 0).toBe(3);
    // A normal or absent flag must print no marker at all.
    expect(html).not.toContain("<strong></strong>");
  });

  it("prints an empty cell when a unit or reference range is absent", () => {
    const html = renderLabReportHtml({
      ...base,
      results: [{ test: "T", analyte: "Qualitative", value: "Negative" }],
    });

    expect(html).toContain("Qualitative");
    expect(html).toContain("Negative");
    expect(html).toContain("<td></td>");
  });

  it("prints the full chain of custody when every timestamp is supplied", () => {
    const html = renderLabReportHtml({
      ...base,
      patientAge: "52",
      patientSex: "F",
      collectedAt: "2026-10-02 09:00",
      receivedAt: "2026-10-02 09:45",
      releasedAt: "2026-10-02 11:15",
      orderingClinician: "Dr. B. Cruz",
      verifiedBy: "Dr. D. Lim",
      interpretation: "Critical hyperkalaemia - urgent clinical review required.",
    });

    for (const label of ["Age", "Sex", "Collected", "Received", "Released", "Ordering clinician"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("Dr. D. Lim");
    expect(html).toContain("Verified");
    expect(html).toContain("Interpretation");
    expect(html).toContain("urgent clinical review required");
  });

  it("omits every optional field when none is supplied", () => {
    const html = renderLabReportHtml(base);

    for (const label of ["Age", "Sex", "Collected", "Received", "Released", "Ordering clinician"]) {
      expect(html).not.toContain(label);
    }
    expect(html).not.toContain("Interpretation");
    expect(html).not.toContain("Verified");
    expect(html).not.toContain("CONFIDENTIAL");
  });

  it("shows a confidentiality notice for a restricted test", () => {
    const html = renderLabReportHtml({
      ...base,
      confidentialityNotice: "HIV serology - results to be discussed by the physician only.",
    });

    expect(html).toContain("CONFIDENTIAL");
    expect(html).toContain("discussed by the physician only");
  });
});

describe("renderReceiptHtml", () => {
  const base = {
    clinicName: "Klinika ng Pagmamahal",
    receiptNo: "OR-000789",
    issuedAt: "2026-10-02 15:00",
    cashierName: "M. Aquino",
    lines: [{ description: "Consultation - new patient", qty: 1, unitPrice: 800, total: 800 }],
    subtotal: 800,
    total: 800,
  };

  it("omits every optional field when none is supplied", () => {
    const html = renderReceiptHtml(base);

    expect(html).toContain("OR-000789");
    expect(html).toContain("M. Aquino");
    expect(html).toContain("800.00");
    expect(html).not.toContain("Patient");
    expect(html).not.toContain("Payer");
    expect(html).not.toContain("Cash tendered");
    expect(html).not.toContain("Change");
    expect(html).not.toContain("REPRINT");
  });

  it("prints the patient, payer, tendered cash, change, and footer when supplied", () => {
    const html = renderReceiptHtml({
      ...base,
      clinicAddress: "123 Katipunan Ave",
      patientName: "Garcia, Pedro",
      payer: "Private cash",
      amountTendered: 1000,
      changeGiven: 200,
      footer: "Please come back for your follow-up.",
    });

    expect(html).toContain("123 Katipunan Ave");
    expect(html).toContain("Garcia, Pedro");
    expect(html).toContain("Private cash");
    expect(html).toContain("Cash tendered");
    expect(html).toContain("1,000.00");
    expect(html).toContain("Change");
    expect(html).toContain("come back for your follow-up");
  });

  it("marks a reprint and states that the original stays valid", () => {
    const html = renderReceiptHtml({ ...base, reprintedFrom: "OR-000100" });

    expect(html).toContain("REPRINT");
    expect(html).toContain("OR-000100");
    expect(html).toContain("the original remains valid");
  });

  it("prints a discount and records whether ID was captured", () => {
    const withId = renderReceiptHtml({
      ...base,
      discount: { label: "Senior citizen", amount: 100, idCaptured: true },
      total: 700,
    });
    expect(withId).toContain("Senior citizen");
    expect(withId).toContain("(ID captured)");
    expect(withId).toContain("-100.00");

    const withoutId = renderReceiptHtml({
      ...base,
      discount: { label: "Senior citizen", amount: 100 },
      total: 700,
    });
    expect(withoutId).toContain("Senior citizen");
    expect(withoutId).not.toContain("(ID captured)");
  });

  it("omits a discount that is absent, null, or zero-valued", () => {
    // A zero discount row would imply an adjustment that never happened.
    for (const discount of [undefined, null, { label: "Promo", amount: 0 }]) {
      const html = renderReceiptHtml({ ...base, discount });
      expect(html).not.toContain("Promo");
      expect(html.match(/<div class="grand"/g)?.length ?? 0).toBe(1);
    }
  });

  it("formats money to two decimals with thousands separators", () => {
    const html = renderReceiptHtml({
      ...base,
      lines: [{ description: "Package", qty: 3, unitPrice: 1234.5, total: 3703.5 }],
      subtotal: 3703.5,
      total: 3703.5,
    });

    expect(html).toContain("1,234.50");
    expect(html).toContain("3,703.50");
  });

  it("falls back to zero for an unparseable amount rather than printing NaN", () => {
    // A receipt showing "NaN" is worse than one showing a wrong-but-plain zero.
    const html = renderReceiptHtml({
      ...base,
      subtotal: "not-a-number" as unknown as number,
      total: Number.NaN,
    });

    expect(html).not.toMatch(/NaN/);
    expect(html).toContain("0.00");
  });

  it("has no field that could carry an internal fee share (Q-17)", () => {
    const html = renderReceiptHtml(base);

    // The patient-facing receipt must have no revenue-share/PF percentage slot
    // for the template to print, even if a caller later supplies one.
    expect(html).not.toMatch(/pf_share|revenue.?share|profit.?share|percentage/i);
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderReceiptHtml({
      ...base,
      clinicName: "<b>Clinic</b>",
      patientName: "<script>alert('xss')</script>",
      payer: "\"><script>",
      footer: "<img src=x onerror=alert(1)>",
      lines: [{ description: "<script>line</script>", qty: 1, unitPrice: 0, total: 0 }],
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderPrescriptionHtml", () => {
  const baseRx: PrescriptionDocument = {
    clinicName: "Metro Health Medical Center",
    rxNo: "RX-2026-0001",
    issuedAt: "2026-10-04",
    patientName: "Santos, Maria Elena",
    patientAge: 38,
    patientSex: "FEMALE",
    prescriberName: "Dr. Roberto Mendoza, MD",
    prcLicenseNo: "0123456",
    ptrNo: "PTR-889900",
    items: [
      {
        genericName: "Amoxicillin + Clavulanic Acid",
        brandName: "Augmentin",
        strength: "500 mg / 125 mg",
        dosageForm: "Film-Coated Tablet",
        quantity: "21",
        sig: "Take 1 tablet every 8 hours with meals for 7 days",
      },
    ],
  };

  it("renders compliant Rx pad with uppercase generic name (RA 6675)", () => {
    const html = renderPrescriptionHtml(baseRx);
    expect(html).toContain("AMOXICILLIN + CLAVULANIC ACID");
    expect(html).toContain("(Augmentin)");
    expect(html).toContain("RX-2026-0001");
    expect(html).toContain("Santos, Maria Elena");
    expect(html).toContain("Dr. Roberto Mendoza, MD");
    expect(html).toContain("PRC Lic. No.");
    expect(html).toContain("0123456");
    expect(html).toContain("Philippine Generics Act");
    expect(html).toContain("No Known Drug Allergies (NKDA)");
  });

  it("renders allergy warning when patient allergies exist", () => {
    const html = renderPrescriptionHtml({
      ...baseRx,
      allergies: [{ substance: "Penicillin", severity: "SEVERE" }],
    });
    expect(html).toContain("DRUG ALLERGY WARNING");
    expect(html).toContain("Penicillin (SEVERE)");
    expect(html).not.toContain("NKDA");
  });

  it("renders S2 Dangerous Drugs warning when item is controlled or s2SerialNo provided", () => {
    const html = renderPrescriptionHtml({
      ...baseRx,
      s2LicenseNo: "S2-998877",
      s2SerialNo: "PDEA-S2-2026-001",
      s2QuantityInWords: "Twenty-one tablets",
      items: [
        {
          ...baseRx.items[0]!,
          isControlled: true,
        },
      ],
    });
    expect(html).toContain("DANGEROUS DRUGS BOARD / PDEA CONTROLLED SUBSTANCE");
    expect(html).toContain("S2-998877");
    expect(html).toContain("PDEA-S2-2026-001");
    expect(html).toContain("Twenty-one tablets");
  });

  it("renders clinical diagnosis, diagnosis description, and physician instructions on the prescription", () => {
    const html = renderPrescriptionHtml({
      ...baseRx,
      diagnosis: "J20.9",
      diagnosisDescription: "Acute Bronchitis, unspecified with chest congestion",
      specialInstruction: "Drink 2-3 liters of water daily. Return if symptoms worsen after 3 days.",
    });
    expect(html).toContain("Clinical Diagnosis / Impression:");
    expect(html).toContain("J20.9");
    expect(html).toContain("Diagnosis Description:");
    expect(html).toContain("Acute Bronchitis, unspecified with chest congestion");
    expect(html).toContain("Physician's Instructions &amp; Notes:");
    expect(html).toContain("Drink 2-3 liters of water daily. Return if symptoms worsen after 3 days.");
  });
});

describe("renderLabRequisitionHtml", () => {
  const baseReq: LabRequisitionDocument = {
    clinicName: "Metro Health Clinical Lab",
    orderNo: "LAB-2026-9001",
    issuedAt: "2026-10-04",
    priority: "STAT" as const,
    patientName: "Dela Cruz, Juan",
    orderingPhysician: "Dr. Roberto Mendoza",
    clinicalImpression: "Acute Abdomen, r/o Appendicitis",
    tests: [
      {
        testCode: "CBC",
        testName: "Complete Blood Count w/ Diff",
        specimenType: "Whole Blood",
        collectionTube: "EDTA Purple Top",
        fastingRequired: false,
      },
      {
        testCode: "FBS",
        testName: "Fasting Blood Sugar",
        specimenType: "Serum",
        collectionTube: "Gold SST",
        fastingRequired: true,
        fastingHours: 10,
      },
    ],
  };

  it("renders STAT requisition with clinical impression and specimen tubes", () => {
    const html = renderLabRequisitionHtml(baseReq);
    expect(html).toContain("STAT / IMMEDIATE");
    expect(html).toContain("LAB-2026-9001");
    expect(html).toContain("Complete Blood Count w/ Diff");
    expect(html).toContain("EDTA Purple Top");
    expect(html).toContain("Fasting Blood Sugar");
    expect(html).toContain("Fasting Required:</strong> 10 hrs");
    expect(html).toContain("Acute Abdomen, r/o Appendicitis");
    expect(html).toContain("Phlebotomy &amp; Specimen Accessioning Section");
  });
});

describe("renderEncounterOrdersHtml", () => {
  it("renders combined consultation orders with medications and diagnostic requisitions", () => {
    const html = renderEncounterOrdersHtml({
      clinicName: "Metro Health Clinic",
      visitNo: "VIS-2026-100",
      issuedAt: "2026-10-04",
      patientName: "Santos, Maria",
      prescriberName: "Dr. Roberto Mendoza",
      prescriptions: [
        {
          genericName: "Paracetamol",
          strength: "500 mg",
          quantity: 10,
          sig: "1 tab q4h prn fever",
        },
      ],
      labRequests: [
        {
          testCode: "URINE",
          testName: "Urinalysis Routine",
          specimenType: "Urine Cup",
        },
      ],
      advice: "Drink plenty of water and rest.",
    });

    expect(html).toContain("CLINICAL CONSULTATION ORDERS &amp; MANAGEMENT PLAN");
    expect(html).toContain("VIS-2026-100");
    expect(html).toContain("Paracetamol");
    expect(html).toContain("Urinalysis Routine");
    expect(html).toContain("Drink plenty of water and rest.");
  });
});

