#!/usr/bin/env python3
"""
Rebuilds registry/theme-registry.json from all themes/*/manifest.json files.
Auto-detects features from manifest fields.
"""

import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone

THEMES_DIR = "themes"
REGISTRY_PATH = "registry/theme-registry.json"
REPO_BASE = "https://raw.githubusercontent.com/itsdestin/wecoded-themes/main"


def pinned_base() -> str:
    """Base URL for theme FILES, fixed to the commit this registry was built from.

    WHY (security apparatus, 2026-11): `main` moves, so a URL on it can serve different
    bytes than the ones this run read and fingerprinted (a later push, or a CDN copy from
    another moment). A commit URL never changes, so what the app downloads is exactly what
    passed review. Falls back to `main` only outside a git checkout. Previews stay on main
    (they are generated after this commit and are not code the app runs).
    """
    sha = os.environ.get("REGISTRY_COMMIT", "")
    if not sha:
        try:
            sha = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
        except (OSError, subprocess.CalledProcessError):
            sha = ""
    if re.fullmatch(r"[0-9a-f]{40}", sha):
        return f"https://raw.githubusercontent.com/itsdestin/wecoded-themes/{sha}"
    print("  ⚠ not in a git checkout: theme file URLs fall back to main")
    return REPO_BASE


def sha256_file(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

# Official themes (source: youcoded-core) — maintained by itsdestin
OFFICIAL_AUTHORS = {"itsdestin"}


def detect_features(manifest: dict) -> list[str]:
    """Auto-detect features from manifest fields."""
    features = []

    bg = manifest.get("background", {})
    if bg.get("type") == "image":
        features.append("wallpaper")
    if bg.get("panels-blur", 0) > 0:
        features.append("glassmorphism")

    effects = manifest.get("effects", {})
    if effects.get("particles") and effects["particles"] != "none":
        features.append("particles")

    if manifest.get("font"):
        features.append("custom-font")
    if manifest.get("icons"):
        features.append("custom-icons")
    if manifest.get("mascot"):
        features.append("mascot")
    if manifest.get("custom_css"):
        features.append("custom-css")

    return features


def extract_manifest_assets(manifest: dict) -> set[str]:
    """Extract all asset paths referenced in the manifest."""
    # Collect every value that looks like a relative asset path (assets/...).
    # Also normalize theme-asset://<slug>/assets/... URIs to their relative
    # form — validate-theme.yml rejects these at PR time, but this backstop
    # ensures a bad manifest that slips through still produces correct
    # assetUrls instead of a silently empty map.
    slug = manifest.get("slug", "")
    theme_asset_prefix = f"theme-asset://{slug}/" if slug else None
    refs = set()

    def walk(obj):
        if isinstance(obj, str):
            if obj.startswith("assets/"):
                refs.add(obj)
            elif theme_asset_prefix and obj.startswith(theme_asset_prefix):
                rel = obj[len(theme_asset_prefix):]
                if rel.startswith("assets/"):
                    refs.add(rel)
        elif isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(manifest)
    return refs


def collect_asset_urls(slug: str, theme_dir: str, manifest: dict, base: str = REPO_BASE) -> dict[str, str]:
    """Build URL map for assets that the manifest actually references.

    Only includes files that (a) are referenced in the manifest and
    (b) exist on disk. Warns on mismatches so broken themes are caught
    during registry builds rather than at download time.
    """
    referenced = extract_manifest_assets(manifest)
    asset_urls = {}

    for rel_path in sorted(referenced):
        abs_path = os.path.join(theme_dir, rel_path)
        if os.path.isfile(abs_path):
            asset_urls[rel_path] = f"{base}/themes/{slug}/{rel_path}"
        else:
            # Manifest references a file that doesn't exist — flag it
            print(f"  ⚠ {slug}: manifest references '{rel_path}' but file is missing")

    return asset_urls


def load_previous_registry() -> dict:
    """The registry as last published, keyed by slug ({} when there is none or it is unreadable)."""
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            return {t["slug"]: t for t in json.load(f).get("themes", []) if "slug" in t}
    except (OSError, ValueError, KeyError, TypeError):
        return {}


def updated_date(old: dict | None, new: dict, today: str) -> str:
    """The "updated" date for a theme: today only if its own version or files changed.

    WHY (2026-11-12): every rebuild used to stamp ALL themes with today's date, so the marketplace's
    "New" sort treated every theme as freshly updated whenever any one theme changed. A theme keeps
    its previous date unless its version differs, or its files differ. Files are compared by the
    per-file fingerprints when the old entry has them, else by the author's contentHash. When the
    old entry offers nothing to compare, the old date is KEPT: never invent freshness.
    """
    if not old or not old.get("updated"):
        return today
    if old.get("version") != new.get("version"):
        return today
    old_fh, new_fh = old.get("fileHashes"), new.get("fileHashes")
    if old_fh and new_fh:
        return today if old_fh != new_fh else old["updated"]
    old_ch, new_ch = old.get("contentHash"), new.get("contentHash")
    if old_ch and new_ch and old_ch != new_ch:
        return today
    return old["updated"]


def build_registry():
    themes = []
    previous = load_previous_registry()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    files_base = pinned_base()

    for slug in sorted(os.listdir(THEMES_DIR)):
        theme_dir = os.path.join(THEMES_DIR, slug)
        manifest_path = os.path.join(theme_dir, "manifest.json")

        if not os.path.isfile(manifest_path):
            continue

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        author = manifest.get("author", "unknown")
        source = "youcoded-core" if author in OFFICIAL_AUTHORS else "community"

        # Extract preview tokens (subset of colors for CSS-based card previews)
        tokens = manifest.get("tokens", {})
        preview_tokens = {
            k: tokens[k]
            for k in ("canvas", "panel", "accent", "on-accent", "fg", "fg-muted", "edge")
            if k in tokens
        }

        # Check for preview.png
        preview_path = os.path.join(theme_dir, "preview.png")
        preview_url = (
            f"{REPO_BASE}/themes/{slug}/preview.png"
            if os.path.isfile(preview_path)
            else None
        )

        asset_urls = collect_asset_urls(slug, theme_dir, manifest, files_base)
        file_hashes = {"manifest.json": sha256_file(manifest_path)}
        for rel_path in asset_urls:
            file_hashes[rel_path] = sha256_file(os.path.join(theme_dir, rel_path))

        entry = {
            "slug": slug,
            "name": manifest.get("name", slug),
            "author": author,
            "dark": manifest.get("dark", False),
            "description": manifest.get("description"),
            "preview": preview_url,
            "previewTokens": preview_tokens if len(preview_tokens) >= 5 else None,
            "version": manifest.get("version", "1.0.0"),
            "created": manifest.get("created"),
            "updated": today,  # replaced below once the entry's fingerprints are known
            "source": source,
            "features": detect_features(manifest),
            "manifestUrl": f"{files_base}/themes/{slug}/manifest.json",
            "assetUrls": asset_urls,
            # WHY (security apparatus, 2026-11): SHA-256 of every file the app downloads, keyed
            # like assetUrls plus "manifest.json". The app refuses a download that does not match.
            "fileHashes": file_hashes,
            # Propagated from the author's manifest.json. Used by YouCoded's
            # theme-publish-state resolver to detect whether a locally-edited
            # theme has drifted from its published registry entry. Legacy
            # entries missing this field are treated as "matching" by the app,
            # so no backfill is required.
            "contentHash": manifest.get("contentHash"),
        }

        entry["updated"] = updated_date(previous.get(slug), entry, today)
        themes.append(entry)

    registry = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "themes": themes,
    }

    os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Registry rebuilt with {len(themes)} theme(s)")
    for t in themes:
        print(f"  - {t['name']} ({t['slug']}) [{t['source']}] features: {t['features']}")


if __name__ == "__main__":
    build_registry()
