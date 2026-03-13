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
# Use Go module proxy for China
ENV GOPROXY=https://goproxy.cn,direct
# Use npm mirror for China
ENV npm_config_registry=https://registry.npmmirror.com
# Use pip mirror for China
ENV PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/
# Use gem mirror for China
ENV GEM_SOURCE=https://mirrors.aliyun.com/rubygems/

# Create directories
RUN mkdir -p $GOPATH/bin

# Install Go-based security tools
RUN go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
# Install WhatWeb from GitHub (Ruby-based tool)
RUN git clone --depth 1 https://github.com/urbanadventurer/WhatWeb.git /opt/whatweb && \
    chmod +x /opt/whatweb/whatweb && \
    gem install addressable && \
    echo '#!/bin/bash' > /usr/local/bin/whatweb && \
    echo 'cd /opt/whatweb && exec ./whatweb "$@"' >> /usr/local/bin/whatweb && \
    chmod +x /usr/local/bin/whatweb

# Install Python-based tools
RUN pip3 install --no-cache-dir schemathesis

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

# Create non-root user for security
RUN addgroup -g 1001 pentest && \
    adduser -u 1001 -G pentest -s /bin/bash -D pentest

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY lumin-tool-mcp/package*.json ./lumin-tool-mcp/

# Install Node.js dependencies (including devDependencies for TypeScript build)
# Use retry mechanism to handle transient network errors
# Note: Not using BuildKit cache for compatibility with GitHub Actions
RUN set -e; \
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
RUN npm install -g @playwright/mcp@latest

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

# Set entrypoint
ENTRYPOINT ["node", "dist/lumin.js"]
