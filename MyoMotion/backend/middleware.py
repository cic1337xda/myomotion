import os
import uuid
from urllib.parse import urlparse
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# Trusted origin hostnames for CSRF verification
TRUSTED_ORIGINS = {
    "localhost",
    "127.0.0.1",
    "myomotion.flowkraft.xyz",
}

extra_origins = os.environ.get("ALLOWED_ORIGINS", "")
for item in extra_origins.split(","):
    cleaned = item.strip().lower()
    if cleaned:
        TRUSTED_ORIGINS.add(cleaned)

MUTATING_METHODS = {"POST", "PUT", "DELETE", "PATCH"}


class SecurityAndTracingMiddleware(BaseHTTPMiddleware):
    """
    Enforces:
    1. Unique X-Request-ID tracing header on every request/response
    2. Strict HTTP Security Headers (Clickjacking, MIME-sniffing, Referrer)
    3. Origin / Referer CSRF protection on state-changing requests
    """

    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = request_id

        # CSRF check for browser-initiated state mutations
        if request.method in MUTATING_METHODS:
            origin = request.headers.get("origin")
            referer = request.headers.get("referer")
            request_host = (request.headers.get("host") or "").split(":")[0].lower()

            source_header = origin or referer
            if source_header:
                parsed_host = (urlparse(source_header).hostname or "").lower()
                allowed = TRUSTED_ORIGINS | ({request_host} if request_host else set())
                if parsed_host and parsed_host not in allowed:
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "CSRF validation failed: untrusted request origin."},
                        headers={"X-Request-ID": request_id}
                    )

        response = await call_next(request)

        # Inject Request-ID & Security Headers
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response
