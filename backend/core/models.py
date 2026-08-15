"""Django ORM models — mirror the legacy Digital Attendance schema (db_table names
kept identical so the existing PostgreSQL data can be imported by
`python manage.py import_legacy`)."""

from django.contrib.auth.models import AbstractUser
from django.db import models


def now_iso() -> str:
    import datetime

    return datetime.datetime.utcnow().isoformat()


class SchoolClass(models.Model):
    name = models.CharField(max_length=255)
    section = models.CharField(max_length=64, default="")
    academic_year = models.CharField(max_length=32, null=True, blank=True)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "classes"

    def label(self) -> str:
        if self.section:
            return f"{self.name} — Sec {self.section}"
        return self.name


class Subject(models.Model):
    school_class = models.ForeignKey(
        "SchoolClass", db_column="class_id", on_delete=models.CASCADE, related_name="subjects"
    )
    name = models.CharField(max_length=255)
    code = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "subjects"


class Student(models.Model):
    name = models.CharField(max_length=255)
    roll = models.CharField(max_length=64, null=True, blank=True)
    class_text = models.CharField(max_length=255, null=True, blank=True, db_column="class")
    section = models.CharField(max_length=64, null=True, blank=True)
    reg_no = models.CharField(max_length=128, null=True, blank=True)
    school_class = models.ForeignKey(
        "SchoolClass",
        null=True,
        blank=True,
        db_column="class_id",
        on_delete=models.SET_NULL,
        related_name="students",
    )
    created_at = models.TextField(null=True, blank=True, default=now_iso)
    portal_student_id = models.CharField(max_length=128, null=True, blank=True, unique=True)

    class Meta:
        db_table = "students"

    def label(self) -> str:
        if self.school_class:
            return self.school_class.label()
        if self.class_text:
            return self.class_text + (f" — Sec {self.section}" if self.section else "")
        return "—"


class RoleUser(AbstractUser):
    """Single table for admin / teacher / student logins."""

    ROLE_CHOICES = [
        ("admin", "admin"),
        ("teacher", "teacher"),
        ("student", "student"),
    ]
    password = models.CharField(max_length=300)
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default="student")
    student = models.OneToOneField(
        "Student",
        null=True,
        blank=True,
        db_column="student_id",
        on_delete=models.SET_NULL,
        related_name="login",
    )
    full_name = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "users"

    def is_admin(self):
        return self.role == "admin"

    def is_teacher(self):
        return self.role == "teacher"


class TeacherAssignment(models.Model):
    user = models.ForeignKey(
        "RoleUser", db_column="user_id", on_delete=models.CASCADE, related_name="assignments"
    )
    school_class = models.ForeignKey(
        "SchoolClass", db_column="class_id", on_delete=models.CASCADE
    )
    subject = models.ForeignKey("Subject", db_column="subject_id", on_delete=models.CASCADE)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "teacher_assignments"
        unique_together = ("user", "school_class", "subject")


class Enrollment(models.Model):
    student = models.ForeignKey("Student", db_column="student_id", on_delete=models.CASCADE)
    school_class = models.ForeignKey(
        "SchoolClass", db_column="class_id", on_delete=models.CASCADE, related_name="enrollments"
    )
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "enrollments"
        unique_together = ("student", "school_class")


class Attendance(models.Model):
    student = models.ForeignKey(
        "Student",
        null=True,
        blank=True,
        db_column="student_id",
        on_delete=models.SET_NULL,
        related_name="attendance_records",
    )
    name = models.CharField(max_length=255, null=True, blank=True)
    timestamp = models.TextField(null=True, blank=True, default=now_iso)
    school_class = models.ForeignKey(
        "SchoolClass",
        null=True,
        blank=True,
        db_column="class_id",
        on_delete=models.SET_NULL,
    )
    subject = models.ForeignKey(
        "Subject",
        null=True,
        blank=True,
        db_column="subject_id",
        on_delete=models.SET_NULL,
    )
    marked_by = models.ForeignKey(
        "RoleUser",
        null=True,
        blank=True,
        db_column="marked_by",
        on_delete=models.SET_NULL,
    )
    source = models.CharField(max_length=32, null=True, blank=True)
    attendance_day = models.CharField(max_length=16, null=True, blank=True)

    class Meta:
        db_table = "attendance"
        indexes = [
            models.Index(fields=["student", "school_class", "subject", "timestamp"]),
            models.Index(fields=["school_class", "subject", "timestamp"]),
            models.Index(fields=["student", "school_class", "subject", "attendance_day"]),
        ]


class FaceEmbedding(models.Model):
    student = models.OneToOneField(
        "Student", db_column="student_id", primary_key=True, on_delete=models.CASCADE
    )
    centroid = models.BinaryField()
    dim = models.IntegerField()
    sample_count = models.IntegerField(default=0)
    updated_at = models.TextField(null=True, blank=True)

    class Meta:
        db_table = "face_embeddings"


class PortalSyncLog(models.Model):
    direction = models.CharField(max_length=16)
    entity = models.CharField(max_length=64)
    status = models.CharField(max_length=32)
    detail = models.TextField(null=True, blank=True)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "portal_sync_log"


class SystemSetting(models.Model):
    """Admin-configurable settings (key/value). Thresholds live here so they
    can be tuned from the Admin UI without touching code."""

    key = models.CharField(max_length=64, unique=True)
    value = models.TextField(null=True, blank=True)
    updated_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "system_settings"


class AuditLog(models.Model):
    """Append-only trail of admin/relevant write actions for accountability."""

    actor = models.ForeignKey(
        "RoleUser",
        null=True,
        blank=True,
        db_column="actor_id",
        on_delete=models.SET_NULL,
    )
    action = models.CharField(max_length=64)
    target = models.CharField(max_length=255, null=True, blank=True)
    detail = models.TextField(null=True, blank=True)
    created_at = models.TextField(null=True, blank=True, default=now_iso)

    class Meta:
        db_table = "audit_log"
        indexes = [
            models.Index(fields=["-id"]),
            models.Index(fields=["action"]),
            models.Index(fields=["created_at"]),
        ]
