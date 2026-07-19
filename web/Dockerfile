# syntax=docker/dockerfile:1

# ---- build: compile the React app to static files ----
FROM reg.mini.dev/node:v26.5.0 AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime: unprivileged nginx serving static files + proxying the API ----
FROM reg.mini.dev/nginx:v1.31.3 AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["wget", "-qO-", "http://127.0.0.1:8080/healthz"]
LABEL org.opencontainers.image.title="shortlink-web" \
  org.opencontainers.image.description="ShortLink frontend + edge proxy (nginx)"