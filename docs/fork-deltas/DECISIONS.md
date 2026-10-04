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

## How pulls land

- **Date:** 2026-10-04
- **Decision:** A promotion of `staging` onto `main` is a merge commit (PR #19, PR #32). A feature or sync pull request into `staging` is squash-merged, one batch per pull request.
- **Reason:** A squash on `staging` reverts as one commit. A merge onto `main` keeps the promotion as its own commit, separate from the work that already landed on `staging`.
- **Revisit trigger:** If `main` should become a linear squash history, or if GitHub is set so only one merge method is allowed.
