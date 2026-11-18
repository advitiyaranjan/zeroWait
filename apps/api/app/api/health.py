"""zeroWait API — Health check endpoint."""

from fastapi import APIRouter, Response, status

from app.core.config import settings
from app.database.session import check_database_connection
from app.schemas.health import HealthResponse

router = APIRouter()

APP_VERSION = "0.1.0"


@router.get("/health", response_model=HealthResponse)
async def health_check(response: Response) -> HealthResponse:
    """Check application health including database connectivity.

    Accurately verifies PostgreSQL connectivity without leaking credentials.
    """
    is_connected, db_status = await check_database_connection()
    if not is_connected:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return HealthResponse(
        status="healthy" if is_connected else "unhealthy",
        environment=settings.environment,
        database=db_status,
        version=APP_VERSION,
    )
