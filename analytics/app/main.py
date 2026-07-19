"""ShortLink analytics service.

Two jobs in one process:
  1. A background worker that blocks on the Redis "clicks" queue and folds
     each click into an aggregate row in Postgres.
  2. A tiny HTTP API the Node service calls to read those aggregates.
"""

import asyncio
import os
from contextlib import asynccontextmanager

import psycopg
import redis.asyncio as redis
from fastapi import FastAPI, HTTPException


def env(key: str, default: str) -> str:
    return os.getenv(key, default)


def read_secret(key: str, default: str = "") -> str:
    """Read KEY_FILE (a mounted secret) if set, otherwise KEY."""
    path = os.getenv(f"{key}_FILE")
    if path and os.path.exists(path):
        with open(path) as fh:
            return fh.read().strip()
    return os.getenv(key, default)


PG_DSN = (
    f"host={env('PGHOST', 'postgres')} port={env('PGPORT', '5432')} "
    f"dbname={env('PGDATABASE', 'shortlink')} user={env('PGUSER', 'shortlink')} "
    f"password={read_secret('PGPASSWORD', '')}"
)
REDIS_URL = env("REDIS_URL", "redis://redis:6379")

UPSERT = (
    "INSERT INTO click_stats(code, clicks) VALUES(%s, 1) "
    "ON CONFLICT (code) DO UPDATE "
    "SET clicks = click_stats.clicks + 1, updated_at = now()"
)

_redis: "redis.Redis | None" = None


async def consume_clicks() -> None:
    """Drain the Redis click queue into Postgres, forever."""
    r = redis.from_url(REDIS_URL, decode_responses=True)
    while True:
        try:
            async with await psycopg.AsyncConnection.connect(PG_DSN, autocommit=True) as conn:
                while True:
                    item = await r.blpop("clicks", timeout=5)
                    if item is None:
                        continue
                    _, code = item
                    await conn.execute(UPSERT, (code,))
        except Exception as exc:  # reconnect on any transient failure
            print("consumer error:", exc, flush=True)
            await asyncio.sleep(2)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _redis
    _redis = redis.from_url(REDIS_URL, decode_responses=True)
    task = asyncio.create_task(consume_clicks())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="shortlink-analytics", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    try:
        await _redis.ping()
        async with await psycopg.AsyncConnection.connect(PG_DSN) as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.get("/stats/{code}")
async def stats(code: str):
    async with await psycopg.AsyncConnection.connect(PG_DSN) as conn:
        cur = await conn.execute("SELECT clicks FROM click_stats WHERE code=%s", (code,))
        row = await cur.fetchone()
    return {"code": code, "clicks": row[0] if row else 0}
