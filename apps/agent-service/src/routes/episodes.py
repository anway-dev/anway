from fastapi import APIRouter, Request, Header
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class EpisodeIn(BaseModel):
    name: str
    episode_body: str
    source_description: str
    reference_time: datetime

@router.post("")
async def add_episode(body: EpisodeIn, request: Request, x_tenant_id: str = Header(...)):
    graphiti = request.app.state.graphiti
    if graphiti is None:
        return {"status": "unavailable", "error": "Graphiti not initialized"}
    await graphiti.add_episode(
        name=body.name,
        episode_body=body.episode_body,
        source_description=body.source_description,
        reference_time=body.reference_time,
        group_id=x_tenant_id,
    )
    return {"status": "ok"}
