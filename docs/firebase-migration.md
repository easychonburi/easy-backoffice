# Firebase migration

Branch: migration/firebase-backend. Original baseline: d8e777bbb6536d4eaa4d3a410a6cec8d25f2b1c1.

The supplied Apps Script and workbook have been reviewed. This branch implements a separate Firebase backend and changes all six pages to use its authenticated same-origin API. Production main and the existing Apps Script deployment remain unchanged.

See [Firebase setup](firebase-setup.md) for environment setup, test results, data issues, and remaining acceptance work. Cloud deployment and production cutover have not occurred.

## Original frontend API inventory

| Page | Literal API actions found |
| --- | --- |
| index.html | getStaffByPin |
| clock.html | clockIn, clockOut, getBranches, getSettings, getTimesheets, getTodayStatus |
| dashboard.html | approvePurchase, getAdvances, getPendingPurchases, getPickups, getSettings, getStaff, getTimesheets, saveAdvance |
| driver.html | getDriverOrders, getPickups, getTimesheets, submitDriverReturn, uploadDriverPhoto |
| payroll.html | deleteLeave, getAdvances, getLeaves, getPayrollRuns, getSettings, getStaff, getTimesheets, markAdvancesDeducted, saveLeave, savePayrollRun, sendPayrollNotify, updateTimesheetOT, upsertTimesheet |
| stock.html | getStockItems, getTodayStockOrders, saveStockLog |


Driver clock actions also select clockIn/clockOut dynamically. New server code includes staff administration, central targets, and leave operations.

## Before production cutover

Resolve source data relationships, authorize staging billing and deploy, provision private test credentials, test all workflows with anonymized data, implement and verify notification delivery, benchmark concurrent use on cloud infrastructure, rehearse reconciliation and rollback, and agree a final sync window. Do not write independently to both live databases without a synchronization design.
