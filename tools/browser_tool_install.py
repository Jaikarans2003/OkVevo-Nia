"""Nia fork shim — upstream Hermes split the browser-install helpers out of
``tools/browser_tool.py`` into ``tools/browser_tool_install.py`` (browser-tool
module split we do not carry). Nia keeps them in ``tools/browser_tool``.

Re-export the names shared code and upstream tests reference so both import
paths work. Re-apply on next upstream sync: keep this file as long as Nia has
not taken upstream's browser-tool split.
"""

from hermes_constants import agent_browser_runnable, node_tool_runnable  # noqa: F401
from tools.browser_tool import (  # noqa: F401
    _chromium_installed,
    _find_agent_browser,
    _is_npx_agent_browser_sentinel,
    _resolve_npx_bin,
    _running_in_docker,
)
