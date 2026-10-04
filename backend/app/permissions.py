"""
Who may do what.

Four roles. The map below is the one place that says what each can do; routes ask
for a permission (require_permission) instead of naming roles, so changing who may
do something is a one-line change here. docs/ROLES.md describes the same matrix
for people.

- admin    everything.
- manager  all counter work plus the approval actions (waiving fees, deciding what
           happens to money on a cancellation, settling deposits), reports, the
           audit log and the fleet and its rates. Not users, Configuration,
           locations, or erasing/exporting a customer.
- staff    counter work: bookings, handovers, check-outs, customers, maintenance,
           vehicle details. Not the approval actions.
- readonly can look at everything except identity documents, and change nothing.

"Change nothing" is enforced once, for every staff route, in
app.dependencies.require_authenticated_user (it refuses a read-only user on any
method that is not a read), so a new route is safe by default.
"""

ADMIN = "admin"
MANAGER = "manager"
STAFF = "staff"
READONLY = "readonly"

# Every role a user can have, from most to least powerful.
ROLES = (ADMIN, MANAGER, STAFF, READONLY)

# Any change to bookings, customers, handovers, check-outs, maintenance, vehicles.
WRITE = "bookings.write"
# Waive fees, settle a deposit, choose what happens to an online payment on cancel.
MONEY_APPROVE = "money.approve"
# Customers' contact details in the customer list (otherwise masked).
CUSTOMERS_LIST_FULL = "customers.list_full"
# ID and driving-licence numbers.
IDENTITY_READ = "identity.read"
# Revenue and the audit log.
REPORTS_READ = "reports.read"
# Add, retire and re-price vehicles; the extras catalog.
FLEET_MANAGE = "fleet.manage"
# Users, Configuration, locations, customer erase and export.
ADMINISTER = "admin.manage"

PERMISSIONS: dict[str, frozenset[str]] = {
    ADMIN: frozenset(
        {WRITE, MONEY_APPROVE, CUSTOMERS_LIST_FULL, IDENTITY_READ, REPORTS_READ, FLEET_MANAGE, ADMINISTER}
    ),
    MANAGER: frozenset(
        {WRITE, MONEY_APPROVE, CUSTOMERS_LIST_FULL, IDENTITY_READ, REPORTS_READ, FLEET_MANAGE}
    ),
    STAFF: frozenset({WRITE, IDENTITY_READ}),
    READONLY: frozenset(),
}


def has_permission(role: str, permission: str) -> bool:
    return permission in PERMISSIONS.get(role, frozenset())
