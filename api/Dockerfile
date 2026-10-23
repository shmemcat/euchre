FROM python:3.11-slim AS builder
COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

FROM python:3.11-slim
WORKDIR /app
COPY --from=builder /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
ARG VERSION=development
ARG REVISION=unknown
ENV EUCHRE_SERVER_VERSION=$VERSION EUCHRE_SOURCE_REVISION=$REVISION
COPY euchre_server ./euchre_server
COPY migrations ./migrations
COPY gunicorn_conf.py ./
RUN useradd --system --uid 10001 euchre && mkdir instance && chown euchre instance
USER euchre
EXPOSE 5002
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5002/ready', timeout=2)"
# Explicit migration job first. Runtime startup never runs the legacy migrator.
CMD ["gunicorn", "-c", "gunicorn_conf.py", "euchre_server.wsgi:app"]
