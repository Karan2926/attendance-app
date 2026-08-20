"""Hardening middleware for the Attendance app.

Deliberately dependency-free: a small CSP middleware instead of pulling in
django-csp, so the requirements stay lean.
"""

from django.conf import settings

# Bootstrap is loaded from jsDelivr (see frontend/index.html). The SPA builds
# load their own JS/CSS from the same origin, and the camera feature needs
# blob:/data: for images. Inter/JetBrains Mono come from Google Fonts
# (frontend/index.html). 'unsafe-inline' for styles only is required because
# React inline style props (e.g. style={{ textAlign: "center" }}) are common
# in this codebase; scripts stay strict.
_CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; "
    "img-src 'self' data: blob: https:; "
    "media-src 'self' blob:; "
    "connect-src 'self' https://cdn.jsdelivr.net; "
    "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.gstatic.com; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "base-uri 'self'; "
    "form-action 'self'"
)


class ContentSecurityPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if settings.CSP_ENABLED:
            response["Content-Security-Policy"] = _CSP
        return response