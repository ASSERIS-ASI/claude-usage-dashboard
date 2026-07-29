FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

ARG OCI_SOURCE=https://github.com/ASSERIS-ASI/claude-usage-dashboard
ARG OCI_REVISION=unknown
ARG OCI_VERSION=development

LABEL org.opencontainers.image.title="Claude Usage Dashboard" \
      org.opencontainers.image.description="Local-first analytics for Claude Code usage" \
      org.opencontainers.image.vendor="ASSERIS AISBL" \
      org.opencontainers.image.source="${OCI_SOURCE}" \
      org.opencontainers.image.revision="${OCI_REVISION}" \
      org.opencontainers.image.version="${OCI_VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.documentation="${OCI_SOURCE}#readme"

ENV NODE_ENV=production \
    CLAUDE_USAGE_HOST=0.0.0.0 \
    CLAUDE_CONFIG_DIR=/home/node/.claude \
    CLAUDE_USAGE_MIGRATE_LEGACY_STATE=1 \
    CLAUDE_USAGE_STATE_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force
COPY --chown=node:node . .
RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3333
VOLUME ["/data"]

CMD ["node", "dashboard.js", "--port=3333"]
