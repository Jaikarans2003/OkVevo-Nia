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
  "nia_app": "/Applications/Nia.app"
}
```

## Dumps

``

## D7 matrix (Auto, 3×, first tool only)

| task | rep | expect | first_tool | routed_model | wall_s | tokens | credits |
|---|---|---|---|---|---|---|---|
| d7_su_01_whatsapp_open | 1 | computer_use |  | okvevo/auto-intelligence | 132.33 |  |  |
| d7_su_01_whatsapp_open | 2 | computer_use |  | okvevo/auto-intelligence | 11.87 |  |  |
| d7_su_01_whatsapp_open | 3 | computer_use |  | okvevo/auto-intelligence | 10.07 |  |  |
| d7_su_02_notes_put | 1 | computer_use |  | okvevo/auto-intelligence | 12.71 |  |  |
| d7_su_02_notes_put | 2 | computer_use |  | okvevo/auto-intelligence | 9.06 |  |  |
| d7_su_02_notes_put | 3 | computer_use |  | okvevo/auto-intelligence | 20.74 |  |  |
| d7_su_03_whatsapp_send | 1 | computer_use |  | okvevo/auto-intelligence | 165.17 |  |  |
| d7_su_03_whatsapp_send | 2 | computer_use |  | okvevo/auto-intelligence | 73.85 |  |  |
| d7_su_03_whatsapp_send | 3 | computer_use |  | okvevo/auto-intelligence | 10.87 |  |  |
| d7_su_04_notes_type | 1 | computer_use |  | okvevo/auto-intelligence | 10.27 |  |  |
| d7_su_04_notes_type | 2 | computer_use |  | okvevo/auto-intelligence | 11.48 |  |  |
| d7_su_04_notes_type | 3 | computer_use |  | okvevo/auto-intelligence | 10.27 |  |  |
| d7_su_05_whatsapp_someone | 1 | computer_use |  | okvevo/auto-intelligence | 10.27 |  |  |
| d7_su_05_whatsapp_someone | 2 | computer_use |  | okvevo/auto-intelligence | 13.69 |  |  |
| d7_su_05_whatsapp_someone | 3 | computer_use |  | okvevo/auto-intelligence | 11.88 |  |  |
| d7_su_06_notes_open | 1 | computer_use |  | okvevo/auto-intelligence | 12.29 |  |  |
| d7_su_06_notes_open | 2 | computer_use |  | okvevo/auto-intelligence | 12.29 |  |  |
| d7_su_06_notes_open | 3 | computer_use |  | okvevo/auto-intelligence | 12.5 |  |  |
| d7_su_07_whatsapp_late | 1 | computer_use |  | okvevo/auto-intelligence | 11.68 |  |  |
| d7_su_07_whatsapp_late | 2 | computer_use |  | okvevo/auto-intelligence | 12.9 |  |  |
| d7_su_07_whatsapp_late | 3 | computer_use |  | okvevo/auto-intelligence | 10.08 |  |  |
| d7_su_08_notes_drop | 1 | computer_use |  | okvevo/auto-intelligence | 12.69 |  |  |
| d7_su_08_notes_drop | 2 | computer_use |  | okvevo/auto-intelligence | 11.29 |  |  |
| d7_su_08_notes_drop | 3 | computer_use |  | okvevo/auto-intelligence | 14.91 |  |  |
| d7_su_09_whatsapp_start | 1 | computer_use |  | okvevo/auto-intelligence | 31.83 |  |  |
| d7_su_09_whatsapp_start | 2 | computer_use |  | okvevo/auto-intelligence | 149.21 |  |  |
| d7_su_09_whatsapp_start | 3 | computer_use |  | okvevo/auto-intelligence | 12.89 |  |  |
| d7_su_10_notes_add | 1 | computer_use |  | okvevo/auto-intelligence | 11.31 |  |  |
| d7_su_10_notes_add | 2 | computer_use |  | okvevo/auto-intelligence | 10.88 |  |  |
| d7_su_10_notes_add | 3 | computer_use |  | okvevo/auto-intelligence | 9.28 |  |  |
| d7_su_11_tally | 1 | computer_use |  | okvevo/auto-intelligence |  |  |  |
| d7_su_11_tally | 2 | computer_use |  | okvevo/auto-intelligence |  |  |  |
| d7_su_11_tally | 3 | computer_use |  | okvevo/auto-intelligence |  |  |  |
| d7_su_12_multi | 1 | computer_use |  | okvevo/auto-intelligence | 9.7 |  |  |
| d7_su_12_multi | 2 | computer_use |  | okvevo/auto-intelligence | 10.48 |  |  |
| d7_su_12_multi | 3 | computer_use |  | okvevo/auto-intelligence | 12.3 |  |  |
| d7_su_13_calc | 1 | computer_use |  | okvevo/auto-intelligence | 11.89 |  |  |
| d7_su_13_calc | 2 | computer_use |  | okvevo/auto-intelligence | 19.54 |  |  |
| d7_su_13_calc | 3 | computer_use |  | okvevo/auto-intelligence | 28.62 |  |  |
| d7_sn_01_ls | 1 | not_computer_use |  | okvevo/auto-intelligence | 12.5 |  |  |
| d7_sn_01_ls | 2 | not_computer_use |  | okvevo/auto-intelligence | 11.5 |  |  |
| d7_sn_01_ls | 3 | not_computer_use |  | okvevo/auto-intelligence | 12.1 |  |  |
| d7_sn_02_web | 1 | not_computer_use |  | okvevo/auto-intelligence | 13.71 |  |  |
| d7_sn_02_web | 2 | not_computer_use |  | okvevo/auto-intelligence | 12.51 |  |  |
| d7_sn_02_web | 3 | not_computer_use |  | okvevo/auto-intelligence | 11.9 |  |  |
| d7_sn_03_edit | 1 | not_computer_use |  | okvevo/auto-intelligence | 11.69 |  |  |
| d7_sn_03_edit | 2 | not_computer_use |  | okvevo/auto-intelligence | 12.1 |  |  |
| d7_sn_03_edit | 3 | not_computer_use |  | okvevo/auto-intelligence | 12.11 |  |  |
| d7_sn_04_git | 1 | not_computer_use |  | okvevo/auto-intelligence | 9.67 |  |  |
| d7_sn_04_git | 2 | not_computer_use |  | okvevo/auto-intelligence | 10.68 |  |  |
| d7_sn_04_git | 3 | not_computer_use |  | okvevo/auto-intelligence | 12.71 |  |  |
| d7_sn_05_math | 1 | not_computer_use |  | okvevo/auto-intelligence | 10.29 |  |  |
| d7_sn_05_math | 2 | not_computer_use |  | okvevo/auto-intelligence | 10.49 |  |  |
| d7_sn_05_math | 3 | not_computer_use |  | okvevo/auto-intelligence | 12.52 |  |  |

## Provisional bake-off

_no bake-off rows_

## Baseline scores (app-state checkers)

_no baseline rows_

Raw CSV: `p0_mac_2026-09-23.csv`
