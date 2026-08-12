"""Seed an admin user (and optional demo class/subject/teacher) for Phase 1."""

from __future__ import annotations

import datetime

from django.core.management.base import BaseCommand

from core.models import RoleUser, SchoolClass, Subject, TeacherAssignment, now_iso


class Command(BaseCommand):
    help = "Seed an admin user and optional demo data."

    def add_arguments(self, parser):
        parser.add_argument("--admin-user", default="admin")
        parser.add_argument("--admin-pass", default="admin123")
        parser.add_argument("--demo", action="store_true", help="Also create demo class/teacher")

    def handle(self, *args, **opts):
        admin_user = opts["admin_user"]
        admin_pass = opts["admin_pass"]
        now = now_iso()

        admin = RoleUser.objects.filter(username=admin_user).first()
        if admin:
            self.stdout.write(f"Admin '{admin_user}' already exists (id={admin.id})")
            admin_id = admin.id
        else:
            admin = RoleUser.objects.create_user(
                username=admin_user,
                password=admin_pass,
                role="admin",
                full_name="System Admin",
                created_at=now,
            )
            admin_id = admin.id
            self.stdout.write(f"Created admin '{admin_user}' (id={admin_id})")

        if not opts["demo"]:
            return

        cls, _ = SchoolClass.objects.get_or_create(
            name="B.Tech CSE",
            section="A",
            defaults={"academic_year": "2025-26", "created_at": now},
        )
        subj, _ = Subject.objects.get_or_create(
            school_class=cls, code="DS101", defaults={"name": "Data Structures", "created_at": now}
        )
        teacher = RoleUser.objects.filter(username="teacher1").first()
        if not teacher:
            teacher = RoleUser.objects.create_user(
                username="teacher1",
                password="teacher123",
                role="teacher",
                full_name="Demo Teacher",
                created_at=now,
            )
            self.stdout.write("Created teacher 'teacher1' / teacher123")
        TeacherAssignment.objects.get_or_create(
            user=teacher, school_class=cls, subject=subj, defaults={"created_at": now}
        )
        self.stdout.write("Assigned teacher1 → B.Tech CSE A / Data Structures")
        self.stdout.write("Done.")
