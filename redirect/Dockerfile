# syntax=docker/dockerfile:1

# ---- build: compile a static binary ----
FROM reg.mini.dev/go:v1.26.5 AS build
WORKDIR /src
COPY go.mod ./
COPY main.go ./
# resolve deps + write go.sum, then build a small, static, stripped binary
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/redirect .

# ---- runtime: distroless "static", non-root, no shell, no package manager ----
FROM reg.mini.dev/go:v1.26.5 AS runtime
COPY --from=build /out/redirect /redirect
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD ["/redirect", "-healthcheck"]
LABEL org.opencontainers.image.title="shortlink-redirect" \
  org.opencontainers.image.description="ShortLink redirect hot path (Go, distroless)"
ENTRYPOINT ["/redirect"]