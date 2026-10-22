# OkVevo KEEP-PATCH ledger

Hard cap: **3** edits to upstream-owned files. Prefer extension points.

Pinned upstream tag: **v0.22.4**.

## Active

None. Count = **0**.

Identity uses generated `SOUL.md` (`scripts/okvevo/make_soul.py`) plus
`agent.platform_hints.desktop.append`. LLM routing, credits, and media live in
`plugins/okvevo` and `plugins/model-providers/okvevo`.

`install_script.rs` is **not** patched. Customer packs should use
`HERMES_DESKTOP_VARIANT=bundled` (agent-payload in extraResources) instead of
a first-run clone. Unpackaged/dev `bootstrap-runner.ts` still swaps the GitHub
URL to `Jaikarans2003/OkVevo-Nia`.

Root `package-lock.json` is allowed to differ from the tag so the
`apps/desktop` workspace can install `firebase` (billing listener). That is a
packaging lockfile delta, not a Python KEEP-PATCH. Drift skips this one file.

## UI/packaging deltas

`apps/desktop` and `apps/bootstrap-installer` differ from `v0.22.4`. They are
not KEEP-PATCH (fork-owned packaging/UI). `scripts/okvevo/check_upstream_delta.sh`
fails if `git diff --name-only v0.22.4` for either tree does not match the
corresponding list **exactly**.

<!-- okvevo-delta:apps/bootstrap-installer -->
- `apps/bootstrap-installer/public/apple-touch-icon.png`
- `apps/bootstrap-installer/public/nia.png`
- `apps/bootstrap-installer/src-tauri/icons/128x128.png`
- `apps/bootstrap-installer/src-tauri/icons/128x128@2x.png`
- `apps/bootstrap-installer/src-tauri/icons/32x32.png`
- `apps/bootstrap-installer/src-tauri/icons/icon.icns`
- `apps/bootstrap-installer/src-tauri/icons/icon.ico`
- `apps/bootstrap-installer/src-tauri/src/bootstrap.rs`
- `apps/bootstrap-installer/src-tauri/tauri.conf.json`
- `apps/bootstrap-installer/src/styles.css`
<!-- /okvevo-delta:apps/bootstrap-installer -->

<!-- okvevo-delta:apps/desktop -->
- `apps/desktop/THIRD_PARTY_NOTICES.txt`
- `apps/desktop/assets/icon.icns`
- `apps/desktop/assets/icon.ico`
- `apps/desktop/assets/icon.png`
- `apps/desktop/e2e/boot.spec.ts`
- `apps/desktop/e2e/fixtures.ts`
- `apps/desktop/electron-builder.config.cjs`
- `apps/desktop/electron/backend-env.test.ts`
- `apps/desktop/electron/backend-env.ts`
- `apps/desktop/electron/backend-health.test.ts`
- `apps/desktop/electron/backend-health.ts`
- `apps/desktop/electron/bootstrap-runner.ts`
- `apps/desktop/electron/connection-config.test.ts`
- `apps/desktop/electron/main.ts`
- `apps/desktop/electron/okvevo-auth-flow.test.ts`
- `apps/desktop/electron/okvevo-auth-flow.ts`
- `apps/desktop/electron/okvevo-auth-store.test.ts`
- `apps/desktop/electron/okvevo-auth-store.ts`
- `apps/desktop/electron/okvevo-auth.test.ts`
- `apps/desktop/electron/okvevo-auth.ts`
- `apps/desktop/electron/okvevo-build-channel.d.ts`
- `apps/desktop/electron/okvevo-config-migration.test.ts`
- `apps/desktop/electron/okvevo-config-migration.ts`
- `apps/desktop/electron/okvevo-env.test.ts`
- `apps/desktop/electron/okvevo-env.ts`
- `apps/desktop/electron/portal-session.ts`
- `apps/desktop/electron/preload.ts`
- `apps/desktop/electron/remote-lifecycle.ts`
- `apps/desktop/electron/terminal-ipc.ts`
- `apps/desktop/electron/vscode-marketplace.ts`
- `apps/desktop/electron/zoom.ts`
- `apps/desktop/package.json`
- `apps/desktop/product-identity.cjs`
- `apps/desktop/public/apple-touch-icon.png`
- `apps/desktop/public/okvevo-intro.gif`
- `apps/desktop/resources/ffmpeg-licenses/SOURCE-OFFER.txt`
- `apps/desktop/scripts/after-pack.mjs`
- `apps/desktop/scripts/before-pack.mjs`
- `apps/desktop/scripts/build.mjs`
- `apps/desktop/scripts/bundle-electron-main.mjs`
- `apps/desktop/scripts/ci-desktop-version.mjs`
- `apps/desktop/scripts/ci-desktop-version.test.mjs`
- `apps/desktop/scripts/ci-map-pack-env.mjs`
- `apps/desktop/scripts/ci-map-pack-env.test.mjs`
- `apps/desktop/scripts/fetch-ffmpeg.mjs`
- `apps/desktop/scripts/notarize.mjs`
- `apps/desktop/scripts/overlay-brand-assets.mjs`
- `apps/desktop/scripts/prepare-app-icon.mjs`
- `apps/desktop/scripts/publish-release-feed.mjs`
- `apps/desktop/scripts/publish-release-feed.test.mjs`
- `apps/desktop/scripts/require-release-secrets.mjs`
- `apps/desktop/scripts/require-release-secrets.test.mjs`
- `apps/desktop/scripts/resolve-build-channel.mjs`
- `apps/desktop/scripts/resolve-build-channel.test.mjs`
- `apps/desktop/scripts/run-internal-builder.mjs`
- `apps/desktop/scripts/set-exe-identity.mjs`
- `apps/desktop/scripts/sign-windows.mjs`
- `apps/desktop/scripts/smoke-release-feed.test.mjs`
- `apps/desktop/scripts/test-desktop.mjs`
- `apps/desktop/scripts/write-okvevo-pack-env.mjs`
- `apps/desktop/scripts/write-okvevo-pack-env.test.mjs`
- `apps/desktop/src/app/artifacts/artifact-utils.ts`
- `apps/desktop/src/app/artifacts/index.test.ts`
- `apps/desktop/src/app/pet-generate/components/generate-unavailable.test.tsx`
- `apps/desktop/src/app/pet-generate/components/generate-unavailable.tsx`
- `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/message-stream.ts`
- `apps/desktop/src/app/session/hooks/use-model-controls.test.tsx`
- `apps/desktop/src/app/settings/about-settings.test.ts`
- `apps/desktop/src/app/settings/billing/api.test.ts`
- `apps/desktop/src/app/settings/billing/dev-fixtures.ts`
- `apps/desktop/src/app/settings/billing/errors.test.ts`
- `apps/desktop/src/app/settings/billing/index.test.tsx`
- `apps/desktop/src/app/settings/billing/index.tsx`
- `apps/desktop/src/app/settings/billing/use-billing-state.test.ts`
- `apps/desktop/src/app/settings/billing/use-billing-state.ts`
- `apps/desktop/src/app/settings/billing/use-charge-poller.test.ts`
- `apps/desktop/src/app/settings/constants.ts`
- `apps/desktop/src/app/settings/gateway-settings.tsx`
- `apps/desktop/src/app/settings/helpers.test.ts`
- `apps/desktop/src/app/settings/model-settings.tsx`
- `apps/desktop/src/app/settings/okvevo-locked-prefs.ts`
- `apps/desktop/src/app/settings/providers-settings.test.tsx`
- `apps/desktop/src/app/settings/settings-search.test.ts`
- `apps/desktop/src/app/settings/settings-ui-policy.test.ts`
- `apps/desktop/src/app/settings/settings-ui-policy.ts`
- `apps/desktop/src/app/shell/model-catalog-menu.test.tsx`
- `apps/desktop/src/app/shell/model-catalog-menu.tsx`
- `apps/desktop/src/app/shell/model-menu-panel.tsx`
- `apps/desktop/src/app/shell/titlebar-controls.tsx`
- `apps/desktop/src/app/shell/titlebar.ts`
- `apps/desktop/src/components/assistant-ui/thread/assistant-message.test.tsx`
- `apps/desktop/src/components/assistant-ui/thread/assistant-message.tsx`
- `apps/desktop/src/components/assistant-ui/tool/fallback-model.test.ts`
- `apps/desktop/src/components/boot-failure-overlay.test.tsx`
- `apps/desktop/src/components/boot-failure-overlay.tsx`
- `apps/desktop/src/components/chat/intro-copy.jsonl`
- `apps/desktop/src/components/chat/intro.test.tsx`
- `apps/desktop/src/components/chat/intro.tsx`
- `apps/desktop/src/components/chat/wordmark.tsx`
- `apps/desktop/src/components/desktop-install-overlay.test.tsx`
- `apps/desktop/src/components/desktop-install-overlay.tsx`
- `apps/desktop/src/components/onboarding/index.test.tsx`
- `apps/desktop/src/components/onboarding/index.tsx`
- `apps/desktop/src/components/onboarding/providers.tsx`
- `apps/desktop/src/components/pane-shell/tree/store.ts`
- `apps/desktop/src/components/send-diagnostics-dialog.tsx`
- `apps/desktop/src/components/version-details.tsx`
- `apps/desktop/src/global.d.ts`
- `apps/desktop/src/i18n/en.ts`
- `apps/desktop/src/lib/build-channel.ts`
- `apps/desktop/src/lib/model-options.test.ts`
- `apps/desktop/src/lib/model-status-label.test.ts`
- `apps/desktop/src/lib/model-status-label.ts`
- `apps/desktop/src/lib/okvevo-billing-listener.selfcheck.ts`
- `apps/desktop/src/lib/okvevo-billing-listener.test.ts`
- `apps/desktop/src/lib/okvevo-billing-listener.ts`
- `apps/desktop/src/lib/okvevo-firebase.ts`
- `apps/desktop/src/lib/product.ts`
- `apps/desktop/src/lib/provider-branding.test.ts`
- `apps/desktop/src/lib/provider-branding.ts`
- `apps/desktop/src/lib/user-facing-error.ts`
- `apps/desktop/src/main.tsx`
- `apps/desktop/src/plugins/hermes-bots/chat-empty.test.tsx`
- `apps/desktop/src/plugins/hermes-bots/data.identity.test.ts`
- `apps/desktop/src/plugins/hermes-bots/data.ts`
- `apps/desktop/src/plugins/hermes-bots/group-chat.test.ts`
- `apps/desktop/src/plugins/hermes-bots/group-chat.ts`
- `apps/desktop/src/plugins/hermes-bots/group-rounds.ts`
- `apps/desktop/src/plugins/hermes-bots/labels.ts`
- `apps/desktop/src/plugins/hermes-bots/model-picker.test.tsx`
- `apps/desktop/src/plugins/hermes-bots/model-picker.tsx`
- `apps/desktop/src/plugins/hermes-bots/relay.test.ts`
- `apps/desktop/src/plugins/hermes-bots/routing.test.ts`
- `apps/desktop/src/plugins/hermes-bots/row-helpers.test.ts`
- `apps/desktop/src/plugins/hermes-bots/skills-hub-picker.test.tsx`
- `apps/desktop/src/plugins/hermes-bots/skills-hub.tsx`
- `apps/desktop/src/plugins/hermes-bots/soul.test.ts`
- `apps/desktop/src/sdk/index.ts`
- `apps/desktop/src/store/notifications.ts`
- `apps/desktop/src/store/okvevo-auth.test.ts`
- `apps/desktop/src/store/okvevo-auth.ts`
- `apps/desktop/src/store/onboarding.ts`
- `apps/desktop/src/store/profile-share.test.ts`
- `apps/desktop/src/store/reactions-enabled.ts`
- `apps/desktop/src/store/statusbar-prefs.ts`
- `apps/desktop/src/store/zoom.ts`
- `apps/desktop/src/styles.css`
- `apps/desktop/src/themes/backend-sync.test.ts`
- `apps/desktop/src/themes/context.tsx`
- `apps/desktop/src/themes/presets.test.ts`
- `apps/desktop/src/themes/presets.ts`
- `apps/desktop/src/themes/request.test.tsx`
- `apps/desktop/src/vite-env.d.ts`
- `apps/desktop/vite.config.ts`
- `apps/desktop/vitest.config.ts`
<!-- /okvevo-delta:apps/desktop -->

## Retired

None yet.
