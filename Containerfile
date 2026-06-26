# SPDX-License-Identifier: MPL-2.0
# Copyright (c) Jonathan D.A. Jewell <j.d.a.jewell@open.ac.uk>
#
# Svalinn — verified-container gateway (MVP).
#
# Containerises the MVP gateway (tools/mvp/svalinn_gateway.ts — the documented
# TypeScript exemption in svalinn/.claude/CLAUDE.md), which is the only runnable
# surface today. It binds SVALINN_HOST/SVALINN_PORT and serves /health(z),
# /v1/containers, /v1/images, /verify, /run, /status/:jobId.
#
# Subprocess-backed endpoints (/verify, /run) need the vordr + svalinn-gate
# binaries; without them the gateway still serves /health(z) and the JSON-backed
# list endpoints, degrading gracefully.
FROM denoland/deno:alpine

WORKDIR /app

# The MVP gateway plus its JSON fallbacks for the list endpoints.
COPY tools/mvp/svalinn_gateway.ts ./tools/mvp/svalinn_gateway.ts
COPY tools/mvp/containers.json ./tools/mvp/containers.json
COPY tools/mvp/images.json ./tools/mvp/images.json

ENV SVALINN_PORT=8000 \
    SVALINN_HOST=0.0.0.0 \
    SVALINN_STATE_PATH=/tmp/svalinn-state.json \
    SVALINN_AUDIT_PATH=/tmp/svalinn-audit.log

USER deno
EXPOSE 8000

# Liveness: the gateway is up if /health answers at all (it returns 503 while
# optional dependencies like vordr are absent, which is expected in a minimal
# image — so treat any HTTP response as "up").
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["deno", "eval", "--allow-net", "try { await fetch('http://localhost:8000/health'); Deno.exit(0); } catch { Deno.exit(1); }"]

CMD ["deno", "run", "--allow-net", "--allow-read", "--allow-write", "--allow-env", "--allow-run", "tools/mvp/svalinn_gateway.ts"]
