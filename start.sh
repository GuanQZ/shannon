#!/bin/bash
set -e

echo "Starting Lumin services..."

# Read configuration from lumin.yaml
CONFIG_FILE="/app/configs/lumin.yaml"
if [ -f "$CONFIG_FILE" ]; then
  # Extract port configs using grep and sed (minimal dependencies)
  MCP_PORT_CONFIG=$(grep -E "^[[:space:]]*mcpPort:" "$CONFIG_FILE" | sed "s/.*mcpPort:[[:space:]]*//" | tr -d " \"")
  PLAYWRIGHT_PORT_CONFIG=$(grep -E "^[[:space:]]*playwrightPort:" "$CONFIG_FILE" | sed "s/.*playwrightPort:[[:space:]]*//" | tr -d " \"")
  DASHBOARD_PORT_CONFIG=$(grep -E "^[[:space:]]*dashboardPort:" "$CONFIG_FILE" | sed "s/.*dashboardPort:[[:space:]]*//" | tr -d " \"")

  # Env vars override config file
  export MCP_PORT=${MCP_PORT:-$MCP_PORT_CONFIG}
  export PLAYWRIGHT_PORT=${PLAYWRIGHT_PORT:-$PLAYWRIGHT_PORT_CONFIG}
  export DASHBOARD_PORT=${DASHBOARD_PORT:-$DASHBOARD_PORT_CONFIG}
fi

# Fallback defaults
export MCP_PORT=${MCP_PORT:-8082}
export PLAYWRIGHT_PORT=${PLAYWRIGHT_PORT:-8083}
export DASHBOARD_PORT=${DASHBOARD_PORT:-3457}

# Create required directories
mkdir -p /app/audit-logs
mkdir -p /app/repos
mkdir -p /app/deliverables
mkdir -p /app/temporal-data

# Start Temporal server first (port 7233)
echo "Starting Temporal Server on port 7233..."
temporal server start-dev \
  --db-filename /app/temporal-data/temporal.db \
  --ip 0.0.0.0 \
  --port 7233 \
  --frontend-port 7233 &
TEMPORAL_PID=$!

# Wait for Temporal to be ready
echo "Waiting for Temporal to be ready..."
sleep 10

# Start MCP Server
echo "Starting MCP Server on port ${MCP_PORT}..."
PORT=${MCP_PORT} node /app/lumin-tool-mcp/dist/http-server.js &
MCP_PID=$!

sleep 3

# Start Playwright MCP
echo "Starting Playwright MCP on port ${PLAYWRIGHT_PORT}..."
playwright-mcp --port ${PLAYWRIGHT_PORT} --host 0.0.0.0 --allowed-hosts "*" --headless --executable-path /usr/bin/chromium-browser --no-sandbox --output-dir /app/repos &
PLAYWRIGHT_PID=$!

sleep 2

# Start Temporal Worker (connects to localhost:7233)
echo "Starting Temporal Worker..."
TEMPORAL_ADDRESS=localhost:7233 node /app/dist/temporal/worker.js &
WORKER_PID=$!

# Start Dashboard
echo "Starting Dashboard on port ${DASHBOARD_PORT}..."
PORT=${DASHBOARD_PORT} TEMPORAL_ADDRESS=localhost:7233 node /app/dashboard/server.js &
DASHBOARD_PID=$!

echo "=========================================="
echo "All Lumin services started successfully!"
echo "Temporal Server:  http://localhost:7233"
echo "Temporal Web:    http://localhost:8233"
echo "MCP Server:      http://localhost:${MCP_PORT}/health"
echo "Playwright MCP:  http://localhost:${PLAYWRIGHT_PORT}"
echo "Dashboard:       http://localhost:${DASHBOARD_PORT}"
echo "=========================================="

wait
