#!/usr/bin/env python3
"""Nia branding floor — run: python3 scripts/check_nia_branding.py

Identity floor (Batch 0) plus user-visible Hermes/Nous scrub (Phase 5).

Fails closed on:
  - SOUL.md / docker/SOUL.md missing the Nia identity lead
  - apps/desktop/package.json productName / appId not Nia
  - DEFAULT_AGENT_IDENTITY / DEFAULT_SOUL_MD not Nia
  - install clone URLs not pointing at Jaikarans2003/OkVevo-Nia
  - forbidden product phrasing in those same identity files
  - obvious hermes logo filenames under apps/desktop/assets
  - Hermes / Nous product words, or Hermes/Nous doc links, inside
    user-visible strings on the Phase 5 paths (i18n, Electron/renderer
    copy, installer UI, EXE/plist metadata, CLI help, help links)

Allow: LICENSE/NOTICE, copyright attribution lines, brand-scrub needles,
legacy-template match strings, tests, and internal ids (~/.hermes, hermes
CLI, hermes://, HERMES_*, protocol/package names, Hermes.app path tokens).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

NIA_LEAD = "You are Nia, built by OkVevo"
OKVEVO_NIA_HTTPS = "https://github.com/Jaikarans2003/OkVevo-Nia.git"
OKVEVO_NIA_SSH = "git@github.com:Jaikarans2003/OkVevo-Nia.git"

# Product-as-self phrasing in identity files (not "never say Hermes" guidance).
FORBIDDEN_IDENTITY = re.compile(
    r"(?i)("
    r"you are hermes(?:\s+agent)?"
    r"|hermes agent(?:,|\s+an\s+|\s+installer|\s+persona)"
    r"|created by nous research"
    r"|built by nous"
    r"|welcome to hermes"
    r"|productName[\"']?\s*:\s*[\"']Hermes[\"']"
    r")"
)

# Lines that intentionally mention Hermes/Nous as forbidden brands.
GUIDANCE_OK = re.compile(
    r"(?i)(never say|not hermes|not nous|do not say|instead of hermes|"
    r"legacy|template|match|upgrade|rewrite|scrub|forbidden|against)"
)


def _fail(msg: str, errors: list[str]) -> None:
    errors.append(msg)


def _read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


def check_soul_files(errors: list[str]) -> None:
    for rel in ("SOUL.md", "docker/SOUL.md"):
        text = _read(rel).strip()
        if NIA_LEAD not in text:
            _fail(f"{rel}: missing Nia identity lead ({NIA_LEAD!r})", errors)
        # Whole-file product-as-self (ignore empty)
        for i, line in enumerate(text.splitlines(), 1):
            if FORBIDDEN_IDENTITY.search(line) and not GUIDANCE_OK.search(line):
                _fail(f"{rel}:{i}: forbidden product phrasing: {line.strip()[:120]}", errors)


def check_package_json(errors: list[str]) -> None:
    data = json.loads(_read("apps/desktop/package.json"))
    product = data.get("productName")
    app_id = (data.get("build") or {}).get("appId") or data.get("appId")
    if product != "Nia":
        _fail(f"apps/desktop/package.json: productName must be 'Nia', got {product!r}", errors)
    if app_id != "com.okvevo.nia":
        _fail(f"apps/desktop/package.json: appId must be 'com.okvevo.nia', got {app_id!r}", errors)


def check_python_identity(errors: list[str]) -> None:
    pb = _read("agent/prompt_builder.py")
    if f'DEFAULT_AGENT_IDENTITY = (\n    "{NIA_LEAD}' not in pb and f'"{NIA_LEAD}' not in pb:
        _fail("agent/prompt_builder.py: DEFAULT_AGENT_IDENTITY must lead with Nia/OkVevo", errors)

    ds = _read("hermes_cli/default_soul.py")
    if f'DEFAULT_SOUL_MD = (\n    "{NIA_LEAD}' not in ds and NIA_LEAD not in ds.split("DEFAULT_SOUL_MD", 1)[-1][:400]:
        _fail("hermes_cli/default_soul.py: DEFAULT_SOUL_MD must lead with Nia/OkVevo", errors)

    # Only scan the live DEFAULT_SOUL_MD / DEFAULT_AGENT assignment blocks for
    # product-as-self; legacy template tuples intentionally contain Hermes.
    for rel, text, marker in (
        ("agent/prompt_builder.py", pb, "DEFAULT_AGENT_IDENTITY"),
        ("hermes_cli/default_soul.py", ds, "DEFAULT_SOUL_MD"),
    ):
        # Take until next top-level assignment after marker (rough).
        idx = text.find(marker)
        if idx < 0:
            continue
        chunk = text[idx : idx + 800]
        for i, line in enumerate(chunk.splitlines(), 1):
            if "_LEGACY" in line or "legacy" in line.lower():
                break
            if FORBIDDEN_IDENTITY.search(line) and not GUIDANCE_OK.search(line):
                _fail(f"{rel}: {marker} block: forbidden phrasing: {line.strip()[:120]}", errors)


def check_install_urls(errors: list[str]) -> None:
    for rel in ("scripts/install.sh", "scripts/install.ps1"):
        path = ROOT / rel
        if not path.exists():
            _fail(f"{rel}: missing", errors)
            continue
        text = path.read_text(encoding="utf-8")
        if OKVEVO_NIA_HTTPS not in text and OKVEVO_NIA_SSH not in text:
            _fail(f"{rel}: clone URL must reference Jaikarans2003/OkVevo-Nia", errors)
        if "NousResearch/hermes-agent" in text and "OkVevo-Nia" not in text:
            _fail(f"{rel}: still points only at NousResearch/hermes-agent", errors)


def check_logo_filenames(errors: list[str]) -> None:
    assets = ROOT / "apps" / "desktop" / "assets"
    if not assets.is_dir():
        return
    bad = re.compile(r"(?i)hermes.*\.(png|icns|ico|svg)$")
    for p in assets.rglob("*"):
        if p.is_file() and bad.search(p.name):
            _fail(f"logo filename looks Hermes-branded: {p.relative_to(ROOT)}", errors)


# Internal ids and attribution. Stripped before the product-word check so
# ~/.hermes, the hermes CLI, hermes://, HERMES_*, and copyright lines stay.
_ALLOW_RES = (
    re.compile(r"Hermes\.app"),
    re.compile(r"Hermes\.exe"),
    re.compile(r"Hermes-Setup"),
    re.compile(r"agents\.nousresearch\.com", re.IGNORECASE),
    re.compile(r"hermes://", re.IGNORECASE),
    re.compile(r"HERMES_[A-Z0-9_]+"),
    re.compile(r"X-Hermes-[A-Za-z0-9-]+"),
    re.compile(r"@hermes/"),
    re.compile(r"(?:~/)?\.hermes\b"),
    re.compile(r"\bhermes\b"),  # lowercase CLI / package token
)
_PLIST_STRING_RE = re.compile(r"<string>(.*?)</string>", re.DOTALL)
_JSX_TEXT_RE = re.compile(r">([^<>{}]*\b(?:Hermes|Nous)\b[^<>{}]*)<")
_COPYRIGHT_ATTR_RE = re.compile(r"Copyright", re.IGNORECASE)
_PRODUCT_WORD_RE = re.compile(r"\b(?:Hermes|Nous)\b")
_SKIP_FILE_PARTS = (".test.ts", ".test.tsx", ".test.mjs", ".test.js")
_SKIP_DIRS = {"node_modules", "dist", "release", "target", "out"}

# Phase 5 surfaces. A seeded product word in any one of these must fail.
# Git copies of these catalogs match upstream. The shipped strings live in
# brand/locales (desktop modules + CLI overlay JSON).
_SUPERSEDED_DESKTOP_CATALOGS = {
    "apps/desktop/src/i18n/en.ts",
    "apps/desktop/src/i18n/ar.ts",
    "apps/desktop/src/i18n/ja.ts",
    "apps/desktop/src/i18n/zh.ts",
    "apps/desktop/src/i18n/zh-hant.ts",
}

VISIBLE_ROOTS = (
    "brand/locales",
    "apps/desktop/src/i18n",
    "apps/desktop/src",
    "apps/desktop/electron",
    "apps/bootstrap-installer",
    "apps/desktop/scripts/set-exe-identity.mjs",
    "apps/desktop/package.json",
    "scripts/install.sh",
    "scripts/install.ps1",
    "locales",
    "apps/desktop/THIRD_PARTY_NOTICES.txt",
)


def _line_of(text: str, index: int) -> int:
    return text.count("\n", 0, index) + 1


# Upgrade grep still matches the comment written by older installers.
_LEGACY_INSTALLER_MARKER = "# Hermes Agent browser tools"


def _parser_noise(inner: str) -> bool:
    """A quote span that swallowed code, not a user-visible literal."""
    if inner.count("\n") < 2:
        return False
    markers = ("function ", "const ", "let ", "Write-Host", "param(", "async function")
    return any(marker in inner for marker in markers)


_NOUS_DISCORD_RE = re.compile(r"discord\.gg/nousresearch", re.IGNORECASE)
_OSS_NOTICE_NAMES = {"THIRD_PARTY_NOTICES.txt", "LICENSE", "NOTICE"}
PRODUCT_COPYRIGHT = "© 2026 Azonova Technologies Pvt Ltd"


def visible_violation(inner: str, *, allow_oss_attribution: bool = False) -> str | None:
    """Return a short reason if this user-visible string leaks Hermes/Nous."""
    # MIT attribution stays in LICENSE, NOTICE, and THIRD_PARTY_NOTICES.txt.
    # Those files are not shown in the app UI.
    if allow_oss_attribution:
        return None
    if _NOUS_DISCORD_RE.search(inner):
        return "discord.gg/NousResearch"
    if _parser_noise(inner):
        return None
    if re.search(r"open-source licenses", inner, re.IGNORECASE):
        return "open-source licenses"
    if "Nous Research" in inner and _COPYRIGHT_ATTR_RE.search(inner):
        return "Nous Research copyright"
    scrubbed = inner.replace(_LEGACY_INSTALLER_MARKER, "")
    for pat in _ALLOW_RES:
        scrubbed = pat.sub("", scrubbed)
    if re.search(r"\bHermes\b", scrubbed):
        return "Hermes"
    if re.search(r"\bNous\b", scrubbed):
        return "Nous"
    low = scrubbed.lower()
    if "nousresearch.com" in low:
        return "nousresearch.com"
    if "github.com/nousresearch" in low:
        return "github.com/NousResearch"
    return None


def _skip_file(path: Path) -> bool:
    name = path.name
    if any(name.endswith(part) or part in name for part in _SKIP_FILE_PARTS):
        return True
    if name in {"LICENSE", "NOTICE", "LICENCE.txt", "LICENCE-FAQ.txt"}:
        return True
    return False


def iter_visible_files() -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for rel in VISIBLE_ROOTS:
        path = ROOT / rel
        if not path.exists():
            continue
        files = [path] if path.is_file() else path.rglob("*")
        for file in files:
            if not file.is_file():
                continue
            if any(part in _SKIP_DIRS for part in file.parts):
                continue
            if _skip_file(file):
                continue
            rel = file.relative_to(ROOT).as_posix()
            if rel in _SUPERSEDED_DESKTOP_CATALOGS:
                continue
            if rel.startswith("locales/") and rel.endswith(".yaml"):
                overlay = ROOT / "brand" / "locales" / f"{Path(rel).stem}.overlay.json"
                if overlay.is_file():
                    continue
            if file.suffix.lower() not in {
                ".ts",
                ".tsx",
                ".js",
                ".mjs",
                ".html",
                ".css",
                ".json",
                ".plist",
                ".yaml",
                ".yml",
                ".sh",
                ".ps1",
                ".rs",
                ".xml",
            } and file.name not in _OSS_NOTICE_NAMES:
                continue
            resolved = file.resolve()
            if resolved in seen:
                continue
            seen.add(resolved)
            found.append(file)
    return found


def _skip_balanced_braces(text: str, i: int) -> int:
    """i points at '{'. Return the index just after the matching '}'."""
    depth = 0
    n = len(text)
    while i < n:
        c = text[i]
        if c in "\"'`":
            i = _skip_string(text, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _skip_string(text: str, i: int) -> int:
    """i points at the opening quote. Return the index just after the closer.

    A newline inside ' or " means this was not a string (a regex or comment
    fragment). Return i + 1 so the scan resumes at the next character.
    """
    quote = text[i]
    start = i
    i += 1
    n = len(text)
    while i < n:
        if text[i] == "\\":
            i += 2
            continue
        if quote == "`" and text.startswith("${", i):
            i = _skip_balanced_braces(text, i + 1)
            continue
        if text[i] == "\n" and quote != "`":
            return start + 1
        if text[i] == quote:
            return i + 1
        i += 1
    return start + 1


def iter_string_spans(text: str, suffix: str):
    """Yield (start, end, inner) for code string literals. Skips comments."""
    i = 0
    n = len(text)
    hash_comment = suffix in {".sh", ".ps1", ".yaml", ".yml"}
    slash_comment = suffix in {".ts", ".tsx", ".js", ".mjs", ".rs"}
    while i < n:
        if hash_comment and text[i] == "#" and (i == 0 or text[i - 1] == "\n"):
            nxt = text.find("\n", i)
            i = n if nxt < 0 else nxt + 1
            continue
        if slash_comment and text.startswith("//", i):
            nxt = text.find("\n", i)
            i = n if nxt < 0 else nxt + 1
            continue
        if slash_comment and text.startswith("/*", i):
            nxt = text.find("*/", i + 2)
            i = n if nxt < 0 else nxt + 2
            continue
        if text[i] in "\"'`":
            end = _skip_string(text, i)
            if end > i + 1 and text[end - 1] == text[i]:
                yield i + 1, end - 1, text[i + 1 : end - 1]
                i = end
            else:
                i += 1
            continue
        i += 1


def iter_visible_strings(text: str, suffix: str):
    """Yield (line, inner) for user-visible literals and plist/JSX text."""
    if suffix == ".txt":
        yield 1, text
        return
    if suffix == ".plist" or (suffix == ".xml" and "<plist" in text[:200]):
        for match in _PLIST_STRING_RE.finditer(text):
            yield _line_of(text, match.start()), match.group(1)
        return
    for start, _end, inner in iter_string_spans(text, suffix):
        yield _line_of(text, start), inner
    if suffix in {".tsx", ".html", ".jsx"}:
        for match in _JSX_TEXT_RE.finditer(text):
            yield _line_of(text, match.start()), match.group(1)


def check_visible_strings(errors: list[str]) -> None:
    for file in iter_visible_files():
        try:
            text = file.read_text(encoding="utf-8")
        except (OSError, UnicodeError):
            continue
        rel = file.relative_to(ROOT)
        allow_oss = file.name in _OSS_NOTICE_NAMES
        for line, inner in iter_visible_strings(text, file.suffix.lower()):
            reason = visible_violation(inner, allow_oss_attribution=allow_oss)
            if reason:
                snippet = " ".join(inner.split())[:140]
                _fail(f"{rel}:{line}: user-visible {reason}: {snippet}", errors)


def check_pack_metadata(errors: list[str]) -> None:
    pkg = json.loads(_read("apps/desktop/package.json"))
    build = pkg.get("build") or {}
    mac = (build.get("mac") or {}).get("extendInfo") or {}
    win = build.get("win") or {}
    nsis = build.get("nsis") or {}
    dmg = build.get("dmg") or {}
    if pkg.get("productName") != "Nia" or build.get("productName") != "Nia":
        _fail("apps/desktop/package.json: productName must be Nia", errors)
    if "Hermes" in str(pkg.get("description", "")) or "Nous" in str(pkg.get("description", "")):
        _fail("apps/desktop/package.json: description leaks Hermes/Nous", errors)
    if pkg.get("author") != "OkVevo":
        _fail(f"apps/desktop/package.json: author must be OkVevo, got {pkg.get('author')!r}", errors)
    for key in ("CFBundleDisplayName", "CFBundleName"):
        if mac.get(key) != "Nia":
            _fail(f"apps/desktop/package.json: mac.extendInfo.{key} must be Nia", errors)
    if _PRODUCT_WORD_RE.search(str(dmg.get("title", ""))):
        _fail("apps/desktop/package.json: dmg.title leaks Hermes/Nous", errors)
    for key in ("shortcutName", "uninstallDisplayName"):
        if nsis.get(key) != "Nia":
            _fail(f"apps/desktop/package.json: nsis.{key} must be Nia", errors)
    publishers = ((win.get("signtoolOptions") or {}).get("publisherName")) or []
    if "OkVevo" not in publishers:
        _fail("apps/desktop/package.json: win publisherName must include OkVevo", errors)

    exe = _read("apps/desktop/scripts/set-exe-identity.mjs")
    if "CompanyName: 'OkVevo'" not in exe and 'CompanyName: "OkVevo"' not in exe:
        _fail("set-exe-identity.mjs: CompanyName must be OkVevo", errors)
    if "ProductName: 'Nia'" not in exe and 'ProductName: "Nia"' not in exe:
        _fail("set-exe-identity.mjs: ProductName must be Nia", errors)
    if "FileDescription: 'Nia'" not in exe and 'FileDescription: "Nia"' not in exe:
        _fail("set-exe-identity.mjs: FileDescription must be Nia", errors)
    if f"LegalCopyright: '{PRODUCT_COPYRIGHT}'" not in exe and f'LegalCopyright: "{PRODUCT_COPYRIGHT}"' not in exe:
        _fail("set-exe-identity.mjs: LegalCopyright must be the Azonova product line", errors)
    if "Nous Research" in exe:
        _fail("set-exe-identity.mjs: LegalCopyright must not name Nous Research", errors)

    tauri = json.loads(_read("apps/bootstrap-installer/src-tauri/tauri.conf.json"))
    bundle = tauri.get("bundle") or {}
    if tauri.get("productName") != "Nia":
        _fail("tauri.conf.json: productName must be Nia", errors)
    if bundle.get("publisher") != "OkVevo":
        _fail("tauri.conf.json: publisher must be OkVevo", errors)
    copyright_line = str(bundle.get("copyright", ""))
    if copyright_line != PRODUCT_COPYRIGHT:
        _fail("tauri.conf.json: copyright must be the Azonova product line", errors)
    if build.get("copyright") != PRODUCT_COPYRIGHT:
        _fail("apps/desktop/package.json: build.copyright must be the Azonova product line", errors)
    if mac.get("NSHumanReadableCopyright") != PRODUCT_COPYRIGHT:
        _fail("apps/desktop/package.json: NSHumanReadableCopyright must be the Azonova product line", errors)
    notice = _read("apps/desktop/THIRD_PARTY_NOTICES.txt")
    license_body = _read("LICENSE").split("MIT License", 1)[-1].strip()
    if "Copyright (c) 2025 Nous Research" not in notice or license_body not in notice:
        _fail("THIRD_PARTY_NOTICES.txt: must include the Hermes Agent MIT license verbatim", errors)
    window_title = (((tauri.get("app") or {}).get("windows") or [{}])[0]).get("title")
    if window_title != "Nia":
        _fail("tauri.conf.json: window title must be Nia", errors)


def main() -> int:
    errors: list[str] = []
    check_soul_files(errors)
    check_package_json(errors)
    check_python_identity(errors)
    check_install_urls(errors)
    check_logo_filenames(errors)
    check_pack_metadata(errors)
    check_visible_strings(errors)

    if errors:
        print("check_nia_branding: FAIL", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("check_nia_branding: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
