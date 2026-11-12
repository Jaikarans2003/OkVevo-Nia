# Vendor touchpoints

A public OkVevo build talks to the OkVevo portal for paid model, image, video,
and web work. It does not hold a vendor API key and it does not call a vendor
host itself.

Allowed besides the portal origin baked into the pack (`OKVEVO_WEB_ORIGIN`):

- `okvevo.com` and `releases.okvevo.com`
- Firebase Auth and Firestore for the pack's Firebase project

Anything else in the table is not a host the public build may call.

| Feature | Status | How it is switched |
| --- | --- | --- |
| Chat completions | Routed | `model.provider: okvevo`. The model-provider plugin posts to `{OKVEVO_WEB_ORIGIN}/api/gateway`. |
| Auto Cost Effective / Auto Intelligence | Routed | Virtual ids `okvevo/auto-cost` and `okvevo/auto-intelligence`. The plugin rewrites the wire model. The portal still meters it. |
| Image generation | Routed | `image_gen.provider: okvevo` via `plugins/okvevo`. |
| Video generation | Routed | `video_gen.provider: okvevo` via `plugins/okvevo`. |
| Web search and extract | Routed | `web.backend`, `web.search_backend`, and `web.extract_backend` are `okvevo`. |
| OpenRouter, OpenAI, Anthropic, Google, xAI, Groq | Disabled | No vendor key in the pack or in `okvevo/config/okvevo-defaults.yaml`. Public picker hides those rows. |
| Fal direct | Disabled | Image and video go through the portal. No `FAL_KEY` in the app. |
| Tavily, Firecrawl, Exa, Parallel | Disabled | Web providers are `okvevo`. `web.keyless_fallback` and `web.keyless_rescue` are false. |
| ElevenLabs and other paid TTS | Disabled | No vendor key. Keyless edge TTS is unchanged upstream. |
| Local speech-to-text | Routed | On-device. No vendor key. |
| Nous inference, catalog fetch, Chronos, telemetry, tool-gateway connectors | Disabled | See `docs/okvevo/NOUS-TOUCHPOINTS.md`. |

`scripts/okvevo/check_vendor_keys.py` fails CI if the defaults file or a packed
`okvevo-pack-env.json` contains one of those vendor keys with a value.
OkVevo tokens (`OKVEVO_API_KEY`, `OKVEVO_WEB_ORIGIN`) are allowlisted by not
being in that list.

The packed-app check records renderer requests and fails if a URL host is in
`apps/desktop/e2e/okvevo/vendor-guard.ts`. `noteRequestUrl` throws for
`https://openrouter.ai/...` and for `https://api.fal.run/...`.
