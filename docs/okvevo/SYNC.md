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

Gitleaks: `docs/okvevo/gitleaks-baseline.json` is a native `gitleaks detect
--redact` report of findings already in history (upstream `v0.22.4` plus
OkVevo snapshot commits). CI fails only on findings not in that file. Do not
re-serialize the JSON with Python — gitleaks matches on entropy/message
equality, not fingerprint. To refresh after a known false positive that is
already in git history:

```bash
gitleaks detect --source . --log-opts="v0.22.4" --report-path /tmp/gitleaks-up.json --report-format json --redact --exit-code 0
gitleaks detect --source . --log-opts="v0.22.4..HEAD" --report-path /tmp/gitleaks-ok.json --report-format json --redact --exit-code 0
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

R2: do not mkdir prefixes or upload `.keep`. `okvevo/staging/` and
`okvevo/stable/` appear on the first installer upload from our pack/publish
workflows (`RELEASES_S3_*`). Leave existing `nia/` objects alone.

Do **not** `git revert` an upstream merge. Redeploy the previous R2 build and
fix forward.

Optional: `git config rerere.enabled true` in this clone so desktop conflict
resolutions replay (do not run that from CI; it is a local clone setting).

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
