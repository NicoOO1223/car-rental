# Crash test: Adriatic Drive Rentals

A second, separate copy of the product, set up as a brand-new client, to be tested hard by two people before it is offered to a real first client. Staff side only: the booking site is off.

Nothing here is real. The business, people, plates and addresses are invented. Customers use `@example.com` addresses, so an email to them goes nowhere (see "Email" below).

## What is in it

| | |
|---|---|
| Business | Adriatic Drive Rentals, Split. Euro, 25% VAT included, timezone Europe/Zagreb, invoice prefix ADR. Brand colour teal (the demo is black). |
| Places | Split SPU, Dubrovnik DBV, Zadar ZAD |
| Classes | Mini, Economy, Compact, SUV, Premium, Van (Mini, SUV and Compact have Italian or Polish text too) |
| Cars | 26: 10 in Split, 9 in Dubrovnik, 7 in Zadar. Petrol, diesel, hybrid and one electric; manual and automatic |
| Requests | 150, all **Pending**, pickups from tomorrow to about three months out |
| Customers | 110. Some book two or three times. Six are "Test Renter A to F" with a real inbox (below) |
| Condition | One car with expired insurance, one with an inspection due within a week, two service jobs and a cleaning job coming up |

Built into the requests on purpose:

- **Overlaps.** Four cars have six requests each on nearly the same dates. Nothing blocks a pending request, so confirming one makes the others on that car impossible ("car already reserved").
- **Old requests.** About 23 arrived more than 24 hours ago, so they are flagged against the 24-hour "time to confirm" setting. About 10 arrived in the last 6 hours.
- **Class bookings.** About 22 ask for a class, not a car, so the car is provisional ("car not final").
- **Fees.** About a third are under 5 days (short-term fee), a fifth return to a different airport (airport-change fee), and a third have extras.

## Signing in

The staff address and the owner login are in the message that came with this. The other logins (random passwords) are in `deploy/.stacks/crashtest/testusers.txt` on the machine that loaded the data:

| Role | Use it to check |
|---|---|
| Owner (admin) | everything, including Configuration and users |
| `colleague.admin@example.com` (admin) | a second admin working at the same time |
| `manager@example.com` | what a manager can and cannot change |
| `counter.staff@example.com` | the day-to-day desk: requests, check-in, check-out |
| `readonly@example.com` | that nothing can be changed |

Two people, one each: try confirming the same request at the same moment.

## Scenarios to work through

Tick them off and write what you see in "Findings" at the end.

**Requests (Reservations)**
- [ ] The list shows 150 and the "Awaiting confirmation" tile agrees. Sort by Booked, both directions; the oldest should be flagged.
- [ ] Open a request on a hot car (several with the same car). The card listing other requests for that car and dates is there.
- [ ] Confirm one of them. Confirm another that overlaps: it must be refused with a clear message.
- [ ] Reject a request. Cancel a confirmed one. Check each is shown as it should be.
- [ ] Edit a request: change the dates, the car, the return place, the extras. Check the price changes as expected.
- [ ] Open a class booking ("car not final") and fix a car. Check you cannot choose a car that is already taken.
- [ ] Create a new booking by hand, for a new customer and for an existing one (the customer should not be duplicated).

**Handover and return** (use confirmed ones whose pickup is soon, or create one for today)
- [ ] Check in: identity details, cash payment, deposit, both signatures, agreement PDF.
- [ ] Check out: mileage, fuel, a late return, a damage charge, deposit settlement, invoice.
- [ ] The invoice number follows on from the last, with no gap.

**Fleet**
- [ ] "All vehicles" in cards and in a table; filter by place and by status.
- [ ] The schedule view. A service job blocks the car for its hours.
- [ ] Add, edit and retire a car. Add a photo. Move a car to another place and book it from there.
- [ ] The notifications for the expired insurance and the inspection due.

**Customers, extras, classes, places**
- [ ] Search a customer; open one with several bookings; merge or edit.
- [ ] Add a new class with Italian text; change a price and check an existing request keeps the price it was agreed at.
- [ ] Add a place with its own timezone.

**Configuration and people**
- [ ] Change the brand colour; the staff app follows. Try a pale colour and check the text stays readable.
- [ ] Change the time to confirm to 48 and then 0; the flags follow.
- [ ] Switch the interface language (English, Italian, Polish).
- [ ] Create a user, change a role, deactivate one. Sign in as each role and check what is hidden or read-only.
- [ ] Look at the audit trail: it should say who did what.

**Phones and edges**
- [ ] The same pages on a phone (tables become cards; filters sit behind a button).
- [ ] Sign out, sign in with a wrong password several times, reset a password.
- [ ] A very long name, an accent in a name, a postal code with spaces.
- [ ] Reload mid-form; use the back button; open two tabs.

## Email

The sender is the Azure-managed address, so a message may land in spam. It is switched on for the business and for each type under Configuration, Email.

- Confirming a booking sends the renter an email. For the 100-odd `@example.com` customers that goes nowhere (it will be logged as failed or bounced). That is expected, but do not confirm hundreds of them just to look at the list.
- To check the email itself, use **Test Renter A to F**: their addresses are real inboxes, the ones given to the loader with `--real-email`. With one address, A uses it as it is and B to F use plus-tagged copies (`name+adr2@gmail.com` and so on) that land in the same mailbox. Open the customer to see which address a renter has. Confirm one, check the message arrives, its wording, the link in it, and the pickup reminder.
- The Email log under Configuration shows what was sent and what failed.

## Starting a fresh round

Re-running the loader replaces the cars, classes, places, requests and customers with a fresh set (it asks you to type the stack name first; users, settings and the logo stay). This needs someone with the database access described below.

## Loading the data (for whoever runs it)

1. Open the database firewall for your own address:

   ```
   az postgres flexible-server firewall-rule create -g car-rental-crashtest-rg -s <server name, e.g. car-rental-pg-xxxxxx> `
       -n crashtest-seed --start-ip-address <your ip> --end-ip-address <your ip>
   ```

2. The photos go to the stack's storage account, so sign in with `az login` and have the *Storage Blob Data Contributor* role on it.
3. From `backend/`, with the app login (the `carrental_app` password is in `deploy/.stacks/crashtest/apppassword`):

   ```
   $env:CRASHTEST_DATABASE_URL = "postgresql+psycopg://carrental_app:<apppassword>@<postgres host>:5432/car_rental?sslmode=require"
   $env:AZURE_STORAGE_ACCOUNT_URL = "https://<photo account>.blob.core.windows.net"
   $env:SECRET_KEY = "throwaway"
   .venv\Scripts\python.exe seed_test_client.py --stack crashtest --real-email you@example.org --real-email colleague@example.org
   ```

4. **Remove the firewall rule** again: `az postgres flexible-server firewall-rule delete -g car-rental-crashtest-rg -s <server> -n crashtest-seed --yes`.

## Taking it down

`.\deploy\deprovision.ps1 -Stack crashtest` removes the whole stack (its resource group, database and storage). It costs roughly 10 to 15 USD a month while it exists.

## Findings

Write one line per finding: where, what you did, what you expected, what happened.

| # | Who | Where | What happened | Expected |
|---|---|---|---|---|
| 1 | | | | |
