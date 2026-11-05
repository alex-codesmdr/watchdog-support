# Phase 4 progress: RMA, advisories, integrations, reporting, admin

Status: **in progress**. Last updated 2026-11-05.

| Part                          | Status      | What exists                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4a RMA (hardware replacement) | Done        | Customers (and partners, L2/L3 engineers) request a replacement from a support case; RMA coordinators approve or decline with a reason. Two flows: return-then-replace and advance replacement (Premium / Mission-Critical only). Tracking numbers both ways, receipt, replacement shipping. Shipping the replacement registers the new serial for the customer (or takes it from WatchDog spare stock), moves the remaining coverage to it and retires the faulty unit. Printable WatchDog RMA form (PDF). Emails to the requester at every step and to coordinators on new requests. Case timeline shows RMA progress. One open RMA per device. Pages: `/portal/rmas`, `/workspace/rmas`, RMA panel on every case. |
| 4b Security advisories        | Done        | WDSA advisories with CVE and CVSS, affected WatchDog products and versions, publish, revise and withdraw workflow, RSS, email subscriptions and affected-device alerts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 4c API keys and webhooks      | Done        | Organisation API keys with scopes, signed webhooks with SSRF protection, retries and auto-disable; public API description at /api/openapi.json                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 4d Reports and admin          | In progress | Done: support report with weekly chart and CSV; audit trail for staff (filters, CSV, tamper check) and activity log for customer administrators; Admin and Administration hub pages; announcement banners (audiences, schedule, incidents that cannot be dismissed); saved replies for engineers (personal and shared, placeholders filled from the case). Next: admin settings, workspace polish                                                                                                                                                                                                                                                                                                                    |

## Decisions

- ADR-026: API keys and webhooks (see `docs/ADR.md`).
- The public API description lists only what an API key can reach; the full staff description and interactive docs are available outside production only.

- A runtime brand guard rejects third-party vendor names in published advisories, knowledge-base articles and download releases, using the same one-way fingerprints as CI. PSIRT internal notes are exempt because they never leave staff screens.
- Withdrawn advisories stay public, marked as withdrawn with the reason, so nobody is left wondering where one went.
- Demo data includes one advisory labelled "(demo)" with no CVE ID; real advisories come only from the PSIRT workflow.

- RMA visibility follows case visibility: whoever can read the case can read its RMAs.
- RMAs created by a coordinator start approved; everyone else's start as requests.
- The returns address on the RMA form is Apollo Infoways Pvt. Ltd., H-102, 3rd Floor, Sector 63, Noida, Uttar Pradesh 201301 (configurable as `RMA_RETURN_ADDRESS`).
- The RMA form is generated with built-in PDF fonts (no font files, works offline) and contains only WatchDog names; a test checks it against the prohibited-name fingerprints.

- The audit trail shown to customer administrators covers only their organisation; WatchDog staff appear as "WatchDog Support", and change detail and addresses for staff or system actions are withheld.
- The tamper check recomputes the whole hash chain on demand (staff only, rate-limited).
- The navigation bar keeps daily work only. Occasional tools live on one hub page each, and every link shows only with its permission.

- Announcements: up to three banners show at once, incidents first. Visitors see "everyone" banners, signed-in customers also see customer banners, staff see staff banners. Taking a banner down keeps it on record. Dismissals are remembered per browser.
- Saved replies are staff-only (RLS and permission). Personal replies are private to their owner; shared replies are edited only by support managers. Placeholders ({{customer_name}}, {{organisation}}, {{case_ref}}, {{my_name}}) are filled in the reply box, so the engineer sees the final text before sending.
- Announcements and saved replies pass through the runtime brand guard.

## Tests at this point

API integration: 398 (including 9 RMA, 8 advisories, 12 integrations, 3 API description, 3 reports) plus 24 unit. Browser: 55 on desktop and mobile with axe checks.
