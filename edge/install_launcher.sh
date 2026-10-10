#!/usr/bin/env bash
# Start edge/launcher.py at login (macOS), so opening the dashboard turns the cameras on.
# It runs inside Terminal (opened in the background): macOS gives the webcam to Terminal, never to
# a background launchd job ("Cannot open camera").
#   edge/install_launcher.sh            install (and start now)
#   edge/install_launcher.sh remove     uninstall
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL=com.earlyeye.launcher
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null && sleep 2 || true
if [ "${1:-}" = "remove" ]; then rm -f "$PLIST"; pkill -f "edge/launcher.py" || true; echo "Removed."; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/usr/bin/open</string><string>-g</string><string>-a</string><string>Terminal</string><string>$PWD/edge/launcher.command</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PL
pkill -f "edge/launcher.py" 2>/dev/null || true; sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: a Terminal window named 'EarlyEye cameras' opens at login; http://127.0.0.1:8700/status. Remove: edge/install_launcher.sh remove"
