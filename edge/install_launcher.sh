#!/usr/bin/env bash
# Start edge/launcher.py at login (macOS), so opening the dashboard turns the cameras on.
#   edge/install_launcher.sh            install (and start now)
#   edge/install_launcher.sh remove     uninstall
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL=com.earlyeye.launcher
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = "remove" ]; then rm -f "$PLIST"; echo "Removed."; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$PWD/edge/.venv/bin/python</string><string>$PWD/edge/launcher.py</string></array>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$PWD/edge/launcher.log</string>
  <key>StandardErrorPath</key><string>$PWD/edge/launcher.log</string>
</dict></plist>
PL
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed: http://127.0.0.1:8700/status (log: edge/launcher.log). Remove: edge/install_launcher.sh remove"
