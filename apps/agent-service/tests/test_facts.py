from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch


def test_get_facts_returns_list_with_ts_fact_shape():
    from src.main import app

    mock_graphiti = AsyncMock()
    mock_graphiti.build_indices_and_constraints = AsyncMock()

    class FakeResult:
        uuid = "uuid-1"
        fact = "service is healthy"
        valid_at = "2026-01-01T00:00:00Z"

    mock_graphiti.search = AsyncMock(return_value=[FakeResult()])

    with patch.object(app.state, "graphiti", mock_graphiti):
        client = TestClient(app)
        resp = client.get("/facts?query=health", headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        # Regression: previously returned {"claim": ..., "valid_at": ...},
        # which doesn't match the TS Fact interface {claim, source,
        # validFrom, validTo?} — every real fact got source: undefined and
        # validFrom: undefined on the TS side. Now asserting the real
        # contract shape.
        assert data[0]["claim"] == "service is healthy"
        assert data[0]["source"] == "graphiti"
        assert data[0]["validFrom"].startswith("2026-01-01T00:00:00")
        assert data[0]["validTo"] is None


def test_get_facts_defaults_valid_from_to_now_when_graphiti_omits_it():
    from src.main import app

    mock_graphiti = AsyncMock()

    class FakeResultNoTimestamp:
        uuid = "uuid-2"
        fact = "brand new fact"
        # no valid_at attribute at all

    mock_graphiti.search = AsyncMock(return_value=[FakeResultNoTimestamp()])

    with patch.object(app.state, "graphiti", mock_graphiti):
        client = TestClient(app)
        resp = client.get("/facts?query=new", headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"})
        assert resp.status_code == 200
        data = resp.json()
        assert data[0]["validFrom"] is not None


def test_get_facts_filters_by_at_point_in_time():
    from src.main import app

    mock_graphiti = AsyncMock()

    class OldFact:
        fact = "old fact, still valid"
        valid_at = "2020-01-01T00:00:00Z"
        invalid_at = None

    class FutureFact:
        fact = "fact that only became true later"
        valid_at = "2030-01-01T00:00:00Z"
        invalid_at = None

    mock_graphiti.search = AsyncMock(return_value=[OldFact(), FutureFact()])

    with patch.object(app.state, "graphiti", mock_graphiti):
        client = TestClient(app)
        # Regression: `at` was previously accepted but silently dropped —
        # graphiti.search() always returns "now" state regardless of the
        # requested historical time. Point-in-time filtering is now applied
        # client-side against each fact's own valid_at/invalid_at window.
        resp = client.get(
            "/facts?query=q&at=2025-06-01T00:00:00Z",
            headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"},
        )
        assert resp.status_code == 200
        data = resp.json()
        claims = [f["claim"] for f in data]
        assert "old fact, still valid" in claims
        assert "fact that only became true later" not in claims


def test_get_facts_empty_when_graphiti_none():
    from src.main import app

    app.state.graphiti = None
    client = TestClient(app)
    resp = client.get("/facts?query=test", headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"})
    assert resp.status_code == 503  # graphiti unavailable — correct behavior
