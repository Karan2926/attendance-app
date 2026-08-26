from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    # Django built-in admin moved to a secret URL — use the custom React admin UI instead
    path("django-admin-internal/", admin.site.urls),
    path("api/", include("core.urls")),
]
