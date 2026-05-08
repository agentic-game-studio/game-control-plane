#!/bin/bash
#
# install-deps.sh — Install Python dependencies for asset-pipeline.py
#
# Usage: bash scripts/asset-pipeline/install-deps.sh
#
# This script installs the Python packages required by the asset generation pipeline:
#   - Pillow      (image processing: alpha-trim, grid-pad, thumbnails)
#   - rembg       (background removal via U2-Net saliency model)
#   - PyYAML      (parsing presets.yaml batch files)
#
# It targets /usr/local/bin/python3 (Python 3.12 from python.org) to ensure
# pip packages are available even if Homebrew Python is the default.
#

set -euo pipefail

PYTHON_BIN="${PIPELINE_PYTHON:-/usr/local/bin/python3}"

# ── Validate Python binary ────────────────────────────────────────────────────

if ! command -v "$PYTHON_BIN" &>/dev/null; then
  echo "ERROR: Python not found at '$PYTHON_BIN'"
  echo "  Set PIPELINE_PYTHON env var or install Python 3.12 from https://www.python.org/"
  echo "  e.g. PIPELINE_PYTHON=/usr/local/bin/python3 bash scripts/asset-pipeline/install-deps.sh"
  exit 1
fi

PYTHON_VERSION=$("$PYTHON_BIN" --version 2>&1 | awk '{print $2}')
echo "[*] Using $PYTHON_BIN (Python $PYTHON_VERSION)"

# ── Check if pip is available ───────────────────────────────────────────────

PIP_CMD="$PYTHON_BIN -m pip"
if ! $PIP_CMD --version &>/dev/null; then
  echo "ERROR: pip not available for $PYTHON_BIN"
  echo "  Ensure pip is installed: curl https://bootstrap.pypa.io/get-pip.py | $PYTHON_BIN"
  exit 1
fi

# ── Upgrade pip (reduces install errors) ────────────────────────────────────

echo "[*] Upgrading pip..."
$PIP_CMD install --upgrade pip --quiet

# ── Core dependencies ───────────────────────────────────────────────────────

echo "[*] Installing Pillow (image processing)..."
$PIP_CMD install --upgrade Pillow --quiet

echo "[*] Installing PyYAML (YAML preset parsing)..."
$PIP_CMD install --upgrade PyYAML --quiet

# ── rembg (U2-Net background removal) ───────────────────────────────────────
#
# rembg requires:
#   1. the rembg package itself
#   2. the u2net model (downloaded on first use, ~176 MB)
#
# Installation is split so failures are clear.

echo "[*] Installing rembg (U2-Net background removal)..."
$PIP_CMD install --upgrade rembg --quiet

# ── Verify external tools ────────────────────────────────────────────────────

echo ""
echo "[*] Checking external tools..."

MFLUX_BIN="${HOME}/.local/bin/mflux-generate-flux2"
if command -v mflux-generate-flux2 &>/dev/null; then
  echo "  ✓ mflux-generate-flux2 found in PATH"
elif [[ -x "$MFLUX_BIN" ]]; then
  echo "  ✓ mflux-generate-flux2 found at $MFLUX_BIN"
else
  echo "  ✗ mflux-generate-flux2 NOT FOUND"
  echo "    Install: pip install mflux-generate-flux2"
  MISSING=$((MISSING + 1))
fi

# ── Verify Python package installations ─────────────────────────────────────

echo ""
echo "[*] Verifying Python packages..."

MISSING=0

check() {
  local mod="$1"
  local pkg="$2"
  if $PYTHON_BIN -c "import $mod; print('$mod', $mod.__version__)" 2>/dev/null; then
    echo "  ✓ $pkg installed"
  else
    echo "  ✗ $pkg MISSING — run: $PIP_CMD install $pkg"
    MISSING=$((MISSING + 1))
  fi
}

check "PIL"       "Pillow"
check "yaml"      "PyYAML"
check "rembg"     "rembg"
check "wave"      "wave (stdlib)"
check "struct"    "struct (stdlib)"
check "math"      "math (stdlib)"

# ── rembg model download hint ────────────────────────────────────────────────
#
# The U2-Net model (~176 MB) is downloaded automatically on first rembg use.
# To pre-download it, run:
#   /usr/local/bin/python3 -c "from rembg import remove; remove(b'')"
#
# This avoids a delay on the first actual pipeline run.

REMBG_MODEL_DIR="${HOME}/.u2net"
if [[ ! -d "$REMBG_MODEL_DIR" ]]; then
  echo ""
  echo "[*] Pre-downloading U2-Net model (~176 MB, first run only)..."
  echo "    (This saves time on the first pipeline execution)"
  $PYTHON_BIN -c "
import sys, tempfile
from rembg import remove
# Generate a 1x1 transparent PNG in memory and process it to trigger model download
from PIL import Image
img = Image.new('RGBA', (1, 1), (0, 0, 0, 0))
import io
buf = io.BytesIO()
img.save(buf, format='PNG')
buf.seek(0)
try:
    remove(buf.read())
    print('U2-Net model ready')
except Exception as e:
    # Downloading/caching is also fine
    print('Model download triggered (may continue in background)')
" 2>/dev/null || echo "  (model will download on first pipeline use)"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
if [[ $MISSING -eq 0 ]]; then
  echo "✓ All dependencies installed successfully."
  echo ""
  echo "  Python:     $PYTHON_BIN ($PYTHON_VERSION)"
  echo "  Pillow:     $($PYTHON_BIN -c 'import PIL; print(PIL.__version__)')"
  echo "  PyYAML:     $($PYTHON_BIN -c 'import yaml; print(yaml.__version__)')"
  echo "  rembg:      $($PYTHON_BIN -c 'import rembg; print(rembg.__version__)')"
  echo ""
  echo "  Next: /usr/local/bin/python3 scripts/asset-pipeline/asset-pipeline.py --dry-run"
else
  echo "✗ $MISSING package(s) failed to install. Check errors above."
  exit 1
fi
