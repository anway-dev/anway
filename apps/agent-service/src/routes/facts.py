from fastapi import APIRouter, Request, Header, Query, HTTPException
from datetime import datetime
import re

UUID_PATTERN = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

router = APIRouter()

def validate_uuid(value: str) -> str:
    if not UUID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid tenant_id format: {value}")
    return value

@router.get("")
async def get_facts(
    request: Request,
    query: str = Query(..., min_length=1, max_length=500),
    at: datetime | None = None,
    x_tenant_id: str = Header(...),
):
    validate_uuid(x_tenant_id)
    graphiti = request.app.state.graphiti
    if graphiti is None:
        return []
    results = await graphiti.search(query=query, group_ids=[x_tenant_id])
    return [{"claim": r.fact, "valid_at": r.valid_at} for r in results]
