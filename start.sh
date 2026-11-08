#!/bin/sh
# Menti starten (macOS/Linux/Git Bash). Optional: Port als Argument.
cd "$(dirname "$0")" && exec java src/Menti.java "$@"
