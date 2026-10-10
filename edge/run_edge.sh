#!/usr/bin/env bash
# EarlyEye edge on macOS (Apple Silicon or Intel) and Linux. Usage: edge/run_edge.sh [options]
# Uses uv's self-contained Python 3.11: Homebrew's python@3.11 can break on macOS 26
# (pyexpat vs the system libexpat), which also breaks pip.
set -euo pipefail
cd "$(dirname "$0")/.."
PY=edge/.venv/bin/python
if [ ! -x "$PY" ] || ! "$PY" -c "import cv2, ultralytics, lightgbm" 2>/dev/null; then
  if ! command -v uv >/dev/null 2>&1; then
    echo "Installing uv (Python manager) ..."
    if command -v brew >/dev/null 2>&1; then brew install uv; else curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"; fi
  fi
  [ -x "$PY" ] || uv venv --python 3.11 --managed-python edge/.venv
  echo "Installing the model's packages (first run only, a few minutes) ..."
  uv pip install --python "$PY" -r edge/requirements.txt
fi
if [ "$(uname)" = "Darwin" ] && ! "$PY" -c "import lightgbm" 2>/dev/null; then
  echo "LightGBM needs OpenMP on macOS: brew install libomp"; exit 1
fi
if [ "${1:-}" = "all" ]; then shift; exec "$PY" edge/run_all.py "$@"; fi
exec "$PY" edge/earlyeye_edge.py "$@"
