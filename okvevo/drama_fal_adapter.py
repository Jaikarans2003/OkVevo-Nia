"""Thin client for the OkVevo portal drama endpoints. No prices and no provider key."""

import json
import os
import sys
import urllib.request

COMMANDS = ("choose", "quote", "submit", "collect", "cancel")


def post(command, payload, origin, token, opener=urllib.request.urlopen):
    if command not in COMMANDS:
        raise SystemExit("unknown command")
    request = urllib.request.Request(
        origin.rstrip("/") + "/api/gateway/fal/drama/" + command,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with opener(request) as response:
        return json.load(response)


def main(argv=None, stdin=None):
    argv = list(sys.argv if argv is None else argv)
    command = argv[1] if len(argv) > 1 else ""
    origin = os.environ.get("OKVEVO_WEB_ORIGIN", "")
    token = os.environ.get("OKVEVO_ID_TOKEN", "")
    if not origin or not token:
        raise SystemExit("OKVEVO_WEB_ORIGIN and OKVEVO_ID_TOKEN are required")
    raw = sys.stdin.buffer.read() if stdin is None else stdin
    payload = json.loads(raw or b"{}")
    json.dump(post(command, payload, origin, token), sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
