# P0 computer-use eval (packaged Nia)

Drive **packaged Nia.app** (not `npm run dev`). The window/shell is the installed app. The Python agent is **not** automatically this Cursor folder.

| What you edit | Does a re-run pick it up? |
|---|---|
| `eval/computer_use_p0/` (this harness) | Yes. It is a separate Python script talking to Nia over the gateway. |
| Agent / `computer_use` / `hermes_cli` in this checkout | **No**, until Nia is bound to this folder. Packaged Nia extracts Python to `~/.hermes/hermes-agent` and keeps using that copy. |
| Electron / renderer UI | Needs a new DMG/EXE. Do not expect Cursor edits to change the window chrome. |

To make **this checkout's Python** the thing Nia runs (same installed Nia.app, no reinstall):

```bash
cd eval/computer_use_p0
chmod +x bind_checkout.sh
./bind_checkout.sh
./run_p0.sh
```

`run_p0.sh` binds automatically: it starts `/Applications/Nia.app/Contents/MacOS/Nia` with `HERMES_DESKTOP_HERMES_ROOT` pointing at this folder (`open -a Nia` drops that env, so we do not use it). If that fails, it copies the checkout into `~/.hermes/hermes-agent` and restarts. Override with `P0_ALLOW_PACKAGED=1` only when you mean to score the extracted install. After any agent/`hermes_cli` edit, run `./bind_checkout.sh` again so the gateway reloads Python. Harness edits in this folder are live without a restart.


- `session.create` — `apps/desktop/src/app/session/hooks/use-session-actions/index.ts` `desktopSessionCreateParams` L247–280 and `requestGateway('session.create')` L532–538. Server: `tui_gateway/methods_session.py` L14.
- `prompt.submit` — `apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts` L756–790. Server: `tui_gateway/methods_prompt.py` L287.
- WebSocket: `apps/desktop/electron/main.ts` L12308 (`/api/ws?token=`). Token scrape: `apps/desktop/electron/dashboard-token.ts` L38–69.

Per run the CSV logs: prompt (contact redacted), first action tool, routed model (the response model, not the `okvevo/auto-*` alias), wall time, LLM turns, tokens, credits (gateway usage, or the portal ledger when that is empty), and screenshot count.

Each run stops at `max_llm_turns` or `max_tokens` from config and records `budget_exceeded`. D7 scores the first action tool: `skill_view` and `skills_list` are neutral. Bake-off runs the 2 or 3 pinned ids in `bakeoff_models`, not Auto alone.

D7 stops after that first action tool. Bake-off and baseline run to completion (or the budget cap) and score **app state** (AX/UIA), not the transcript.

## Mac (this machine)

1. Install/pin cua-driver **0.28.2** (matches npm `@trycua/cua-driver`): from `hermes-agent/`, `hermes computer-use install` (P0 pin is in `hermes_cli/tools_config.py`).
2. Copy `config.example.json` → `config.local.json`. Set `TEST_CONTACT` to the **exact WhatsApp chat title**. Never commit that file.
3. Run `./bind_checkout.sh` once (restarts Nia onto this folder's Python). Sign in if the window asks.
4. Open WhatsApp. Install LibreOffice if missing (`brew install --cask libreoffice`). TallyPrime is Windows-only.
5. One command:

```bash
cd eval/computer_use_p0
chmod +x run_p0.sh
./run_p0.sh
```

Writes `reports/p0_mac_<date>.csv` and `reports/p0_mac_<date>_summary.md`. Resume-safe: re-run skips finished CSV rows.

Dumps only: `./run_p0.sh --suite dump`

## Windows (non-technical tester)

### Prerequisites

1. Nia installed from https://releases.okvevo.com/staging/Nia-win-x64.exe (or the version you were asked to test). Sign in once.
2. WhatsApp Desktop installed and logged in.
3. **LibreOffice** installed (Calc).
4. **TallyPrime Educational Mode** installed for the ledger task.
5. Python 3.11+ on PATH, **or** use Nia’s venv: `%USERPROFILE%\.hermes\hermes-agent\venv\Scripts\python.exe`
6. This repo folder `eval\computer_use_p0` (from branch `eval/computer-use-p0`).
7. Run `.\bind_checkout.ps1` once so Nia uses this folder's Python, then sign in.

### Config

1. Copy `config.example.json` to `config.local.json` in the same folder.
2. Edit `TEST_CONTACT`: paste the exact WhatsApp chat name of your test contact (not a phone number in git or screenshots).
3. Leave Nia **open and signed in**. Leave WhatsApp, Calc, and TallyPrime Educational Mode open. If a leftover ledger named `Test Ledger` exists, the harness tries to delete it before each Tally run (`tally_reset.ps1`). Use a throwaway educational company, not a real books file.

### One command

In PowerShell:

```powershell
cd <path-to-repo>\eval\computer_use_p0
Set-ExecutionPolicy -Scope Process Bypass
.\run_p0.ps1
```

That runs the suite and writes:

- `reports\p0_windows_<date>.csv`
- `reports\p0_windows_<date>_summary.md`

If Python is missing, install it from https://www.python.org/downloads/ and tick **Add python.exe to PATH**, then run the same `run_p0.ps1` again.

## Safety

The public repo must not contain `TEST_CONTACT`, tokens, keys, or phone numbers. `config.local.json` is gitignored. CSV prompts redact the contact as `***CONTACT***`.
