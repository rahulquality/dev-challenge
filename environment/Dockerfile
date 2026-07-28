# Firmware release-publishing task image.
# Base image digest supplied pre-pinned by the orchestrator spec (used verbatim).
# node:20 provides global fetch and `node --test` (Node >= 18 required by the verifier).
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

# System packages, one consolidated apt transaction:
#   - openssl:         the gateway shells out to `openssl cms -verify`; also used
#                      below to generate the signing keypairs at build time.
#   - ca-certificates: HTTPS trust store.
#   - build-essential + python3: node-gyp fallback so the `duckdb` npm package can
#                      compile its native addon if no prebuilt binary covers the
#                      platform.
#   - python3-pip:     to install the Python verifier toolchain at build time.
#   - tmux, asciinema: agent runtime-recording requirements.
# allow_internet=false at task runtime: everything is installed here at BUILD time.
# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        asciinema \
        build-essential \
        ca-certificates \
        openssl \
        python3 \
        python3-pip \
        tmux \
    && rm -rf /var/lib/apt/lists/*

# Python test toolchain (verifier runs `python -m pytest --ctrf ...` in THIS
# container, offline at runtime). Pinned exactly; Debian's externally-managed
# environment is overridden with --break-system-packages (acceptable in a task
# container).
RUN pip install --no-cache-dir --break-system-packages \
        pytest==8.4.1 \
        pytest-json-ctrf==0.3.5 \
        requests==2.32.3 \
        duckdb==1.1.3

WORKDIR /app

# Build-time signing keypairs. NOT shipped as fixtures: they exist only in the
# built image. current/ is the key in force (the publisher signs, the gateway
# verifies); revoked/ is retained so the UNTRUSTED_SIGNATURE rotation scenario is
# reproducible.
RUN mkdir -p /app/keys/current /app/keys/revoked \
 && openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
      -keyout /app/keys/current/current.key.pem \
      -out    /app/keys/current/current.cert.pem \
      -subj "/CN=fw-signing-2026-current/O=ReleaseEng/C=US" \
 && openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
      -keyout /app/keys/revoked/revoked.key.pem \
      -out    /app/keys/revoked/revoked.cert.pem \
      -subj "/CN=fw-signing-2025-revoked/O=ReleaseEng/C=US" \
 && chmod -R a+rX /app/keys

# --- Node dependency install (build-time, for offline runtime) ---
# Copy manifests first for layer-cache friendliness, install, then copy sources.
# Both manifests use exact version pins (duckdb 1.1.3, express 4.19.2); no
# lockfiles ship, so `npm install` is used (npm ci requires a lockfile).

# Root publisher package (declares pinned `duckdb`; ESM).
COPY package.json /app/package.json
RUN npm install --no-audit --no-fund

# Distribution gateway subproject (pins express@4.19.2; starts with `node server.js`).
COPY distribution-gateway/package.json /app/distribution-gateway/package.json
WORKDIR /app/distribution-gateway
RUN npm install --no-audit --no-fund
WORKDIR /app

# Remaining gateway sources (server.js, app.js, lib/, etc.).
COPY distribution-gateway/ /app/distribution-gateway/

# Task fixtures.
COPY fixtures/build_manifest.csv /app/fixtures/build_manifest.csv
COPY reports/publications.expected.txt /app/reports/publications.expected.txt

# The verifier launches the gateway in the background and drives it over
# localhost; there is no CMD that starts it. A default interactive shell suffices.
CMD ["/bin/bash"]
