# Syncing Hermes upstream into OkVevo-Nia

Push target is always `okvevo` (`Jaikarans2003/OkVevo-Nia`). Never `origin`.

```bash
git fetch origin --tags
# inspect the new tag, then:
git merge vX.Y.Z
bash scripts/okvevo/check_upstream_delta.sh vX.Y.Z
python3 scripts/okvevo/check_branding.py
```

If drift fails, either move the change into an OkVevo-owned path or add a
KEEP-PATCH in `docs/okvevo/PATCHES.md` (cap 3).

## Cadence and merge rules

- Sync every Hermes release, and at least every 2 weeks when no release tag
  landed (merge the newest tag; never an untagged `origin/main`).
- `git merge` the tag. Do not rebase the OkVevo branch onto it.
- Each sync is its own PR into `staging`. It merges only when all of these are
  green: the OkVevo parity and desktop E2E suite (`okvevo-desktop-pack.yml`,
  `e2e/okvevo`), `scripts/okvevo/check_branding.py`, the Nous-diff scan below,
  `scripts/okvevo/check_vendor_keys.py`, and the vendor-host guard
  (`e2e/okvevo/vendor-guard.ts`).
- Every sync reads `docs/okvevo/UPSTREAM-KNOWN-ISSUES.md` and
  `docs/okvevo/WORKAROUNDS.md`. For each workaround: is the upstream issue
  closed, or is the fix in the release notes? Run its behavior test with the
  toggle off. If Hermes passes, recommend removing ours (set Applied-Upstream,
  delete the code). If ours is clearly better, keep it and write down why.
  Karan decides.
- If an upstream sync changes the help-guidance text overridden by
  `plugins/okvevo/identity.py` (`HERMES_AGENT_HELP_GUIDANCE` / `_NO_SKILLS`),
  take upstream's change, then re-apply the OkVevo wording from
  `okvevo/config/identity.json`. The identity seam test
  (`plugins/okvevo/tests/test_identity.py`) must pass before merging.
- **Icon / BrandMark pack hooks** (`apps/desktop/scripts/before-build.mjs`,
  `after-pack.mjs` `restoreLegacyMacIcon`, `set-exe-identity.mjs`,
  `electron-builder.config.cjs` NSIS/DMG icons / DMG layout helper, `brand-mark.tsx`):
  on conflict, take upstream, then re-apply the OkVevo one-line hook / brand path
  helper (`okvevo-brand-paths.mjs` / `overlayBrandAssets` / `okvevo-dmg-layout.mjs`).
  Before merge, every sync PR must pass: `ci-assert-packaged-icons.mjs` (Mac +
  Windows), `ci-assert-dmg-layout.mjs`, packed `@okvevo` mention E2E
  (`e2e/okvevo/packed-mention-menu.spec.ts` only — not packed-chat/signin),
  About-version / `HERMES_PAYLOAD_VERSION` stamp, and UI-CONTRACT visual baselines.
- `check_upstream_delta.sh` prints the patch budget (desktop / installer /
  other). A new desktop or installer entry in PATCHES.md needs a one-line
  reason: ``- `path` — why``.

Gitleaks: `docs/okvevo/gitleaks-baseline.json` is a native `gitleaks detect
--redact` report of findings already in history (upstream `v0.23.0` plus
OkVevo snapshot commits). CI fails only on findings not in that file. Do not
re-serialize the JSON with Python — gitleaks matches on entropy/message
equality, not fingerprint. To refresh after a known false positive that is
already in git history:

```bash
gitleaks detect --source . --log-opts="v0.23.0" --report-path /tmp/gitleaks-up.json --report-format json --redact --exit-code 0
gitleaks detect --source . --log-opts="v0.23.0..HEAD" --report-path /tmp/gitleaks-ok.json --report-format json --redact --exit-code 0
# concatenate the two JSON arrays without rewriting objects, then commit.
```

After merge, list new upstream workflows:

```bash
git diff --name-only --diff-filter=A <old-tag> <new-tag> -- .github/workflows
```

Disable Nous-only publish/release workflows with `gh workflow disable <name>`
(`--repo Jaikarans2003/OkVevo-Nia`). Do not edit those YAML files.

Also disable every remaining workflow that `runs-on: blacksmith-*` (CI, Tests,
Lint, Nix, JS Tests, …). OkVevo-Nia has no Blacksmith runners; those jobs
queue forever. Do not KEEP-PATCH the runner labels. Required checks stay the
OkVevo jobs on `ubuntu-latest` / `macos-latest` / `windows-latest`.

### Disabled workflows (OkVevo-Nia)

`gh workflow disable` state on `Jaikarans2003/OkVevo-Nia`, checked 2026-11-10 with
`gh workflow list --all`. Re-check after every sync; a new Nous workflow that
runs on `blacksmith-*` or publishes for Nous is disabled the same way.

- Blacksmith runners (queue forever here): `ci-review-comment.yml` (CI review comment), `ci.yaml` (CI), `contributor-check.yml` (Contributor Attribution Check), `deploy-site.yml` (Deploy Site), `docker-lint.yml` (Docker / shell lint), `docker.yml` (Docker Build, Test, and Publish), `docs-site-checks.yml` (Docs Site Checks), `e2e-desktop.yml` (E2E Desktop), `history-check.yml` (History Check), `infographic-check.yml` (Infographic Check), `js-autofix.yml` (auto-fix lint issues & formatting), `js-tests.yml` (JS Tests), `label-rerun.yml` (Label rerun), `lint.yml` (Lint (ruff + ty)), `lockfile-diff.yml` (Lockfile diff), `nix.yml` (Nix flake check), `plugin-catalog-ci.yml` (Plugin Catalog CI), `profile-artifact-check.yml` (Profile Artifact Boundary), `rust-tests.yml` (Rust tests), `skills-index-freshness.yml` (Skills Index Freshness Check), `skills-index.yml` (Build Skills Index), `supply-chain-audit.yml` (Supply Chain Audit), `termux-verify.yml` (Termux verification), `tests-os.yml` (OS-specific tests), `tests.yml` (Tests), `uv-lockfile-check.yml` (uv.lock check), `windows-venv-e2e.yml` (Windows venv-holder live E2E). `plugin-catalog-ci.yml` disabled 2026-11-10 after the v0.23.0 sync (PR #76 showed it queued).
- Nous-only jobs (Nous registries, sandboxes, installers): `install-e2e-run.yml` (Install & Update E2E (reusable)), `install-e2e.yml` (Install & Update E2E), `pm-bundle.yml` (PM Bundle), `sandbox-image.yml` (Sandbox desktop image), `windows-bundle-sdk.yml` (Windows bundle SDK).
- Retired OkVevo / fork workflows (YAML removed, kept disabled): `desktop-pack.yml` (Desktop pack (reusable)), `desktop-preview.yml` (Desktop preview (artifacts only)), `desktop-production.yml` (Desktop production), `desktop-publish.yml` (Publish release), `desktop-staging.yml` (Desktop staging), `installer-tests.yml` (Installer tests), `nia-dep-audit.yml` (Nia dependency audit), `publish-e2e-evidence.yml` (Publish E2E evidence), `review-labels.yml` (Review labels).

R2: do not mkdir prefixes or upload `.keep`. `okvevo/staging/` and
`okvevo/stable/` appear on the first installer upload from our pack/publish
workflows (`RELEASES_S3_*`). Leave existing `nia/` objects alone.

Do **not** `git revert` an upstream merge. Redeploy the previous R2 build and
fix forward.

Required on the clone that does the merge: `git config rerere.enabled true`, so
desktop conflict resolutions replay on the next sync. It is a local clone
setting; do not run it from CI.

## PATCHES conflict stop

If `docs/okvevo/PATCHES.md` conflicts, stop. Keep every OkVevo row. Do not
delete a delta to get a clean merge, and do not edit upstream Python to make
`scripts/okvevo/check_upstream_delta.sh` pass. Re-apply the OkVevo side, then
run the delta script against the tag you just merged.

## Nous-diff scan

After the merge, list Nous hosts in the new tag and match each one to
`docs/okvevo/NOUS-TOUCHPOINTS.md`. A hit that is not in that file, and is not
switched off by `okvevo/config/okvevo-defaults.yaml`, is a stop.

```bash
git grep -n -E 'nousresearch\.com|hermes-sandbox' vX.Y.Z -- '*.py' '*.ts' '*.tsx' '*.yml' '*.yaml'
```

Do not edit the upstream file to delete the string. Switch it off from
OkVevo config, `isByokChromeVisible()`, or an OkVevo plugin, then record the
row.

## UI contract (every sync and every OkVevo UI change)

See `docs/okvevo/UI-CONTRACT.md`.

On every upstream sync:

1. Re-apply everything in `UI-CONTRACT.md`.
2. List every new or changed upstream screen with screenshots.
3. Brand each new screen via tokens + overrides before merging.
4. Visual tests green, or diffs explicitly approved before baseline update.

On every OkVevo UI change (yours, not only syncs): same four rules — tokens, OkVevo-owned paths / PATCHES.md, inventory row, baselines in the same PR.

