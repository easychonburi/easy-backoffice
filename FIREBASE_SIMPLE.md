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

Shop settings and notifications:
- Admin edits central_targets.target_qty. Original reporting/production units,
  ratios and zero/diff rules are retained. setup-shop.js initializes missing rows
  at target_qty=0 (no live quantities imported); owner sets targets through Admin.
- settings/driver_order_quantities.items contains the old FIXED_ORDER_QTY defaults.
  Stock resolves current quantities on each submission. Existing orders retain
  their recorded amounts. There is no new driver conversion system.
- settings/notifications stores the legacy Telegram/LINE keys server-side under
  the existing server-only rules. Only token-present booleans return to Admin;
  blank password inputs preserve values, explicit clear removes them.
- Clock/late, stock, advance, payroll and driver notifications use the original
  destinations. Central work orders go to LINE. Every staging message is marked
  as test data. Failed notifications warn without retrying completed data writes.
- Driver packing confirmation sends each destination separately, including
  requested amounts, full/short status, actual and missing quantities. Delivery
  photos go from request memory directly to Telegram, with no persistent storage.

Run GOOGLE_CLOUD_PROJECT=easy-backoffice-simple-staging node functions/setup-shop.js
once before deploying this slice. It preserves existing settings. Credentials
are supplied separately through authenticated Admin settings, never in Git.

Deploy only easy-backoffice-simple-staging, Cloud Run easy-simple-api in
asia-southeast1 with the existing runtime/build identities and PIN_SECRET:1.
Run node build.js to generate the Hosting allowlist in public/. Never deploy this
branch with the original production workflow. Synthetic/test accounts only.

Verification on staging: admin/staff/driver PIN, staff create/edit + branch/work
settings, clock in/out, stock/driver orders and returns, leave/OT/advance/payroll
writes and rereads passed with synthetic PORT accounts. Original pages and
payroll detail/calendar were checked at 360px. Browser staff GPS was unavailable;
clock writes were tested through the API with the synthetic branch coordinates.
