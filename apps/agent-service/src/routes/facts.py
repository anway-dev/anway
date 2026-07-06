from fastapi import APIRouter, Request, Header, Query, HTTPException
from datetime import datetime, timezone
import re

UUID_PATTERN = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

router = APIRouter()

def validate_uuid(value: str) -> str:
    if not UUID_PATTERN.match(value):
        raise HTTPException(status_code=400, detail=f"Invalid tenant_id format: {value}")
    return value


def _parse_dt(value) -> datetime | None:
    """Coerce a graphiti-core result field (datetime or ISO string) to an
    aware datetime, or None if absent/unparseable."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


@router.get("")
async def get_facts(
    request: Request,
    query: str = Query(..., min_length=1, max_length=500),
    at: datetime | None = None,
    x_tenant_id: str = Header(...),
):
    validate_uuid(x_tenant_id)
    graphiti = request.app.state.graphiti
    if not graphiti:
        raise HTTPException(status_code=503, detail="Graphiti unavailable")

    # graphiti.search() always returns currently-valid facts — it has no
    # search()-level "as of a past time" kwarg that's stable across
    # graphiti-core versions (this repo pins >=0.3, and the exact temporal
    # query API has changed across releases — see CLAUDE.md's accepted
    # deviation note on Graphiti). Point-in-time semantics for `at` are
    # implemented here instead, by post-filtering each result's own
    # valid_at/invalid_at window client-side — correct regardless of which
    # graphiti-core version is installed, and doesn't depend on a kwarg that
    # might not exist.
    results = await graphiti.search(query=query, group_ids=[x_tenant_id])

    facts = []
    for r in results:
        valid_from = _parse_dt(getattr(r, "valid_at", None))
        valid_to = _parse_dt(getattr(r, "invalid_at", None))
        facts.append({
            "claim": r.fact,
            "source": "graphiti",
            # Previously returned as "valid_at" — the TS Fact interface
            # (packages/agent/src/interfaces/knowledge-graph.ts) expects
            # {claim, source, validFrom, validTo?}, so every real fact
            # crossing this boundary silently got source: undefined and
            # validFrom: undefined on the TS side (an unsafe `as Fact[]`
            # cast masked the mismatch instead of erroring).
            "validFrom": (valid_from or datetime.now(timezone.utc)).isoformat(),
            "validTo": valid_to.isoformat() if valid_to else None,
        })

    if at is not None:
        at_utc = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
        facts = [
            f for f in facts
            if _parse_dt(f["validFrom"]) <= at_utc
            and (f["validTo"] is None or _parse_dt(f["validTo"]) >= at_utc)
        ]

    return facts
