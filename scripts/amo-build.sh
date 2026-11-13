#!/usr/bin/env bash
# Rebuilds the Firefox add-on from source, exactly as submitted to addons.mozilla.org.
# Run from the root of the extracted source archive:   bash scripts/amo-build.sh
# Output: dist/firefox/ (identical, file by file, to the submitted add-on). See BUILD.md.
set -euo pipefail

NODE_MIN_MAJOR=22
BUN_VERSION=1.3.14

cd "$(dirname "$0")/.."

case "$(uname -s)" in
  Linux | Darwin) ;;
  *) echo "Unsupported OS: $(uname -s). Use Linux or macOS (see BUILD.md)." >&2; exit 1 ;;
esac

# 1. Node.js >= 22 (not installed by this script: see BUILD.md for instructions).
if ! command -v node > /dev/null 2>&1; then
  echo "Node.js ${NODE_MIN_MAJOR} or later is required (see BUILD.md)." >&2
  exit 1
fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt "$NODE_MIN_MAJOR" ]; then
  echo "Node.js ${NODE_MIN_MAJOR} or later is required, found $(node --version)." >&2
  exit 1
fi

# 2. Bun, exact version (only used to install the pinned dev dependencies from bun.lock).
BUN="bun"
if ! command -v bun > /dev/null 2>&1 || [ "$(bun --version)" != "$BUN_VERSION" ]; then
  echo "Installing Bun ${BUN_VERSION} into ./.bun-amo ..."
  export BUN_INSTALL="$PWD/.bun-amo"
  curl -fsSL https://bun.sh/install | bash -s "bun-v${BUN_VERSION}" > /dev/null
  BUN="$BUN_INSTALL/bin/bun"
fi
echo "Node $(node --version), Bun $("$BUN" --version)"

# 3. Dependencies: exact versions from bun.lock (build tools only, nothing is bundled into the add-on).
"$BUN" install --frozen-lockfile

# 4. Regenerate src/ui/icons.css from the SVG files in assets/ (same content as the committed file).
node scripts/make-ui-assets.mjs

# 5. Production build (Node, not Bun): writes dist/chrome/ and dist/firefox/.
node scripts/build.mjs --prod

echo
echo "Done: dist/firefox/ is the add-on content."
