#!/bin/bash
# Playwright MCP wrapper - dynamically sets output-dir from environment variable

# Get output directory from environment (set before starting workflow)
OUTPUT_DIR="${PLAYWRIGHT_OUTPUT_DIR:-/app/repos}"

echo "Starting playwright-mcp with output-dir: $OUTPUT_DIR"

exec playwright-mcp \
  --port 8083 \
  --host 0.0.0.0 \
  --allowed-hosts '*' \
  --headless \
  --executable-path /usr/bin/chromium-browser \
  --no-sandbox \
  --output-dir "$OUTPUT_DIR"
