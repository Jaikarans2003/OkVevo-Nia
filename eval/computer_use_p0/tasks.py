"""D7 / bake-off / baseline prompts. WhatsApp text always uses TEST_CONTACT only."""

from __future__ import annotations

from typing import Any

AUTO_MODEL = "okvevo/auto-cost"

# Request aliases. The HTTP response model is the one that actually ran.
ALIAS_MODELS = frozenset(
    {
        "okvevo/auto-cost",
        "okvevo/auto-intelligence",
        "openrouter/auto",
        "openrouter/auto-beta",
        "openrouter/pareto-code",
    }
)


def is_alias_model(model: str) -> bool:
    return str(model or "").strip() in ALIAS_MODELS


def bakeoff_model_list(cfg: dict) -> list[str]:
    """2 or 3 distinct pinned models. Auto aliases are not a bake-off."""
    raw = cfg.get("bakeoff_models") if isinstance(cfg, dict) else None
    if not isinstance(raw, list):
        raw = []
    out: list[str] = []
    for item in raw:
        name = str(item or "").strip()
        if not name or is_alias_model(name) or name in out:
            continue
        out.append(name)
    if len(out) < 2 or len(out) > 3:
        raise SystemExit(
            "Bake-off needs 2 or 3 distinct pinned models in bakeoff_models "
            "(not okvevo/auto-cost). See config.example.json."
        )
    return out

# Unique body so the WhatsApp checker can match this run's last bubble.
WHATSAPP_BODY = (
    "P0 line one — running a computer-use eval.\n"
    "P0 line two — please ignore this test message.\n"
    "P0 line three — {MARKER}"
)


def d7_tasks(contact: str, marker: str) -> list[dict[str, Any]]:
    body = WHATSAPP_BODY
    note = "P0 D7 note about tomorrow's call. marker={MARKER}"
    should_use = [
        ("d7_su_01_whatsapp_open", "whatsapp", f"Open WhatsApp and message {contact}: {body}"),
        ("d7_su_02_notes_put", "notes", f"Put this in Notes with title 'Nia P0 test note': {note}"),
        ("d7_su_03_whatsapp_send", "whatsapp", f"Send {contact} a WhatsApp: {body}"),
        ("d7_su_04_notes_type", "notes", f"Type a note in Notes titled 'Nia P0 test note' that says: {note}"),
        ("d7_su_05_whatsapp_someone", "whatsapp", f"Message {contact} on WhatsApp: {body}"),
        ("d7_su_06_notes_open", "notes", f"Open the Notes app and write this as 'Nia P0 test note': {note}"),
        ("d7_su_07_whatsapp_late", "whatsapp", f"WhatsApp {contact} that I'm running late. Also send: {body}"),
        ("d7_su_08_notes_drop", "notes", f"Drop this into Notes titled 'Nia P0 test note': {note}"),
        ("d7_su_09_whatsapp_start", "whatsapp", f"Start a WhatsApp chat with {contact} and send: {body}"),
        ("d7_su_10_notes_add", "notes", f"Add a note in the Notes app about tomorrow's call titled 'Nia P0 test note': {note}"),
        ("d7_su_11_tally", "tally", 'In TallyPrime Educational Mode, create a ledger "Test Ledger" under Sundry Debtors'),
        ("d7_su_12_multi", "multi", f"Copy the Notes note 'Nia P0 test note' into a WhatsApp message to {contact}"),
        ("d7_su_13_calc", "calc", "In LibreOffice Calc, type 10, 20, 30 in A1–A3 and total them in A4"),
    ]
    should_not = [
        ("d7_sn_01_ls", "none", "List the files in this folder"),
        ("d7_sn_02_web", "none", "Search the web for the current Nia version"),
        ("d7_sn_03_edit", "none", "Edit foo.py and add a comment"),
        ("d7_sn_04_git", "none", "Run git status in the project"),
        ("d7_sn_05_math", "none", "What's 18% of 2,450?"),
    ]
    out = []
    for tid, kind, prompt in should_use:
        out.append(
            {
                "id": tid,
                "prompt": prompt,
                "expect_first": "computer_use",
                "kind": kind,
                "windows_only": kind == "tally",
                "needs_contact": kind in {"whatsapp", "multi"},
            }
        )
    for tid, kind, prompt in should_not:
        out.append(
            {
                "id": tid,
                "prompt": prompt,
                "expect_first": "not_computer_use",
                "kind": kind,
                "windows_only": False,
                "needs_contact": False,
            }
        )
    return out


def bakeoff_tasks(contact: str, marker: str) -> list[dict[str, Any]]:
    body = WHATSAPP_BODY
    return [
        {
            "id": "bake_whatsapp",
            "kind": "whatsapp",
            "prompt": (
                f"Open WhatsApp, search {contact}, open the first result, "
                f"type this 3-line message, and send it:\n{body}"
            ),
            "needs_contact": True,
            "windows_only": False,
        },
        {
            "id": "bake_notes",
            "kind": "notes",
            "prompt": (
                "Open Notes and create a note titled 'Nia P0 test note' with body: "
                "P0 bake-off note marker={MARKER}"
            ),
            "needs_contact": False,
            "windows_only": False,
        },
        {
            "id": "bake_calc",
            "kind": "calc",
            "prompt": "In LibreOffice Calc, type 10, 20, 30 in A1–A3 and total them in A4 so A4 equals 60.",
            "needs_contact": False,
            "windows_only": False,
        },
    ]


def baseline_tasks(contact: str, marker: str) -> list[dict[str, Any]]:
    body = WHATSAPP_BODY
    return [
        {
            "id": "base_whatsapp_regression",
            "kind": "whatsapp",
            "prompt": (
                f"Open WhatsApp, search {contact}, open the first result, "
                f"type a 3-line message, and send:\n{body}"
            ),
            "needs_contact": True,
            "windows_only": False,
        },
        {
            "id": "base_notes",
            "kind": "notes",
            "prompt": (
                "Open the Notes app and write a note titled 'Nia P0 test note' about "
                f"tomorrow's call. Body: P0 baseline note marker={{MARKER}}"
            ),
            "needs_contact": False,
            "windows_only": False,
        },
        {
            "id": "base_tally",
            "kind": "tally",
            "prompt": 'In TallyPrime Educational Mode, create a ledger "Test Ledger" under Sundry Debtors.',
            "needs_contact": False,
            "windows_only": True,
        },
        {
            "id": "base_calc",
            "kind": "calc",
            "prompt": "In LibreOffice Calc, type 10 in A1, 20 in A2, 30 in A3, and put the total in A4.",
            "needs_contact": False,
            "windows_only": False,
        },
        {
            "id": "base_vague_whatsapp",
            "kind": "whatsapp",
            "prompt": f"Message {contact} on WhatsApp: {body}",
            "needs_contact": True,
            "windows_only": False,
        },
        {
            "id": "base_vague_notes",
            "kind": "notes",
            "prompt": f"Drop this into Notes titled 'Nia P0 test note': P0 vague note marker={{MARKER}}",
            "needs_contact": False,
            "windows_only": False,
        },
        {
            "id": "base_vague_notes2",
            "kind": "notes",
            "prompt": f"Put this in Notes as 'Nia P0 test note': P0 second vague note marker={{MARKER}}",
            "needs_contact": False,
            "windows_only": False,
        },
    ]
