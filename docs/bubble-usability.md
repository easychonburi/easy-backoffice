# Usability patterns adapted from Easy Bubble Backoffice

Reference reviewed through the authenticated admin UI at https://easy-bubble-backoffice.web.app/admin.html. The reference project was inspected only; no records or settings were changed. Its staff records, pay amounts, PINs, and integration credentials were not copied into this project.

Observed patterns and adaptations:

| Reference pattern | Adaptation in this branch |
| --- | --- |
| Overview, Payroll, Staff, Settings navigation in one admin area | Common admin navigation on the existing pages, with an additional Data tab |
| Add/edit/deactivate staff from a table | Searchable staff list, role/branch/shift/pay settings, status editing, separate PIN setup |
| Named work shifts with editable hours | Named shifts, overnight support, and staff assignment; existing payroll rules retained |
| Branch GPS editor with current-location button | Branch editor, radius validation, and explicit current-location button |
| Settings forms with clear save buttons | Validated central attendance/pay settings with change detection |
| Table selection and local search | Date filtering, 100-row cursor pages, search within loaded rows, and audit history |
| Loading feedback and prevention of repeated clicks | Disabled save buttons, progress labels, success/error messages, request IDs |
| Safe operations instead of deleting related payroll rows | Read-only data browser; linked records are changed through their dedicated workflows |

Bubble's per-minute lateness rule, minimum OT rules, deposits, leave deductions, and monthly payroll cycle differ from this project's rules. They were not imported. Telegram setup, bulk historical attendance entry, deposit accounting, and payroll cancellation remain separate features; they are not implied to exist here merely because they were visible in the reference.

Existing rows without a version are treated as version zero. Staff, shift, branch, and global setting forms reject stale saves. Closing an assigned branch or shift is blocked while active staff still use it. PIN changes invalidate older Firebase sessions through the staff authentication version; PINs are never returned to the browser or written to the audit log.
