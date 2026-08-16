"""API views — Django/DRF port of the entire Flask app.py route surface."""

from __future__ import annotations

import csv
import datetime
import io
import os
import shutil

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import Count
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import services, training
from .image_security import ImageValidationError, read_upload, sanitize_image
from .models import (
    Attendance,
    AuditLog,
    Enrollment,
    FaceEmbedding,
    SchoolClass,
    Student,
    Subject,
    TeacherAssignment,
    now_iso,
)
from .permissions import IsAdmin, IsStudent, IsTeacherOrAdmin
from .rate_limit import rate_limit
from .recognition import (
    CLASSROOM_MARGIN,
    CLASSROOM_SIM_THRESHOLD,
    CLASSROOM_STRONG_THRESHOLD,
    LIVE_SIM_THRESHOLD,
)

DATASET_DIR = settings.DATASET_DIR
os.makedirs(DATASET_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Health / monitoring
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([AllowAny])
def health_view(request):
    """Public liveness probe — used by deploy/healthcheck.sh."""
    from django.db import connection

    db_ok = True
    try:
        connection.ensure_connection()
    except Exception:
        db_ok = False
    return Response(
        {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "unreachable"},
        status=200 if db_ok else 503,
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def _user_payload(u):
    return {
        "id": u.id,
        "username": u.username,
        "role": u.role,
        "student_id": u.student_id,
        "full_name": u.full_name or "",
    }


@api_view(["POST"])
@permission_classes([AllowAny])
@rate_limit(lambda r: "login", 10, 60)
def login_view(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    from django.contrib.auth import authenticate

    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        return Response({"error": "Invalid username or password."}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": _user_payload(user)})


@api_view(["POST"])
@permission_classes([AllowAny])
@rate_limit(lambda r: "register", 10, 60)
def register_view(request):
    if not settings.ALLOW_PUBLIC_REGISTER:
        return Response({"error": "Public registration disabled"}, status=403)

    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    roll = (request.data.get("roll") or "").strip()
    invite = (request.data.get("invite_code") or "").strip()

    if settings.REGISTER_INVITE_CODE and invite != settings.REGISTER_INVITE_CODE:
        return Response({"error": "Invalid invite code."}, status=400)
    if not username or not password or not roll:
        return Response({"error": "All fields are required."}, status=400)
    if len(password) < 8:
        return Response({"error": "Password must be at least 8 characters."}, status=400)

    st = Student.objects.filter(roll=roll).first()
    if not st:
        return Response(
            {"error": "No student found with that roll number. Ask your teacher to add you first."},
            status=400,
        )
    User = get_user_model()
    if User.objects.filter(student_id=st.id).exists():
        return Response({"error": "An account already exists for this student."}, status=400)
    if User.objects.filter(username=username).exists():
        return Response({"error": "That username is already taken."}, status=400)

    user = User.objects.create_user(
        username=username,
        password=password,
        role="student",
        student=st,
        created_at=now_iso(),
    )
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": _user_payload(user)}, status=201)


@api_view(["POST"])
def logout_view(request):
    try:
        request.auth.delete()
    except Exception:
        pass
    return Response({"ok": True})


@api_view(["GET"])
def me_view(request):
    return Response({"user": _user_payload(request.user)})


@api_view(["GET"])
@permission_classes([IsStudent])
def my_attendance_view(request):
    st = request.user.student
    if not st:
        return Response({"records": [], "student": None})
    records = (
        Attendance.objects.filter(student=st)
        .select_related("school_class", "subject")
        .order_by("-timestamp")[:200]
    )
    data = [
        {
            "timestamp": r.timestamp,
            "class_name": r.school_class.name if r.school_class else None,
            "section": r.school_class.section if r.school_class else None,
            "subject_name": r.subject.name if r.subject else None,
        }
        for r in records
    ]
    return Response(
        {
            "student": {
                "name": st.name,
                "roll": st.roll,
                "class": st.class_text,
                "section": st.section,
            },
            "records": data,
        }
    )


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
@api_view(["GET"])
def dashboard_view(request):
    role = request.user.role
    assignments = services.get_user_assignments(request.user.id, role)
    classes = services.list_classes_for_user(request.user.id, role)
    return Response(
        {
            "role": role,
            "username": request.user.username,
            "assignment_count": len(assignments) if role != "admin" else None,
            "class_count": len(classes),
        }
    )


@api_view(["GET"])
def attendance_stats_view(request):
    class_ids = services.teacher_class_ids(request.user.id, request.user.role)
    qs = Attendance.objects.all()
    if class_ids is not None:
        qs = qs.filter(school_class_id__in=class_ids) if class_ids else Attendance.objects.none()

    counts = {}
    for r in qs.values_list("attendance_day", flat=True):
        if not r:
            continue
        try:
            d = datetime.date.fromisoformat(r)
        except Exception:
            continue
        counts[d] = counts.get(d, 0) + 1

    last_30 = [datetime.date.today() - datetime.timedelta(days=i) for i in range(29, -1, -1)]
    return Response(
        {
            "dates": [d.strftime("%d-%b") for d in last_30],
            "counts": [int(counts.get(d, 0)) for d in last_30],
        }
    )


# ---------------------------------------------------------------------------
# Classes / subjects / teachers / assignments
# ---------------------------------------------------------------------------
@api_view(["GET", "POST"])
@permission_classes([IsTeacherOrAdmin])
def classes_view(request):
    if request.method == "GET":
        rows = services.list_classes_for_user(request.user.id, request.user.role)
        return Response(
            {
                "classes": [
                    {
                        "id": c.id,
                        "name": c.name,
                        "section": c.section,
                        "label": c.label(),
                        "academic_year": c.academic_year,
                    }
                    for c in rows
                ]
            }
        )

    if request.user.role != "admin":
        return Response({"error": "Only admin can create classes"}, status=403)
    name = (request.data.get("name") or "").strip()
    section = (request.data.get("section") or "").strip()
    year = (request.data.get("academic_year") or "").strip() or None
    if not name:
        return Response({"error": "name required"}, status=400)
    c = SchoolClass.objects.create(
        name=name, section=section, academic_year=year, created_at=now_iso()
    )
    services.log_action(request.user, "class.created", target=f"Class #{c.id} ({c.label()})")
    return Response({"class_id": c.id}, status=201)


@api_view(["GET", "POST"])
@permission_classes([IsTeacherOrAdmin])
def subjects_view(request, class_id):
    if request.method == "GET":
        rows = services.list_subjects_for_class(request.user.id, request.user.role, class_id)
        return Response(
            {
                "subjects": [
                    {"id": s.id, "name": s.name, "code": s.code, "class_id": s.school_class_id}
                    for s in rows
                ]
            }
        )

    if request.user.role != "admin":
        return Response({"error": "Only admin can create subjects"}, status=403)
    name = (request.data.get("name") or "").strip()
    code = (request.data.get("code") or "").strip() or None
    if not name:
        return Response({"error": "name required"}, status=400)
    if not SchoolClass.objects.filter(id=class_id).exists():
        return Response({"error": "class not found"}, status=404)
    s = Subject.objects.create(
        school_class_id=class_id, name=name, code=code, created_at=now_iso()
    )
    services.log_action(
        request.user,
        "subject.created",
        target=f"Subject #{s.id} ({s.name}) in class #{class_id}",
    )
    return Response({"subject_id": s.id}, status=201)


@api_view(["POST"])
@permission_classes([IsAdmin])
def create_teacher_view(request):
    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    full_name = (request.data.get("full_name") or "").strip() or None
    if not username or not password:
        return Response({"error": "username and password required"}, status=400)
    try:
        with transaction.atomic():
            user = get_user_model().objects.create_user(
                username=username,
                password=password,
                role="teacher",
                full_name=full_name,
                created_at=now_iso(),
            )
    except IntegrityError:
        return Response({"error": "username already exists"}, status=409)
    services.log_action(
        request.user,
        "teacher.created",
        target=f"Teacher #{user.id} ({username})",
        detail=full_name or "",
    )
    return Response({"user_id": user.id}, status=201)


@api_view(["POST"])
@permission_classes([IsAdmin])
def assign_teacher_view(request):
    try:
        user_id = int(request.data.get("user_id"))
        class_id = int(request.data.get("class_id"))
        subject_id = int(request.data.get("subject_id"))
    except (TypeError, ValueError):
        return Response({"error": "user_id, class_id, subject_id required"}, status=400)

    from .models import RoleUser

    if not RoleUser.objects.filter(id=user_id, role="teacher").exists():
        return Response({"error": "teacher not found"}, status=404)
    if not Subject.objects.filter(id=subject_id, school_class_id=class_id).exists():
        return Response({"error": "subject does not belong to class"}, status=400)
    try:
        with transaction.atomic():
            a = TeacherAssignment.objects.create(
                user_id=user_id,
                school_class_id=class_id,
                subject_id=subject_id,
                created_at=now_iso(),
            )
    except IntegrityError:
        return Response({"error": "assignment already exists"}, status=409)
    services.log_action(
        request.user,
        "assignment.created",
        target=f"Teacher #{user_id} → class #{class_id} subject #{subject_id}",
    )
    return Response({"assignment_id": a.id}, status=201)


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def my_assignments_view(request):
    rows = services.get_user_assignments(request.user.id, request.user.role)
    return Response(
        {
            "assignments": [
                {
                    "id": r["id"],
                    "class_id": r["class_id"],
                    "subject_id": r["subject_id"],
                    "class_label": r["class_name"]
                    + (f" — Sec {r['section']}" if r["section"] else ""),
                    "subject_name": r["subject_name"],
                    "subject_code": r["subject_code"],
                }
                for r in rows
            ]
        }
    )


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_overview_view(request):
    classes = list(SchoolClass.objects.all().order_by("name", "section"))
    subjects = list(
        Subject.objects.select_related("school_class").order_by("school_class__name", "name")
    )
    teachers = list(
        get_user_model()
        .objects.filter(role="teacher")
        .order_by("username")
        .values("id", "username", "full_name", "created_at")
    )
    assignments = list(
        TeacherAssignment.objects.select_related("user", "school_class", "subject")
        .order_by("user__username", "school_class__name")
        .values(
            "id",
            "user__username",
            "school_class__name",
            "school_class__section",
            "subject__name",
        )
    )
    return Response(
        {
            "classes": [
                {"id": c.id, "name": c.name, "section": c.section, "label": c.label()}
                for c in classes
            ],
            "subjects": [
                {
                    "id": s.id,
                    "name": s.name,
                    "code": s.code,
                    "class_id": s.school_class_id,
                    "class_name": s.school_class.name,
                    "section": s.school_class.section,
                }
                for s in subjects
            ],
            "teachers": list(teachers),
            "assignments": [
                {
                    "id": a["id"],
                    "username": a["user__username"],
                    "class_name": a["school_class__name"],
                    "section": a["school_class__section"],
                    "subject_name": a["subject__name"],
                }
                for a in assignments
            ],
        }
    )


# ---------------------------------------------------------------------------
# Admin — teacher accounts, system settings, audit
# ---------------------------------------------------------------------------
SETTING_DEFS = [
    {
        "key": "recognition.live_threshold",
        "label": "Live mark confidence",
        "default": LIVE_SIM_THRESHOLD,
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "group": "recognition",
        "hint": "Minimum similarity to auto-mark attendance in live webcam mode. "
        "Higher = stricter (fewer false matches, more Unknown).",
    },
    {
        "key": "recognition.classroom_threshold",
        "label": "Classroom match confidence",
        "default": CLASSROOM_SIM_THRESHOLD,
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "group": "recognition",
        "hint": "Minimum similarity to consider a classroom-photo face a match. "
        "Lower = more students auto-recognized, higher risk of wrong matches.",
    },
    {
        "key": "recognition.classroom_strong_threshold",
        "label": "Classroom 'needs review' cutoff",
        "default": CLASSROOM_STRONG_THRESHOLD,
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "group": "recognition",
        "hint": "Matches below this confidence are flagged 'Needs review' so a "
        "teacher double-checks before saving.",
    },
    {
        "key": "recognition.classroom_margin",
        "label": "Classroom similarity margin",
        "default": CLASSROOM_MARGIN,
        "min": 0.0,
        "max": 0.1,
        "step": 0.005,
        "group": "recognition",
        "hint": "Extra cosine-similarity buffer used when ranking classroom faces. "
        "Rarely needs changing.",
    },
]

_SETTING_DEFS_BY_KEY = {d["key"]: d for d in SETTING_DEFS}


def _effective_setting(key, default):
    return services.get_float_setting(key, default)


@api_view(["PUT"])
@permission_classes([IsAdmin])
def update_teacher_view(request, teacher_id):
    """Activate / deactivate a teacher account (soft removal)."""
    if request.user.id == teacher_id:
        return Response({"error": "You cannot modify your own account"}, status=400)
    user = get_user_model().objects.filter(id=teacher_id, role="teacher").first()
    if not user:
        return Response({"error": "teacher not found"}, status=404)
    active = request.data.get("active")
    if active is None:
        return Response({"error": "active (bool) required"}, status=400)
    user.is_active = bool(active)
    user.save()
    if not user.is_active:
        Token.objects.filter(user=user).delete()
    action = "teacher.activated" if user.is_active else "teacher.deactivated"
    services.log_action(
        request.user, action, target=f"Teacher #{user.id} ({user.username})"
    )
    return Response({"id": user.id, "active": user.is_active})


@api_view(["DELETE"])
@permission_classes([IsAdmin])
def delete_teacher_view(request, teacher_id):
    """Permanently remove a teacher account (assignments cascade)."""
    if request.user.id == teacher_id:
        return Response({"error": "You cannot delete your own account"}, status=400)
    user = get_user_model().objects.filter(id=teacher_id, role="teacher").first()
    if not user:
        return Response({"error": "teacher not found"}, status=404)
    username = user.username
    user.delete()
    services.log_action(
        request.user, "teacher.deleted", target=f"Teacher #{teacher_id} ({username})"
    )
    return Response({"deleted": True})


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_system_stats_view(request):
    today = datetime.date.today().isoformat()
    week_ago = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
    from .recognition import dataset_disk_usage

    teachers = list(
        get_user_model()
        .objects.filter(role="teacher")
        .values("id", "username", "full_name", "is_active", "created_at")
        .order_by("username")
    )
    teacher_ids = [t["id"] for t in teachers]
    class_counts = dict(
        TeacherAssignment.objects.filter(user_id__in=teacher_ids)
        .values_list("user_id")
        .annotate(c=Count("id"))
    )
    today_by_teacher = dict(
        Attendance.objects.filter(
            marked_by_id__in=teacher_ids, attendance_day=today
        )
        .values_list("marked_by_id")
        .annotate(c=Count("id"))
    )
    per_teacher = [
        {
            "id": t["id"],
            "username": t["username"],
            "full_name": t["full_name"],
            "is_active": t["is_active"],
            "class_count": class_counts.get(t["id"], 0),
            "records_today": today_by_teacher.get(t["id"], 0),
        }
        for t in teachers
    ]

    class_records = dict(
        Attendance.objects.filter(attendance_day=today)
        .values_list("school_class_id")
        .annotate(c=Count("id"))
    )
    classes = list(SchoolClass.objects.annotate(student_count=Count("students", distinct=True)))
    per_class = [
        {
            "id": c.id,
            "label": c.label(),
            "student_count": c.student_count,
            "records_today": class_records.get(c.id, 0),
        }
        for c in classes
    ]

    return Response(
        {
            "students": Student.objects.count(),
            "classes": SchoolClass.objects.count(),
            "subjects": Subject.objects.count(),
            "teachers": len(teachers),
            "teachers_active": sum(1 for t in teachers if t["is_active"]),
            "attendance_today": Attendance.objects.filter(attendance_day=today).count(),
            "attendance_7d": Attendance.objects.filter(attendance_day__gte=week_ago).count(),
            "embeddings": services.face_embedding_count(),
            "dataset_mb": dataset_disk_usage(DATASET_DIR)["mb"],
            "per_teacher": per_teacher,
            "per_class": per_class,
        }
    )


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_system_health_view(request):
    """Admin health dashboard — DB, model, dataset, storage, latest backup."""
    import glob
    import json as _json

    from django.db import connection

    db_ok = True
    try:
        connection.ensure_connection()
    except Exception:
        db_ok = False

    from .recognition import dataset_disk_usage

    model_path = settings.MODEL_PATH or ""
    model_exists = bool(model_path) and os.path.isfile(model_path)
    model_mb = None
    if model_exists:
        try:
            model_mb = round(os.path.getsize(model_path) / (1024 * 1024), 1)
        except OSError:
            model_mb = None

    usage = dataset_disk_usage(settings.DATASET_DIR)

    backup_dir = os.environ.get("ATTENDANCE_BACKUP_DIR", "/var/backups/attendance")
    latest_backup = None
    if os.path.isdir(backup_dir):
        dumps = sorted(glob.glob(os.path.join(backup_dir, "db-*.dump")))
        if dumps:
            latest_backup = os.path.basename(dumps[-1])

    train_status = {}
    train_status_path = settings.TRAIN_STATUS_FILE or ""
    if train_status_path and os.path.isfile(train_status_path):
        try:
            with open(train_status_path, encoding="utf-8") as f:
                train_status = _json.load(f)
        except Exception:
            train_status = {}

    return Response(
        {
            "status": "ok" if db_ok else "degraded",
            "database": "ok" if db_ok else "unreachable",
            "model": {"exists": model_exists, "size_mb": model_mb},
            "dataset": {
                "dir": settings.DATASET_DIR,
                "size_mb": usage["mb"],
                "files": usage["files"],
                "students": usage["students"],
            },
            "train_status": train_status,
            "backup": {"latest": latest_backup},
        }
    )


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_settings_view(request):
    def _def(d):
        return {
            "key": d["key"],
            "label": d["label"],
            "value": _effective_setting(d["key"], d["default"]),
            "default": d["default"],
            "min": d["min"],
            "max": d["max"],
            "step": d["step"],
            "group": d.get("group", ""),
            "hint": d.get("hint", ""),
        }

    return Response({"settings": [_def(d) for d in SETTING_DEFS]})


@api_view(["POST"])
@permission_classes([IsAdmin])
def admin_update_settings_view(request):
    updates = request.data.get("settings") or {}
    if not isinstance(updates, dict) or not updates:
        return Response({"error": "settings object required"}, status=400)

    applied = []
    for key, raw in updates.items():
        d = _SETTING_DEFS_BY_KEY.get(key)
        if not d:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            return Response({"error": f"Invalid value for {key}"}, status=400)
        value = max(d["min"], min(d["max"], value))
        services.set_setting(key, value)
        applied.append({"key": key, "value": value})

    if not applied:
        return Response({"error": "no known settings provided"}, status=400)
    services.log_action(
        request.user,
        "settings.updated",
        target="Recognition settings",
        detail=", ".join(f"{a['key']}={a['value']}" for a in applied),
    )
    return Response({"updated": applied})


@api_view(["GET"])
@permission_classes([IsAdmin])
def admin_audit_view(request):
    rows = (
        AuditLog.objects.select_related("actor")
        .order_by("-id")[:200]
    )
    return Response(
        {
            "logs": [
                {
                    "id": r.id,
                    "actor": r.actor.username if r.actor else None,
                    "action": r.action,
                    "target": r.target,
                    "detail": r.detail,
                    "created_at": r.created_at,
                }
                for r in rows
            ]
        }
    )


# ---------------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------------
def _parse_class_subject(request):
    try:
        class_id = int(request.data.get("class_id"))
        subject_id = int(request.data.get("subject_id"))
    except (TypeError, ValueError):
        return None, None
    return class_id, subject_id


def _clean_upload(request, key="image"):
    """Validate + sanitize an uploaded image.

    Returns (BytesIO | None, Response | None). The response is a 400 error
    when the upload is missing or rejected by the security layer.
    """
    f = request.FILES.get(key)
    if not f:
        return None, Response({"error": "no image"}, status=400)
    clean, err = read_upload(f)
    if err:
        return None, Response({"error": err}, status=400)
    return io.BytesIO(clean), None


def _require_assignment(request):
    class_id, subject_id = _parse_class_subject(request)
    if not class_id or not subject_id:
        return None, None, (Response({"error": "class_id and subject_id required"}, status=400))
    if not services.teacher_can_access(request.user.id, request.user.role, class_id, subject_id):
        return None, None, (Response({"error": "Not authorized for this class/subject"}, status=403))
    return class_id, subject_id, None


@api_view(["GET", "POST"])
@permission_classes([IsTeacherOrAdmin])
def students_view(request):
    if request.method == "GET":
        rows = services.students_for_teacher(request.user.id, request.user.role)
        return Response(
            {
                "students": [
                    {
                        "id": s.id,
                        "name": s.name,
                        "roll": s.roll or "",
                        "class": s.class_text or "",
                        "section": s.section or "",
                        "reg_no": s.reg_no or "",
                        "class_id": s.school_class_id,
                        "created_at": s.created_at,
                    }
                    for s in rows
                ]
            }
        )

    data = request.data
    name = (data.get("name") or "").strip()
    if not name:
        return Response({"error": "name required"}, status=400)

    class_id_raw = data.get("class_id")
    if class_id_raw is None:
        class_id_raw = ""
    else:
        class_id_raw = str(class_id_raw).strip()
    class_id = None
    cls = ""
    sec = data.get("sec") or ""
    if class_id_raw:
        try:
            class_id = int(class_id_raw)
        except ValueError:
            return Response({"error": "invalid class_id"}, status=400)
        allowed = services.list_classes_for_user(request.user.id, request.user.role)
        if class_id not in {c.id for c in allowed}:
            return Response({"error": "Not authorized for this class"}, status=403)
        crow = SchoolClass.objects.filter(id=class_id).first()
        if crow:
            cls = crow.name
            sec = crow.section or sec

    roll = (data.get("roll") or "").strip()
    reg_no = (data.get("reg_no") or "").strip()
    if roll:
        q = Student.objects.filter(roll=roll)
        if class_id is not None:
            q = q.filter(school_class_id=class_id)
        if q.exists():
            return Response(
                {"error": f"Roll number '{roll}' already exists. Use a unique roll."}, status=400
            )
    st = Student.objects.create(
        name=name,
        roll=roll or None,
        class_text=cls,
        section=sec or None,
        reg_no=reg_no or None,
        school_class_id=class_id,
        created_at=now_iso(),
    )
    if class_id:
        Enrollment.objects.get_or_create(
            student=st, school_class_id=class_id, defaults={"created_at": now_iso()}
        )
    os.makedirs(os.path.join(DATASET_DIR, str(st.id)), exist_ok=True)
    services.log_action(
        request.user,
        "student.created",
        target=f"Student #{st.id} ({name})",
        detail=f"roll={roll or '-'} class_id={class_id}",
    )
    return Response({"student_id": st.id}, status=201)


def _save_compact_profile(src_path: str, dest_path: str) -> None:
    try:
        import cv2

        img = cv2.imread(src_path)
        if img is None:
            shutil.copyfile(src_path, dest_path)
            return
        h, w = img.shape[:2]
        edge = max(h, w)
        if edge > 480:
            scale = 480 / edge
            img = cv2.resize(img, (int(w * scale), int(h * scale)))
        cv2.imwrite(dest_path, img, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    except Exception:
        shutil.copyfile(src_path, dest_path)


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
@rate_limit(lambda r: r.user.id, 30, 60)
def upload_face_view(request, student_id):
    if not services.teacher_can_manage_student(request.user.id, request.user.role, student_id):
        return Response({"error": "Not authorized for this student"}, status=403)

    files = request.FILES.getlist("images[]") or request.FILES.getlist("images")
    files = files[: settings.MAX_CAPTURE_IMAGES]
    saved = 0
    rejected = 0
    folder = os.path.join(DATASET_DIR, str(student_id))
    os.makedirs(folder, exist_ok=True)
    has_profile = os.path.exists(os.path.join(folder, "profile.jpg"))
    for f in files:
        clean, err = read_upload(f)
        if err:
            rejected += 1
            continue
        try:
            fname = f"{datetime.datetime.utcnow().timestamp():.6f}_{saved}.jpg"
            path = os.path.join(folder, fname)
            with open(path, "wb") as out:
                out.write(clean)
            if saved == 0 and not has_profile:
                _save_compact_profile(path, os.path.join(folder, "profile.jpg"))
            saved += 1
        except Exception:
            rejected += 1
            continue
    note = "Captures are temporary. After Train Model, only profile.jpg is kept."
    if rejected:
        note += f" {rejected} file(s) skipped (invalid or too large)."
    return Response(
        {
            "saved": saved,
            "rejected": rejected,
            "note": note,
        }
    )


@api_view(["GET"])
def student_photo_view(request, student_id):
    role = request.user.role
    if role == "student" and request.user.student_id != student_id:
        return Response({"error": "Forbidden"}, status=403)
    if role in ("teacher", "admin"):
        if not services.teacher_can_manage_student(request.user.id, role, student_id) and role != "admin":
            return Response({"error": "Forbidden"}, status=403)
    profile_path = os.path.join(DATASET_DIR, str(student_id), "profile.jpg")
    if os.path.exists(profile_path):
        return FileResponse(open(profile_path, "rb"), content_type="image/jpeg")
    return Response({"error": "not found"}, status=404)


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def create_student_login_view(request, student_id):
    if not services.teacher_can_manage_student(request.user.id, request.user.role, student_id):
        return Response({"error": "Not authorized for this student"}, status=403)

    username = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""
    if not username or not password:
        return Response({"error": "username and password required"}, status=400)
    if len(password) < 8:
        return Response({"error": "password must be at least 8 characters"}, status=400)

    User = get_user_model()
    if not Student.objects.filter(id=student_id).exists():
        return Response({"error": "student not found"}, status=404)
    if User.objects.filter(student_id=student_id).exists() or User.objects.filter(
        username=username
    ).exists():
        return Response({"error": "login already exists for student or username"}, status=409)
    user = User.objects.create_user(
        username=username,
        password=password,
        role="student",
        student_id=student_id,
        created_at=now_iso(),
    )
    return Response({"user_id": user.id, "username": username}, status=201)


@api_view(["GET", "PUT", "PATCH", "DELETE"])
@permission_classes([IsTeacherOrAdmin])
def student_detail_view(request, student_id):
    if not services.teacher_can_manage_student(request.user.id, request.user.role, student_id):
        return Response({"error": "Not authorized for this student"}, status=403)

    if request.method == "DELETE":
        st_name = Student.objects.filter(id=student_id).values_list("name", flat=True).first()
        services.delete_student_cascade(student_id)
        folder = os.path.join(DATASET_DIR, str(student_id))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
        services.log_action(
            request.user,
            "student.deleted",
            target=f"Student #{student_id} ({st_name or '?'})",
        )
        return Response({"deleted": True})

    st = Student.objects.filter(id=student_id).first()
    if not st:
        return Response({"error": "student not found"}, status=404)

    if request.method == "GET":
        return Response(
            {
                "id": st.id,
                "name": st.name,
                "roll": st.roll or "",
                "class": st.class_text or "",
                "section": st.section or "",
                "reg_no": st.reg_no or "",
                "class_id": st.school_class_id,
            }
        )

    data = request.data
    name = str(data.get("name", "")).strip()
    if not name:
        return Response({"error": "Name is required"}, status=400)

    roll = str(data.get("roll", "")).strip()
    reg_no = str(data.get("reg_no", "")).strip()
    class_id_raw = data.get("class_id", None)

    class_id = None
    cls_name = ""
    section = ""
    if class_id_raw is not None and str(class_id_raw).strip() != "":
        try:
            class_id = int(class_id_raw)
        except (TypeError, ValueError):
            return Response({"error": "invalid class_id"}, status=400)
        allowed = services.list_classes_for_user(request.user.id, request.user.role)
        if class_id not in {c.id for c in allowed}:
            return Response({"error": "Not authorized for this class"}, status=403)
        crow = SchoolClass.objects.filter(id=class_id).first()
        if not crow:
            return Response({"error": "Class not found"}, status=404)
        cls_name = crow.name
        section = crow.section or ""

    old_class_id = st.school_class_id
    try:
        if class_id is not None:
            st.name = name
            st.roll = roll or None
            st.reg_no = reg_no or None
            st.school_class_id = class_id
            st.class_text = cls_name
            st.section = section or None
            st.save()
            if old_class_id and int(old_class_id) != int(class_id):
                Enrollment.objects.filter(student=st, school_class_id=old_class_id).delete()
            Enrollment.objects.get_or_create(
                student=st, school_class_id=class_id, defaults={"created_at": now_iso()}
            )
        else:
            st.name = name
            st.roll = roll or None
            st.reg_no = reg_no or None
            st.save()
    except IntegrityError:
        return Response(
            {"error": f"Roll number '{roll}' already exists. Use a unique roll."}, status=409
        )

    return Response(
        {
            "updated": True,
            "student_id": st.id,
            "name": st.name,
            "roll": roll,
            "reg_no": reg_no,
            "class_id": class_id,
            "class": cls_name,
            "section": section,
        }
    )


@api_view(["DELETE"])
@permission_classes([IsTeacherOrAdmin])
def delete_student_view(request, student_id):
    if not services.teacher_can_manage_student(request.user.id, request.user.role, student_id):
        return Response({"error": "Not authorized for this student"}, status=403)
    st_name = Student.objects.filter(id=student_id).values_list("name", flat=True).first()
    services.delete_student_cascade(student_id)
    folder = os.path.join(DATASET_DIR, str(student_id))
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    services.log_action(
        request.user,
        "student.deleted",
        target=f"Student #{student_id} ({st_name or '?'})",
    )
    return Response({"deleted": True})


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def train_model_view(request):
    started = training.start_training()
    if not started:
        return Response({"status": "already_running"}, status=202)
    services.log_action(request.user, "training.started", target="Recognition model")
    return Response({"status": "started"}, status=202)


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def train_status_view(request):
    return Response(training.read_train_status())


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def storage_stats_view(request):
    from .recognition import dataset_disk_usage

    usage = dataset_disk_usage(DATASET_DIR)
    return Response(
        {
            "dataset": usage,
            "face_embeddings": services.face_embedding_count(),
            "keep_capture_images": settings.KEEP_CAPTURE_IMAGES,
            "max_capture_images": settings.MAX_CAPTURE_IMAGES,
        }
    )


@api_view(["POST"])
@permission_classes([IsAdmin])
def prune_captures_view(request):
    from .recognition import prune_capture_images

    res = prune_capture_images(DATASET_DIR, keep_profile=True)
    services.log_action(
        request.user, "captures.pruned", detail=f"deleted={res['deleted']}"
    )
    return Response(res)


# ---------------------------------------------------------------------------
# Recognition
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
@rate_limit(lambda r: r.user.id, 60, 60)
def check_face_view(request):
    img_stream, err = _clean_upload(request)
    if err:
        return err
    from .recognition import check_face_quality

    return Response(check_face_quality(img_stream))


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
@rate_limit(lambda r: r.user.id, 60, 60)
def recognize_face_view(request):
    class_id, subject_id, err = _require_assignment(request)
    if err:
        return err

    img_stream, err = _clean_upload(request)
    if err:
        return err

    try:
        from .recognition import (
            extract_face_for_image,
            load_model_if_exists,
            predict_with_model,
        )

        face = extract_face_for_image(img_stream)
        if face is None:
            return Response({"recognized": False, "error": "no face detected"})

        emb = face["embedding"]
        bbox = face.get("bbox")
        frame_w = face.get("image_width")
        frame_h = face.get("image_height")

        clf = load_model_if_exists()
        if clf is None:
            return Response(
                {
                    "recognized": False,
                    "error": "model not trained",
                    "bbox": bbox,
                    "image_width": frame_w,
                    "image_height": frame_h,
                }
            )

        enrolled = services.student_ids_in_class(class_id)
        pred_label, conf = predict_with_model(
            clf,
            emb,
            allowed_ids=enrolled if enrolled else None,
            similarity_threshold=_effective_setting(
                "recognition.live_threshold", LIVE_SIM_THRESHOLD
            ),
        )
        if pred_label is None:
            return Response(
                {
                    "recognized": False,
                    "confidence": float(conf),
                    "bbox": bbox,
                    "image_width": frame_w,
                    "image_height": frame_h,
                    "label": "Unknown",
                }
            )

        sid = int(pred_label)
        st = Student.objects.filter(id=sid).first()
        name = st.name if st else "Unknown"

        saved = services.mark_present(
            [sid], class_id, subject_id, request.user.id, source="live"
        )
        if saved > 0:
            services.log_action(
                request.user,
                "attendance.marked",
                target=f"Student #{sid} ({name})",
                detail=f"class_id={class_id} subject_id={subject_id} source=live conf={conf:.3f}",
            )
        return Response(
            {
                "recognized": True,
                "student_id": sid,
                "name": name,
                "confidence": float(conf),
                "saved": saved > 0,
                "already_marked": saved == 0,
                "bbox": bbox,
                "image_width": frame_w,
                "image_height": frame_h,
                "label": name,
            }
        )
    except Exception:
        return Response({"recognized": False, "error": "recognition failed"}, status=500)


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
@rate_limit(lambda r: r.user.id, 20, 60)
def recognize_classroom_view(request):
    class_id, subject_id, err = _require_assignment(request)
    if err:
        return err

    img_stream, err = _clean_upload(request)
    if err:
        return err

    try:
        from .recognition import (
            extract_embeddings_for_classroom,
            load_model_if_exists,
            predict_with_model,
        )

        faces = extract_embeddings_for_classroom(img_stream)
        if not faces:
            return Response({"faces": [], "message": "No faces detected"})

        clf = load_model_if_exists()
        if clf is None:
            return Response({"error": "model not trained"})

        enrolled = services.student_ids_in_class(class_id)
        if not enrolled:
            return Response(
                {
                    "faces": [],
                    "error": "No students enrolled in this class. Add students to this class and Train Model first.",
                }
            )

        sim_thr = _effective_setting("recognition.classroom_threshold", CLASSROOM_SIM_THRESHOLD)
        strong_thr = _effective_setting(
            "recognition.classroom_strong_threshold", CLASSROOM_STRONG_THRESHOLD
        )
        margin = _effective_setting("recognition.classroom_margin", CLASSROOM_MARGIN)
        if len(enrolled) <= 5:
            sim_thr = min(sim_thr, 0.25)

        today = datetime.date.today().isoformat()
        results_list = []
        best_by_student = {}

        for face in faces:
            emb = face["embedding"]
            pred_label, conf = predict_with_model(
                clf, emb, allowed_ids=enrolled, similarity_threshold=sim_thr, margin=margin
            )
            closest_id, closest_conf = predict_with_model(
                clf, emb, allowed_ids=enrolled, similarity_threshold=0.0, margin=0.0
            )

            entry = {
                "bbox": face["bbox"],
                "confidence": float(conf),
                "recognized": False,
                "name": "Unknown",
                "student_id": None,
                "already_marked": False,
                "needs_review": True,
                "closest_name": None,
                "closest_confidence": float(closest_conf) if closest_id is not None else 0.0,
            }
            if closest_id is not None:
                crow = Student.objects.filter(id=int(closest_id)).values("name", "roll").first()
                if crow:
                    entry["closest_name"] = crow["name"]
                    entry["closest_roll"] = crow["roll"]

            if pred_label is not None:
                sid = int(pred_label)
                row = Student.objects.filter(id=sid).values("name", "roll", "class_text").first()
                if row:
                    entry["recognized"] = True
                    entry["name"] = row["name"]
                    entry["roll"] = row["roll"]
                    entry["class"] = row["class_text"]
                    entry["student_id"] = sid
                    entry["confidence"] = float(conf)
                    entry["needs_review"] = float(conf) < strong_thr

                    already = Attendance.objects.filter(
                        student_id=sid,
                        school_class_id=class_id,
                        subject_id=subject_id,
                        attendance_day=today,
                    ).exists()
                    entry["already_marked"] = bool(already)

                    prev = best_by_student.get(sid)
                    if prev is None or entry["confidence"] > prev["confidence"]:
                        best_by_student[sid] = entry
                    continue

            entry["name"] = "Unknown"
            entry["needs_review"] = True
            entry["confidence"] = float(entry.get("closest_confidence") or conf or 0.0)
            results_list.append(entry)

        results_list = list(best_by_student.values()) + [
            e for e in results_list if not e.get("recognized")
        ]

        return Response(
            {
                "faces": results_list,
                "class_id": class_id,
                "subject_id": subject_id,
                "detected": len(faces),
                "matched": len(best_by_student),
                "phase": 2,
            }
        )
    except Exception:
        return Response({"error": "recognition failed"}, status=500)


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def confirm_classroom_attendance_view(request):
    class_id, subject_id, err = _require_assignment(request)
    if err:
        return err

    student_ids = request.data.get("student_ids", [])
    if not student_ids:
        return Response({"saved": 0})

    enrolled = services.student_ids_in_class(class_id)
    if enrolled:
        student_ids = [sid for sid in student_ids if int(sid) in enrolled]

    saved = services.mark_present(
        [int(sid) for sid in student_ids], class_id, subject_id, request.user.id, source="classroom"
    )
    services.log_action(
        request.user,
        "attendance.confirmed",
        target=f"class #{class_id} subject #{subject_id}",
        detail=f"saved={saved} of {len(student_ids)} students",
    )
    return Response({"saved": saved})


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def attendance_records_view(request):
    def _int(name):
        raw = request.query_params.get(name)
        if raw in (None, ""):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    class_id = _int("class_id")
    subject_id = _int("subject_id")
    period = request.query_params.get("period", "all")
    records = services.attendance_records_for_user(
        request.user.id, request.user.role, class_id, subject_id, period
    )
    return Response(
        {
            "records": [
                {
                    "id": r.id,
                    "student_id": r.student_id,
                    "name": r.name,
                    "timestamp": r.timestamp,
                    "class_id": r.school_class_id,
                    "subject_id": r.subject_id,
                    "class_name": r.school_class.name if r.school_class else None,
                    "section": r.school_class.section if r.school_class else None,
                    "subject_name": r.subject.name if r.subject else None,
                }
                for r in records
            ]
        }
    )


@api_view(["DELETE"])
@permission_classes([IsTeacherOrAdmin])
def delete_attendance_record_view(request, record_id):
    class_ids = services.teacher_class_ids(request.user.id, request.user.role)
    row = Attendance.objects.filter(id=record_id).first()
    if not row:
        return Response({"error": "not found"}, status=404)
    if class_ids is not None and row.school_class_id not in class_ids:
        return Response({"error": "Not authorized"}, status=403)
    row.delete()
    services.log_action(
        request.user,
        "attendance.record.deleted",
        target=f"Attendance #{record_id}",
        detail=f"student={row.name or row.student_id} day={row.attendance_day}",
    )
    return Response({"deleted": True})


def _download_csv_response(request):
    class_ids = services.teacher_class_ids(request.user.id, request.user.role)
    qs = Attendance.objects.select_related("school_class", "subject")
    if class_ids is not None:
        qs = qs.filter(school_class_id__in=class_ids) if class_ids else Attendance.objects.none()
    rows = qs.order_by("-timestamp")

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "student_id", "name", "timestamp", "class", "section", "subject", "subject_code"])
    for r in rows:
        writer.writerow(
            [
                r.id,
                r.student_id,
                r.name,
                r.timestamp,
                r.school_class.name if r.school_class else "",
                r.school_class.section if r.school_class else "",
                r.subject.name if r.subject else "",
                r.subject.code if r.subject else "",
            ]
        )
    resp = HttpResponse(output.getvalue(), content_type="text/csv")
    resp["Content-Disposition"] = 'attachment; filename="attendance.csv"'
    return resp


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def download_csv_view(request):
    return _download_csv_response(request)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def analytics_view(request):
    def _int(name):
        raw = request.query_params.get(name)
        if raw in (None, ""):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    class_id = _int("class_id")
    subject_id = _int("subject_id")
    classes = services.list_classes_for_user(request.user.id, request.user.role)
    class_ids = services.teacher_class_ids(request.user.id, request.user.role)

    if class_id and class_ids is not None and class_id not in class_ids:
        return Response({"error": "Not authorized"}, status=403)

    if class_id:
        ids = services.student_ids_in_class(class_id)
        students = list(Student.objects.filter(id__in=ids).order_by("name")) if ids else []
    elif class_ids is None:
        students = list(Student.objects.all().order_by("name"))
    elif not class_ids:
        students = []
    else:
        students = list(
            Student.objects.filter(services.models_or_enrolled(class_ids))
            .distinct()
            .order_by("name")
        )

    rows = []
    today = datetime.date.today()
    for st in students:
        q = Attendance.objects.filter(student=st)
        if class_id:
            q = q.filter(school_class_id=class_id)
        if subject_id:
            q = q.filter(subject_id=subject_id)
        days_present = q.values("attendance_day").distinct().count()
        try:
            start_date = datetime.date.fromisoformat((st.created_at or "")[:10])
        except Exception:
            start_date = today
        total_days = max((today - start_date).days + 1, 1)
        pct = round((days_present / total_days) * 100, 1)
        rows.append(
            {
                "id": st.id,
                "name": st.name,
                "roll": st.roll or "-",
                "days_present": days_present,
                "total_days": total_days,
                "pct": pct,
            }
        )

    return Response(
        {
            "rows": rows,
            "classes": [
                {"id": c.id, "name": c.name, "section": c.section, "label": c.label()}
                for c in classes
            ],
            "selected_class_id": class_id,
            "selected_subject_id": subject_id,
        }
    )


# ---------------------------------------------------------------------------
# Copilot
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def copilot_view(request):
    query = (request.data.get("query") or request.data.get("message") or "").strip()
    if len(query) > 500:
        return Response({"error": "Query too long"}, status=400)
    from . import copilot

    return Response(copilot.ask(request.user.id, request.user.role, query))


# ---------------------------------------------------------------------------
# Register export
# ---------------------------------------------------------------------------
@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def register_export_meta_view(request):
    import calendar

    classes = services.list_classes_for_user(request.user.id, request.user.role)
    now = datetime.datetime.now()
    return Response(
        {
            "classes": [
                {"id": c.id, "name": c.name, "section": c.section, "label": c.label()}
                for c in classes
            ],
            "current_month": now.month,
            "current_year": now.year,
            "month_names": {i: calendar.month_name[i] for i in range(1, 13)},
        }
    )


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def register_export_xlsx_view(request):
    import calendar

    try:
        class_id = int(request.query_params.get("class_id"))
        subject_id = int(request.query_params.get("subject_id"))
        year = int(request.query_params.get("year"))
        month = int(request.query_params.get("month"))
    except (TypeError, ValueError):
        return Response({"error": "class_id, subject_id, year, month required"}, status=400)

    if month < 1 or month > 12:
        return Response({"error": "invalid month"}, status=400)

    if not services.teacher_can_access(request.user.id, request.user.role, class_id, subject_id):
        return Response({"error": "Not authorized for this class/subject"}, status=403)

    session_label = (request.query_params.get("session") or "").strip()
    faculty = (request.query_params.get("faculty") or "").strip()
    branch = (request.query_params.get("branch") or "").strip()

    from .register_export import build_register_workbook

    data = build_register_workbook(
        class_id=class_id,
        subject_id=subject_id,
        year=year,
        month=month,
        session_label=session_label,
        faculty_name=faculty,
        branch_label=branch,
    )
    fname = f"attendance_register_{year}_{month:02d}_c{class_id}_s{subject_id}.xlsx"
    resp = HttpResponse(data, content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp
