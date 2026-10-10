#!/usr/bin/env bash
# EarlyEye cameras: opening the dashboard turns them on (see edge/launcher.py). Close this window to stop.
printf '\033]0;EarlyEye cameras\007'
cd "$(dirname "$0")/.."
exec edge/.venv/bin/python edge/launcher.py
