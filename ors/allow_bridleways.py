"""Make bridleways routable for openrouteservice's foot profiles.

ORS's FootFlagEncoder (foot-hiking, foot-walking) hard-codes the highway types it walks on,
and `bridleway` is not among them — a bridleway is only used when it also carries an
explicit foot=yes/designated/official/permissive. No ors-config.yml key changes that, so
this rewrites the OSM extract instead: every highway=bridleway with no foot tag and no
access restriction gets foot=yes. Everything else is copied through unchanged.

    python allow_bridleways.py sweden-latest.osm.pbf sweden-latest-bridleways.osm.pbf

Run by the `osm-prep` service in openrouteservice.yaml. Rebuild the graphs afterwards.
"""
import os
import sys

import osmium

# FootFlagEncoder's own restrictedValues: an access=<one of these> bridleway stays closed,
# exactly as ORS would treat it. foot=no is left alone because only untagged ways change.
RESTRICTED = {"no", "private", "restricted", "military", "emergency"}


def main(src, dst):
    if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src):
        print(f"{dst} is newer than {src}, nothing to do")
        return

    tmp = dst + ".tmp"
    if os.path.exists(tmp):
        os.remove(tmp)

    changed = 0
    # Explicit format: the .tmp suffix would otherwise defeat format detection.
    with osmium.SimpleWriter(osmium.io.File(tmp, "pbf")) as writer:
        # Only bridleway ways reach Python; every other object goes straight to the writer
        # in C++, so a country extract takes minutes rather than hours. File order is kept.
        processor = (osmium.FileProcessor(src)
                     .with_filter(osmium.filter.EntityFilter(osmium.osm.WAY))
                     .with_filter(osmium.filter.TagFilter(("highway", "bridleway")))
                     .handler_for_filtered(writer))
        for way in processor:
            if "foot" in way.tags or way.tags.get("access") in RESTRICTED:
                writer.add(way)
                continue
            tags = {t.k: t.v for t in way.tags}
            tags["foot"] = "yes"
            writer.add(way.replace(tags=tags))
            changed += 1

    # Rename only once complete, so an interrupted run never leaves a truncated extract
    # that looks up to date.
    os.replace(tmp, dst)
    print(f"Added foot=yes to {changed} bridleways -> {dst}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
