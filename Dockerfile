# syntax=docker/dockerfile:1
# Multi-stage build: 1) front end (Node), 2) Python app with the precomputed artifact.
#
#   docker build -t f1qp .
# Behind a TLS-intercepting proxy, pass its CA as a build secret (optional):
#   docker build --network=host --build-arg HTTPS_PROXY=$HTTPS_PROXY --secret id=ca_cert,src=/path/ca.crt -t f1qp .

# REGISTRY lets you build from a Docker Hub mirror, e.g. --build-arg REGISTRY=mirror.gcr.io/library
ARG REGISTRY=docker.io/library

FROM ${REGISTRY}/node:22.11-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca_cert; fi; npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM ${REGISTRY}/python:3.13-slim AS app
# git: the live service updates F1DB with a sparse git clone (INSTALL_GIT=0 skips it; live then
# uses the bundled data file and OpenF1 only).
ARG INSTALL_GIT=1
RUN if [ "$INSTALL_GIT" = "1" ]; then apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*; fi
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export PIP_CERT=/run/secrets/ca_cert; fi; pip install --no-cache-dir uv==0.11.32
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 HOST=0.0.0.0 PORT=8000 F1QP_STATIC_DIR=/app/web/dist
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=secret,id=ca_cert,required=false \
    if [ -f /run/secrets/ca_cert ]; then export SSL_CERT_FILE=/run/secrets/ca_cert; fi; uv sync --frozen --no-dev --no-install-project
COPY f1qp/ f1qp/
COPY data/qualifying_entries.csv data/media_manifest.json data/
RUN uv sync --frozen --no-dev && f1qp-build
COPY --from=web /web/dist web/dist
RUN useradd --create-home --uid 10001 f1qp && chown -R f1qp /app
USER f1qp
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status == 200 else 1)"
CMD ["sh", "-c", "uvicorn f1qp.server:create_app --factory --host $HOST --port $PORT --proxy-headers --forwarded-allow-ips='*'"]
