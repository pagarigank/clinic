#!/usr/bin/env python3
"""Rebuild Word document matching PDF structure with Renal Care module added"""
from docx import Document
from docx.shared import Inches
import os

# Read the original PDF content we extracted earlier
# and add the Renal Care section from specification.md

docx_path = r"D:\clinic\Clinic-Platform-User-Manual.docx"
pdf_path = r"D:\clinic\Clinic-Platform-User-Manual.pdf"
img_dir = r"D:\clinic"

# Create new document
doc = Document()

# Sections with their screenshots and content
sections_data = [
    {
        "title": "1. Getting Started",
        "img": "login.png",
        "content": [
            "To log in, enter tenant slug, email, password then click \"Sign In to Clinic\".",
            "Sidebar modules: Clinical Care, Laboratory, Pharmacy, Supply & Inventory, Billing, Compliance, Renal Care, System.",
            "Dashboard shows appointments, pending orders, prescriptions, requisitions, billing totals."
        ]
    },
    {
        "title": "2. Tenant Administration",
        "img": "admin-users.png",
        "content": [
            "Users screen lets admins create/update/deactivate accounts.",
            "Roles define access with SoD enforcement; Clinical, Pharmacy, Lab, Supply, Billing, Renal Care (Nephrologist, Dialysis Nurse, Tech), System.",
            "Branches represent facilities with location-specific stock."
        ]
    },
    {
        "title": "3. Patients",
        "img": "patients.png",
        "content": [
            "Patients screen is master index (Clinical > Patients).",
            "Create with demographics; MRN auto-generated.",
            "Documents can be uploaded and tagged.",
            "All changes logged in audit trail."
        ]
    },
    {
        "title": "4. Clinical",
        "img": "dashboard.png",
        "content": [
            "Appointments screen calendar; book/reschedule/cancel.",
            "Visits capture vitals and SOAP notes; notes locked when signed.",
            "Prescriptions checked for interactions/allergies."
        ]
    },
    {
        "title": "5. Laboratory",
        "img": "lab-worklist.png",
        "content": [
            "Test Catalog defines tests with LOINC, specimen type, reference ranges, price.",
            "Worklist tracks status: ORDERED, COLLECTED, ENTERED, VERIFIED, RELEASED.",
            "Two-person verification (AC-17) enforced; critical values trigger alerts.",
            "Reports downloadable as PDF/CSV."
        ]
    },
    {
        "title": "6. Pharmacy",
        "img": "pharmacy-queue.png",
        "content": [
            "Drug Master catalogs medications with formulary, controlled flag.",
            "Pharmacy Queue for Rx verification.",
            "Dispensing uses FEFO (First-Expired, First-Out).",
            "Controlled drugs logged with witness signatures."
        ]
    },
    {
        "title": "7. Central Supply",
        "img": "supply-requisitions.png",
        "content": [
            "Item Master catalogs supplies; Locations define storage hierarchy.",
            "Requisitions: internal requests → APPROVAL → PICKED → ISSUED → CLOSED.",
            "Purchase Orders external supplier orders.",
            "GRN matches delivery to PO: 3-way match with PO, GRN, Invoice.",
            "Cycle counts verify stock."
        ]
    },
    {
        "title": "8. Billing & Cashiering",
        "img": "billing-pos.png",
        "content": [
            "Charges created on service render; POS generates invoices.",
            "Payments via cash, card, insurance; supports split payments.",
            "Cashier shifts track drawer; close counts versus system.",
            "Credit notes for refunds with audit trail."
        ]
    },
    {
        "title": "9. Compliance & Audit",
        "img": None,
        "content": [
            "Audit Trail logs all actions with user, timestamp, IP.",
            "PHI Access Log tracks health data views per Data Privacy Act.",
            "Consents recorded; DSR workflow: receive → verify → start → complete/reject."
        ]
    },
    {
        "title": "10. Reports & Exports",
        "img": None,
        "content": [
            "Dashboard provides CSV/XLSX: Patient Census, Lab TAT, Pharmacy, Stock Ledger, AR Aging, Shift Summary."
        ]
    },
    {
        "title": "11. Renal Care",
        "img": None,
        "content": [
            "**Stations** screen catalogs dialysis chairs/machines with capacity and equipment.",
            "**Scheduling:** Appointments schedule patients; workflow: SCHEDULED → CHECKED_IN → IN_PROGRESS → COMPLETED.",
            "**Sessions:** Management records pre/intra/post vitals and flowsheets per treatment.",
            "**Prescriptions:** Renal prescriptions by Nephrologist drive scheduling and treatment protocols.",
            "**Dialyzer Management:** Tracks expiry dates; system quarantines expired stock automatically.",
            "**Water Quality:** RO Water Quality monitoring; weekly tests logged (conductivity, pH, bacterial count).",
            "**Billing:** PhilHealth dialysis claims generated from completed sessions."
        ]
    },
    {
        "title": "12. Frequently Asked Questions",
        "img": None,
        "content": [
            "Login: Password reset via admin; Nephrologist/Dialysis Nurse/Dialysis Tech roles required for Renal module access.",
            "Can't schedule dialysis? Patient needs active renal prescription from Nephrologist first.",
            "Submit PhilHealth claim? Complete sessions generate EPR file via Renal Care > Claims section.",
            "Expired dialyzer? System quarantines it; contact Supply for return/adjustment process.",
            "Water quality logged weekly; check Renal Care > Water Quality for conductivity, pH, bacterial count.",
            "Vascular access history tracked in patient's Renal tab under Access History section."
        ]
    }
]

# Build document
for section in sections_data:
    doc.add_heading(section["title"], level=1)
    for para in section["content"]:
        p = doc.add_paragraph(para)
        p.style = 'Normal'
    
    # Add screenshot
    if section.get("img"):
        img_path = os.path.join(img_dir, section["img"])
        if os.path.exists(img_path):
            p = doc.add_paragraph()
            run = p.add_run()
            run.add_picture(img_path, width=Inches(5.5))

doc.save(docx_path)
print(f"Document saved: {len(doc.paragraphs)} paragraphs, {len(doc.inline_shapes)} images")