# EASY Firebase SIMPLE — staging port

Source UI/flow: easy-backoffice/main d8e777b. Technical reference only:
easybkk-backoffice/firebase-migration-v2. Original backend logic supplied in
code.gs; workbook used for column names only. No production data imported.

Published pages: index (PIN only; admin -> dashboard, staff -> clock, driver ->
driver), dashboard, admin, clock, payroll, driver and stock (driver dependency).
Original page layout, wording and payroll formulas are retained, with narrow
mobile fixes. admin provides the missing staff/branch/work/pay configuration.
foundation.html is a test artifact and is not published by build.js.

Backend: existing server-only Firestore, PIN_SECRET:1 and opaque sessions.
operations.js handles the original API actions directly; legacy-rules.js retains
the original time/GPS helpers and item catalogue. easy-page.js connects original
page response shapes and session handling to the existing /api endpoint.

Collections: staff, branches, settings/work, timesheets, leaves, advances,
payroll_runs, stock_logs, driver_jobs, central_targets (original stock target
read dependency), pin_index, sessions and login_limits. Staff adds bank_name,
bank_account and day_off. settings/work adds ot_grace_min. Payments record exact
advance_ids atomically with deduction. Paid-period time/leave edits are rejected.
The original clock uses global shifts; payroll supports individual shift times
and its original Sunday rule. These existing differences are retained.

Staging limitation: no Telegram/LINE production credentials or destinations are
copied. Driver photo submission explicitly reports that a test Telegram room is
not configured. Payroll saves without sending a notification. Leave CRUD follows
the original payroll page fields (the supplied code.gs has no leave handlers).

Deploy only easy-backoffice-simple-staging, Cloud Run easy-simple-api in
asia-southeast1 with the existing runtime/build identities and PIN_SECRET:1.
Run node build.js to generate the Hosting allowlist in public/. Never deploy this
branch with the original production workflow. Synthetic/test accounts only.
