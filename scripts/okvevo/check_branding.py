#!/usr/bin/env python3
"""OkVevo branding gates: identity, brand image paths, catalogs, user-visible Hermes."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "apps/desktop"
ALLOWLIST = ROOT / "scripts/okvevo/hermes-string-allowlist.txt"
IMAGE_EXT = re.compile(r"\.(icns|ico|png|tiff|tif|gif|svg|icon)$", re.I)
SCAN_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
LOG_CALLS = {
    "rememberLog",
    "console.log",
    "console.error",
    "console.warn",
    "console.info",
    "console.debug",
}
IDENTITY_SCAN = [
    DESKTOP / "package.json",
    DESKTOP / "product-identity.cjs",
    DESKTOP / "scripts/run-internal-builder.mjs",
    ROOT / "brand/nia.json",
    ROOT / "apps/bootstrap-installer/src-tauri/tauri.conf.json",
]


def load_allowlist() -> tuple[list[str], set[str]]:
    substrings: list[str] = []
    exact: set[str] = set()
    for raw in ALLOWLIST.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        kind, text = line.split(" ", 1)
        if kind == "substring":
            substrings.append(text)
        elif kind == "exact":
            exact.add(text)
        else:
            raise SystemExit(f"bad allowlist line: {raw}")
    substrings.sort(key=len, reverse=True)
    return substrings, exact


def hermes_visible(body: str, substrings: list[str], exact: set[str]) -> bool:
    if body in exact:
        return False
    cleaned = body
    for token in substrings:
        cleaned = cleaned.replace(token, "")
    return "Hermes" in cleaned


def template_text_parts(body: str) -> list[tuple[str, str]]:
    parts: list[tuple[str, str]] = []
    buf: list[str] = []
    i = 0
    while i < len(body):
        if body.startswith("${", i):
            parts.append(("text", "".join(buf)))
            buf = []
            i += 2
            depth = 1
            expr: list[str] = []
            while i < len(body) and depth:
                if body[i] == "{":
                    depth += 1
                elif body[i] == "}":
                    depth -= 1
                    if depth == 0:
                        i += 1
                        break
                expr.append(body[i])
                i += 1
            parts.append(("expr", "".join(expr)))
            continue
        buf.append(body[i])
        i += 1
    parts.append(("text", "".join(buf)))
    return parts


ATTRIBUTION = "Built on Hermes Agent by Nous Research"


def rewrite_copy(text: str) -> str:
    rewritten = ATTRIBUTION.join(part.replace("Hermes", "OkVevo") for part in text.split(ATTRIBUTION))
    return rewritten.replace("a OkVevo", "an OkVevo").replace("A OkVevo", "An OkVevo")


def rewrite_body(body: str, quote: str) -> str:
    if quote != "`":
        return rewrite_copy(body)
    out: list[str] = []
    for kind, chunk in template_text_parts(body):
        out.append(rewrite_copy(chunk) if kind == "text" else "${" + chunk + "}")
    return "".join(out)


def suspicious_span(body: str) -> bool:
    if "\n" not in body:
        return False
    return any(token in body for token in ("const ", "function ", "=>", "\n  //", "\n *", "lines.push"))


def identifier_key(body: str) -> bool:
    if re.fullmatch(r"[a-z][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+", body):
        # i18n key path (``notifications.actions.restartHermes``): the brand
        # overlay rewrites the VALUE; renaming the key paints the raw key.
        return True
    return bool(re.fullmatch(r"[A-Za-z_$][A-Za-z0-9_$]*", body)) and body != "Hermes"


def body_visible(body: str, quote: str, substrings: list[str], exact: set[str]) -> bool:
    if suspicious_span(body) or identifier_key(body):
        return False
    chunks = [body] if quote != "`" else [chunk for kind, chunk in template_text_parts(body) if kind == "text"]
    return any(hermes_visible(chunk, substrings, exact) for chunk in chunks)


def scan_literals(text: str) -> list[dict]:
    found: list[dict] = []
    n = len(text)
    i = 0
    line = 1
    last_ident = ""
    pending_dot = False
    call_stack: list[str] = []
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
            i += 1
            pending_dot = False
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            i += 2
            while i + 1 < n and not (text[i] == "*" and text[i + 1] == "/"):
                if text[i] == "\n":
                    line += 1
                i += 1
            i = min(n, i + 2)
            continue
        if c in "'\"`":
            quote = c
            start = i
            start_line = line
            i += 1
            buf: list[str] = []
            closed = False
            while i < n:
                ch = text[i]
                if ch == "\\":
                    buf.append(ch)
                    if i + 1 < n:
                        buf.append(text[i + 1])
                        if text[i + 1] == "\n":
                            line += 1
                        i += 2
                        continue
                    i += 1
                    continue
                if ch == "\n":
                    line += 1
                    if quote != "`":
                        break
                if ch == quote:
                    i += 1
                    closed = True
                    found.append(
                        {
                            "start": start,
                            "end": i,
                            "quote": quote,
                            "body": "".join(buf),
                            "line": start_line,
                            "log": any(name in LOG_CALLS for name in call_stack),
                        }
                    )
                    break
                buf.append(ch)
                i += 1
            if not closed:
                continue
            continue
        if c.isalpha() or c == "_" or c == "$":
            j = i + 1
            while j < n and (text[j].isalnum() or text[j] in "_$"):
                j += 1
            ident = text[i:j]
            last_ident = f"{last_ident}.{ident}" if pending_dot and last_ident else ident
            pending_dot = False
            i = j
            continue
        if c == ".":
            pending_dot = True
            i += 1
            continue
        if c == "(":
            call_stack.append(last_ident)
            last_ident = ""
            pending_dot = False
            i += 1
            continue
        if c == ")":
            if call_stack:
                call_stack.pop()
            pending_dot = False
            i += 1
            continue
        if not c.isspace():
            pending_dot = False
            last_ident = ""
        i += 1
    return found


def source_files() -> list[Path]:
    roots = [DESKTOP / "electron", DESKTOP / "src"]
    files: list[Path] = []
    for root in roots:
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix not in SCAN_EXT:
                continue
            rel = path.relative_to(DESKTOP).as_posix()
            if rel.startswith("src/i18n/"):
                continue
            if any(part in {"node_modules", "dist", "release", "build"} for part in path.parts):
                continue
            name = path.name
            if ".test." in name or ".spec." in name:
                continue
            files.append(path)
    return files


def rewrite_sources(substrings: list[str], exact: set[str], write: bool) -> int:
    changed = 0
    for path in source_files():
        text = path.read_text(encoding="utf-8")
        literals = [item for item in scan_literals(text) if not item["log"]]
        pieces: list[str] = []
        cursor = 0
        dirty = False
        for item in literals:
            if not body_visible(item["body"], item["quote"], substrings, exact):
                continue
            new_body = rewrite_body(item["body"], item["quote"])
            if new_body == item["body"]:
                continue
            pieces.append(text[cursor : item["start"]])
            pieces.append(item["quote"] + new_body + item["quote"])
            cursor = item["end"]
            dirty = True
            if not write:
                print(f"{path.relative_to(ROOT)}:{item['line']}: {item['body'][:120]}")
        if not dirty:
            continue
        pieces.append(text[cursor:])
        changed += 1
        if write:
            path.write_text("".join(pieces), encoding="utf-8")
    return changed


def check_identity() -> int:
    failed = 0
    for path in IDENTITY_SCAN:
        text = path.read_text(encoding="utf-8")
        rel = path.relative_to(ROOT)
        if '"productName": "Nia"' in text or '"productName":"Nia"' in text:
            print(f"{rel}: productName is still Nia", file=sys.stderr)
            failed += 1
        if "com.okvevo.nia" in text:
            print(f"{rel}: leftover bundle id com.okvevo.nia", file=sys.stderr)
            failed += 1
        if "NIA_BUILD_CHANNEL" in text:
            print(f"{rel}: leftover NIA_BUILD_CHANNEL", file=sys.stderr)
            failed += 1
    return failed


def check_builder_paths() -> int:
    text = (DESKTOP / "electron-builder.config.cjs").read_text(encoding="utf-8")
    failed = 0
    for match in re.finditer(r"\b(icon|background|from)\s*:\s*(['\"])([^'\"]+)\2", text):
        value = match.group(3)
        if not IMAGE_EXT.search(value):
            continue
        if "brand/" not in value.replace("\\", "/"):
            print(f"electron-builder image path is outside brand/: {value}", file=sys.stderr)
            failed += 1
    return failed


def check_title() -> int:
    html = (DESKTOP / "index.html").read_text(encoding="utf-8")
    match = re.search(r"<title>(.*?)</title>", html)
    title = match.group(1) if match else ""
    if "Hermes" in title:
        print(f"index.html title still contains Hermes: {title}", file=sys.stderr)
        return 1
    return 0


def check_literals(substrings: list[str], exact: set[str]) -> int:
    failed = 0
    for path in source_files():
        text = path.read_text(encoding="utf-8")
        for item in scan_literals(text):
            if item["log"]:
                continue
            if not body_visible(item["body"], item["quote"], substrings, exact):
                continue
            print(
                f"{path.relative_to(ROOT)}:{item['line']}: user-visible Hermes literal",
                file=sys.stderr,
            )
            failed += 1
    return failed


def check_catalog() -> int:
    proc = subprocess.run(
        ["npx", "vitest", "run", "--project", "ui", "src/i18n/okvevo-catalog.test.ts"],
        cwd=DESKTOP,
    )
    return proc.returncode


def check_error_overrides() -> int:
    """CLI setup phrases must stay mapped to OkVevo copy in both override layers."""
    ui = (DESKTOP / "src/lib/user-facing-error.ts").read_text(encoding="utf-8")
    py = (ROOT / "plugins/okvevo/errors.py").read_text(encoding="utf-8")
    failed = 0
    for phrase in ("hermes fallback add", "hermes setup", "hermes model", "hermes auth"):
        if phrase not in ui or phrase not in py:
            print(f"error override missing {phrase!r}", file=sys.stderr)
            failed += 1
    if "Please sign in again" not in ui or "Please sign in again" not in py:
        print("error override missing 'Please sign in again'", file=sys.stderr)
        failed += 1
    return failed


def check_asset_spec() -> int:
    proc = subprocess.run([sys.executable, str(ROOT / "scripts/okvevo/asset_spec.py"), "--check"])
    return proc.returncode


def main() -> int:
    write = "--rewrite" in sys.argv
    dry = "--dry-run" in sys.argv
    substrings, exact = load_allowlist()
    if write or dry:
        count = rewrite_sources(substrings, exact, write=write)
        print(f"{'rewrote' if write else 'would rewrite'} {count} files")
        if dry and not write:
            return 0
    failed = check_identity()
    failed += check_builder_paths()
    failed += check_title()
    failed += check_literals(substrings, exact)
    failed += check_error_overrides()
    failed += check_asset_spec()
    failed += check_catalog()
    if failed:
        return 1
    print("OkVevo branding checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
