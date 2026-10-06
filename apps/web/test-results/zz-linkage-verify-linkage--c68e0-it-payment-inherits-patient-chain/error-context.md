# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: zz-linkage-verify.spec.ts >> linkage >> invoice carries patient and visit; payment inherits patient
- Location: tests\e2e\zz-linkage-verify.spec.ts:12:3

# Error details

```
Error: invoice patientId not returned

expect(received).toBeTruthy()

Received: undefined
```

# Page snapshot

```yaml
- generic [ref=f1e1]:
  - generic [ref=f1e3]:
    - link "Skip to main content" [ref=f1e4] [cursor=pointer]:
      - /url: "#main"
    - banner [ref=f1e5]:
      - link "Clinic Platform Home" [ref=f1e7] [cursor=pointer]:
        - /url: /dashboard
        - generic [aria-hidden] [ref=f1e8]: ⚕
        - generic [ref=f1e9]:
          - generic [ref=f1e10]: Clinic Platform
          - generic [ref=f1e11]: demo-a
      - button "Switch Active Branch" [ref=f1e13] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e14]: 🏢
        - generic [ref=f1e15]: Demo A — Main
        - generic [aria-hidden] [ref=f1e16]: ▼
      - generic [ref=f1e17]:
        - button "Open global search (Control K)" [ref=f1e18] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e19]: 🔍
          - generic [ref=f1e20]: Search…
          - generic [ref=f1e21]: Ctrl K
        - button "Open notifications" [ref=f1e22] [cursor=pointer]:
          - generic [aria-hidden] [ref=f1e23]: 🔔
        - generic "Row-Level Security isolation active" [ref=f1e24]: RLS ISOLATED
        - status "Signed in as Demo A — Tenant Admin" [ref=f1e26]:
          - generic [aria-hidden] [ref=f1e27]: D
          - generic [ref=f1e28]:
            - generic [ref=f1e29]: Demo A — Tenant Admin
            - generic [ref=f1e30]: TENANT_ADMIN
        - button "Sign Out" [ref=f1e31] [cursor=pointer]
    - generic [ref=f1e32]:
      - complementary "Main Navigation" [ref=f1e33]:
        - navigation [ref=f1e34]:
          - generic [ref=f1e35]:
            - button "Workspace" [ref=f1e36] [cursor=pointer]:
              - generic [ref=f1e37]:
                - generic [aria-hidden] [ref=f1e38]: 🗂️
                - generic [ref=f1e39]: Workspace
              - generic [aria-hidden] [ref=f1e40]: ▾
            - generic:
              - generic:
                - link "Dashboard" [ref=f1e41] [cursor=pointer]:
                  - /url: /dashboard
                  - generic [aria-hidden] [ref=f1e42]: 📊
                - link "Patient Registry" [ref=f1e44] [cursor=pointer]:
                  - /url: /patients
                  - generic [aria-hidden] [ref=f1e45]: 👥
                - link "Duplicate Candidates JOB-22 worklist" [ref=f1e47] [cursor=pointer]:
                  - /url: /patients/duplicates
                  - generic [aria-hidden] [ref=f1e48]: 🧬
                  - generic [ref=f1e49]: Duplicate Candidates
                  - generic "JOB-22 worklist" [ref=f1e50]: "22"
                - link "Report Catalogue & Runs" [ref=f1e51] [cursor=pointer]:
                  - /url: /reports
                  - generic [aria-hidden] [ref=f1e52]: 📑
          - generic [ref=f1e54]:
            - button "Clinical Care" [ref=f1e55] [cursor=pointer]:
              - generic [ref=f1e56]:
                - generic [aria-hidden] [ref=f1e57]: 🩺
                - generic [ref=f1e58]: Clinical Care
              - generic [aria-hidden] [ref=f1e59]: ▾
            - generic:
              - generic:
                - link "Appointments" [ref=f1e60] [cursor=pointer]:
                  - /url: /clinical/appointments
                  - generic [aria-hidden] [ref=f1e61]: 📅
                - link "Queue Board" [ref=f1e63] [cursor=pointer]:
                  - /url: /clinical/queue
                  - generic [aria-hidden] [ref=f1e64]: 🎫
                - link "Consultations & Chart" [ref=f1e66] [cursor=pointer]:
                  - /url: /clinical/visits
                  - generic [aria-hidden] [ref=f1e67]: 🩺
          - generic [ref=f1e69]:
            - button "Pharmacy Dispensing" [ref=f1e70] [cursor=pointer]:
              - generic [ref=f1e71]:
                - generic [aria-hidden] [ref=f1e72]: 💊
                - generic [ref=f1e73]: Pharmacy Dispensing
              - generic [aria-hidden] [ref=f1e74]: ▾
            - generic:
              - generic:
                - link "Verification Queue" [ref=f1e75] [cursor=pointer]:
                  - /url: /pharmacy/queue
                  - generic [aria-hidden] [ref=f1e76]: 💊
                - link "Dispense Workbench" [ref=f1e78] [cursor=pointer]:
                  - /url: /pharmacy/dispenses
                  - generic [aria-hidden] [ref=f1e79]: ⚖️
                - link "Dangerous Drugs Book" [ref=f1e81] [cursor=pointer]:
                  - /url: /pharmacy/controlled-register
                  - generic [aria-hidden] [ref=f1e82]: 📕
                - link "OTC Sales" [ref=f1e84] [cursor=pointer]:
                  - /url: /pharmacy/sales
                  - generic [aria-hidden] [ref=f1e85]: 🛒
                - link "Medication Admin (MAR)" [ref=f1e87] [cursor=pointer]:
                  - /url: /pharmacy/administrations
                  - generic [aria-hidden] [ref=f1e88]: 💉
                - link "Drug Formulary & Pricing" [ref=f1e90] [cursor=pointer]:
                  - /url: /pharmacy/catalog
                  - generic [aria-hidden] [ref=f1e91]: 💊
          - generic [ref=f1e93]:
            - button "Laboratory" [ref=f1e94] [cursor=pointer]:
              - generic [ref=f1e95]:
                - generic [aria-hidden] [ref=f1e96]: 🔬
                - generic [ref=f1e97]: Laboratory
              - generic [aria-hidden] [ref=f1e98]: ▾
            - generic:
              - generic:
                - link "Lab Workbench" [ref=f1e99] [cursor=pointer]:
                  - /url: /laboratory/worklist
                  - generic [aria-hidden] [ref=f1e100]: 🔬
                - link "Result Entry & Flags" [ref=f1e102] [cursor=pointer]:
                  - /url: /laboratory/results
                  - generic [aria-hidden] [ref=f1e103]: 📝
                - link "Verification Queue" [ref=f1e105] [cursor=pointer]:
                  - /url: /laboratory/verification
                  - generic [aria-hidden] [ref=f1e106]: 🛡️
                - link "Critical Alerts" [ref=f1e108] [cursor=pointer]:
                  - /url: /laboratory/critical-alerts
                  - generic [aria-hidden] [ref=f1e109]: ⚡
                - link "Quality Control & LJ" [ref=f1e111] [cursor=pointer]:
                  - /url: /laboratory/qc
                  - generic [aria-hidden] [ref=f1e112]: 📈
                - link "Released Reports" [ref=f1e114] [cursor=pointer]:
                  - /url: /laboratory/reports
                  - generic [aria-hidden] [ref=f1e115]: 📜
                - link "Test Catalog & Pricing" [ref=f1e117] [cursor=pointer]:
                  - /url: /laboratory/catalog
                  - generic [aria-hidden] [ref=f1e118]: 🧪
          - generic [ref=f1e120]:
            - button "Supply & Inventory" [ref=f1e121] [cursor=pointer]:
              - generic [ref=f1e122]:
                - generic [aria-hidden] [ref=f1e123]: 📦
                - generic [ref=f1e124]: Supply & Inventory
              - generic [aria-hidden] [ref=f1e125]: ▾
            - generic:
              - generic:
                - link "Supply Dashboard" [ref=f1e126] [cursor=pointer]:
                  - /url: /supply/dashboard
                  - generic [aria-hidden] [ref=f1e127]: 📈
                - link "Stock Explorer" [ref=f1e129] [cursor=pointer]:
                  - /url: /supply/stock
                  - generic [aria-hidden] [ref=f1e130]: 📦
                - link "Receive Delivery (GRN)" [ref=f1e132] [cursor=pointer]:
                  - /url: /supply/grn
                  - generic [aria-hidden] [ref=f1e133]: 📥
                - link "Requisitions & Issues" [ref=f1e135] [cursor=pointer]:
                  - /url: /supply/requisitions
                  - generic [aria-hidden] [ref=f1e136]: 📋
                - link "Issue / Consumption" [ref=f1e138] [cursor=pointer]:
                  - /url: /supply/issue
                  - generic [aria-hidden] [ref=f1e139]: 📤
                - link "Item Master & Pricing" [ref=f1e141] [cursor=pointer]:
                  - /url: /supply/items
                  - generic [aria-hidden] [ref=f1e142]: 🏷️
          - generic [ref=f1e144]:
            - button "Billing & Cashiering" [expanded] [ref=f1e145] [cursor=pointer]:
              - generic [ref=f1e146]:
                - generic [aria-hidden] [ref=f1e147]: 💳
                - generic [ref=f1e148]: Billing & Cashiering
              - generic [aria-hidden] [ref=f1e149]: ▾
            - generic [ref=f1e151]:
              - link "Billing & Invoices" [ref=f1e152] [cursor=pointer]:
                - /url: /billing/invoices
                - generic [aria-hidden] [ref=f1e153]: 🧾
              - link "Cashier POS" [ref=f1e155] [cursor=pointer]:
                - /url: /billing/pos
                - generic [aria-hidden] [ref=f1e156]: 🛒
              - link "Cashier Shifts" [ref=f1e158] [cursor=pointer]:
                - /url: /billing/shifts
                - generic [aria-hidden] [ref=f1e159]: ⏱️
              - link "Credit Notes" [ref=f1e161] [cursor=pointer]:
                - /url: /billing/credit-notes
                - generic [aria-hidden] [ref=f1e162]: 📑
              - link "Daily Close & Tally" [ref=f1e164] [cursor=pointer]:
                - /url: /billing/daily-close
                - generic [aria-hidden] [ref=f1e165]: 🔒
          - generic [ref=f1e167]:
            - button "Tenant Administration" [ref=f1e168] [cursor=pointer]:
              - generic [ref=f1e169]:
                - generic [aria-hidden] [ref=f1e170]: 🏛️
                - generic [ref=f1e171]: Tenant Administration
              - generic [aria-hidden] [ref=f1e172]: ▾
            - generic:
              - generic:
                - link "Staff Approvals 2 pending" [ref=f1e173] [cursor=pointer]:
                  - /url: /admin/approvals
                  - generic [aria-hidden] [ref=f1e174]: 📝
                  - generic [ref=f1e175]: Staff Approvals
                  - generic "2 pending" [ref=f1e176]: "2"
                - link "Staff & Users" [ref=f1e177] [cursor=pointer]:
                  - /url: /admin/users
                  - generic [aria-hidden] [ref=f1e178]: 👤
                - link "Create Staff User" [ref=f1e180] [cursor=pointer]:
                  - /url: /admin/users/new
                  - generic [aria-hidden] [ref=f1e181]: ➕
                - link "Employee Records" [ref=f1e183] [cursor=pointer]:
                  - /url: /admin/employees
                  - generic [aria-hidden] [ref=f1e184]: 🪪
                - link "Roles & Permissions" [ref=f1e186] [cursor=pointer]:
                  - /url: /admin/roles
                  - generic [aria-hidden] [ref=f1e187]: 🛡️
                - link "Branches & Units" [ref=f1e189] [cursor=pointer]:
                  - /url: /admin/branches
                  - generic [aria-hidden] [ref=f1e190]: 🏢
                - link "Services & Prices" [ref=f1e192] [cursor=pointer]:
                  - /url: /admin/service-catalog
                  - generic [aria-hidden] [ref=f1e193]: 💰
                - link "Settings" [ref=f1e195] [cursor=pointer]:
                  - /url: /admin/settings
                  - generic [aria-hidden] [ref=f1e196]: ⚙️
          - generic [ref=f1e198]:
            - button "Compliance & Audit" [ref=f1e199] [cursor=pointer]:
              - generic [ref=f1e200]:
                - generic [aria-hidden] [ref=f1e201]: 🛡️
                - generic [ref=f1e202]: Compliance & Audit
              - generic [aria-hidden] [ref=f1e203]: ▾
            - generic:
              - generic:
                - link "Audit Explorer" [ref=f1e204] [cursor=pointer]:
                  - /url: /compliance?tab=audit
                  - generic [aria-hidden] [ref=f1e205]: 🔍
                - link "PHI Access Log" [ref=f1e207] [cursor=pointer]:
                  - /url: /compliance?tab=phi
                  - generic [aria-hidden] [ref=f1e208]: 🛡️
                - link "DSR & Privacy Rights" [ref=f1e210] [cursor=pointer]:
                  - /url: /compliance?tab=dsr
                  - generic [aria-hidden] [ref=f1e211]: 📋
                - link "Breach Register" [ref=f1e213] [cursor=pointer]:
                  - /url: /compliance?tab=breach
                  - generic [aria-hidden] [ref=f1e214]: 🚨
                - link "Retention & Holds" [ref=f1e216] [cursor=pointer]:
                  - /url: /compliance?tab=retention
                  - generic [aria-hidden] [ref=f1e217]: 📦
                - link "Access Reviews" [ref=f1e219] [cursor=pointer]:
                  - /url: /compliance?tab=access-reviews
                  - generic [aria-hidden] [ref=f1e220]: 👥
                - link "PIDSR (RA 11332)" [ref=f1e222] [cursor=pointer]:
                  - /url: /compliance?tab=pidsr
                  - generic [aria-hidden] [ref=f1e223]: 🦠
          - generic [ref=f1e225]:
            - button "System" [ref=f1e226] [cursor=pointer]:
              - generic [ref=f1e227]:
                - generic [aria-hidden] [ref=f1e228]: 🖥️
                - generic [ref=f1e229]: System
              - generic [aria-hidden] [ref=f1e230]: ▾
            - link "System Health" [ref=f1e231] [cursor=pointer]:
              - /url: /ping
              - generic [aria-hidden] [ref=f1e232]: 📡
        - generic [ref=f1e234]: DPA 2012 · PHI Protected
      - main [ref=f1e237]:
        - generic [ref=f1e238]:
          - generic [ref=f1e239]:
            - generic [ref=f1e240]:
              - heading "Billing Workbench & Invoices" [level=2] [ref=f1e241]
              - paragraph [ref=f1e242]: "Phase 7: Invoice lifecycle, statutory discounts (RA 9994/10754), charge capture, and official receipts."
            - generic [ref=f1e243]:
              - button "📄 Patient Statement (SOA)" [ref=f1e244] [cursor=pointer]
              - link "🛒 Open Cashier POS" [ref=f1e245] [cursor=pointer]:
                - /url: /billing/pos
              - button "➕ New Invoice" [ref=f1e246] [cursor=pointer]
          - status [ref=f1e247]:
            - generic [aria-hidden] [ref=f1e248]: ✓
            - generic [ref=f1e249]: Invoice successfully created.
          - generic [ref=f1e251]:
            - generic [ref=f1e253]:
              - generic [ref=f1e254]: Total Invoiced
              - generic [ref=f1e255]: ₱6,687.00
              - generic [ref=f1e256]: 12 active invoices
            - generic [ref=f1e258]:
              - generic [ref=f1e259]: Outstanding Receivables
              - generic [ref=f1e260]: ₱4,000.00
              - generic [ref=f1e261]: 8 unpaid / partial
            - generic [ref=f1e263]:
              - generic [ref=f1e264]: Collected Revenue
              - generic [ref=f1e265]: ₱2,687.00
              - generic [ref=f1e266]: Confirmed payments
            - generic [ref=f1e268]:
              - generic [ref=f1e269]: Collection Status
              - generic [ref=f1e270]: 40%
              - generic [ref=f1e271]: Settlement rate
          - generic [ref=f1e273]:
            - searchbox "Search invoices" [ref=f1e275]
            - generic [ref=f1e276]:
              - button "ALL" [ref=f1e277] [cursor=pointer]
              - button "OPEN" [ref=f1e278] [cursor=pointer]
              - button "PARTIAL" [ref=f1e279] [cursor=pointer]
              - button "PAID" [ref=f1e280] [cursor=pointer]
              - button "VOID" [ref=f1e281] [cursor=pointer]
          - table [ref=f1e284]:
            - rowgroup [ref=f1e285]:
              - row [ref=f1e286]:
                - columnheader "Invoice No" [ref=f1e287]
                - columnheader "Patient" [ref=f1e288]
                - columnheader "Payer Type" [ref=f1e289]
                - columnheader "Subtotal" [ref=f1e290]
                - columnheader "Discount" [ref=f1e291]
                - columnheader "Total" [ref=f1e292]
                - columnheader "Balance Due" [ref=f1e293]
                - columnheader "Status" [ref=f1e294]
                - columnheader "Actions" [ref=f1e295]
            - rowgroup [ref=f1e296]:
              - row [ref=f1e297]:
                - cell "INV-2026-001294 10/6/2026" [ref=f1e298]:
                  - text: INV-2026-001294
                  - generic [ref=f1e299]: 10/6/2026
                - cell "Jade E2E366722 PAT-2026-0020" [ref=f1e300]:
                  - generic [ref=f1e301]: Jade E2E366722
                  - generic [ref=f1e302]: PAT-2026-0020
                - cell "PRIVATE_CASH" [ref=f1e303]
                - cell "₱500.00" [ref=f1e305]
                - cell "—" [ref=f1e306]
                - cell "₱500.00" [ref=f1e307]
                - cell "₱500.00" [ref=f1e308]
                - cell "OPEN" [ref=f1e310]
                - cell [ref=f1e312]:
                  - generic [ref=f1e313]:
                    - button "Details" [ref=f1e314] [cursor=pointer]
                    - button "SOA" [ref=f1e315] [cursor=pointer]
                    - link "Pay" [ref=f1e316] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=59b77643-5ffa-449f-ba53-3fe036ab44e2
              - row [ref=f1e317]:
                - cell "INV-2026-001293 10/6/2026" [ref=f1e318]:
                  - text: INV-2026-001293
                  - generic [ref=f1e319]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e320]
                - cell "PRIVATE_CASH" [ref=f1e322]
                - cell "₱500.00" [ref=f1e324]
                - cell "—" [ref=f1e325]
                - cell "₱500.00" [ref=f1e326]
                - cell "₱0.00" [ref=f1e327]
                - cell "PAID" [ref=f1e328]
                - cell [ref=f1e330]:
                  - generic [ref=f1e331]:
                    - button "Details" [ref=f1e332] [cursor=pointer]
                    - button "SOA" [ref=f1e333] [cursor=pointer]
              - row [ref=f1e334]:
                - cell "INV-2026-001292 10/6/2026" [ref=f1e335]:
                  - text: INV-2026-001292
                  - generic [ref=f1e336]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e337]
                - cell "PRIVATE_CASH" [ref=f1e339]
                - cell "₱500.00" [ref=f1e341]
                - cell "—" [ref=f1e342]
                - cell "₱500.00" [ref=f1e343]
                - cell "₱0.00" [ref=f1e344]
                - cell "PAID" [ref=f1e345]
                - cell [ref=f1e347]:
                  - generic [ref=f1e348]:
                    - button "Details" [ref=f1e349] [cursor=pointer]
                    - button "SOA" [ref=f1e350] [cursor=pointer]
              - row [ref=f1e351]:
                - cell "INV-2026-001291 10/6/2026" [ref=f1e352]:
                  - text: INV-2026-001291
                  - generic [ref=f1e353]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e354]
                - cell "PRIVATE_CASH" [ref=f1e356]
                - cell "₱500.00" [ref=f1e358]
                - cell "—" [ref=f1e359]
                - cell "₱500.00" [ref=f1e360]
                - cell "₱500.00" [ref=f1e361]
                - cell "OPEN" [ref=f1e363]
                - cell [ref=f1e365]:
                  - generic [ref=f1e366]:
                    - button "Details" [ref=f1e367] [cursor=pointer]
                    - button "SOA" [ref=f1e368] [cursor=pointer]
                    - link "Pay" [ref=f1e369] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=ebbcd0c6-63ab-4494-bbb4-23f3f8687c14
              - row [ref=f1e370]:
                - cell "INV-2026-001290 10/6/2026" [ref=f1e371]:
                  - text: INV-2026-001290
                  - generic [ref=f1e372]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e373]
                - cell "PRIVATE_CASH" [ref=f1e375]
                - cell "₱500.00" [ref=f1e377]
                - cell "—" [ref=f1e378]
                - cell "₱500.00" [ref=f1e379]
                - cell "₱500.00" [ref=f1e380]
                - cell "OPEN" [ref=f1e382]
                - cell [ref=f1e384]:
                  - generic [ref=f1e385]:
                    - button "Details" [ref=f1e386] [cursor=pointer]
                    - button "SOA" [ref=f1e387] [cursor=pointer]
                    - link "Pay" [ref=f1e388] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=d397d6bb-7cd7-42a3-ba7f-b70dd0f3d996
              - row [ref=f1e389]:
                - cell "INV-2026-001289 10/6/2026" [ref=f1e390]:
                  - text: INV-2026-001289
                  - generic [ref=f1e391]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e392]
                - cell "PRIVATE_CASH" [ref=f1e394]
                - cell "₱500.00" [ref=f1e396]
                - cell "—" [ref=f1e397]
                - cell "₱500.00" [ref=f1e398]
                - cell "₱500.00" [ref=f1e399]
                - cell "OPEN" [ref=f1e401]
                - cell [ref=f1e403]:
                  - generic [ref=f1e404]:
                    - button "Details" [ref=f1e405] [cursor=pointer]
                    - button "SOA" [ref=f1e406] [cursor=pointer]
                    - link "Pay" [ref=f1e407] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=b3d8e846-4956-47ca-92db-ccdc5819ffff
              - row [ref=f1e408]:
                - cell "INV-2026-001288 10/6/2026" [ref=f1e409]:
                  - text: INV-2026-001288
                  - generic [ref=f1e410]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e411]
                - cell "PRIVATE_CASH" [ref=f1e413]
                - cell "₱500.00" [ref=f1e415]
                - cell "—" [ref=f1e416]
                - cell "₱500.00" [ref=f1e417]
                - cell "₱500.00" [ref=f1e418]
                - cell "OPEN" [ref=f1e420]
                - cell [ref=f1e422]:
                  - generic [ref=f1e423]:
                    - button "Details" [ref=f1e424] [cursor=pointer]
                    - button "SOA" [ref=f1e425] [cursor=pointer]
                    - link "Pay" [ref=f1e426] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=f25ad9f5-4c8b-458d-930a-3c25e8c56865
              - row [ref=f1e427]:
                - cell "INV-2026-001287 10/6/2026" [ref=f1e428]:
                  - text: INV-2026-001287
                  - generic [ref=f1e429]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e430]
                - cell "PRIVATE_CASH" [ref=f1e432]
                - cell "₱500.00" [ref=f1e434]
                - cell "—" [ref=f1e435]
                - cell "₱500.00" [ref=f1e436]
                - cell "₱500.00" [ref=f1e437]
                - cell "OPEN" [ref=f1e439]
                - cell [ref=f1e441]:
                  - generic [ref=f1e442]:
                    - button "Details" [ref=f1e443] [cursor=pointer]
                    - button "SOA" [ref=f1e444] [cursor=pointer]
                    - link "Pay" [ref=f1e445] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=84cc8942-510b-4c15-a339-3a506281d470
              - row [ref=f1e446]:
                - cell "INV-2026-001286 10/6/2026" [ref=f1e447]:
                  - text: INV-2026-001286
                  - generic [ref=f1e448]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e449]
                - cell "PRIVATE_CASH" [ref=f1e451]
                - cell "₱500.00" [ref=f1e453]
                - cell "—" [ref=f1e454]
                - cell "₱500.00" [ref=f1e455]
                - cell "₱500.00" [ref=f1e456]
                - cell "OPEN" [ref=f1e458]
                - cell [ref=f1e460]:
                  - generic [ref=f1e461]:
                    - button "Details" [ref=f1e462] [cursor=pointer]
                    - button "SOA" [ref=f1e463] [cursor=pointer]
                    - link "Pay" [ref=f1e464] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=9bf691c0-60bf-4692-a174-50e1c869c5d0
              - row [ref=f1e465]:
                - cell "INV-2026-001285 10/6/2026" [ref=f1e466]:
                  - text: INV-2026-001285
                  - generic [ref=f1e467]: 10/6/2026
                - cell "Walk-in Patient" [ref=f1e468]
                - cell "PRIVATE_CASH" [ref=f1e470]
                - cell "₱500.00" [ref=f1e472]
                - cell "—" [ref=f1e473]
                - cell "₱500.00" [ref=f1e474]
                - cell "₱500.00" [ref=f1e475]
                - cell "OPEN" [ref=f1e477]
                - cell [ref=f1e479]:
                  - generic [ref=f1e480]:
                    - button "Details" [ref=f1e481] [cursor=pointer]
                    - button "SOA" [ref=f1e482] [cursor=pointer]
                    - link "Pay" [ref=f1e483] [cursor=pointer]:
                      - /url: /billing/pos?invoiceId=82caa9d5-cadf-4944-8df3-4392bb80863b
              - row [ref=f1e484]:
                - cell "INV-2026-001284 10/5/2026" [ref=f1e485]:
                  - text: INV-2026-001284
                  - generic [ref=f1e486]: 10/5/2026
                - cell "Maria Cristina Dela Cruz" [ref=f1e487]
                - cell "PRIVATE_CASH" [ref=f1e489]
                - cell "₱585.00" [ref=f1e491]
                - cell "—" [ref=f1e492]
                - cell "₱585.00" [ref=f1e493]
                - cell "₱0.00" [ref=f1e494]
                - cell "PAID" [ref=f1e495]
                - cell [ref=f1e497]:
                  - generic [ref=f1e498]:
                    - button "Details" [ref=f1e499] [cursor=pointer]
                    - button "SOA" [ref=f1e500] [cursor=pointer]
              - row [ref=f1e501]:
                - cell "INV-2026-001163 10/5/2026" [ref=f1e502]:
                  - text: INV-2026-001163
                  - generic [ref=f1e503]: 10/5/2026
                - cell "Maria Cristina Dela Cruz" [ref=f1e504]
                - cell "PRIVATE_CASH" [ref=f1e506]
                - cell "₱1,102.00" [ref=f1e508]
                - cell "—" [ref=f1e509]
                - cell "₱1,102.00" [ref=f1e510]
                - cell "₱0.00" [ref=f1e511]
                - cell "PAID" [ref=f1e512]
                - cell [ref=f1e514]:
                  - generic [ref=f1e515]:
                    - button "Details" [ref=f1e516] [cursor=pointer]
                    - button "SOA" [ref=f1e517] [cursor=pointer]
    - contentinfo [ref=f1e518]:
      - generic [ref=f1e519]: Clinic Platform v1.0 · Connected to Tenant Database · Multi-tenant RLS Active
      - generic [ref=f1e522]: DPA 2012 / PhilHealth Konsulta Standard · PHT (Asia/Manila)
      - generic [ref=f1e523]: © 2026 Clinic Platform · All rights reserved
  - dialog [ref=f1e525]:
    - generic [ref=f1e526]:
      - generic [ref=f1e527]:
        - generic [ref=f1e528]: Create New Invoice
        - button "Close" [ref=f1e529] [cursor=pointer]
      - generic [ref=f1e530]:
        - generic [ref=f1e531]:
          - generic [ref=f1e532]:
            - generic [ref=f1e533]: Payer Type
            - combobox [ref=f1e534]:
              - option "Private / Out-of-Pocket Cash" [selected]
              - option "HMO / Private Insurance"
              - option "PhilHealth Konsulta"
              - option "Corporate Retainer Account"
          - generic [ref=f1e535]:
            - generic [ref=f1e536]: Patient
            - textbox [ref=f1e537]: PAT-2026-0020 — Jade E2E366722
            - button "Change" [ref=f1e539] [cursor=pointer]
        - generic [ref=f1e541]:
          - generic [ref=f1e542]: Visit
          - combobox "Select visit" [ref=f1e543]:
            - option "No specific visit"
            - option "V-20261006-00770 — 10/6/2026, 11:12:57 AM" [selected]
          - text: Links this invoice to the visit being charged.
        - heading "Itemized Charges" [level=6] [ref=f1e544]
        - generic [ref=f1e545]:
          - textbox "Service / Item Description" [ref=f1e547]: General Consultation
          - spinbutton "Qty" [ref=f1e549]: "1"
          - spinbutton "Unit Price" [ref=f1e551]: "500"
          - generic [ref=f1e553]:
            - checkbox "PF" [checked] [ref=f1e554]
            - generic "Professional Fee" [ref=f1e555]: PF
        - button "➕ Add Line" [ref=f1e556] [cursor=pointer]
      - generic [ref=f1e557]:
        - button "Cancel" [ref=f1e558] [cursor=pointer]
        - button "Create Invoice" [active] [ref=f1e559] [cursor=pointer]
```

# Test source

```ts
  1  | // THROWAWAY verification spec for invoice -> patient -> visit -> payment linkage.
  2  | // The main clinical chain is blocked at step 3 by the seeding defect, so this
  3  | // exercises the billing leg on its own against an existing E2E patient.
  4  | import { test, expect } from "@playwright/test";
  5  | import { login } from "./auth.js";
  6  | 
  7  | const PATIENT_NO = process.env.LINKAGE_PATIENT_NO ?? "PAT-2026-0020";
  8  | 
  9  | test.use({ storageState: { cookies: [], origins: [] } });
  10 | 
  11 | test.describe("linkage", () => {
  12 |   test("invoice carries patient and visit; payment inherits patient", async ({ page }) => {
  13 |     await login(page, "admin");
  14 |     await page.goto("/billing/invoices");
  15 |     await page.getByRole("button", { name: /New Invoice/i }).click();
  16 |     const modal = page.locator(".modal", { hasText: "Create New Invoice" });
  17 |     await expect(modal).toBeVisible();
  18 | 
  19 |     await modal.getByLabel("Search patient").fill(PATIENT_NO);
  20 |     const match = modal.locator(".list-group-item").first();
  21 |     await expect(match).toBeVisible({ timeout: 15_000 });
  22 |     await match.click();
  23 | 
  24 |     const visitSelect = modal.getByLabel("Select visit");
  25 |     await expect(visitSelect).toBeVisible({ timeout: 15_000 });
  26 |     const option = visitSelect.locator("option:not([value=''])").first();
  27 |     // <option> is never "visible" inside a closed <select>; assert presence.
  28 |     await expect(option).toHaveCount(1, { timeout: 15_000 });
  29 |     const visitValue = await option.getAttribute("value");
  30 |     expect(visitValue, "patient has no visit to invoice against").toBeTruthy();
  31 |     await visitSelect.selectOption(visitValue!);
  32 | 
  33 |     const resp = page.waitForResponse(
  34 |       (r) => r.url().includes("/billing/invoices") && r.request().method() === "POST",
  35 |     );
  36 |     await modal.getByRole("button", { name: /Create Invoice/i }).click();
  37 |     const body: any = await (await resp).json();
  38 |     console.log("CREATE INVOICE RESPONSE:", JSON.stringify(body?.invoice ?? body));
  39 | 
> 40 |     expect(body?.invoice?.patientId ?? body?.patientId, "invoice patientId not returned").toBeTruthy();
     |                                                                                           ^ Error: invoice patientId not returned
  41 |     expect(body?.invoice?.visitId ?? body?.visitId, "invoice visitId not returned").toBeTruthy();
  42 |   });
  43 | });
```