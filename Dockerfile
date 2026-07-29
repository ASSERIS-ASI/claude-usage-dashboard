FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    CLAUDE_USAGE_HOST=0.0.0.0 \
    CLAUDE_USAGE_STATE_DIR=/home/dashboard/.claude/usage-dashboard-product

WORKDIR /app
COPY --chown=node:node . .

USER node
EXPOSE 3333
VOLUME ["/home/dashboard/.claude/usage-dashboard-product"]

CMD ["node", "dashboard.js", "--port=3333"]
