# Desktop parity — pre-upstream-reset vs this branch

Compared `pre-upstream-reset` (`91d272a0cc0`, this repo only) with the current desktop tree. Status is behavior. `manage_bot` is the stopped row.

| Feature | Old file(s) | New file(s) | Status | Test |
| --- | --- | --- | --- | --- |
| Sign-in, sign-out, token refresh. Scheme stays `hermes://`. | `apps/desktop/electron/okvevo-auth.ts` | `apps/desktop/electron/okvevo-auth.ts` | present | `electron/okvevo-auth.test.ts` (`hermes://auth-callback`). Manual: TESTING.md step 2 |
| Portal origin follows the build channel | pack env + `okvevo-env.ts` | `apps/desktop/electron/okvevo-env.ts`, `apps/desktop/scripts/ci-map-pack-env.mjs` | present | `electron/okvevo-env.test.ts`, `scripts/ci-map-pack-env.test.mjs` |
| Credits %, plan and top-up links, Firestore snapshot | billing listener | `apps/desktop/src/lib/okvevo-billing-listener.ts` | present | `src/lib/okvevo-billing-listener.test.ts`. Manual: TESTING.md step 2 |
| Model picker locked to the OkVevo router | `plugins/okvevo` | `plugins/okvevo/provider_profile.py`, desktop model menu | present | `plugins/okvevo/tests/test_provider_profile.py` (`test_registered_with_auto_fallbacks`). `src/lib/model-status-label.test.ts` |
| 401 “session expired”, 402 “out of credits” | portal errors | `plugins/okvevo/provider_profile.py` | present | `plugins/okvevo/tests/test_provider_profile.py` (`test_401_maps_to_auth`, `test_402_maps_to_billing_copy`). Manual: TESTING.md step 9 |
| Hidden settings by build channel (API keys, provider picker, Nous Portal, pet) | settings policy | `apps/desktop/src/app/settings/settings-ui-policy.ts` | present | `src/app/settings/settings-ui-policy.test.ts`. Manual: TESTING.md step 3 |
| Bots UI: create, edit, delete, group, bot-to-bot | desktop bots plugin | `apps/desktop/src/plugins/hermes-bots/` | present | `data.identity.test.ts`, `group-chat.test.ts`, `routing.test.ts`. Manual: TESTING.md step 10 |
| `manage_bot` from chat | old fork tool | not ported | missing | Stopped. TESTING.md “manage_bot is not on this branch”. Open RELEASE BLOCKER in `PRE-LIVE-BACKLOG.md`. Publish workflow greps that checkbox |
| Theme, zoom, wake locks, intro gif, onboarding | locked prefs, intro | `settings-ui-policy.ts`, `src/components/chat/intro.tsx` | present | `settings-ui-policy.test.ts` (`applyLockedDesktopPrefs`, wake lock). `src/components/chat/intro.test.tsx` |
| Image, video, and web search through the portal | `plugins/okvevo` | `plugins/okvevo/` | present | `plugins/okvevo/tests/test_media_providers.py`, `test_web_provider.py`. Manual: TESTING.md step 8 |
| Auto-update feed URL | was missing after the reset | `apps/desktop/scripts/okvevo-feed-urls.mjs`, `electron/okvevo-feed.ts` | present | `scripts/okvevo-feed-urls.test.mjs`, `electron/okvevo-feed.test.ts`, `scripts/publish-release-feed.test.mjs`. Pack asserts the baked URL equals `https://releases.okvevo.com/` plus the uploaded folder. Manual: TESTING.md step 14 |
| About: company line and Hermes attribution | About panel | `apps/desktop/electron/okvevo-about.ts`, `electron/main.ts` | present | `electron/okvevo-about.test.ts`. Manual: TESTING.md step 1 |
| Bundled agent inside the app | stamp `payload: bundled` | `okvevo-desktop-pack.yml` prepare step, `ci-assert-bundled-pack.mjs` | present | Pack fails unless `install-stamp.json` says `bundled` and `Resources/agent-payload` exists. Manual fresh-DMG chat is TESTING.md step 1 |
