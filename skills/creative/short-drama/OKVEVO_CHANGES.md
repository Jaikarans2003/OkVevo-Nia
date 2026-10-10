# OkVevo edits

Pinned source: https://github.com/zenstory-ai/drama-skills `c2426e03c0e7722bebcc6a488b6658dc38c65ac3`

- `short-drama/SKILL.md`: when `production_profile` is unset, ask for a quality band, a spend cap, or a model id, and write that into `choices`. Prices come from the OkVevo adapter.
- `short-drama/references/okvevo-production-profile.example.json`: example `choices` with `quality_band`, `spend_cap_credits`, and `target_video_model`.
- `short-drama-video-prompts/SKILL.md`: LTX stays on the generic prompt path. The skill does not pick an endpoint or a price.
- `short-drama-produce/SKILL.md`: call the OkVevo adapter (`choose`, `quote`, `submit`, `collect`, `cancel`). Stop `tts` and `music`. Same-pass audio stays. Do not use the bundled provider adapters.
- `short-drama-produce/references/okvevo-adapter.example.json`: adapter config pointing at `okvevo/drama_fal_adapter.py`.
- `LICENSE` copied into each of the eleven skill folders. `SOURCE.md` records the URL and SHA.
- Packaging: `apps/desktop/scripts/pack-agent-snapshot.mjs` puts `skills/` and `okvevo/` in `agent-snapshot.tar.gz`, which electron-builder ships as `extraResources`. A fresh pack contains `okvevo/drama_fal_adapter.py`, the eleven skill folders, and `short-drama/scripts/dashboard_server.py`. The local dashboard stays: Electron `net.request` to `127.0.0.1` got 200 for the page, 401 for `/api/projects` without the session token, and 200 with it.

## 2026-10-10 portal Fal

- `short-drama-video-prompts/references/seedance-2.5.md`: Phase 1 adjacent shots use the previous shot's real last frame as an image-to-video start frame. `extend` stays documented for Phase 2. Missing `ffmpeg` fails before any hold.
- `short-drama-video-prompts/references/minimax-h3.md`: H3 Max on Fal does support reference-to-video. The old "no full-reference" line was wrong.
- `short-drama-video-prompts/references/wan-3.0.md`: Fal id is `alibaba/wan-3.0-prime`.
- `short-drama-produce/references/providers/minimax-music.md`: skill name `music-3.0` maps to Fal `minimax/music-3`.
- `short-drama-produce/scripts/provider_adapters.py`: portal path, speech voice table (schema examples plus Hindi via `language_boost`), speech max 5000, reference-audio cloning rejected in Phase 1, vendor API keys no longer accepted.
- `short-drama-produce/references/okvevo-adapter.example.json`: commands point at `provider_adapters.py portal`.
- `short-drama-produce/scripts/production_tool.py`: `--adapter-config` defaults to that example. Prepare preview includes an estimate label.
