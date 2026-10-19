- After every change, bump CACHE_NAME in service-worker.js by one. CACHE_NAME is the build number (a plain integer, e.g. '2941' → '2942').
- When bumping CACHE_NAME, also bump the matching ?v= query string on ALL FIVE version-stamped asset tags in index.html (style.css, maplibre-boot.mjs, lang/en.js, lang/sv.js, script.js) to EXACTLY the same number. The authoritative list is VERSIONED in service-worker.js — if that array grows, this one must too. These are served max-age=31536000, immutable (main.py), so a returning browser never refetches them — a changed URL is the ONLY way new bytes reach it. The service worker also precaches them as `<asset>?v=<CACHE_NAME>` and matches search-sensitively. A missed bump fails SILENTLY: that one asset keeps running the previous build while everything else updates.
- Keep BUILD_NUMBER in script.js in sync with CACHE_NAME; it is shown after the version in the About modal, e.g. "Version: 2.7.1 (Build 2941)"
- Do not enter any co-authoring text in git messages
- If updating the changelog README.md, trim the changelog in the about menu so its only keeping the 5 latest changes
- Keep the changelog in About short and conise, max 3 row per change.
- If version is changed, don't forget to update the version string in about menu
- Make sure that APP_VERSION in script.js is always up to date to changelog version and vice versa.

