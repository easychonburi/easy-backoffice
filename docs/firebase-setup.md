# Firebase staging setup

Project created: `easy-backoffice-staging`. Web app: `EASY Backoffice Staging`.
Firestore: Standard edition, `(default)`, `asia-southeast1` (Singapore), deny-all client rules.
Authentication is initialized. The PIN service uses Firebase custom tokens; no anonymous provider is needed.

This branch is for testing. **No production cutover or data import has been performed.**
All six pages now use same-origin `/api`, with no fallback to the live Apps Script endpoint.
The existing production deployment and `main` remain separate. Do not configure GitHub Pages to deploy this branch.

## Run locally

Use Node 22, Java 21, and pnpm 11.19.0.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:integration
pnpm emulators
```

In a second terminal, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, then run `node scripts/seed-demo.cjs`.
Open `http://127.0.0.1:5000`. Demo accounts: `TEST_ADMIN / 1234`, `TEST_STAFF / 2345`, `TEST_DRIVER / 3456`.
These seed credentials are only permitted in the emulator. Driver attendance now requests actual GPS instead of sending the old hardcoded coordinates.

For HTTP integration checks with the running seeded stack, set `EASY_HTTP_TESTS=1` and run `node --test functions/test/http.integration.cjs`.

## Staging deployment

Cloud Functions deployment requires the Blaze plan and a billing account. The project was created on Spark; no billing account was linked by this migration.
See [Firebase Functions setup](https://firebase.google.com/docs/functions/get-started) and [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans).

After billing is authorized, use Firebase CLI login for an account with access to this project. No service account keys belong in the repository.
Set `FIREBASE_PROJECT_ID=easy-backoffice-staging` and `FIREBASE_WEB_API_KEY` to the web app API key from Project Settings. The web API key is a public app identifier, not a privileged backend credential.

```sh
pnpm build
firebase deploy --project easy-backoffice-staging --only firestore,functions,hosting,storage
```

Provision Cloud Storage in the staging project first for delivery photos. Firebase custom token signing needs the runtime service account to have the required signing permission; use a narrowly scoped IAM grant, not an exported private key. See [custom tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens).
The function has `maxInstances: 5`, concurrency 40, and no warm-instance minimum. These are starting settings, not a measured production capacity guarantee or a billing cap.

## Data import

`scripts/schema.json` contains headers only. The original spreadsheet, exported JSON, employee details, PINs, integration credentials, and screenshots containing real data must stay outside Git.

```sh
python scripts/export-workbook.py source.xlsx private/import.json
# Set GCLOUD_PROJECT=easy-backoffice-staging before dry-run.
node scripts/import-data.cjs private/import.json
```

The exporter preserves rows, normalizes timestamps to UTC ISO strings and dates to `YYYY-MM-DD`, excludes PINs and integration settings, and normalizes the source typo `satff` to `staff`.
Import is dry-run by default. `--apply` creates records only and refuses an existing destination. An interrupted multi-batch import needs reconciliation before resuming; it does not silently overwrite data.

Source audit found:

- One duplicated `timesheets.record_id` across two rows. The default importer rejects it. `--remap-duplicate-timesheet-ids` can preserve the later row under a suffixed ID with `legacy_record_id`, without merging or deleting either row.
- Four payroll rows reference two staff IDs absent from the supplied staff table. Supply/correct those staff relationships before importing; the importer rejects orphans.
- `stock_logs` headers omit staff and branch names although the old code attempted to append them. New writes retain those fields; old historical names cannot be reconstructed with certainty.
- The original Apps Script does not implement the leave actions called by the frontend, and has no `getCentralTargets` function despite routing to it. These are implemented in this branch. Leave data is not present in the supplied workbook.

Create staging-only credentials after importing approved test staff with `scripts/provision-pin.cjs`, supplying `EASY_STAFF_ID` and `EASY_TEST_PIN` through environment variables. Existing credentials are never overwritten by this script. Do not reuse production PINs for a shared test environment.

## Behavior and limits

- Authenticated requests verify Firebase tokens and read the current active staff role on the server. Non-admin attendance queries are scoped to the authenticated employee; branch stock writes are scoped to their assigned branch.
- Writes use request IDs and transactionally stored responses. Same-ID retries do not repeat mutations. Per-staff guards protect concurrent attendance, payroll, and advance operations, including initially empty query results.
- Payroll totals are recalculated on the server using the existing frontend rules. Confirmation, advance deductions, audit entry, and notification records commit together. Changed totals or pending OT block confirmation.
- Data reads use date/staff filters and reject results over 2,000 rows instead of silently truncating payroll. Broader report pagination remains a follow-up for larger historical datasets.
- Telegram and LINE notifications are recorded as **suppressed staging outbox entries**. No messages are sent. Enabling real notification delivery and retry workers remains required before production cutover. Delivery photos are stored privately in Cloud Storage; Telegram photo delivery is not enabled.
- Work orders are returned as before; no new inventory balance semantics are invented.
- Existing payroll rules, including Sunday shifts and hourly clock clipping, are preserved. Review these business rules with real anonymized fixtures before live payroll use.

## Validation performed

18 domain/import/admin tests passed. Eight Firestore-emulator integration tests passed, including 10 concurrent clock-ins, same-ID retries, five concurrent payroll confirmations, role isolation, parallel PIN attempts, stale configuration edits, assigned-branch protection, data pagination, and PIN reset idempotency.
HTTP integration passed through Hosting, Functions, Auth, and Firestore emulators, including custom-token exchange, unauthorized request rejection, and rejection of old sessions after PIN reset. Browser checks verified admin login, navigation, named-shift creation, and global-settings save against synthetic emulator data.
Domain, import, and build checks also passed on Node 22.23.2; CI uses Node 22. Initial emulator test assertions passed but CLI shutdown returned an error from its update-config directory; subsequent local runs use a workspace config directory.
No cloud latency/load benchmark or real-data payroll acceptance test has been completed. Do not merge or switch production until those checks, data reconciliation, notifications, and rollback rehearsal are complete.
