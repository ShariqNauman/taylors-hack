#!/usr/bin/env bash
# EarlyEye edge on macOS (Apple Silicon or Intel) and Linux. Usage: edge/run_edge.sh [options]
set -euo pipefail
cd "$(dirname "$0")/.."
PY=edge/.venv/bin/python
if [ ! -x "$PY" ]; then
  BASE=$(command -v python3.11 || true)
  [ -z "$BASE" ] && { echo "Install Python 3.11 first: brew install python@3.11"; exit 1; }
  echo "Creating edge/.venv with $BASE ..."
  "$BASE" -m venv edge/.venv || "$BASE" -m venv --without-pip edge/.venv
  if ! "$PY" -m pip --version >/dev/null 2>&1; then
    curl -sSL https://bootstrap.pypa.io/get-pip.py -o /tmp/get-pip.py && "$PY" /tmp/get-pip.py
  fi
  "$PY" -m pip install --upgrade pip
  "$PY" -m pip install -r edge/requirements.txt
fi
if [ "$(uname)" = "Darwin" ] && ! "$PY" -c "import lightgbm" 2>/dev/null; then
  echo "LightGBM needs OpenMP on macOS: brew install libomp"; exit 1
fi
exec "$PY" edge/earlyeye_edge.py "$@"
