# Fork delta — durable generated-media storage

Tags: `[agent]` `[desktop]`

## Summary

Nia keeps every **generated** deliverable under unswept storage. Upstream
`agent/provider_media.py` is copied **verbatim**. Nia policy lives in
`agent/nia_generated_media.py` (validate-first → save under
`cache/generated/<kind>/` → optional `shutil.move` into tier a/b).

## TTS split

| Surface | Location |
|---------|----------|
| Explicit `text_to_speech` / tool (no `output_path`) | Durable `cache/generated/audio` + tiers a/b |
| Voice-mode auto replies | Swept `cache/audio` (upstream) |
| Explicit `output_path` | Honored after the same validation as upstream `_resolve_output_base` |

## Precedence (a → b → c)

1. **a.** `output_dir` / skill `--output-dir` / `HERMES_GENERATED_OUTPUT_DIR`
2. **b.** `HERMES_SESSION_PROJECT_PATH` = attached Project `primary_path` only (never cwd / git root)
3. **c.** `$HERMES_HOME/cache/generated/{images,videos,audio,files}/`

Pet imagegen: always tier c (`apply_tiers=False`).

short-drama-produce: `--output-dir` wins; default root
`cache/generated/short-drama-produce/`. media-use resolve reads env folder only.

## Session env

`HERMES_SESSION_PROJECT_PATH` is in `gateway/session_context._VAR_MAP` and is
injected into skill subprocesses. TUI sets it from Project `primary_path` on
project workspace apply / session bind.

## AUTO_APPEND

`video_generate` is on the producer allowlist with JSON path fields
`video` / `host_video`. History-path dedupe keeps delivery **exactly once**.

## Validate-first / move-fallback

Validation runs **before** Fal/download/credits. On move failure after a
successful generated save: keep the generated file, return its absolute path,
attach a `warning` in the tool result.

## Absolute stored paths / white-label display-only

- Stored tool JSON / `MEDIA:` / DB = real absolute paths only (never `~`).
  Tool and terminal results stay absolute; secret redaction still runs.
- Paint scrubs every tool surface (title, dump, search snippet, run summary,
  error, toast, tooltip). `MEDIA:` lines become players; the visible prose
  has neither `hermes` nor the literal `MEDIA:`.
- `#media:` hrefs, `MEDIA:` paths, and markdown link destinations are masked
  during brand scrub so the player still loads the file.
- `cache/generated` shell allow is `Path.resolve()` plus `is_relative_to`
  (not a string prefix). Settings and `cache/generated-x` stay blocked.
- `output_dir` (optional folder) is on `image_generate`, `video_generate`,
  and explicit `text_to_speech`. Invalid folders fail before the provider
  call. Voice-mode auto replies stay on swept `cache/audio`.
- White-label scrub (`sanitizeUserFacingBrand` / `displayInstallPath` /
  `brand_scrub.py`) is **render-only**. `resolveMediaDisplaySrc` /
  `readFileDataUrl` always receive the real path first.

## Credential mounts + sweep

`cache/generated` is mounted/synced (age-bounded like upstream). Housekeeping
still sweeps inbound `cache/images|videos|audio` only — not `cache/generated/**`.

## Old generations

Out of scope — no copy/migrate of legacy `cache/images` or `cache/videos`
into `cache/generated/`.

## Conformance

Tests in `tests/agent/test_nia_generated_media.py` cover precedence,
validation-reject-before-Fal, move-fallback, no-tilde, sweep leave-generated,
video AUTO_APPEND once, and writer conformance.
