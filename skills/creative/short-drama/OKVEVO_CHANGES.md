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

## 2026-10-10 must-fix pass (quote fail-closed, refs, caps, ffmpeg)

- `production_tool.py`: `prepare` fetches a signed-in portal quote for portal jobs and writes `metadata/quotes/<job>.json`; the preview shows `estimated_credits` or a `quote_error`. `confirm` refuses paid jobs without a usable quote (stale fingerprint, expired, unavailable, signed out). `run` sends `approved_credits` from the receipt.
- `provider_adapters.py`: `quote` argv / `quote_only` payload → `POST /api/fal/quote` (fail-closed). Portal submit now inlines reference media: `image_url` (i2v, one first frame) / `image_urls` (gpt edit), downscaled to ≤2048px via ffmpeg and re-encoded JPEG q90 (PNG when alpha); body capped at 24MB (Cloud Run rejects >32MB before the app). Failures raise before submit, so before any hold.
- gpt-image-2 edit references capped at 4 (adapter and `rateCard.ts` `GPT_IMAGE_MAX_REFS`) until the billing-events smoke prices input tokens; the card comment documents how to lift.
- `short-drama-edit/scripts/edit_tool.py`: H.264 encode resolves the OS hardware encoder first (`h264_videotoolbox`, then `h264_mf`) at a 12 Mbps delivery bitrate, libx264 CRF 18 fallback on dev machines, clear error otherwise — the bundled LGPL ffmpeg ships no libx264. VP8-alpha overlay still decodes via `libvpx` (bundled).
- Packaging: `apps/desktop/scripts/fetch-ffmpeg.mjs` (+ `build-ffmpeg-macos.mjs`) bundle pinned LGPL ffmpeg/ffprobe into `resources/ffmpeg/<platform>-<arch>/` → extraResources `ffmpeg/`; backend PATH puts it first (`bundledFfmpegDir` in `backend-env.ts`).

## 2026-10-10 full parity (Phase 2, deterministic billing)

- `short-drama-video-prompts/references/seedance-2.5.md`: REVERTED the Phase-1 workaround — file is byte-identical to the pinned upstream SHA again (shot 2+ always `extend` with real video + tail frame).
- `provider_adapters.py`: native routing restored — extend/edit → seedance-2.5 `reference-to-video` `task` extension/editing with `video_urls`; multi-slot reference → family `reference-to-video` with image/video/audio arrays per binding role; first+last frame → i2v `end_image_url`. Media no longer inlined as data URLs: uploads go through portal signed-URL flow (`drama-upload://` refs) and a handle-cache reuses a prior shot's Fal URL within 48h. gpt edit refs lifted 4 → 16 (schema max). Voice clone is `fal-ai/minimax/voice-clone` (consent, ≥10s, clone-once, 7-day warn); speech-02-hd reuses `custom_voice_id`. Completed jobs fetch `response_url` for the result payload.

## 2026-10-10 Addendum 3 (billing key + voice clone)

- `provider_adapters.py`: `prepare_voice_clone` / stored `metadata/voices/<character>.json`; never chatterbox; never silent re-clone.
- `production_tool.py`: quote preview shows clone `preview_text` and 7-day retain `warning`.
- `short-drama-produce/SKILL.md` + `adapter-contract.md`: clone rules.
- `production_tool.py`: job `references` / `reference_bindings` caps raised 16 → 50 (seedance-2.5 reference-to-video accepts ≤50 files total).
- `short-drama-produce/SKILL.md`: consent confirmation required before uploading voice or face references.

## 2026-10-10 voice ownership

- Portal `clonedVoices` is the SoT (`uid`, `custom_voice_id`, `character`, `project`, `cloned_at`, `used_in_tts_at`, `consent_at`, `sample_sha256`). Local `metadata/voices/` is a cache.
- Speech jobs with an unowned custom `voice_id` get 403 before any hold.
- Missing local cache → `GET /api/fal/voices` restore; `delete-voice` drops our record. Fal/MiniMax has no delete-voice API.
