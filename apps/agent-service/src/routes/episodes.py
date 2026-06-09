from fastapi import APIRouter, Request, Header, HTTPException
from pydantic import BaseModel
from datetime import datetime
import re

UUID_PATTERN = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

router = APIRouter()

class EpisodeIn(BaseModel):
    name: str
    episode_body: str
    source_description: str
    reference_time: datetime

def validate_uuid(value: str) -> str:
    if not UUID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid tenant_id format: {value}")
    return value

@router.post("")
async def add_episode(body: EpisodeIn, request: Request, x_tenant_id: str = Header(...)):
    validate_uuid(x_tenant_id)
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
