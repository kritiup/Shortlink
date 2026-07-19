# syntax=docker/dockerfile:1

# ---- build: install deps into a self-contained venv ----
FROM python:3.12-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# ---- runtime: copy just the venv + code, run as a non-root user ----
FROM python:3.12-slim-bookworm AS runtime
ENV PATH="/venv/bin:$PATH" PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 appuser
COPY --from=build /venv /venv
WORKDIR /app
COPY --chown=appuser:appuser app ./app
USER appuser
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"]
LABEL org.opencontainers.image.title="shortlink-analytics" \
      org.opencontainers.image.description="ShortLink click analytics (Python/FastAPI)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
