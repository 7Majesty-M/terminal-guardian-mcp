# ─── Build stage ──────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ─── Runtime stage ────────────────────────────────────────────
FROM node:20-alpine AS runtime

LABEL org.opencontainers.image.title="Terminal Guardian MCP"
LABEL org.opencontainers.image.description="Secure MCP server for AI terminal access"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.source="https://github.com/7Majesty-M/terminal-guardian-mcp"

# Install tini for proper signal handling
RUN apk add --no-cache tini git bash

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 guardian && \
    adduser -u 1001 -G guardian -s /bin/sh -D guardian

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY terminal-guardian.config.json ./

# Create log directory with correct permissions
RUN mkdir -p /app/logs /app/workspace && \
    chown -R guardian:guardian /app

USER guardian

# Set workspace to a safe directory
ENV GUARDIAN_CONFIG=/app/terminal-guardian.config.json

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
