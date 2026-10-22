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

Do **not** `git revert` an upstream merge. Redeploy the previous R2 build and
fix forward.

Optional: `git config rerere.enabled true` in this clone so desktop conflict
resolutions replay (do not run that from CI; it is a local clone setting).
