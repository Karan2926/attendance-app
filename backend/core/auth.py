"""DRF token authentication that accepts the token from an HttpOnly cookie.

The SPA authenticates with a DRF Token stored in a same-site HttpOnly cookie
instead of JavaScript-readable storage. The Authorization header is still
accepted for API clients and tests, so this is a drop-in superset of the
built-in TokenAuthentication.

CSRF note: the cookie is sent only on same-site requests (SameSite=Lax), so a
cross-site form/fetch cannot attach it — the same protection Django relies on
for session cookies.
"""

from django.conf import settings
from rest_framework.authentication import TokenAuthentication
from rest_framework.exceptions import AuthenticationFailed


class TokenCookieAuthentication(TokenAuthentication):
    def authenticate(self, request):
        # 1. Try standard Authorization header (for API clients / tests)
        try:
            user_token = super().authenticate(request)
            if user_token is not None:
                return user_token
        except AuthenticationFailed:
            pass

        # 2. Fall back to HttpOnly cookie (for web SPA)
        token_key = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if not token_key:
            return None
        try:
            return self.authenticate_credentials(token_key)
        except AuthenticationFailed:
            # Stale or invalid cookie/token — ignore so request proceeds as AnonymousUser.
            # Public routes (like /auth/login) can run, protected routes return clean 401/403.
            return None

