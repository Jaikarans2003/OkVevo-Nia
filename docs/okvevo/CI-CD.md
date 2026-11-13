# OkVevo desktop CI/CD (operators)

Canonical product flow (also in `.cursor/rules/okvevo-cicd.mdc`):

```
feature/fix branch
 → PR into staging (Desktop staging packs okvevo/staging/)
 → PR staging → main
 → annotated tag vX.Y.Z on okvevo/main tip
 → OkVevo desktop production (archives under okvevo/stable + versions/{ver}/)
 → Actions “Publish release” (customer pointers)
 → users
```

Never push directly to `staging` or `main`. Never push to Nous `origin`.

## Feeds

| Audience | Feed URL |
|----------|----------|
| Team / staging | `https://releases.okvevo.com/okvevo/staging` |
| Customers | `https://releases.okvevo.com/okvevo/stable` (app); Publish also writes root stable names + root `latest*.yml` |

## Unsigned beta

Repository variable `PROD_ALLOW_UNSIGNED=1` allows production packs without certs. Staging always allows unsigned. Remind testers: Mac in-app update will not complete unsigned; Windows may hit SmartScreen — re-download from `/okvevo-download`.

Unset `PROD_ALLOW_UNSIGNED` before the first **signed** public launch.

## FFmpeg Windows mirror

Cold Windows packs fetch the pinned LGPL zip from R2:

`https://releases.okvevo.com/deps/ffmpeg/ffmpeg-n8.1.3-16-ge0a878dd70-win64-lgpl-8.1.zip`

(+ `.sha256` sidecar). Override with `OKVEVO_FFMPEG_MIRROR` if needed. Do not rewrite the upstream `BTBN.url` pin in `fetch-ffmpeg.mjs`. Actions cache is speed only.

One-shot upload (uses repo `RELEASES_S3_*` secrets): workflow **Upload FFmpeg R2 mirror** (`okvevo-upload-ffmpeg-mirror.yml`).

## Publish hard-gate check

`okvevo-desktop-publish.yml` fails if any open `### [ ]` remains under `## Hard gates (block go-live)` in `PRE-LIVE-BACKLOG.md`.

## Fix-forward rollback (v0.1.0 → v0.1.1)

Same as `docs/okvevo/INSTALL-GUIDE.md`:

1. Branch → PR → `staging` → green Desktop staging + team smoke.
2. PR `staging` → `main` (yes required).
3. Tag `v0.1.1` on `okvevo/main` tip; push `okvevo` only (yes required).
4. Wait for production archive job.
5. Karan: Actions → **Publish release** → version `0.1.1`.
6. Smoke root + `okvevo/stable` `OkVevo-*` and `latest*.yml` over HTTPS.
7. Tell testers to re-download (unsigned) or update (once signed).

Do not rely on numeric downgrade via the updater.
