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


class TokenCookieAuthentication(TokenAuthentication):
    def authenticate(self, request):
        user_token = super().authenticate(request)
        if user_token is not None:
            return user_token
        token_key = request.COOKIES.get(settings.AUTH_COOKIE_NAME)
        if not token_key:
            return None
        return self.authenticate_credentials(token_key)
