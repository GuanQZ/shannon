#
# Multi-stage Dockerfile for Pentest Agent
# Uses Chainguard Wolfi for minimal attack surface and supply chain security

# Builder stage - Install tools and dependencies
FROM cgr.dev/chainguard/wolfi-base:latest AS builder

# Install system dependencies available in Wolfi
# Note: Not using BuildKit cache for compatibility with GitHub Actions
RUN apk update && apk add --no-cache \
    build-base git curl wget ca-certificates \
    libpcap-dev linux-headers \
    go nodejs-22 npm python3 py3-pip ruby ruby-dev \
    nmap bash

# Set environment variables for Go
ENV GOPATH=/go
ENV PATH=$GOPATH/bin:/usr/local/go/bin:$PATH
ENV CGO_ENABLED=1
# Use China mirror for Go modules
ENV GOPROXY=https://goproxy.cn,direct

# Create directories
RUN mkdir -p $GOPATH/bin

# Install Go-based security tools
RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
# Install WhatWeb from GitHub (Ruby-based tool)
# Use full clone instead of --depth 1 to get complete files
RUN git clone --recursive https://github.com/urbanadventurer/WhatWeb.git /opt/whatweb && \
    chmod +x /opt/whatweb/whatweb && \
    gem install addressable && \
    echo '#!/bin/bash' > /usr/local/bin/whatweb && \
    echo 'cd /opt/whatweb && exec ./whatweb "$@"' >> /usr/local/bin/whatweb && \
    chmod +x /usr/local/bin/whatweb

# Install Python-based tools
# Use China mirror for pip
RUN pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip3 install --no-cache-dir schemathesis

# Runtime stage - Minimal production image
FROM cgr.dev/chainguard/wolfi-base:latest AS runtime

# Install only runtime dependencies
USER root
# Note: Not using BuildKit cache for compatibility with GitHub Actions
RUN apk update && apk add --no-cache \
    git bash curl ca-certificates libpcap nmap ripgrep \
    nodejs-22 npm python3 ruby \
    chromium nss freetype harfbuzz \
    libx11 libxcomposite libxdamage libxext libxfixes libxrandr mesa-gbm \
    fontconfig font-noto-cjk

# Copy Go binaries from builder
COPY --from=builder /go/bin/subfinder /usr/local/bin/

# Copy WhatWeb from builder
COPY --from=builder /opt/whatweb /opt/whatweb
COPY --from=builder /usr/local/bin/whatweb /usr/local/bin/whatweb

# Install WhatWeb Ruby dependencies in runtime stage
RUN gem install addressable

# Copy Python packages from builder
COPY --from=builder /usr/lib/python3.*/site-packages /usr/lib/python3.12/site-packages
COPY --from=builder /usr/bin/schemathesis /usr/bin/

# Download Temporal CLI binary from GitHub releases
RUN curl -sL -o /tmp/temporal.tar.gz https://github.com/temporalio/cli/releases/download/v1.6.1/temporal_cli_1.6.1_linux_amd64.tar.gz && \
    tar -xzf /tmp/temporal.tar.gz -C /usr/local/bin/ temporal && \
    chmod +x /usr/local/bin/temporal && \
    rm /tmp/temporal.tar.gz

# Create non-root user for security
RUN addgroup -g 1001 pentest && \
    adduser -u 1001 -G pentest -s /bin/bash -D pentest

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY lumin-tool-mcp/package*.json ./lumin-tool-mcp/

# Install Node.js dependencies (including devDependencies for TypeScript build)
# Use official npm registry (npmmirror has missing packages)
RUN npm config set registry https://registry.npmjs.org && \
    set -e; \
    max_retries=3; \
    retry_delay=5; \
    for attempt in $(seq 1 $max_retries); do \
        echo "npm ci attempt $attempt of $max_retries"; \
        if npm ci --no-audit --loglevel=error; then \
            echo "npm ci succeeded"; \
            break; \
        else \
            if [ $attempt -lt $max_retries ]; then \
                echo "npm ci failed, retrying in $retry_delay seconds..."; \
                sleep $retry_delay; \
                retry_delay=$((retry_delay * 2)); \
            else \
                echo "npm ci failed after $max_retries attempts"; \
                exit 1; \
            fi; \
        fi; \
    done && \
    cd lumin-tool-mcp && \
    retry_delay=5; \
    for attempt in $(seq 1 $max_retries); do \
        echo "lumin-tool-mcp npm ci attempt $attempt of $max_retries"; \
        if npm ci --no-audit --loglevel=error; then \
            echo "lumin-tool-mcp npm ci succeeded"; \
            break; \
        else \
            if [ $attempt -lt $max_retries ]; then \
                echo "lumin-tool-mcp npm ci failed, retrying in $retry_delay seconds..."; \
                sleep $retry_delay; \
                retry_delay=$((retry_delay * 2)); \
            else \
                echo "lumin-tool-mcp npm ci failed after $max_retries attempts"; \
                exit 1; \
            fi; \
        fi; \
    done && \
    cd ..

# Copy application source code
COPY . .

# Build TypeScript (lumin-tool-mcp first, then main project)
RUN cd lumin-tool-mcp && npm run build && cd .. && npm run build

# Pre-install playwright-mcp for offline use
RUN npm config set registry https://registry.npmjs.org && \
    npm install -g @playwright/mcp@latest

# Remove devDependencies after build to reduce image size
RUN npm prune --production && \
    cd lumin-tool-mcp && npm prune --production

# Create directories for session data and ensure proper permissions
RUN mkdir -p /app/sessions /app/deliverables /app/repos /app/configs && \
    mkdir -p /tmp/.cache /tmp/.config /tmp/.npm && \
    chmod 777 /app && \
    chmod 777 /tmp/.cache && \
    chmod 777 /tmp/.config && \
    chmod 777 /tmp/.npm && \
    chown -R pentest:pentest /app

# Switch to non-root user
USER pentest

# Set environment variables
ENV NODE_ENV=production
ENV PATH="/usr/local/bin:$PATH"
ENV LUMIN_DOCKER=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV npm_config_cache=/tmp/.npm
ENV HOME=/tmp
ENV XDG_CACHE_HOME=/tmp/.cache
ENV XDG_CONFIG_HOME=/tmp/.config

# Configure Git identity and trust all directories
RUN git config --global user.email "Lumin@localhost" && \
    git config --global user.name "Lumin Agent" && \
    git config --global --add safe.directory '*'

# Create startup script for K8s deployment (includes Temporal server)
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "Starting Lumin services..."\n\
\n\
# Create required directories\n\
mkdir -p /app/audit-logs\n\
mkdir -p /app/repos\n\
mkdir -p /app/deliverables\n\
mkdir -p /app/temporal-data\n\
\n\
# Start Temporal server first (port 7233)\n\
echo "Starting Temporal Server on port 7233..."\n\
temporal server start-dev \\\n\
  --db-filename /app/temporal-data/temporal.db \\\n\
  --ip 0.0.0.0 \\\n\
  --port 7233 \\\n\
  --frontend-port 7233 &\n\
TEMPORAL_PID=$!\n\
\n\
# Wait for Temporal to be ready\n\
echo "Waiting for Temporal to be ready..."\n\
sleep 10\n\
\n\
# Start MCP Server (port 8082)\n\
echo "Starting MCP Server on port 8082..."\n\
node /app/lumin-tool-mcp/dist/http-server.js &\n\
MCP_PID=$!\n\
\n\
sleep 3\n\
\n\
# Start Playwright MCP (port 8083)\n\
echo "Starting Playwright MCP on port 8083..."\n\
playwright-mcp --port 8083 --host 0.0.0.0 --allowed-hosts "*" --headless --executable-path /usr/bin/chromium-browser --no-sandbox --output-dir /app/repos &\n\
PLAYWRIGHT_PID=$!\n\
\n\
sleep 2\n\
\n\
# Start Temporal Worker (connects to localhost:7233)\n\
echo "Starting Temporal Worker..."\n\
TEMPORAL_ADDRESS=localhost:7233 node /app/dist/temporal/worker.js &\n\
WORKER_PID=$!\n\
\n\
# Start Dashboard (port 3457)\n\
echo "Starting Dashboard on port 3457..."\n\
TEMPORAL_ADDRESS=localhost:7233 node /app/dashboard/server.js &\n\
DASHBOARD_PID=$!\n\
\n\
echo "=========================================="\n\
echo "All Lumin services started successfully!"\n\
echo "Temporal Server:  http://localhost:7233"\n\
echo "Temporal Web:    http://localhost:8233"\n\
echo "MCP Server:      http://localhost:8082/health"\n\
echo "Playwright MCP:  http://localhost:8083"\n\
echo "Dashboard:       http://localhost:3457"\n\
echo "=========================================="\n\
\n\
wait' > /app/start.sh && chmod +x /app/start.sh

# Set entrypoint to use the startup script
ENTRYPOINT ["/app/start.sh"]
