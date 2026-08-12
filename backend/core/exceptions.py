"""DRF exception handling — unauthenticated requests get 403, not 401."""

from rest_framework import exceptions
from rest_framework.views import exception_handler as drf_exception_handler


def custom_exception_handler(exc, context):
    if isinstance(exc, exceptions.NotAuthenticated):
        exc = exceptions.PermissionDenied(
            detail=getattr(exc, "detail", "Authentication credentials were not provided.")
        )
    return drf_exception_handler(exc, context)
