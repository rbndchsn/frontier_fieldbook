#!/bin/bash
cd "$(dirname "$0")" || exit 1
if ! command -v python3 >/dev/null; then
  echo 'Python 3 is required. Install it from python.org or use the browser-only index.html mode.'
  read -r -p 'Press Return to close.'; exit 1
fi
python3 server.py
