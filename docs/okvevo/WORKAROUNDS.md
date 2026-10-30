# OkVevo changes against Hermes: features vs workarounds

Every change we carry against Hermes is one of two kinds. Read this on every
upstream sync (`docs/okvevo/SYNC.md`).

## OkVevo features (permanent, no toggle)

Sign-in, billing and credits, the vendor proxy, branding, managed settings
(reconciliation in `apps/desktop/electron/okvevo-config-migration.ts` and the
agent guard in `plugins/okvevo/managed_settings_guard.py`), portal error codes
(`vendor_rejected`, `vendor_unavailable`), and the Fal ops alert.

Every path in the `docs/okvevo/PATCHES.md` desktop and installer lists is
product or packaging (auth, billing, brand, feed, settings visibility, config
migration). That includes `apps/desktop/electron/main.ts`. Those are features,
not workarounds: a sync must not treat them as temporary or delete them because
upstream changed nearby.

## Workarounds (temporary)

Our stand-in for a Hermes bug or gap. Each one:

- lives in its own OkVevo-owned file with a DEP-3 header, and joins upstream
  code with the smallest hook (ideally one line);
- has a toggle `okvevo.workarounds.<id>` in `okvevo/config/okvevo-defaults.yaml`,
  default `true`; `false` is pure Hermes behavior;
- has a behavior test that runs with the toggle on and off.

When a sync finds the upstream issue closed or the fix in the release notes:
set the toggle off, run the behavior test. If Hermes passes, set
Applied-Upstream, delete the file, the hook line, the toggle, and the PATCHES.md
entries. If ours is clearly better, keep it and write down why here.

CI (`scripts/okvevo/check_workarounds.py`) warns, never fails, when a Bug issue
below is closed or Last-Update is older than 60 days.

| Id | Description | Bug | Forwarded | Applied-Upstream | Last-Update |
| --- | --- | --- | --- | --- | --- |
| groups_all_profiles | Bots group list asks `groups.list` on every local profile once the gateway is open, not only the foreground one. Files: `apps/desktop/src/plugins/hermes-bots/okvevo-groups-all-profiles.tsx` (+ `.test.tsx`); hook: the import line in `roster-pane.tsx` | none filed (draft below); related, different: https://github.com/NousResearch/hermes-agent/issues/139002 | no | no | 2026-10-30 |
| event_loop_block_stack | A worker reads the main-process JS stack while it is blocked ≥5 s (in-process inspector session, no port) and writes it to the local log. Files: `apps/desktop/electron/okvevo-block-stack.ts` (+ `.test.ts`); hook: one call in the OkVevo block of `main.ts` | https://github.com/NousResearch/hermes-agent/issues/139959 https://github.com/NousResearch/hermes-agent/issues/144503 | no | no | 2026-10-30 |

## Draft upstream issue: groups_all_profiles (not filed)

Karan reviews this first. If he files it, put the issue URL in the Bug and
Forwarded columns above.

**Title:** Desktop group list only shows rooms saved on the foreground profile

**Repro**

1. Create local profiles CFO and CMO.
2. With CFO in front, create a group named "CMO, CFO, CEO".
3. Quit the app and open it again with another profile in front.
4. Open the Bots group list.

**Expected:** the group is still listed. It was not deleted.

**Actual:** the list is empty for the profile now in front. The only way to see
a group is to create a new one. The room is still in that profile's database.

**Evidence (2026-10-30)**

- `~/.hermes/profiles/cfo/state.db` hosted room `d2e61ed5-daa0-464d-a1ca-d251193bc38a`, name "CMO, CFO, CEO", `disbanded_at` null.
- `~/.hermes/profiles/cmo/state.db` hosted room `c1753c33-b0d7-4005-ad64-2a986daf33fc`, name "CMO, CEO", `disbanded_at` null.
- The default profile and the CEO profile have no hosted rooms.
- `CanonicalGroupList` asks `groups.list` for the foreground profile only. It does not ask the other local profiles.
