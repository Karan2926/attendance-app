"""Import legacy Flask data (SQLite or PostgreSQL) into the Django database.

Usage (SQLite):
    python manage.py import_legacy --sqlite ../../attendance.db

Usage (PostgreSQL, reads the old `attendance` database):
    python manage.py import_legacy --postgres-url postgresql://attendance:attendance@127.0.0.1:5433/attendance

Passwords: legacy werkzeug hashes are stored as-is and verified by the
WerkzeugPasswordHasher, so imported accounts keep working.
"""

from __future__ import annotations

import datetime
import os

from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import (
    Attendance,
    Enrollment,
    FaceEmbedding,
    RoleUser,
    SchoolClass,
    Student,
    Subject,
    TeacherAssignment,
)


def _iso_or_now(v):
    if not v:
        return None
    s = str(v)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.datetime.fromisoformat(s).isoformat()
    except Exception:
        return s


class LegacyReader:
    def __init__(self, source: str):
        self.source = source
        if source.startswith("postgres"):
            import psycopg

            self.conn = psycopg.connect(source)
        else:
            import sqlite3

            self.conn = sqlite3.connect(source)
            self.conn.row_factory = sqlite3.Row

    def rows(self, table: str):
        try:
            cur = self.conn.execute(f"SELECT * FROM {table}")
            cols = [d[0] for d in cur.description]
            for r in cur.fetchall():
                yield {c: r[idx] for idx, c in enumerate(cols)}
        except Exception as e:
            print(f"  {table}: skipped ({e})")

    def close(self):
        self.conn.close()


class Command(BaseCommand):
    help = "Import legacy Flask data into the Django schema."

    def add_arguments(self, parser):
        default_sqlite = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))),
            "attendance.db",
        )
        parser.add_argument("--sqlite", default=default_sqlite)
        parser.add_argument("--postgres-url", default="")

    @transaction.atomic
    def handle(self, *args, **opts):
        source = opts["postgres_url"].strip() or opts["sqlite"]
        reader = LegacyReader(source)
        try:
            self._import(reader)
        finally:
            reader.close()

    def _import(self, reader):
        counts = {}

        print("Importing classes...")
        for r in reader.rows("classes"):
            SchoolClass.objects.get_or_create(
                id=r["id"],
                defaults={
                    "name": r["name"],
                    "section": r["section"] or "",
                    "academic_year": r["academic_year"],
                    "created_at": _iso_or_now(r["created_at"]),
                },
            )
            counts["classes"] = counts.get("classes", 0) + 1

        print("Importing subjects...")
        for r in reader.rows("subjects"):
            Subject.objects.get_or_create(
                id=r["id"],
                defaults={
                    "school_class_id": r["class_id"],
                    "name": r["name"],
                    "code": r["code"],
                    "created_at": _iso_or_now(r["created_at"]),
                },
            )
            counts["subjects"] = counts.get("subjects", 0) + 1

        print("Importing students...")
        for r in reader.rows("students"):
            Student.objects.get_or_create(
                id=r["id"],
                defaults={
                    "name": r["name"],
                    "roll": r["roll"],
                    "class_text": r["class"],
                    "section": r["section"],
                    "reg_no": r["reg_no"],
                    "school_class_id": r["class_id"],
                    "created_at": _iso_or_now(r["created_at"]),
                },
            )
            counts["students"] = counts.get("students", 0) + 1

        print("Importing users (passwords kept in legacy format)...")
        for r in reader.rows("users"):
            role = r["role"] or "student"
            existing = RoleUser.objects.filter(id=r["id"]).first()
            if existing:
                continue
            RoleUser.objects.create(
                id=r["id"],
                username=r["username"],
                password=r["password_hash"],  # werkzeug hash — verified by custom hasher
                role=role,
                student_id=r["student_id"],
                full_name=r["full_name"],
                created_at=_iso_or_now(r["created_at"]),
                is_active=True,
                is_staff=(role == "admin"),
                is_superuser=(role == "admin"),
                last_login=None,
                date_joined=datetime.datetime.utcnow(),
            )
            counts["users"] = counts.get("users", 0) + 1

        print("Importing enrollments...")
        for r in reader.rows("enrollments"):
            Enrollment.objects.get_or_create(
                student_id=r["student_id"],
                school_class_id=r["class_id"],
                defaults={"created_at": _iso_or_now(r["created_at"])},
            )
            counts["enrollments"] = counts.get("enrollments", 0) + 1

        print("Importing teacher_assignments...")
        for r in reader.rows("teacher_assignments"):
            TeacherAssignment.objects.get_or_create(
                user_id=r["user_id"],
                school_class_id=r["class_id"],
                subject_id=r["subject_id"],
                defaults={"created_at": _iso_or_now(r["created_at"])},
            )
            counts["teacher_assignments"] = counts.get("teacher_assignments", 0) + 1

        print("Importing attendance...")
        for r in reader.rows("attendance"):
            Attendance.objects.get_or_create(
                id=r["id"],
                defaults={
                    "student_id": r["student_id"],
                    "name": r["name"],
                    "timestamp": _iso_or_now(r["timestamp"]),
                    "school_class_id": r["class_id"],
                    "subject_id": r["subject_id"],
                    "marked_by_id": r["marked_by"],
                    "source": r["source"],
                    "attendance_day": r["attendance_day"],
                },
            )
            counts["attendance"] = counts.get("attendance", 0) + 1

        print("Importing face_embeddings...")
        for r in reader.rows("face_embeddings"):
            blob = r["centroid"]
            if blob is not None and not isinstance(blob, (bytes, memoryview)):
                blob = bytes(blob)
            if blob is None:
                continue
            FaceEmbedding.objects.get_or_create(
                student_id=r["student_id"],
                defaults={
                    "centroid": bytes(blob),
                    "dim": r["dim"],
                    "sample_count": r["sample_count"] or 0,
                    "updated_at": _iso_or_now(r["updated_at"]),
                },
            )
            counts["face_embeddings"] = counts.get("face_embeddings", 0) + 1

        print("\nImport complete:")
        for k, v in counts.items():
            print(f"  {k}: {v}")
        if not counts:
            print("  (nothing imported — source empty or already migrated)")
