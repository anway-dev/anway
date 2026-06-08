from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch


def test_get_facts_returns_list():
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
        resp = client.get("/facts?query=health", headers={"X-Tenant-Id": "t-1"})
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert data[0]["claim"] == "service is healthy"


def test_get_facts_empty_when_graphiti_none():
    from src.main import app

    app.state.graphiti = None
    client = TestClient(app)
    resp = client.get("/facts?query=test", headers={"X-Tenant-Id": "t-1"})
    assert resp.status_code == 200
    assert resp.json() == []
