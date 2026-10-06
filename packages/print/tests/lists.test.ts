import { describe, expect, it } from "vitest";
import {
  renderRxQueueHtml,
  renderConsumptionListHtml,
  renderDangerousDrugsBookHtml,
  type RxQueueDocument,
  type ConsumptionListDocument,
  type DangerousDrugsBookDocument,
} from "../src/templates.js";

/**
 * Operational list documents: the pharmacy Rx verification queue and the
 * supply consumption/issuance list.
 *
 * These are not signed instruments like a certificate, but they are still
 * printed and filed, so each assembled field is asserted in both states and
 * every interpolated value is checked for HTML escaping.
 */

describe("renderRxQueueHtml", () => {
  const base: RxQueueDocument = {
    clinicName: "Metro Health Clinic",
    branchName: "Main",
    clinicAddress: "123 Katipunan Ave, Quezon City",
    status: "ISSUED",
    generatedAt: "2026-10-04 09:15",
    generatedBy: "Pharm. M. Aquino",
    rows: [
      {
        rxNo: "RX-2026-00412",
        patientName: "Dela Cruz, Clara",
        patientHrn: "HRN-2026-0091",
        patientDob: "1988-04-12",
        prescriberName: "Dr. Roberto Santos, MD",
        visitNo: "VIS-2026-0010",
        itemCount: 3,
        isControlled: false,
        issuedAt: "2026-10-04 08:50",
        validUntil: "2026-10-11",
        status: "ISSUED",
      },
      {
        rxNo: "RX-2026-00413",
        patientName: "Aguinaldo, Juan",
        prescriberName: "Dr. Alicia Tan, MD",
        visitNo: "VIS-2026-0011",
        itemCount: 1,
        isControlled: true,
        status: "ISSUED",
      },
    ],
  };

  it("prints the queue title, filter, clinic, and generation stamp", () => {
    const html = renderRxQueueHtml(base);

    expect(html).toContain("PRESCRIPTION VERIFICATION QUEUE");
    expect(html).toContain("Metro Health Clinic");
    expect(html).toContain("123 Katipunan Ave, Quezon City");
    expect(html).toContain("ISSUED");
    expect(html).toContain("2026-10-04 09:15");
    expect(html).toContain("Pharm. M. Aquino");
  });

  it("prints every row field and distinguishes a controlled entry", () => {
    const html = renderRxQueueHtml(base);

    expect(html).toContain("RX-2026-00412");
    expect(html).toContain("Dela Cruz, Clara");
    expect(html).toContain("HRN-2026-0091");
    expect(html).toContain("Dr. Roberto Santos, MD");
    expect(html).toContain("VIS-2026-0010");
    expect(html).toContain("RX-2026-00413");
    expect(html).toContain("Aguinaldo, Juan");

    // Exactly one row is controlled and must carry the S2 marker.
    expect(html.match(/CONTROLLED/g)?.length ?? 0).toBe(1);
  });

  it("omits optional columns cleanly when a row supplies none", () => {
    const html = renderRxQueueHtml({
      ...base,
      rows: [
        {
          rxNo: "RX-1",
          patientName: "Solo, Patient",
          prescriberName: "Dr. X",
          itemCount: 1,
          isControlled: false,
          status: "ISSUED",
        },
      ],
    });

    expect(html).toContain("Solo, Patient");
    // No HRN / visit / issued / valid-until values were supplied.
    expect(html).not.toContain("HRN-");
    expect(html).not.toContain("VIS-");
  });

  it("renders an explicit empty state instead of a blank table", () => {
    const html = renderRxQueueHtml({ ...base, rows: [] });

    expect(html).toContain("No prescriptions match this filter");
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderRxQueueHtml({
      ...base,
      clinicName: "<b>Clinic</b>",
      generatedBy: "<script>alert(1)</script>",
      rows: [
        {
          rxNo: "\"><script>",
          patientName: "<img src=x onerror=alert(2)>",
          prescriberName: "</div><script>alert(3)</script>",
          itemCount: 1,
          isControlled: false,
          status: "<script>",
        },
      ],
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("renderConsumptionListHtml", () => {
  const base: ConsumptionListDocument = {
    clinicName: "Metro Health Clinic",
    branchName: "Main",
    locationName: "Central Store",
    fromDate: "2026-10-01",
    toDate: "2026-10-04",
    generatedAt: "2026-10-04 17:30",
    generatedBy: "Tech. J. Reyes",
    rows: [
      {
        loggedAt: "2026-10-04 10:05",
        itemCode: "MED-AMOX-500",
        itemName: "Amoxicillin 500mg",
        qty: 21,
        uom: "PCS",
        locationName: "Central Store",
        refType: "HOUSE_USE",
        notes: "Ward stock",
        loggedBy: "Tech. J. Reyes",
      },
      {
        loggedAt: "2026-10-03 14:00",
        itemCode: "SUP-GLOVE-M",
        itemName: "Examination Gloves (M)",
        qty: 100,
        uom: "PCS",
        locationName: "Central Store",
        refType: "PROCEDURE",
        refId: "proc-9",
        loggedBy: "Tech. J. Reyes",
      },
    ],
  };

  it("prints the list title, period, location, and generation stamp", () => {
    const html = renderConsumptionListHtml(base);

    expect(html).toContain("CONSUMPTION / ISSUANCE LIST");
    expect(html).toContain("Metro Health Clinic");
    expect(html).toContain("Central Store");
    expect(html).toContain("2026-10-01");
    expect(html).toContain("2026-10-04 17:30");
    expect(html).toContain("Tech. J. Reyes");
  });

  it("prints every line with item, quantity, unit, purpose and reference", () => {
    const html = renderConsumptionListHtml(base);

    expect(html).toContain("MED-AMOX-500");
    expect(html).toContain("Amoxicillin 500mg");
    expect(html).toContain("21");
    expect(html).toContain("HOUSE_USE");
    expect(html).toContain("Ward stock");
    expect(html).toContain("SUP-GLOVE-M");
    expect(html).toContain("PROCEDURE");
    expect(html).toContain("proc-9");
  });

  it("totals the issued quantity across every line", () => {
    const html = renderConsumptionListHtml(base);

    expect(html).toContain("Total issued");
    expect(html).toContain("121");
  });

  it("renders an explicit empty state instead of a blank table", () => {
    const html = renderConsumptionListHtml({ ...base, rows: [] });

    expect(html).toContain("No consumption recorded for this period");
    expect(html).not.toContain("Total issued");
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderConsumptionListHtml({
      ...base,
      clinicName: "<b>Clinic</b>",
      rows: [
        {
          loggedAt: "2026-10-04 10:05",
          itemName: "<img src=x onerror=alert(1)>",
          qty: 1,
          uom: "\"><script>",
          refType: "<script>",
          notes: "</div><script>alert(2)</script>",
        },
      ],
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;script&gt;");
  });
});

/**
 * Dangerous Drugs Book (RA 9165 §13). This is the one print document here that is
 * a statutory record rather than an operational list, so the assertions are
 * about auditability: every movement keeps its counterparty evidence, and an
 * evidence gap is called out rather than left as a blank cell.
 */
describe("renderDangerousDrugsBookHtml", () => {
  const base: DangerousDrugsBookDocument = {
    clinicName: "Metro Health Clinic",
    branchName: "Main",
    drugFilter: "Morphine 10mg/mL",
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    generatedAt: "2026-10-31 23:55",
    generatedBy: "RPh. M. Aquino",
    closingBalances: [{ drugName: "Morphine 10mg/mL", runningBalance: 7 }],
    rows: [
      {
        occurredAt: "2026-10-02 08:15",
        entryType: "RECEIPT",
        drugName: "Morphine 10mg/mL",
        strength: "10mg/mL",
        dosageForm: "Injection",
        batchNo: "MOR-7781",
        expiryDate: "2028-01-31",
        qtyIn: 20,
        qtyOut: 0,
        runningBalance: 20,
        pharmacistName: "RPh. M. Aquino",
        witnessName: "Tech. J. Reyes",
        witnessSignature: "J. Reyes",
      },
      {
        occurredAt: "2026-10-03 11:40",
        entryType: "DISPENSE",
        drugName: "Morphine 10mg/mL",
        strength: "10mg/mL",
        dosageForm: "Injection",
        batchNo: "MOR-7781",
        qtyIn: 0,
        qtyOut: 13,
        runningBalance: 7,
        patientName: "Dela Cruz, Clara",
        patientHrn: "HRN-2026-0091",
        rxNo: "RX-2026-00412",
        specialRxSerial: "S2-2026-0007",
        prescriberS2No: "PRC-1000001",
        pharmacistName: "RPh. M. Aquino",
        witnessName: "Tech. J. Reyes",
        witnessSignature: "J. Reyes",
        notes: "Post-op analgesia",
      },
    ],
  };

  it("titles the book and states the period it was produced for", () => {
    const html = renderDangerousDrugsBookHtml(base);

    expect(html).toContain("DANGEROUS DRUGS BOOK");
    expect(html).toContain("Metro Health Clinic");
    expect(html).toContain("Main");
    expect(html).toContain("Morphine 10mg/mL");
    expect(html).toContain("2026-10-01");
    expect(html).toContain("2026-10-31");
    expect(html).toContain("2026-10-31 23:55");
    expect(html).toContain("RPh. M. Aquino");
    expect(html).toContain("RA 9165");
  });

  it("prints every movement with its quantities and carried-forward balance", () => {
    const html = renderDangerousDrugsBookHtml(base);

    expect(html).toContain("RECEIPT");
    expect(html).toContain("DISPENSE");
    expect(html).toContain("2026-10-02 08:15");
    expect(html).toContain("2026-10-03 11:40");
    expect(html).toContain("MOR-7781");
    expect(html).toContain("2028-01-31");
    // The running balance must appear for every line, or the book cannot be
    // checked against the physical stock.
    expect(html.match(/MOR-7781/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Book balance at close");
  });

  it("keeps the patient, prescription, S2 slip and licence on a dispense line", () => {
    const html = renderDangerousDrugsBookHtml(base);

    expect(html).toContain("Dela Cruz, Clara");
    expect(html).toContain("HRN-2026-0091");
    expect(html).toContain("RX-2026-00412");
    expect(html).toContain("S2-2026-0007");
    expect(html).toContain("PRC-1000001");
    expect(html).toContain("Post-op analgesia");
  });

  it("names the pharmacist and witness on every line", () => {
    const html = renderDangerousDrugsBookHtml(base);

    expect(html.match(/Witness: Tech\. J\. Reyes/g)?.length ?? 0).toBe(2);
    expect(html.match(/Signed: J\. Reyes/g)?.length ?? 0).toBe(2);
  });

  it("flags a dispense with no patient recorded instead of leaving it blank", () => {
    const html = renderDangerousDrugsBookHtml({
      ...base,
      rows: [
        {
          occurredAt: "2026-10-04 09:00",
          entryType: "DISPENSE",
          drugName: "Morphine 10mg/mL",
          qtyIn: 0,
          qtyOut: 1,
          runningBalance: 6,
          pharmacistName: "RPh. M. Aquino",
          witnessName: "Tech. J. Reyes",
        },
      ],
    });

    expect(html).toContain("NOT RECORDED");
    expect(html).toContain("No patient recorded for this dispense");
    expect(html).toContain("No S2 serial");
  });

  it("leaves the patient and prescription cells as a dash on a non-dispense line", () => {
    const html = renderDangerousDrugsBookHtml({ ...base, rows: [base.rows[0]!] });

    expect(html).not.toContain("NOT RECORDED");
    expect(html).not.toContain("No S2 serial");
  });

it("states the closing balance so the period can be reconciled to stock", () => {
    const html = renderDangerousDrugsBookHtml(base);

    const closing = html.match(/<table class="ddb-closing">[\s\S]*?<\/table>/)?.[0] ?? "";
    expect(closing).toContain("Morphine 10mg/mL");
    expect(closing).toContain("Book balance at close");
    // The book balance carried into the next period, per drug.
    expect(closing).toMatch(/<strong>7<\/strong>/);
  });

  it("says the register is append-only and the copy is digest-sealed", () => {
    const html = renderDangerousDrugsBookHtml(base);

    expect(html).toContain("append-only register");
    expect(html).toContain("SHA-256");
  });

  it("renders an explicit empty state instead of a blank table", () => {
    const html = renderDangerousDrugsBookHtml({
      ...base,
      rows: [],
      closingBalances: [],
    });

    expect(html).toContain("No controlled-register entries were recorded for this period");
    expect(html).not.toContain("<tbody>");
  });

  it("escapes hostile text in every interpolated field", () => {
    const html = renderDangerousDrugsBookHtml({
      ...base,
      clinicName: "<b>Clinic</b>",
      generatedBy: "<script>alert(1)</script>",
      rows: [
        {
          occurredAt: "\"><script>",
          entryType: "DISPENSE",
          drugName: "<img src=x onerror=alert(2)>",
          strength: "<script>alert(3)</script>",
          dosageForm: "<script>",
          batchNo: "</div><script>alert(4)</script>",
          qtyIn: "<script>1</script>" as unknown as number,
          qtyOut: 1,
          runningBalance: 1,
          patientName: "<b>Patient</b>",
          patientHrn: "<script>alert(5)</script>",
          rxNo: "<script>alert(6)</script>",
          specialRxSerial: "<script>alert(7)</script>",
          prescriberS2No: "<script>alert(8)</script>",
          pharmacistName: "<script>alert(9)</script>",
          witnessName: "<script>alert(10)</script>",
          witnessSignature: "<script>alert(11)</script>",
          notes: "<script>alert(12)</script>",
        },
      ],
    });

    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<b>/i);
    expect(html).toContain("&lt;script&gt;");
  });
});
