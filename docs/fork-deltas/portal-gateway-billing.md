# Portal gateway billing

[desktop] Settings billing reads the portal summary. The selected org is sent as `X-OkVevo-Org` by Electron (`hermes:okvevo-billing:get` in `apps/desktop/electron/main.ts`). Chat, Tavily, and Fal submit send the same header from `okvevo_org_headers` (PR #100). A CLI-started gateway is not part of this UI.

## Sponsored bucket (2026-11-26)

`billingViewFromSummary` maps `sponsoredPct` with the same finite 0–100 read as the other percentages. A missing or non-numeric value becomes 0. `fundedBy` is a string or null.

The one-line summary appends ` · sponsored N%` only when `sponsoredPct > 0`.

Settings → Billing adds a third usage bar in that same case. The label is `From ${fundedBy}` when the summary names the super-organisation, and `From super-organisation` when `fundedBy` is null.

Files: `apps/desktop/src/lib/okvevo-billing-listener.ts`, `apps/desktop/src/app/settings/billing/index.tsx`, and their tests.

Check:

```bash
cd apps/desktop && npx vitest run src/lib/okvevo-billing-listener.test.ts src/app/settings/billing/index.test.tsx && npx tsx src/lib/okvevo-billing-listener.selfcheck.ts
```

Screenshot baselines for this row are not in `okvevo-ui-contract.spec.ts-snapshots`. The contract suite does not mock `getOkvevoBilling`.
