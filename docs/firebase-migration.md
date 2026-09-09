# Firebase migration — discovery and isolation

Status: discovery only. No Firebase backend has been implemented or deployed.
Baseline: `d8e777bbb6536d4eaa4d3a410a6cec8d25f2b1c1` on `main`.
Migration branch: `migration/firebase-backend`.

## Current system

The repository contains six HTML pages, a web manifest, and two icons. Each page calls the same Google Apps Script web app. No Apps Script source, spreadsheet schema, backend tests, or deployment workflows were present in the inspected tree.

| Page | Literal API actions found |
| --- | --- |
| index.html | getStaffByPin |
| clock.html | clockIn, clockOut, getBranches, getSettings, getTimesheets, getTodayStatus |
| dashboard.html | approvePurchase, getAdvances, getPendingPurchases, getPickups, getSettings, getStaff, getTimesheets, saveAdvance |
| driver.html | getDriverOrders, getPickups, getTimesheets, submitDriverReturn, uploadDriverPhoto |
| payroll.html | deleteLeave, getAdvances, getLeaves, getPayrollRuns, getSettings, getStaff, getTimesheets, markAdvancesDeducted, saveLeave, savePayrollRun, sendPayrollNotify, updateTimesheetOT, upsertTimesheet |
| stock.html | getStockItems, getTodayStockOrders, saveStockLog |

Driver clock actions also select clockIn or clockOut dynamically. This inventory describes client calls, not the full backend contract.

## Required source material

- All Apps Script source files (.gs and any associated files), including appsscript.json; omit secret values.
- Spreadsheet tab names and column headers, plus anonymized sample rows and identifier relationships.
- Existing business rules and integration details for attendance, overtime, leave, payroll, advances, stock, delivery photos, and notifications.
- The Firebase test project ID and intended account roles. Do not commit service account keys, PINs, tokens, or real employee records.

## Proposed implementation, pending source review

Use a separate Firebase test project and test URL with copied, anonymized data. Keep the current production site and Apps Script endpoint operating while acceptance tests run. A branch alone does not isolate runtime data: the unchanged HTML in this branch still points to production Apps Script, so it is not yet a safe test environment for writes.

Implement authenticated backend operations, validate role and branch permissions on the server, and replace client-trusted staff identifiers with verified identity. Review existing PIN login before choosing the Firebase Authentication migration flow.

Map existing storage to Firestore only after reviewing sheet relationships and business rules. Use transactions for conflicting updates and idempotency for repeated requests, especially clock actions, stock movements, advances, and payroll confirmation. Store photos separately with restricted access.

Provide bounded, indexed queries and pagination instead of returning full data sets. Define atomic payroll/advance behavior and reliable notification retry semantics from the original backend. Do not assume existing client-side request ordering is a safe transaction.

## Verification before cutover

1. Compare old and new response contracts using anonymized fixtures.
2. Test role boundaries and reject unauthorized cross-staff/cross-branch access.
3. Test simultaneous submissions, retries, duplicate requests, and conflicting updates.
4. Check payroll, overtime, leave, advance deductions, stock, orders, and delivery outcomes against the original system.
5. Measure latency and errors under an agreed concurrent-user load; Firebase alone is not evidence of a speed improvement.
6. Rehearse import, record counts, reconciliation, and rollback in the test project.
7. Agree a final data sync and cutover window before changing production. Avoid independent production writes into both systems without a designed synchronization strategy.

## Next step

Obtain the missing Apps Script source and schema, then implement and test the migration on this branch. No production endpoint, data, or hosting configuration has been changed by this discovery work.
