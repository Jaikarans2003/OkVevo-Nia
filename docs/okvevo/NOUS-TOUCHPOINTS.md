# Nous touchpoints

Upstream Hermes still contains Nous hosts. OkVevo does not delete those files.
Each row is switched off from OkVevo-owned config, from `isByokChromeVisible()`,
or by not starting the feature. The Nous banner in the shell is PR 2.

| Surface | Status | Switch |
| --- | --- | --- |
| Nous portal login and free guest identity | Disabled | `nous.guest: false` in `okvevo/config/okvevo-defaults.yaml`. Public settings hide Nous Portal (`isByokChromeVisible()`). |
| `nous` / `auto` as the chat or auxiliary provider | Disabled | First-run `model.provider` is `okvevo`. Every `auxiliary.*.provider` is `main`, which follows that provider. `auto`, `openrouter`, and `nous` are replaced. |
| Chronos | Disabled | `cron.chronos.portal_url` is empty. Cron provider is left unset, so the portal URL is unused. |
| Shared telemetry | Disabled | `telemetry.shared_metrics.enabled` and `send` are false. The upstream endpoint string remains in code and is not requested while send is false. |
| Remote model catalog | Disabled | `model_catalog.enabled: false`. The picker reads the gateway `model.options` list. |
| Nous tool-gateway connectors | Disabled | `tools.connectors.enabled: false`. |
| Skills Hub Nous origin | Disabled | Public chrome does not offer the Nous sign-in the hub uses. No hub URL is written into first-run config. |
| Provider `auto` fallbacks inside upstream profiles | Disabled | The public picker shows one OkVevo row. Auxiliary slots are not `auto`. |
| App updates | Routed | Feed stays `https://releases.okvevo.com` plus the channel folder. Not a Nous host. |
| Sandbox image `nousresearch/hermes-sandbox` | Follow-up | First-run config does not start a container. The upstream default image constant is still in code if a sandbox backend is started later. |

After an upstream merge, run the Nous-diff scan in `docs/okvevo/SYNC.md` and
add a row here for any new host.
