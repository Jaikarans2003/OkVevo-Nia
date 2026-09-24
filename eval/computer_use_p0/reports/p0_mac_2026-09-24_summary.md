# P0 computer-use report (mac)

Date: 2026-09-24 (UTC)

## Entry point (packaged Nia, not dev mode)

Desktop chat: `session.create` at apps/desktop/src/app/session/hooks/use-session-actions/index.ts desktopSessionCreateParams L247–280 and requestGateway L532–538; `prompt.submit` at apps/desktop/src/app/session/hooks/use-prompt-actions/submit.ts L756–790. Gateway: tui_gateway/methods_session.py L14, tui_gateway/methods_prompt.py L287. Packaged spawn: apps/desktop/electron/main.ts L12190 / L12308. No Vite/dev mode.

## Versions

```
{
  "os": "macOS-26.6.2-arm64-arm-64bit",
  "python": "3.11.15",
  "cua_driver_binary": "cua-driver 0.28.2",
  "npm_trycua_cua_driver": "0.28.2",
  "pinned_constant": "0.28.2",
  "nia_app": "/Applications/Nia.app",
  "live_agent": {
    "checkout": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "extracted_active": "/Users/karan/.hermes/hermes-agent",
    "pack_stamp": {
      "commit": "ff25fecf9905a280d3155f54f66e4582c63dc89f",
      "extractedAt": "2026-09-23T14:21:44.612Z"
    },
    "pin_in_checkout": "0.28.2",
    "pin_in_extracted_tree": "0.28.2",
    "gateway_pid": 85884,
    "gateway_cmd": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent/.venv/bin/python -m hermes_cli.main serve --host 127.0.0.1 --port 0",
    "HERMES_DESKTOP_HERMES_ROOT": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "pythonpath0": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "agent_root": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "using_this_checkout": true,
    "bind_mode": "env",
    "bind_stamp": {
      "checkout": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
      "sha": "e1d855e2752e7c61303005025bc7370fa0c43856",
      "mode": "env"
    },
    "checkout_sha": "e1d855e2752e7c61303005025bc7370fa0c43856",
    "cua_driver": "cua-driver 0.28.2"
  }
}
```

## Dumps

``

## D7 matrix (Cost Effective Auto, 3×, first tool only)

_no D7 rows_

## Provisional bake-off

_no bake-off rows_

## Baseline scores (app-state checkers)

- success rate: 5/21
- p50 wall (successes): 45.44
- LLM turns (mean): 8.17
- tokens (mean): 221851.5
- credits (mean, if gateway exposed them): 64.25


Raw CSV: `p0_mac_2026-09-24.csv`
