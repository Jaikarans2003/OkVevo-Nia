# PR 1.3 root-cause — fresh-install sign-in, default-bot label, identity

Repro date: 2026-11-01, macOS arm64, packed staging `OkVevo.app` 0.0.13
(commit `1c0e005856`, staging run 13). Clean state: `~/.hermes` +
`~/Library/Application Support/OkVevo` moved aside and relaunched.
Evidence: `/tmp/pr13-repro/` (desktop.log, agent.log, gateway.log) and the
live pool/profile state captured during the repro.

---

## Item 1 — fresh-install sign-in leaves chat with no credential

### What happened (timeline from the logs)

| Time | Event |
|---|---|
| 19:48:35 | Default gateway (pid 10572) starts. `plugins/okvevo.register()` calls `ensure_okvevo_pool_entry()`; no ID token on disk yet → no-op. Root `~/.hermes/auth.json` `credential_pool.okvevo` stays `null`. |
| 19:52:38 | `[okvevo-auth] opened login` |
| 19:52:46 | `[okvevo-auth] signed in` — token + refresh-token files written. `_writeOkvevoIdTokenFile` runs `_resetOkvevoCredentialCooldowns()`. |
| 19:53:17 | Chat → `agent.credential_pool: no available entries` → `Model resolution failed … No usable credentials found for provider 'okvevo'` (`runtime_provider.py:904`). |
| 20:21:19 | App relaunched. Gateway pid 10572 is **reused** (detached owner; `gateway.pid` handshake, `[backend] Hermes gateway is ready` in <1 s). Pool still `null`. |
| 20:21:41 | Chat **still fails** with the same error. |
| 20:22:49 | `ceo-testing` bot created. New profile's plugin load runs `ensure_okvevo_pool_entry()` → writes the OAuth row into `profiles/ceo-testing/auth.json` (`source=manual:okvevo-desktop`, `has_access_token=true`). |
| 20:23:11 | `ceo-testing` chat **succeeds** — `okvevo client created from provider profile` + `API call #1 … okvevo/auto-cost … total=16432`. |

### Root cause

Two independent facts combine:

1. **`hermes auth reset okvevo` cannot create the pool entry.**
   `auth_reset_command` (`hermes_cli/auth_commands.py:597`) only calls
   `load_pool(provider).reset_statuses()` on entries that already exist. The
   sign-in path (`main.ts:_resetOkvevoCredentialCooldowns`, :7708) shells out
   to `hermes auth reset okvevo` for the root + every profile, and that CLI
   path never loads plugins (plugin discovery is wired only on the
   dashboard/serve path), so `ensure_okvevo_pool_entry()` never runs. The
   entry + `OKVEVO_API_KEY` process env are created only by
   `plugins/okvevo.register()` at a **backend startup**, or by
   `OkvevoProfile.create_client` / `build_client_kwargs_extras` — which run
   only *after* credential resolution has already succeeded. Chicken-and-egg.

2. **Chat and the model catalog resolve OkVevo through the *api-key ladder*,
   not the pool.** `okvevo` is a registry `api_key` provider
   (`plugins/model-providers/okvevo`), so `_ladder_rungs` reaches
   `_api_key_provider_runtime` (`runtime_provider.py:890`), which calls
   `resolve_api_key_provider_credentials` → `_resolve_api_key_provider_secret`
   (`hermes_cli/auth.py:376`). That ladder checks `model.key_env`, then
   `OKVEVO_API_KEY` env (stripped by design — `stripOkvevoApiKeyCopies`), then
   the **root** credential pool (`auth.json`). Root pool is empty ⇒
   `AuthError("No usable credentials … Set OKVEVO_API_KEY")` at
   `runtime_provider.py:904`.

   The bot's chat succeeded because it took a *different* rung: multiplex
   `route_runtime` → `resolve_runtime_with_fallback` reached
   `_resolve_from_pool` (`runtime_provider.py:689`), which does
   `load_pool("okvevo")` **per call** and reads `profiles/ceo-testing/auth.json`
   (the row the new profile just wrote). `OkvevoProfile.create_client` then
   hands the OpenAI client an `api_key` **callable** that re-reads the token
   file per request — so the wire token is always fresh.

**Ours, not upstream.** Upstream v0.22.4 handles late-appearing credentials
fine because its pool read (`load_pool`) happens per call and `hermes auth add`
writes into a pool the running gateway already re-reads. Our token-file design
bypassed the pool for the *default* chat path, so nothing was on disk for the
root until a new backend/profile spawned.

**Born in PR 69** (`feat/okvevo-auth-models-fix`): stripping `OKVEVO_API_KEY`
from `.env` + moving to the token file left no credential the api-key resolver
can see post-sign-in. Its commit `1487932920` ("Stripping OKVEVO_API_KEY left
the packed app with no string key, so the first chat never left the machine")
documents the hole; its fix (env exposure inside `ensure_okvevo_pool_entry`)
only fires at plugin load / client creation.

### Restart does NOT heal (key repro finding)

The detached default gateway survives `Cmd+Q`. Relaunch reuses it, the pool is
still empty, and chat fails again (20:21:41). The plan's "quit/reopen heals"
assumption is **false** on this build — only creating a bot (a new profile
backend) writes the pool entry. This is why "everything healed at once" in the
field: the first bot creation unblocked the shared on-disk pool, and the next
per-call `load_pool` on the bot's path succeeded.

### Model menu shows only Auto — same cause

`fetch_models` (`plugins/model-providers/okvevo/__init__.py:180`) needs a token
via `ensure_okvevo_id_token() or api_key`. The renderer invalidates
`['model-options']` on sign-in flip (`src/store/okvevo-auth.ts:27-29`) and
force-refetches on an Auto-only list (`src/lib/model-options.ts:140-148` +
`model-catalog-menu.tsx:289-301`). But the live catalog fetch resolves the
credential through the same empty api-key ladder ⇒ returns `None` ⇒ the
renderer keeps the Auto fallback rows. No separate negative cache; it is the
same missing-credential root.

---

## Item 3 — default bot label flips to "default"

### What happened

- Before any bot: `bot-roster` snapshot `rows=[local/default=""]` → roster shows **OkVevo agent** (correct).
- After creating `ceo-testing`: snapshot becomes `rows=[local/ceo-testing="" local/default="default"]` → default now shows **"default"**.

### Root cause

`displayName()` (`apps/desktop/src/plugins/hermes-bots/labels.ts:56`) lets a
profile `display_name` beat the "OkVevo agent" fallback (:70-73). The default
profile's `display_name` is **never persisted** — `~/.hermes/profile.yaml` does
not exist (verified). It is **synthesized at read time** by
`gateway/session_group_controls.py:_profiles`:

- line 403 builds the default row from `_profile_info(...).display_name or ''` (empty pre-bot → falls through to "OkVevo agent");
- but for the multiplex/hosted-room sibling path, `discovered()` (line 424-432) defaults `entry['display_name'] = configured` (the profile id) and line 432 overwrites it from the profile's yaml meta.

When the second profile was created, the gateway became a multiplexer
(`gateway_multiplex_mode.py` wrote `gateway.multiplex_profiles: true` at
20:22:49) and began serving `ceo-testing`; the roster read path started
returning the synthesized `display_name: 'default'` for the default row, which
`labels.ts` then preferred over "OkVevo agent".

This is an **upstream** writer (`session_group_controls.py`), so per the plan
the `labels.ts` guard ships as a **DEP-3 workaround**: treat a
`display_name`/`title` equal (case-insensitive) to the profile id as "no real
name" → fall through to "OkVevo agent".

---

## Item 4/B — bot says "Hermes"

Two independent leaks, both confirmed in code:

1. **Post-launch bots keep the upstream SOUL.** `provisionOkvevoProfile`
   (`apps/desktop/electron/okvevo-config-migration.ts:676-693`) writes config
   only, **no SOUL**. Bots created after launch get the upstream scaffolded
   SOUL ("You are Hermes Agent, built by Nous Research…"). Bots existing at
   boot are covered by `migrateOkvevoHermesHome`; only post-launch creation is
   broken. Fix: extend `provisionOkvevoProfile` to also run `migrateSoul` with
   `makeOkvevoSoul(UPSTREAM_SOUL)`.

2. **`HERMES_AGENT_HELP_GUIDANCE(_NO_SKILLS)` leaks into every session.**
   `agent/system_prompt.py:751` appends `HERMES_AGENT_HELP_GUIDANCE_NO_SKILLS`
   unconditionally, and swaps in `HERMES_AGENT_HELP_GUIDANCE` when the
   `hermes-agent` skill is present (constants at `agent/prompt_builder.py:170`,
   :181). Both say "You run on Hermes Agent (by Nous Research)…
   hermes-agent.nousresearch.com". **B.1 verdict stands: v0.22.4 has no
   supported replace/suppress mechanism** (no config gate, no plugin hook; the
   documented env var is never read). So B.2 applies: a plugin-load monkeypatch
   override as a DEP-3 workaround (`plugins/okvevo/identity.py`).

`@hermes` is the default profile's protocol handle (`tools/bot_mode_probe.py`);
per the locked decision it stays allowlisted as an internal protocol name —
the PR 2 backlog tracks showing the default bot as `@okvevo` to users at the
display layer only.
