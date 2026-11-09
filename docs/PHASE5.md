# Phase 5: assistant, status page, hardening, handover

Last updated 2026-11-09. Everything is branded WatchDog only.

| Item                  | Status | What it is                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Help assistant        | Done   | `/help`: questions in plain words, answered only from published articles the asker may read, with numbered citations, "Did this help?" feedback and a link to open a case. Works without an AI service by quoting the best passages; with `ASSISTANT_MODE=anthropic` it writes the answer from the same passages and falls back to quoting if the answer is uncited or off-brand. Questions kept 90 days; editors see unanswered ones |
| Status page           | Done   | `/status`: each service's state, open incidents with timed updates, and the last 30 days. Staff page under Admin > Service status                                                                                                                                                                                                                                                                                                     |
| Production safeguards | Done   | The API refuses to start in production with the development signing key, local file storage, example mail sender, mock identity, skipped virus scanning, private webhook targets, or AI/Jira modes without keys. The website refuses an insecure cookie or placeholder client secret when served over https                                                                                                                           |
| Demo data switch      | Done   | `SEED_DEMO=false` loads reference data and starter content without demo customers                                                                                                                                                                                                                                                                                                                                                     |
| Dependency review     | Done   | `pnpm audit --prod`: `uuid` upgraded; 2 moderate findings remain in a command-line tool the portal never runs (see HANDOVER §8)                                                                                                                                                                                                                                                                                                       |
| India time            | Done   | Database sessions use IST, so "today" and coverage dates match Indian business days around midnight                                                                                                                                                                                                                                                                                                                                   |
| Handover              | Done   | [HANDOVER](HANDOVER.md) and [RUN_ON_YOUR_COMPUTER](RUN_ON_YOUR_COMPUTER.md)                                                                                                                                                                                                                                                                                                                                                           |

## Design notes

- The assistant never sees articles the person cannot read: retrieval runs inside the same row-level
  security as search. Internal articles are used only for WatchDog staff.
- Questions are stored without being readable back by the asker (only staff read them), so the insert
  does not return rows; the id is generated in the API.
- Status entries are public by design; only support managers and system administrators write them, and
  every change is in the audit trail.

## Tests at this point

API and unit tests: about 540. Browser tests (desktop and mobile, with automated accessibility checks): about 70.
