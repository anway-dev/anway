from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from datetime import datetime


def test_add_episode_returns_ok():
    from src.main import app

    mock_graphiti = AsyncMock()
    mock_graphiti.add_episode = AsyncMock()
    mock_graphiti.build_indices_and_constraints = AsyncMock()

    with patch.object(app.state, "graphiti", mock_graphiti):
        client = TestClient(app)
        resp = client.post(
            "/episodes",
            json={
                "name": "test",
                "episode_body": "test body",
                "source_description": "test source",
                "reference_time": "2026-01-01T00:00:00Z",
            },
            headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"},
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_add_episode_unavailable_when_graphiti_none():
    from src.main import app

    app.state.graphiti = None
    client = TestClient(app)
    resp = client.post(
        "/episodes",
        json={
            "name": "test",
            "episode_body": "test",
            "source_description": "test",
            "reference_time": "2026-01-01T00:00:00Z",
        },
        headers={"X-Tenant-Id": "00000000-0000-0000-0000-000000000001"},
    )
    assert resp.status_code == 503  # graphiti unavailable — correct behavior
