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
| Webapp / Web Access (v0.23.0 browser-hosted Desktop behind Nous sign-in) | Disabled | `webapp.enabled: false`, `webapp.public_url: ""` in `okvevo-defaults.yaml`, force-applied by `okvevo-config-migration.ts`; the gateway keeps its private loopback listener (`plugins/okvevo/tests/test_webapp_off.py`). Settings hide the Web Access page (`PUBLIC_HIDDEN_SETTINGS_VIEWS`). |
| Usage-window plans (`/usage` gauges, allowance tags, model-switch recovery) | Disabled | Window plans ride Nous provider rows only. The public picker has one OkVevo row; public error cards offer only retry / retry at reset / continue. |
| Error-card setup guides and provider settings links (`hermes-agent.nousresearch.com/docs`, `portal.nousresearch.com`) | Disabled | Public builds drop those actions (`PUBLIC_ERROR_ACTIONS` in `assistant-message.tsx`) and show the OkVevo help email instead of diagnostics. |
| Remote config backend (`config-config.nousresearch.com`) | Disabled | Loads only with `HERMES_CONFIG_BACKEND=remote`. OkVevo never sets it. |
| Update-stop remedy (`downgrade_refused` dialog with the Hermes updating guide URL) | Follow-up | Written only by the git-checkout `hermes update` path. Customer packs are bundled and update through electron-updater. Message is OkVevo; the guide URL is still upstream's (PRE-LIVE-BACKLOG). |
| CLI update repair hint (`hermes-agent.nousresearch.com/install.sh`) | Follow-up | Printed by `hermes update` on a broken git install. Bundled packs do not use that path. |
| Host matchers only (`error_classifier`, `rate_limit_credits`, `hermes-cloud` suffixes, update proxy host list, `--hermes-sandbox-probe` switch) | No request | Strings that classify or route; no request is made to the host. |

After an upstream merge, run the Nous-diff scan in `docs/okvevo/SYNC.md` and
add a row here for any new host.
