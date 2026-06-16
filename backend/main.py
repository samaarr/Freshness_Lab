"""freshness-lab API — all phases wired.

Live demo:  PATCH services -> change stream -> classifier -> router -> ledger -> SSE
Agent:      POST /api/ask -> $vectorSearch -> mode-forked context -> Claude -> provenance
Benchmark:  POST /api/benchmark/run -> deterministic curve JSON
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import agent
import benchmark
import db
import events
import mode as mode_state
import pipeline
import watcher
from config import CORS_ORIGINS, VECTOR_INDEX_NAME
from embedder import get_embedder

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    watcher.start()
    yield
    watcher.stop()


app = FastAPI(title="freshness-lab", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


class QueryRequest(BaseModel):
    question: str


class AskRequest(BaseModel):
    question: str


class ModeRequest(BaseModel):
    mode: str


class ServicePatch(BaseModel):
    status: str | None = None
    error_rate: float | None = None
    on_call: str | None = None
    runbook_text: str | None = None


@app.get("/healthz")
def healthz():
    return {"ok": True, "mode": mode_state.get_mode()}


@app.post("/api/query")
def query(req: QueryRequest):
    doc = agent.retrieve(req.question)
    if not doc:
        raise HTTPException(503, "vectorSearch returned empty — index may not be READY")
    return {"service_name": doc["name"], "similarity_score": round(float(doc["similarity_score"]), 4),
            "runbook_text": doc["runbook_text"]}


@app.post("/api/ask")
def ask(req: AskRequest):
    try:
        return agent.ask(req.question)
    except RuntimeError as exc:
        raise HTTPException(503, str(exc))


@app.get("/api/mode")
def get_mode():
    return {"mode": mode_state.get_mode()}


@app.post("/api/mode")
def set_mode(req: ModeRequest):
    try:
        return {"mode": mode_state.set_mode(req.mode)}
    except ValueError as exc:
        raise HTTPException(422, str(exc))


@app.post("/api/reset")
def reset_demo():
    return pipeline.reset_all()


@app.post("/api/rebuild")
def rebuild():
    return pipeline.rebuild_all()


@app.get("/api/services")
def services():
    return pipeline.freshness_state()


@app.patch("/api/services/{name}")
def patch_service(name: str, patch: ServicePatch):
    update = {k: v for k, v in patch.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(422, "no fields to update")
    if "status" in update and update["status"] not in {"available", "limited", "sold_out"}:
        raise HTTPException(422, "status must be available|limited|sold_out")
    res = db.services().update_one({"name": name}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(404, f"unknown service '{name}'")
    return {"ok": True, "updated": sorted(update.keys())}


@app.get("/api/freshness")
def freshness():
    return pipeline.freshness_state()


@app.get("/api/ledger")
def get_ledger(limit: int = 50):
    rows = list(db.ledger().find({}, {"_id": 0}).sort("changed_at", -1).limit(limit))
    return rows


@app.get("/api/events")
async def sse():
    q = events.subscribe()
    return StreamingResponse(events.sse_stream(q), media_type="text/event-stream")


class BenchRequest(BaseModel):
    scenario: str  # mechanism_a | mechanism_b | control
    seed: int = 42


@app.post("/api/benchmark/run")
def bench_run(req: BenchRequest):
    if req.scenario not in {"mechanism_a", "mechanism_b", "control"}:
        raise HTTPException(422, "scenario must be mechanism_a|mechanism_b|control")
    return benchmark.run_scenario(req.scenario, seed=req.seed)


@app.get("/api/benchmark/results")
def bench_results():
    rows = list(db.get_db()[benchmark.COLLECTION_BENCH].find({}, {"_id": 0}))
    return {"results": rows, "ttf": benchmark.ttf_stats()}
