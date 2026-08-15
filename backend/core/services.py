"""Domain helpers — the Django port of the legacy `db.py` access/attendance logic."""

from __future__ import annotations

import datetime
from typing import Iterable, Optional

from django.db import IntegrityError, connection, transaction

from .models import (
    Attendance,
    AuditLog,
    Enrollment,
    FaceEmbedding,
    RoleUser,
    SchoolClass,
    Student,
    Subject,
    SystemSetting,
    TeacherAssignment,
    now_iso,
)


def teacher_class_ids(user_id: int, role: str) -> Optional[set[int]]:
    """None means all classes (admin)."""
    if role == "admin":
        return None
    rows = TeacherAssignment.objects.filter(user_id=user_id).values_list("school_class_id", flat=True)
    return {r for r in rows}


def list_classes_for_user(user_id: int, role: str) -> list[SchoolClass]:
    if role == "admin":
        return list(SchoolClass.objects.all().order_by("name", "section"))
    return list(
        SchoolClass.objects.filter(teacherassignment__user_id=user_id)
        .distinct()
        .order_by("name", "section")
    )


def list_subjects_for_class(user_id: int, role: str, class_id: int) -> list[Subject]:
    if role == "admin":
        return list(Subject.objects.filter(school_class_id=class_id).order_by("name"))
    return list(
        Subject.objects.filter(school_class_id=class_id, teacherassignment__user_id=user_id)
        .distinct()
        .order_by("name")
    )


def get_user_assignments(user_id: int, role: str):
    """List (class, subject) pairs the user can access (admin → all)."""
    rows = []
    if role == "admin":
        for s in Subject.objects.select_related("school_class").order_by(
            "school_class__name", "school_class__section", "name"
        ):
            rows.append(
                {
                    "id": s.id,
                    "user_id": None,
                    "class_id": s.school_class_id,
                    "subject_id": s.id,
                    "class_name": s.school_class.name,
                    "section": s.school_class.section,
                    "subject_name": s.name,
                    "subject_code": s.code,
                }
            )
    else:
        for ta in TeacherAssignment.objects.filter(user_id=user_id).select_related(
            "school_class", "subject"
        ):
            rows.append(
                {
                    "id": ta.id,
                    "user_id": ta.user_id,
                    "class_id": ta.school_class_id,
                    "subject_id": ta.subject_id,
                    "class_name": ta.school_class.name,
                    "section": ta.school_class.section,
                    "subject_name": ta.subject.name,
                    "subject_code": ta.subject.code,
                }
            )
    return rows


def teacher_can_access(user_id: int, role: str, class_id: int, subject_id: int) -> bool:
    if role == "admin":
        return Subject.objects.filter(id=subject_id, school_class_id=class_id).exists()
    return TeacherAssignment.objects.filter(
        user_id=user_id, school_class_id=class_id, subject_id=subject_id
    ).exists()


def teacher_can_manage_student(user_id: int, role: str, student_id: int) -> bool:
    if role == "admin":
        return True
    class_ids = teacher_class_ids(user_id, role)
    if not class_ids:
        return False
    enrolled = set(
        Enrollment.objects.filter(student_id=student_id).values_list("school_class_id", flat=True)
    )
    enrolled |= set(
        Student.objects.filter(id=student_id, school_class_id__isnull=False).values_list(
            "school_class_id", flat=True
        )
    )
    return bool(enrolled & class_ids)


def student_ids_in_class(class_id: int) -> set[int]:
    ids = set(Enrollment.objects.filter(school_class_id=class_id).values_list("student_id", flat=True))
    ids |= set(Student.objects.filter(school_class_id=class_id).values_list("id", flat=True))
    return ids


def roster_for_class(class_id: int) -> list[Student]:
    ids = student_ids_in_class(class_id)
    if not ids:
        return []
    return list(Student.objects.filter(id__in=ids).order_by("name"))


def _attendance_day() -> str:
    return datetime.date.today().isoformat()


def mark_present(
    student_ids: Iterable[int],
    class_id: int,
    subject_id: int,
    marked_by: Optional[int],
    source: str = "manual",
) -> int:
    today = _attendance_day()
    ts = datetime.datetime.utcnow().isoformat()
    saved = 0
    for sid in student_ids:
        try:
            if Attendance.objects.filter(
                student_id=sid,
                school_class_id=class_id,
                subject_id=subject_id,
                attendance_day=today,
            ).exists():
                continue
            st = Student.objects.filter(id=sid).first()
            name = st.name if st else "Unknown"
            with transaction.atomic():
                Attendance.objects.create(
                    student_id=sid,
                    name=name,
                    timestamp=ts,
                    school_class_id=class_id,
                    subject_id=subject_id,
                    marked_by_id=marked_by,
                    source=source,
                    attendance_day=today,
                )
                saved += 1
        except IntegrityError:
            continue
    return saved


# ---------------------------------------------------------------------------
# Face embeddings
# ---------------------------------------------------------------------------
def upsert_face_centroid(student_id: int, centroid, sample_count: int) -> None:
    import numpy as np

    vec = np.asarray(centroid, dtype=np.float32).reshape(-1)
    FaceEmbedding.objects.update_or_create(
        student_id=int(student_id),
        defaults={
            "centroid": vec.tobytes(),
            "dim": int(vec.size),
            "sample_count": int(sample_count),
            "updated_at": now_iso(),
        },
    )


def load_face_centroids(allowed_ids: Optional[Iterable[int]] = None) -> dict[int, object]:
    import numpy as np

    qs = FaceEmbedding.objects.all()
    if allowed_ids is not None:
        ids = list({int(x) for x in allowed_ids})
        if not ids:
            return {}
        qs = qs.filter(student_id__in=ids)
    out = {}
    for r in qs:
        vec = np.frombuffer(bytes(r.centroid), dtype=np.float32)
        if r.dim and len(vec) == r.dim:
            out[int(r.student_id)] = vec.copy()
    return out


def face_embedding_count() -> int:
    return FaceEmbedding.objects.count()


# ---------------------------------------------------------------------------
# Students list / delete
# ---------------------------------------------------------------------------
def students_for_teacher(user_id: int, role: str):
    class_ids = teacher_class_ids(user_id, role)
    if class_ids is None:
        return list(Student.objects.all().order_by("-id"))
    if not class_ids:
        return []
    return list(
        Student.objects.filter(
            models_or_enrolled(class_ids)
        ).distinct().order_by("-id")
    )


def models_or_enrolled(class_ids: set[int]):
    from django.db.models import Q

    return Q(school_class_id__in=class_ids) | Q(enrollment__school_class_id__in=class_ids)


def delete_student_cascade(student_id: int) -> None:
    Student.objects.filter(id=student_id).delete()


# ---------------------------------------------------------------------------
# Analytics / stats
# ---------------------------------------------------------------------------
def attendance_records_for_user(user_id: int, role: str, class_id=None, subject_id=None, period="all"):
    class_ids = teacher_class_ids(user_id, role)
    qs = Attendance.objects.select_related("school_class", "subject", "student")
    if class_ids is not None:
        if not class_ids:
            return []
        qs = qs.filter(school_class_id__in=class_ids)
    if class_id:
        if class_ids is not None and class_id not in class_ids:
            return []
        qs = qs.filter(school_class_id=class_id)
    if subject_id:
        qs = qs.filter(subject_id=subject_id)
    today = datetime.date.today()
    if period == "daily":
        qs = qs.filter(attendance_day=today.isoformat())
    elif period == "weekly":
        start = (today - datetime.timedelta(days=7)).isoformat()
        qs = qs.filter(attendance_day__gte=start)
    elif period == "monthly":
        start = (today - datetime.timedelta(days=30)).isoformat()
        qs = qs.filter(attendance_day__gte=start)
    return list(qs.order_by("-timestamp")[:5000])


def export_attendance(day=None, date_from=None, date_to=None, class_id=None, subject_id=None):
    qs = Attendance.objects.select_related("student")
    if day:
        qs = qs.filter(attendance_day=day)
    if date_from:
        qs = qs.filter(attendance_day__gte=date_from)
    if date_to:
        qs = qs.filter(attendance_day__lte=date_to)
    if class_id:
        qs = qs.filter(school_class_id=class_id)
    if subject_id:
        qs = qs.filter(subject_id=subject_id)
    out = []
    for a in qs.order_by("attendance_day", "id"):
        out.append(
            {
                "attendance_id": a.id,
                "student_id": a.student_id,
                "portal_student_id": a.student.portal_student_id if a.student else None,
                "name": a.name or (a.student.name if a.student else ""),
                "date": a.attendance_day,
                "timestamp": a.timestamp,
                "class_id": a.school_class_id,
                "subject_id": a.subject_id,
                "source": a.source,
            }
        )
    return out


def log_portal_sync(direction, entity, status, detail):
    from .models import PortalSyncLog

    PortalSyncLog.objects.create(
        direction=direction, entity=entity, status=status, detail=detail
    )


# ---------------------------------------------------------------------------
# System settings + audit log
# ---------------------------------------------------------------------------
def get_setting(key: str, default=None):
    """Return a SystemSetting value (raw string) or the default."""
    row = SystemSetting.objects.filter(key=key).only("value").first()
    if row and row.value not in (None, ""):
        return row.value
    return default


def get_float_setting(key: str, default: float) -> float:
    try:
        return float(get_setting(key, default))
    except (TypeError, ValueError):
        return default


def set_setting(key: str, value) -> None:
    SystemSetting.objects.update_or_create(
        key=key, defaults={"value": str(value), "updated_at": now_iso()}
    )


def log_action(actor, action: str, target: str | None = None, detail: str | None = None) -> None:
    """Write an audit-trail entry. actor may be a RoleUser or None."""
    from .models import AuditLog

    try:
        AuditLog.objects.create(
            actor=actor if getattr(actor, "pk", None) else None,
            action=action,
            target=target,
            detail=detail,
        )
    except Exception:
        # Never let audit logging break the primary action.
        pass
