# ---- build: install deps into a self-contained venv ----
# 1. Use the -dev variant so we have a shell and pip to compile our environment
FROM reg.mini.dev/python:3.14.6-dev AS build
USER root
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
# Strip out build/install tools since they aren't needed at runtime
RUN pip uninstall -y pip setuptools wheel

# ---- runtime: copy just the venv + code, run as a non-root user ----
# 2. Keep the hyper-hardened, shell-free production tag here
FROM reg.mini.dev/python:3.14.6 AS runtime
ENV PATH="/venv/bin:$PATH" PYTHONUNBUFFERED=1

WORKDIR /app
COPY --from=build /venv /venv

# We chown to UID 1000, which is the pre-baked non-root user in Minimus images
COPY --chown=1000:1000 app ./app

EXPOSE 8000

# Your executive healthcheck syntax is perfect here since it bypasses the missing shell
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2).status==200 else 1)"]

LABEL org.opencontainers.image.title="shortlink-analytics" \
  org.opencontainers.image.description="ShortLink click analytics (Python/FastAPI)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]