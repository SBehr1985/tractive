"""FastAPI-App der Gassi-App: Login über Tractive, Daten, Zeitplan, ausgelieferte Web-App.

Entwicklung:  python -m uvicorn api.main:app --reload --port 8010
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from core import geheim, storage  # noqa: E402

from . import auth, daten, jobs  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    geheim.pruefen()
    storage.init_db()
    jobs.start()
    yield
    jobs.stop()


app = FastAPI(title="Gassi-App", lifespan=lifespan)


@app.middleware("http")
async def sicherheits_header(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


app.include_router(auth.router)
app.include_router(daten.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Gebaute Web-App ausliefern (muss zuletzt kommen, sonst verdeckt es /api)
WEBAPP = Path(__file__).resolve().parents[1] / "webapp" / "dist"
if WEBAPP.is_dir():
    app.mount("/assets", StaticFiles(directory=WEBAPP / "assets"), name="assets")

    @app.get("/{pfad:path}", include_in_schema=False)
    def webapp(pfad: str):
        datei = (WEBAPP / pfad).resolve()
        if pfad and datei.is_file() and WEBAPP in datei.parents:
            return FileResponse(datei)
        return FileResponse(WEBAPP / "index.html")
