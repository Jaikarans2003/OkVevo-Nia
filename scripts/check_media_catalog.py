#!/usr/bin/env python3
"""Media catalog selfcheck — run: python3 scripts/check_media_catalog.py

Asserts the contract between okvevo/media-catalog.json and the code that
consumes it:

- every shipped photo row resolves to a FAL_MODELS key
- every shipped video row resolves to a FAL plugin family
- explicit model= matching is fail-closed (unknown ids rejected, aliases hit)
- the rendered model= schema descriptions stay under the byte cap
- when the OkVevo-Web sibling checkout is present, both catalog copies are
  byte-identical (cross-repo drift is otherwise invisible from either side)
"""

import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tools import media_catalog  # noqa: E402


def main() -> None:
    catalog = media_catalog.load_catalog()
    assert catalog, "media catalog missing or unparseable"
    version = media_catalog.catalog_version()
    assert version >= 1, "catalog version missing"

    photos = media_catalog.shipped_rows("photos")
    videos = media_catalog.shipped_rows("videos")
    assert photos, "no shipped photo rows"
    assert videos, "no shipped video rows"

    for row in photos:
        resolved = media_catalog.resolve_image_model(row)
        assert resolved, f"shipped photo row does not resolve to FAL_MODELS: {row['id']}"
    for row in videos:
        fid = media_catalog.resolve_video_family(row)
        assert fid, f"shipped video row does not resolve to a FAL family: {row['id']}"

    # Fail-closed matching: exact id hits, alias hits, junk misses.
    assert media_catalog.find_shipped("photos", "fal-ai/nano-banana-pro")
    assert media_catalog.find_shipped("videos", "bytedance/seedance-2.5/image-to-video")
    assert media_catalog.find_shipped("photos", "dalle-9") is None
    assert media_catalog.find_shipped("videos", "fal-ai/veo3.1") is None  # real but unlisted
    assert media_catalog.find_shipped("photos", "") is None

    for kind in ("photos", "videos"):
        desc = media_catalog.model_param_description(kind)
        size = len(desc.encode("utf-8"))
        assert size <= media_catalog.MODEL_DESC_MAX_BYTES, (
            f"{kind} model= description is {size}B > {media_catalog.MODEL_DESC_MAX_BYTES}B cap"
        )
        for row in media_catalog.shipped_rows(kind):
            assert row["id"] in desc, f"{kind} description missing shipped id {row['id']}"

    # Cross-repo byte drift check (only when both checkouts share a workspace).
    here = media_catalog._catalog_path()
    sibling = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(here))),  # workspace root
        "OkVevo-Web", "src", "lib", "fal", "media-catalog.json",
    )
    if os.path.exists(sibling):
        digest = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
        assert digest(here) == digest(sibling), (
            "catalog copies drifted — keep hermes-agent/okvevo/media-catalog.json "
            "and OkVevo-Web/src/lib/fal/media-catalog.json byte-identical"
        )
        print(f"  cross-repo bytes identical: {digest(here)[:12]}…")
    else:
        print("  sibling OkVevo-Web checkout absent — skipped byte-drift check")

    print(f"check_media_catalog: ok (version={version}, "
          f"{len(photos)} shipped photos, {len(videos)} shipped videos)")


if __name__ == "__main__":
    main()
