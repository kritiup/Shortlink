# syntax=docker/dockerfile:1

# ---- build: install production dependencies only ----
FROM reg.mini.dev/node:v26.5.0 AS build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# ---- runtime: slim base, non-root, read-only friendly ----
FROM reg.mini.dev/node:v26.5.0 AS runtime
ENV NODE_ENV=production
WORKDIR /app
# the official node image already ships an unprivileged "node" user (uid 1000)
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node healthcheck.js ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "healthcheck.js"]
LABEL org.opencontainers.image.title="shortlink-api" \
  org.opencontainers.image.description="ShortLink control-plane API (Node/Express)"
CMD ["node", "src/server.js"]