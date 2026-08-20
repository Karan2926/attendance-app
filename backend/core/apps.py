import logging

from django.apps import AppConfig
from django.conf import settings
from django.db.backends.signals import connection_created

logger = logging.getLogger(__name__)

_synced_in_process = False


def _sync_postgres_sequences(sender=None, connection=None, force=False, **kwargs):
    """Repair PostgreSQL id sequences desynced by restore/seed-with-explicit-ids.

    A restore that imports rows with explicit IDs leaves the nextval behind, so
    the next INSERT hits a duplicate primary key and student creation 500s.

    Runs once per process, on the first Postgres connection. Hooked onto
    connection_created (not AppConfig.ready) so it cannot trip Django's
    "query during app initialization" guard, and it is guaranteed to complete
    before the first INSERT on that connection.
    """
    global _synced_in_process
    if _synced_in_process and not force:
        return
    if connection is None:
        from django.db import connection as default_connection

        connection = default_connection
    if connection.vendor != "postgresql":
        return
    _synced_in_process = True
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
            )
            for (table,) in cursor.fetchall():
                try:
                    cursor.execute(
                        "SELECT pg_get_serial_sequence(%s, 'id')", [table]
                    )
                    seq = cursor.fetchone()[0]
                    if not seq:
                        continue
                    cursor.execute(
                        f"SELECT setval('{seq}', COALESCE((SELECT MAX(id) FROM {table}), 1)) FROM {table}"
                    )
                except Exception:  # noqa: BLE001 - one bad table must not block startup
                    continue
    except Exception:  # noqa: BLE001 - non-Postgres or locked DB: skip silently
        logger.debug("sequence sync skipped (not Postgres or not available)")


class CoreConfig(AppConfig):
    name = "core"

    def ready(self) -> None:
        if settings.DATABASES["default"]["ENGINE"].endswith("postgresql"):
            connection_created.connect(_sync_postgres_sequences)