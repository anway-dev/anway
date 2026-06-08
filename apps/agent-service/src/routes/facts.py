from fastapi import APIRouter, Request, Header, Query
from datetime import datetime

router = APIRouter()

@router.get("")
async def get_facts(
    request: Request,
    query: str = Query(...),
    at: datetime | None = None,
    x_tenant_id: str = Header(...),
):
    graphiti = request.app.state.graphiti
    if graphiti is None:
        return []
    results = await graphiti.search(query=query, group_ids=[x_tenant_id])
    return [{"uuid": str(r.uuid), "fact": r.fact, "valid_at": r.valid_at} for r in results]
