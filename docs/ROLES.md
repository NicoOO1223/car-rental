# Roles and permissions

Every staff account has one of four roles. The same table is in code in
`backend/app/permissions.py` (the server enforces it) and `frontend/lib/permissions.ts`
(only used to show or hide things). A test, `backend/tests/test_roles.py`, calls every
staff route as every role and fails if this table and the server disagree.

| | Administrator | Manager | Staff | Read-only |
|---|:-:|:-:|:-:|:-:|
| Look at bookings, fleet, customers, maintenance, dashboard | yes | yes | yes | yes |
| Create and change bookings, run handovers and returns, take payments and deposits, maintenance, edit vehicle details | yes | yes | yes | no |
| See customers' date of birth, address, phone and email in the customer list | yes | yes | masked | masked |
| Open one customer (full details, recorded in the audit log) | yes | yes | yes | yes |
| See and edit ID and driving-licence numbers | yes | yes | yes | no |
| Waive late or fuel fees; settle a deposit | yes | yes | no | no |
| Decide to keep or refund an online payment when cancelling (staff cancel and the cancellation policy applies) | yes | yes | no | no |
| Revenue report and the audit log | yes | yes | no | no |
| Add, retire and re-price vehicles; the extras catalog | yes | yes | no | no |
| Users, Configuration (including the Email section: pause, wording, test, resend), locations, erase or export a customer | yes | no | no | no |

## How it is enforced

- **Read-only is enforced once.** Every staff route depends on
  `require_authenticated_user` (`backend/app/dependencies.py`), which refuses any change
  from a read-only account. A route added later is covered without anyone remembering.
- **Everything else asks for a named permission** (`require_permission(...)`), so changing who
  may do something is a change to the map in `permissions.py`.
- **The interface follows, but does not decide.** Buttons a role cannot use are hidden or
  disabled; the server refuses them either way, and its message is shown.
- **A role change signs the person out** everywhere (their old sessions stop working).

## Things to know

- A read-only account cannot start a handover by opening the check-in screen (that would
  create a record); for them a handover that was never started is "not found".
- Customer lists mask contact details, but searching still matches on phone and email, because
  finding a customer by the number they called from is a normal counter task.
- Settling a deposit needs a manager or administrator. If deposits are on, a return that
  has a deposit to settle has to wait for one of them. If that is too strict for a counter
  without a manager present, move `MONEY_APPROVE` for that one route to a different
  permission in `backend/app/routers/check_outs.py`.
