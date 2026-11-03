#!/usr/bin/env sh
# Start the Gridcast web app on macOS/Linux without Docker.
#
#   ./start.sh            # http://127.0.0.1:8000
#   ./start.sh --no-live  # skip live weekend updates
#   PORT=8080 ./start.sh
#
# Needs uv (Python) and Node.js. The script tells you how to install whichever is missing.
set -eu
cd "$(dirname "$0")"
PORT="${PORT:-8000}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "\n'%s' is not installed.\nInstall it with:\n  %s\nthen run this script again.\n\n" "$1" "$2"
    exit 1
  fi
}
need uv "curl -LsSf https://astral.sh/uv/install.sh | sh"
need npm "your package manager (e.g. 'brew install node') or the LTS installer from https://nodejs.org"

# 1. Front end: install packages once, rebuild when the source is newer than the last build.
if [ ! -f web/dist/index.html ] || [ -n "$(find web/src web/index.html -newer web/dist/index.html 2>/dev/null | head -n 1)" ]; then
  [ -d web/node_modules ] || (cd web && echo "Installing front-end packages..." && npm ci --no-audit --no-fund)
  (cd web && echo "Building the front end..." && npm run build)
fi

# 2. Python environment (first run downloads Python 3.13 and the packages).
echo "Preparing the Python environment..."
uv sync --no-dev

# 3. Start the server.
[ "${1:-}" = "--no-live" ] && export F1QP_LIVE_INTERVAL=0
printf "\nStarting Gridcast at http://127.0.0.1:%s (first start computes the predictions, ~10 s). Ctrl+C to stop.\n\n" "$PORT"
exec uv run --no-dev f1qp-serve --port "$PORT"
