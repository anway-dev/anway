from fastapi import FastAPI
from .routes import episodes, facts
from .config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD

app = FastAPI(title="Anvay Agent Service")

@app.on_event("startup")
async def startup():
    try:
        from graphiti_core import Graphiti
        app.state.graphiti = Graphiti(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
        await app.state.graphiti.build_indices_and_constraints()
    except Exception:
        app.state.graphiti = None

app.include_router(episodes.router, prefix="/episodes")
app.include_router(facts.router, prefix="/facts")
