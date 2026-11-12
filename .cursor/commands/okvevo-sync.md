# Sync upstream Hermes

Run from `hermes-agent/`. Push only `okvevo`. Never `origin`.

1. `git fetch origin --tags`
2. Read the new tag. Do not merge it until the delta is understood.
3. `git merge vX.Y.Z`
4. If `docs/okvevo/PATCHES.md` conflicts, stop. Keep every OkVevo row. Do not edit upstream Python to make the conflict go away.
5. `bash scripts/okvevo/check_upstream_delta.sh vX.Y.Z`
6. `python3 scripts/okvevo/check_branding.py`
7. `python3 scripts/okvevo/check_vendor_keys.py`
8. Scan the new tag for Nous hosts and match each hit to `docs/okvevo/NOUS-TOUCHPOINTS.md`:

```bash
git grep -n -E 'nousresearch\.com|hermes-sandbox' vX.Y.Z -- '*.py' '*.ts' '*.tsx' '*.yml' '*.yaml'
```

9. Rebrand any new user-facing string. Leave wire ids (`~/.hermes`, `hermes` CLI, `hermes://`) alone.
10. Ask before commit, push, or merge.
