# P0 computer-use report (mac)

Date: 2026-09-23 (UTC)

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
    "gateway_pid": 25274,
    "gateway_cmd": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent/.venv/bin/python -m hermes_cli.main serve --host 127.0.0.1 --port 0",
    "HERMES_DESKTOP_HERMES_ROOT": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "pythonpath0": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "agent_root": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
    "using_this_checkout": true,
    "bind_mode": "env",
    "bind_stamp": {
      "checkout": "/Users/karan/Documents/ManarthaVarsityProjects/OkVevo/Tech/Nia/hermes-agent",
      "sha": "1d8a9513ff4266934d420733f97db90d4f60bb4a",
      "mode": "env"
    },
    "checkout_sha": "1d8a9513ff4266934d420733f97db90d4f60bb4a",
    "cua_driver": "cua-driver 0.28.2"
  }
}
```



## Dumps

``

## D7 matrix (Cost Effective Auto, 3×, first tool only)


| task                      | rep | expect           | first_tool     | routed_model     | wall_s | tokens | credits |
| ------------------------- | --- | ---------------- | -------------- | ---------------- | ------ | ------ | ------- |
| d7_su_01_whatsapp_open    | 1   | computer_use     | computer_use   | okvevo/auto-cost | 8.25   |        |         |
| d7_su_01_whatsapp_open    | 2   | computer_use     | computer_use   | okvevo/auto-cost | 5.64   |        |         |
| d7_su_01_whatsapp_open    | 3   | computer_use     | computer_use   | okvevo/auto-cost | 5.85   |        |         |
| d7_su_02_notes_put        | 1   | computer_use     | skill_view     | okvevo/auto-cost | 6.85   | 22226  |         |
| d7_su_02_notes_put        | 2   | computer_use     | skill_view     | okvevo/auto-cost | 5.84   |        |         |
| d7_su_02_notes_put        | 3   | computer_use     | skill_view     | okvevo/auto-cost | 5.44   |        |         |
| d7_su_03_whatsapp_send    | 1   | computer_use     | computer_use   | okvevo/auto-cost | 6.25   |        |         |
| d7_su_03_whatsapp_send    | 2   | computer_use     | skill_view     | okvevo/auto-cost | 9.06   |        |         |
| d7_su_03_whatsapp_send    | 3   | computer_use     | session_search | okvevo/auto-cost | 7.66   |        |         |
| d7_su_04_notes_type       | 1   | computer_use     | skill_view     | okvevo/auto-cost | 8.87   | 22204  |         |
| d7_su_04_notes_type       | 2   | computer_use     | skill_view     | okvevo/auto-cost | 5.45   |        |         |
| d7_su_04_notes_type       | 3   | computer_use     | skill_view     | okvevo/auto-cost | 6.25   | 22201  |         |
| d7_su_05_whatsapp_someone | 1   | computer_use     | computer_use   | okvevo/auto-cost | 13.29  |        |         |
| d7_su_05_whatsapp_someone | 2   | computer_use     | skill_view     | okvevo/auto-cost | 6.85   |        |         |
| d7_su_05_whatsapp_someone | 3   | computer_use     | skill_view     | okvevo/auto-cost | 9.08   |        |         |
| d7_su_06_notes_open       | 1   | computer_use     | skill_view     | okvevo/auto-cost | 5.25   | 22200  |         |
| d7_su_06_notes_open       | 2   | computer_use     | computer_use   | okvevo/auto-cost | 6.66   |        |         |
| d7_su_06_notes_open       | 3   | computer_use     | computer_use   | okvevo/auto-cost | 5.86   | 22232  |         |
| d7_su_07_whatsapp_late    | 1   | computer_use     | skill_view     | okvevo/auto-cost | 5.86   |        |         |
| d7_su_07_whatsapp_late    | 2   | computer_use     | skill_view     | okvevo/auto-cost | 6.86   |        |         |
| d7_su_07_whatsapp_late    | 3   | computer_use     | skill_view     | okvevo/auto-cost | 7.08   |        |         |
| d7_su_08_notes_drop       | 1   | computer_use     | skill_view     | okvevo/auto-cost | 10.29  |        |         |
| d7_su_08_notes_drop       | 2   | computer_use     | skill_view     | okvevo/auto-cost | 5.47   |        |         |
| d7_su_08_notes_drop       | 3   | computer_use     | skill_view     | okvevo/auto-cost | 6.07   |        |         |
| d7_su_09_whatsapp_start   | 1   | computer_use     | web_search     | okvevo/auto-cost | 7.09   |        |         |
| d7_su_09_whatsapp_start   | 2   | computer_use     | skills_list    | okvevo/auto-cost | 7.49   |        |         |
| d7_su_09_whatsapp_start   | 3   | computer_use     | skill_view     | okvevo/auto-cost | 6.28   |        |         |
| d7_su_10_notes_add        | 1   | computer_use     | skill_view     | okvevo/auto-cost | 5.47   |        |         |
| d7_su_10_notes_add        | 2   | computer_use     | skill_view     | okvevo/auto-cost | 5.67   | 22191  |         |
| d7_su_10_notes_add        | 3   | computer_use     | skill_view     | okvevo/auto-cost | 5.27   |        |         |
| d7_su_11_tally            | 1   | computer_use     |                | okvevo/auto-cost |        |        |         |
| d7_su_11_tally            | 2   | computer_use     |                | okvevo/auto-cost |        |        |         |
| d7_su_11_tally            | 3   | computer_use     |                | okvevo/auto-cost |        |        |         |
| d7_su_12_multi            | 1   | computer_use     | skill_view     | okvevo/auto-cost | 4.47   |        |         |
| d7_su_12_multi            | 2   | computer_use     | skill_view     | okvevo/auto-cost | 4.26   |        |         |
| d7_su_12_multi            | 3   | computer_use     | skill_view     | okvevo/auto-cost | 4.06   |        |         |
| d7_su_13_calc             | 1   | computer_use     | computer_use   | okvevo/auto-cost | 5.46   |        |         |
| d7_su_13_calc             | 2   | computer_use     | computer_use   | okvevo/auto-cost | 4.66   |        |         |
| d7_su_13_calc             | 3   | computer_use     | computer_use   | okvevo/auto-cost | 4.26   |        |         |
| d7_sn_01_ls               | 1   | not_computer_use | search_files   | okvevo/auto-cost | 3.64   |        |         |
| d7_sn_01_ls               | 2   | not_computer_use | terminal       | okvevo/auto-cost | 4.85   |        |         |
| d7_sn_01_ls               | 3   | not_computer_use | search_files   | okvevo/auto-cost | 4.25   |        |         |
| d7_sn_02_web              | 1   | not_computer_use | web_search     | okvevo/auto-cost | 3.65   |        |         |
| d7_sn_02_web              | 2   | not_computer_use | web_search     | okvevo/auto-cost | 4.06   |        |         |
| d7_sn_02_web              | 3   | not_computer_use | web_search     | okvevo/auto-cost | 3.85   |        |         |
| d7_sn_03_edit             | 1   | not_computer_use | search_files   | okvevo/auto-cost | 7.7    |        |         |
| d7_sn_03_edit             | 2   | not_computer_use | search_files   | okvevo/auto-cost | 4.05   |        |         |
| d7_sn_03_edit             | 3   | not_computer_use | read_file      | okvevo/auto-cost | 4.04   |        |         |
| d7_sn_04_git              | 1   | not_computer_use |                | okvevo/auto-cost | 165.25 | 44476  |         |
| d7_sn_04_git              | 2   | not_computer_use | terminal       | okvevo/auto-cost | 5.28   |        |         |
| d7_sn_04_git              | 3   | not_computer_use | terminal       | okvevo/auto-cost | 4.06   |        |         |
| d7_sn_05_math             | 1   | not_computer_use |                | okvevo/auto-cost | 6.29   | 22235  |         |
| d7_sn_05_math             | 2   | not_computer_use |                | okvevo/auto-cost | 4.86   | 22185  |         |
| d7_sn_05_math             | 3   | not_computer_use |                | okvevo/auto-cost | 5.05   | 22251  |         |




## Provisional bake-off


| model            | success   | p50_s   | n   |
| ---------------- | --------- | ------- | --- |
| okvevo/auto-cost | 4/9 (44%) | 338.095 | 9   |


Provisional winner (success rate, then p50): **okvevo/auto-cost**. Not locked (R6 waits for P2 re-run).

## Baseline scores (app-state checkers)

- success rate: 11/21
- p50 wall (successes): 36.66
- LLM turns (mean): 16.11
- tokens (mean): 724191.5
- credits (mean, if gateway exposed them): unknown

Raw CSV: `p0_mac_2026-09-23.csv`