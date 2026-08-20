"""Sync AdminTool PostgreSQL id sequences to the current max id.

Repair after a DB restore/import that used explicit IDs; ensures the next
INSERT does not collide with an existing primary key.

Usage: python manage.py sync_db_sequences
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Sync PostgreSQL id sequences so the next INSERT cannot hit a duplicate PK"

    def handle(self, *args, **options):
        from core.apps import _sync_postgres_sequences

        # force=True: the in-process guard may have already run via the
        # connection_created signal; the command must always re-check.
        _sync_postgres_sequences(force=True)
        self.stdout.write(self.style.SUCCESS("DB sequences synced"))