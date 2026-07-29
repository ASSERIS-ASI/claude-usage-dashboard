FROM node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

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
