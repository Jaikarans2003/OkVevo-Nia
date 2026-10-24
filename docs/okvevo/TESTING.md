# OkVevo manual test checklist

Run on a **fresh packaged staging build**, Mac **and** Windows. Quit and uninstall Nia first. The new `appId` (`com.okvevo.app`) installs **beside** Nia, not over it. Never run both at once — they share `~/.hermes`.

Report GitHub Actions minutes this PR used (macOS/Windows runners bill more on private repos).

| # | Test | Pass when |
|---|---|---|
| 1 | Fresh install | Installer, Dock/Taskbar, window title, Start menu all say OkVevo; About shows "OkVevo by Azonova Technologies Pvt Ltd" and "Built on Hermes Agent by Nous Research." |
| 2 | Sign in / sign out | Works; credits shown as % of the plan grant plus purchased top-up |
| 3 | Hidden surfaces (public build) | No API key fields, no provider picker, no Nous Portal. Internal build shows them |
| 4 | Identity | Ask "Who are you? What can you do? Who made you?" on 2+ models, on the **default bot** and on a **new bot created from the Bots UI** → answers as OkVevo agent |
| 5 | Simple tasks (time each) | "Make an Excel file with 3 columns of sample sales data", "Write a 1-page Word doc", "Build a simple website" → correct file, finishes in one go |
| 6 | Preview | xlsx, docx, html site, pdf, image open in preview (note any type that does not) |
| 7 | Stream | Tool calls and paths visible; nothing replaced with "[internal details omitted]" |
| 8 | Image, video, web search | Work; credits drop on the portal |
| 9 | Out of credits | Clear "top up" message, not a crash |
| 10 | Bots section (UI) | Create, edit, delete a bot from the Bots list; group chat; bot-to-bot message |
| 11 | Tester upgrade | Sessions, memory, bots intact after OkVevo install; config migration backed up (`*.okvevo-migrate.bak`) + logged (root + every `~/.hermes/profiles/*`) |
| 12 | Mac permissions | Re-grant microphone, screen-recording and accessibility to the new app |
| 13 | Windows extras | SmartScreen "More info → Run anyway"; username with a space; PowerShell tasks |
| 14 | Auto-update | Staging build N updates to N+1 (unsigned Mac in-app update will not swap — re-download the DMG) |

## Known gaps

### `manage_bot` is not on this branch

The fork tool `manage_bot` (create / list / update a bot from **chat**; it never supported delete) was dropped in the upstream reset. Upstream v0.22.4 has no replacement. Port is on `PRE-LIVE-BACKLOG.md`.

**Still works — Bots UI**

- New bot (Create Bot → `profiles.create`)
- Edit profile (name, SOUL, skills, look)
- Delete bot
- Group chat and bot-to-bot messages

Those go through the desktop gateway profile RPCs, not `manage_bot`.

**Fails — chat (every channel)**

- "Make me a bot that…" / create a bot from chat
- "List my bots" via the agent
- "Change that bot's personality / role / description" from chat

There is no `manage_bot` tool. A determined agent can still edit profile files with file/shell tools. That is not a supported create/list/update path.

The old whole-home block (`plugins/nia-public-guard`, `pre_tool_call` on `terminal` / `read_file` / `write_file` / … targeting all of `~/.hermes`) is **gone** on this branch. Remaining blocks are credential files only: upstream `agent/file_safety.py` (`.env`, `auth.json`, token dirs) plus `plugins/okvevo/secrets_guard.py` (same files plus `okvevo-firebase-id-token` / `okvevo-firebase-refresh-token`, including via the terminal).

**Delete from chat**

The old tool never had delete. Delete remains UI-only on every channel.

## Upstream workflows on this PR

Nous CI (CI, Tests, Lint, Nix flake check, JS Tests, …) uses **Blacksmith** runners (`blacksmith-*-ubuntu-2404`). OkVevo-Nia has no Blacksmith org. Those jobs queue forever here and succeed on Nous `v0.22.4` (`4d04303818b`) because Nous has the runners.

**Action:** `gh workflow disable` on those workflows (same as other Nous-only jobs). Treat their PR runs as **cancelled by disable**. Do not KEEP-PATCH runner labels.

Required merge checks are only the OkVevo jobs: Drift + branding + OkVevo plugins, Gitleaks, Desktop OkVevo suites, Assert repository is OkVevo-Nia.

## R2 prefixes

Do not create `okvevo/staging/` or `okvevo/stable/` by hand or with `.keep` objects. Object storage has no folders; the first upload from the staging pack (`okvevo/staging`) or the production archive/publish (`okvevo/stable`, plus the existing bucket-root copies) creates those key prefixes. Do not delete or move any `nia/` objects.
