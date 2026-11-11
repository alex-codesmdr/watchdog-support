# Phase 6: the suggestions from the review guide

Built after the review guide, from its suggestion lists: every suggestion that does not need an
outside account. Not built: WhatsApp updates (needs a WhatsApp Business account), CRM connection
(needs the CRM) and device health from a management cloud (needs that system).

Migrations: `0022_insights`, `0023_business`, `0024_field`. All are reversible with data in place.

## For customers

| Feature                       | Where                                     | What it does                                                                                                                                                              |
| ----------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts and invoices        | Administration > Contracts and invoices   | Customer administrators see each contract's value, devices covered and invoices (overdue marked), and ask to renew. Partners never see contracts                          |
| Visit booking                 | Case page > Visits                        | Book an engineer on site (2 h) or a remote session (1 h) in a free slot; calendar file; cancel with a reason. Slots come from the roster; Sundays and holidays are closed |
| Lifecycle notices             | Devices                                   | End-of-sale and end-of-support dates, suggested replacement and advice beside each affected device; optional email to administrators                                      |
| Community                     | Community (header)                        | Ask and answer questions; people show as first name and initial, never organisation; the asker or an engineer marks the answer                                            |
| Suggestions board             | Suggestions (header)                      | Suggest improvements and vote; nobody but staff sees who posted; staff set a status and reply                                                                             |
| Monthly service review        | Email, 1st of each month                  | To customer administrators: cases, response time, targets met, satisfaction, coverage ending. Switch off in Admin > Portal settings                                       |
| Hindi pages                   | Language switch in the header, My account | Header, footer, home page, dashboard, case list, new case form, case page, file uploads and devices page. Other pages stay in English until their text is translated      |
| Sign in with Microsoft/Google | Sign-in page (once switched on)           | Only for existing WatchDog accounts; the first time they confirm with their WatchDog password; the authenticator code is still asked every time                           |

## For Apollo Infoways staff

| Feature                  | Where                                   | What it does                                                                                                                                              |
| ------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Log a phone call         | Tools > Log a phone call                | Find the caller by company, name, phone, email or serial; the SLA starts at the call time; the case shows "Reported by phone"                             |
| Low ratings to call back | Tools > Low ratings to call back        | Ratings of 1 or 2 email the support managers and wait until someone notes the call back                                                                   |
| "Might help" panel       | Case page (staff)                       | Matching articles and similar solved cases with the reply that fixed them                                                                                 |
| Case to article          | Case page > Draft a knowledge article   | Now removes customer names, sites, serials, emails, phone numbers and IP addresses automatically                                                          |
| Management dashboard     | Tools > Management dashboard            | Six-month trends (cases, SLA met, satisfaction), the queue now, cases by product family, busiest customers, engineer workload                             |
| Renewal pipeline         | Tools > Renewal pipeline                | Contracts and coverage ending soon, value, owner, stage; weekly digest email to each account owner                                                        |
| Contracts and invoices   | Tools > Contracts and invoices          | Record contracts (linked to coverage by contract reference) and invoices; mark paid or cancelled                                                          |
| Partner access           | Tools > Partner access                  | Give a reseller access to a customer, with an optional end date; the customer is emailed and can end it                                                   |
| Roster and on call       | Tools > Roster and on call              | Shifts and the P1 phone; routing prefers engineers on shift; an unrouted P1 goes to the P1 on-call engineer, who is emailed and texted                    |
| Product lifecycle        | Tools > Product lifecycle               | Set end-of-sale and end-of-support dates, replacement and advice per model                                                                                |
| Spare stock              | Tools > Spare stock                     | Spares by serial at each depot, minimums, moves, write-offs; the RMA shipping form offers spares in stock; coordinators are emailed when a depot runs low |
| Visits                   | Tools > Visits                          | Upcoming visits and remote sessions                                                                                                                       |
| Community, suggestions   | Tools > Community, Customer suggestions | Answer and moderate; reply to and set the status of suggestions                                                                                           |

## New permissions

`csat:followup`, `contract:read:org`, `contract:manage`, `partner:manage`, `roster:manage`,
`catalog:manage`, `idea:submit`, `idea:manage`, `visit:book`, `visit:manage`, `stock:manage`,
`community:post`, `community:moderate`. See `packages/rbac/rbac.matrix.yaml`.

## Switching on Microsoft and Google sign-in

1. Register an app with Microsoft Entra ID and/or Google with the redirect address
   `https://<sign-in address>/realms/watchdog/broker/microsoft/endpoint` (or `/google/endpoint`).
2. Run `MICROSOFT_CLIENT_ID=… MICROSOFT_CLIENT_SECRET=… bash deploy/keycloak/sign-in-with.sh`
   (and/or the `GOOGLE_…` pair). `SWITCH_OFF=microsoft` turns it off again.

Checked against Keycloak 26 with a stand-in identity provider: linking needs the WatchDog
password, the authenticator code is still required, and unknown people cannot get in.

## Demo data

The demo adds three contracts with invoices, a two-week roster from the day of setup (Asha on
days, Vikram on the P1 phone overnight), an end-of-sale notice on the SW3100-24T, three
suggestions, three depots with spares, and two community questions. Visit slots appear only while
the demo roster runs; add shifts in Roster and on call after that.

## Tests

About 700 API and unit tests and about 80 browser tests, including new suites for every feature
above and a Hindi page check.
