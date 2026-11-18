"""Tests for zeroWait API root and health endpoints."""

import asyncpg
import pytest
from httpx import ASGITransport, AsyncClient

from app.api import health as health_module
from app.database.session import get_session
from app.main import app


@pytest.fixture
def client():
    """Create an async test client."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.mark.asyncio
async def test_root_endpoint(client: AsyncClient) -> None:
    """Test that the root endpoint returns expected data."""
    async with client:
        response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "zeroWait API"
    assert "version" in data
    assert data["docs"] == "/docs"


@pytest.mark.asyncio
async def test_health_endpoint_reports_connected_database(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test that a connected database produces a healthy response."""

    async def connected_database() -> tuple[bool, str]:
        return True, "connected"

    monkeypatch.setattr(health_module, "check_database_connection", connected_database)
    async with client:
        response = await client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "environment" in data
    assert "database" in data
    assert "version" in data
    assert data["database"] == "connected"


@pytest.mark.asyncio
async def test_health_endpoint_reports_unavailable_database(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Test that an unavailable database produces an unhealthy response."""

    async def unavailable_database() -> tuple[bool, str]:
        return False, "unavailable"

    monkeypatch.setattr(
        health_module, "check_database_connection", unavailable_database
    )
    async with client:
        response = await client.get("/api/health")

    assert response.status_code == 503
    assert response.json()["status"] == "unhealthy"
    assert response.json()["database"] == "unavailable"


@pytest.mark.asyncio
async def test_postgres_driver_errors_are_cors_safe_503s() -> None:
    """Translate raw asyncpg connection failures into browser-readable 503s."""

    async def failing_session() -> None:
        raise asyncpg.exceptions.InvalidPasswordError(
            "password authentication failed for user 'secret_user'"
        )

    app.dependency_overrides[get_session] = failing_session
    try:
        transport = ASGITransport(app=app, raise_app_exceptions=False)
        async with AsyncClient(
            transport=transport, base_url="http://test"
        ) as test_client:
            response = await test_client.get(
                "/api/v1/feeds",
                headers={"Origin": "http://localhost:5173"},
            )

        assert response.status_code == 503
        assert response.headers["access-control-allow-origin"] == (
            "http://localhost:5173"
        )
        assert response.json()["detail"] == (
            "Database service is temporarily unavailable"
        )
        assert "secret_user" not in response.text
        assert "password" not in response.text
    finally:
        app.dependency_overrides.pop(get_session, None)
