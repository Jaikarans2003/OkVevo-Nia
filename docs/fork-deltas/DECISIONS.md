# Decisions

Short records of fork choices. One entry each: date, decision, reason, revisit trigger. Code deltas stay in the other files in this folder.

## Strategy B — selective cherry-picks

- **Date:** 2026-09-25
- **Decision:** Catch up by cherry-picking chosen Hermes commits onto `staging`. Do not replay Nia onto latest Hermes, and do not merge `origin/main`.
- **Reason:** The throwaway replay (U3) conflicted on 37 of 60 commits and 314 files. A crude resolve failed branding-adjacent JS checks and 5,721 Python tests. Batch 1 then needed a backport on 12 of 19 commits (63%).
- **Revisit trigger:** Karan schedules the rebuild, or two further landed batches both need a backport on most commits. Measured again after Batch 2b.

## Delta-reduction overlay

- **Date:** 2026-10-02
- **Decision:** Steps 1 and 2 are in. Icons copy from `brand/assets/` at pack time (PR #29). Locale catalogs overlay from `brand/locales/` (PR #30). Step 3 (product-name token) waits for conflict numbers from a real cherry-pick dry run.
- **Reason:** The U3 replay estimated about 9 icon files and 26 locale files would stop conflicting if Nia stopped editing those upstream paths. Portal, lockdowns, and real logic stay in-place edits.
- **Revisit trigger:** The Batch 2b dry run. Build step 3 only if that run still conflicts on user-facing product-name strings often enough to justify one to two weeks. Otherwise leave step 3 until a later string-heavy batch.

## Computer use stays parked

- **Date:** 2026-09-25
- **Decision:** Do not land `computer-use-upstream-sync`, `eval/computer-use-p0`, or `tools/computer_use/` changes. Batch 1b took the rest of `6c3aae398ade` and left the computer-use parts out.
- **Reason:** That work is a Linux desktop driven by the gateway. The Mac and Windows app does not run it. A later OkVevo Cloud plan can pick it up.
- **Revisit trigger:** An OkVevo Cloud plan that includes a Linux gateway, and Karan explicitly unparks it.

## OSS notice is a file, not a screen

- **Date:** 2026-10-01
- **Decision:** Settings → About does not show Open-source licenses (PR #27). `THIRD_PARTY_NOTICES.txt` stays inside the packaged app (`Contents/Resources` on Mac, `resources` on Windows). `LICENSE` and `NOTICE` stay in the repo.
- **Reason:** Customers should not see a Hermes/Nous license screen. The MIT notice still has to ship with every copy.
- **Revisit trigger:** OkVevo-Web adds `/legal/open-source`. The packaged file stays even after that page exists.

## Batch 2b scope

- **Date:** 2026-10-05
- **Decision:** Batch 2b is the crash and data-loss set that merged as PR #38. Taken: `553388b320cf`, `c48e05a9d012`, `0af6b2121e22`, `46d080127978`, `9e62232b0762`, `7350426b1793`, `54684326e7e1`, `fc6144e3c175`. Skipped: `d46ea7bf2081`, `e81be5b66a43`, and the seven rows whose files are not on Nia (`73f7fc2ca54c`, `f389bddd118d`, `59ddb98c03cc`, `9567dd9c54a7`, `7823f8771d1a`, `98a9a7956160`, `e33fd7e09b42`), plus `7154128fe19f` (left out on purpose). Newest taken sha `c48e05a9d012`. Backport ratio 7/8.
- **Reason:** Those skips have no matching mechanism on Nia. Importing the missing module just to take the patch would widen the fork.
- **Revisit trigger:** A later sync that adds the missing module for another reason. Re-check the skipped sha then.

## Features taken (F1–F7)

- **Date:** 2026-10-05
- **Decision:** Take these Hermes features, one pull request each, in order: F1 cron re-run when a job never reached the model; F2 MCP connection health and a concurrency cap; F3 group member picker; F4 steer or stop a running sub-task, plus handoff of unfinished work; F5 sibling chats (`/branch`); F6 cron uses the current model unless pinned; F7 Bot Screen and cross-gateway group chat as groundwork only, one feature flag, default off, no visible entry. Deferred: in-app browser comments, Kanban. Skipped as Nous-only: plugin catalog, telemetry, subscription tiers, Honcho, Nous login.
- **Reason:** F1–F6 run on the Mac and Windows app. F7 is the cloud piece and stays off until an OkVevo Cloud plan turns it on. The deferred and skipped items are either low value now or need a Hermes cloud account.
- **Revisit trigger:** F5 and F6 report their translation-conflict counts before code. F7 stops if it cannot be gated. Browser comments and Kanban wait until Karan asks.

## Rebuild re-measure

- **Date:** 2026-10-05
- **Decision:** Stay on Strategy B. Re-measure the backport ratio on 2026-11-01. Schedule the full replay only if that measurement is still above 70% and Karan wants a multi-week project.
- **Reason:** Batch 1 was 63%, the Batch 2 table 75%, Batch 2a 67%, Batch 2b 88%. Hermes is still adding thousands of commits a week. A rebuild now pauses security and bugfix shipping.
- **Revisit trigger:** 2026-11-01, threshold 70%.

## Image and search providers stay Fal and Tavily

- **Date:** 2026-10-05
- **Decision:** Do not add new image or search providers. Image generation stays Fal. Web search stays Tavily.
- **Reason:** Upstream Meta image generation needs its own API key and a new portal route beside Fal. Perplexity’s Hermes-managed path goes through Nous; a bring-your-own key would clone the Tavily gateway. Codex search needs a Codex login, which is not a normal HTTP search. Fal and Tavily already run through the OkVevo portal.
- **Revisit trigger:** Revisit if users ask for Perplexity/Meta.

## How pulls land

- **Date:** 2026-10-04
- **Decision:** A promotion of `staging` onto `main` is a merge commit (PR #19, PR #32). A feature or sync pull request into `staging` is squash-merged, one batch per pull request.
- **Reason:** A squash on `staging` reverts as one commit. A merge onto `main` keeps the promotion as its own commit, separate from the work that already landed on `staging`.
- **Revisit trigger:** If `main` should become a linear squash history, or if GitHub is set so only one merge method is allowed.
