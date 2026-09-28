# Fork deltas — computer_use (staging only)

**Scope:** deltas present on current `staging` tip. Do **not** copy the parked-branch ledger from `computer-use-upstream-sync` (cua-driver 0.28.2 pin, tools_config split, schema byte-freeze, etc. are **not** on staging).

---

### Shipped-default aux-vision skip

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `agent/image_routing.py` (`_explicit_aux_vision_override` — Nia block comparing to `DEFAULT_CONFIG` auxiliary.vision) |
| **What** | Packaged default vision provider/model is **not** treated as an explicit user override |
| **Why** | Native main-model vision still wins for attaches when supported; packaged defaults must not force aux path |
| **Re-apply** | After taking upstream `image_routing.py`, re-insert the DEFAULT_CONFIG comparison block |
| **Check** | Unit tests covering `_explicit_aux_vision_override`; packaged vision routing smoke |

### computer_use vision_routing delegates to agent

| Field | Value |
|-------|-------|
| **Tags** | `[agent]` |
| **Files** | `tools/computer_use/vision_routing.py` (`_explicit_aux_vision_override` body → `agent.image_routing._explicit_aux_vision_override`) |
| **What** | Single SoT for “explicit aux vision” including the Nia shipped-default skip |
| **Why** | Capture path and attach path must agree |
| **Re-apply** | Replace any inlined upstream helper with the delegation |
| **Check** | Import + call agreement with `image_routing`; computer_use unit tests if present |

### Not on staging (parked elsewhere)

- `PINNED_CUA_DRIVER_VERSION = "0.28.2"`
- Upstream computer_use / tools_config split snapshot
- Schema description byte-freeze / S3 routing scanner from parked branch

When those land in a future plan, extend this file in the same commit.
