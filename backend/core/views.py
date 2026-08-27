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
    PendingRegistration,
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


def _client_ip(request):
    fwd = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "") or "unknown"

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


@api_view(["GET"])
@permission_classes([AllowAny])
def landing_stats_view(request):
    """Public, marketing-level counts for the landing page (no PII)."""
    from .recognition import dataset_disk_usage

    today = datetime.date.today().isoformat()
    return Response(
        {
            "students": Student.objects.count(),
            "classes": SchoolClass.objects.count(),
            "subjects": Subject.objects.count(),
            "attendance_today": Attendance.objects.filter(attendance_day=today).count(),
            "embeddings": services.face_embedding_count(),
            "dataset_mb": dataset_disk_usage(settings.DATASET_DIR)["mb"],
        }
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
    client_ip = _client_ip(request)
    from django.contrib.auth import authenticate

    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        services.log_action(
            None,
            "auth.login.failed",
            target=username or "(blank)",
            detail=f"ip={client_ip}",
        )
        return Response({"error": "Invalid username or password."}, status=400)
    token, _ = Token.objects.get_or_create(user=user)
    services.log_action(user, "auth.login", target=username, detail=f"ip={client_ip}")
    resp = Response({"user": _user_payload(user)})
    resp.set_cookie(
        settings.AUTH_COOKIE_NAME,
        token.key,
        max_age=settings.AUTH_COOKIE_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=settings.AUTH_COOKIE_SECURE,
        path="/",
    )
    return resp


@api_view(["GET"])
@permission_classes([AllowAny])
def public_classes_view(request):
    """Public list of active classes with their subjects for the registration dropdown."""
    classes = SchoolClass.objects.prefetch_related("subjects").all().order_by("name", "section")
    return Response(
        {
            "classes": [
                {
                    "id": c.id,
                    "name": c.name,
                    "section": c.section,
                    "label": c.label(),
                    "subject_count": c.subjects.count(),
                    "subjects": [s.name for s in c.subjects.all()],
                }
                for c in classes
            ]
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
@rate_limit(lambda r: "register", 15, 60)
def register_view(request):
    """Student self-registration — creates a PendingRegistration for admin approval.

    Face images are stored in a temporary directory under DATASET_DIR/pending/<pending_id>/.
    The admin must approve before the student account is fully created.
    """
    if not settings.ALLOW_PUBLIC_REGISTER:
        return Response({"error": "Public registration is currently disabled by administrator."}, status=403)

    data = request.data
    roll = (data.get("roll") or "").strip()
    name = (data.get("name") or "").strip()
    reg_no = (data.get("reg_no") or "").strip()
    class_id_raw = data.get("class_id")
    invite = (data.get("invite_code") or "").strip()

    # Validate invite code
    if settings.REGISTER_INVITE_CODE and invite != settings.REGISTER_INVITE_CODE:
        return Response({"error": "Invalid invite code. Ask your teacher for the registration code."}, status=400)

    # Required field validation
    if not roll or not name:
        return Response({"error": "Full name and roll number are required."}, status=400)

    # Check roll number is not already registered or pending
    User = get_user_model()
    if Student.objects.filter(roll=roll).exists() and User.objects.filter(student__roll=roll).exists():
        return Response({"error": "An account already exists for this roll number."}, status=400)
    if PendingRegistration.objects.filter(roll=roll, status=PendingRegistration.STATUS_PENDING).exists():
        return Response({"error": "A pending registration already exists for this roll number. Please wait for mentor approval."}, status=400)

    # Generate a safe, unique username based on roll number
    import re
    import uuid
    import secrets
    clean_username = re.sub(r'[^a-zA-Z0-9]', '', roll).lower()
    if not clean_username:
        clean_username = f"student_{uuid.uuid4().hex[:8]}"

    base_username = clean_username
    suffix = 1
    while User.objects.filter(username=clean_username).exists() or PendingRegistration.objects.filter(username=clean_username, status=PendingRegistration.STATUS_PENDING).exists():
        clean_username = f"{base_username}{suffix}"
        suffix += 1
    username = clean_username

    # Generate a random password since student login is not used
    password = secrets.token_urlsafe(16)

    # Validate class_id
    school_class = None
    if class_id_raw:
        try:
            school_class = SchoolClass.objects.filter(id=int(class_id_raw)).first()
        except (ValueError, TypeError):
            pass

    # Hash the password (stored as make_password hash, applied on approval)
    from django.contrib.auth.hashers import make_password as _make_password
    password_hash = _make_password(password)

    # Create the PendingRegistration record first to get an ID for the temp dir
    with transaction.atomic():
        pending = PendingRegistration.objects.create(
            name=name,
            roll=roll,
            reg_no=reg_no or None,
            school_class=school_class,
            username=username,
            password_hash=password_hash,
            invite_code_used=invite or None,
            temp_image_dir="",
            face_sample_count=0,
        )

        # Process face capture images into the temp directory
        files = request.FILES.getlist("images[]") or request.FILES.getlist("images")
        saved = 0
        temp_dir = os.path.join(DATASET_DIR, "pending", str(pending.id))
        os.makedirs(temp_dir, exist_ok=True)

        if files:
            for f in files[: settings.MAX_CAPTURE_IMAGES]:
                clean, err = read_upload(f)
                if err:
                    continue
                try:
                    fname = f"{datetime.datetime.utcnow().timestamp():.6f}_{saved}.jpg"
                    path = os.path.join(temp_dir, fname)
                    with open(path, "wb") as out:
                        out.write(clean)
                    saved += 1
                except Exception:
                    continue

        pending.temp_image_dir = temp_dir
        pending.face_sample_count = saved
        pending.save()

    services.log_action(
        None,
        "auth.register_pending",
        target=f"PendingReg #{pending.id} ({name} / {roll})",
        detail=f"class={school_class.label() if school_class else 'none'}, photos={saved}",
    )
    return Response(
        {
            "status": "pending",
            "pending_id": pending.id,
            "message": "Your registration has been submitted and is awaiting admin approval. You will be able to log in once approved.",
        },
        status=202,
    )


# ---------------------------------------------------------------------------
# Admin — pending student registration approvals
# ---------------------------------------------------------------------------

def _pending_reg_payload(p):
    """Serialise a PendingRegistration for the admin UI."""
    return {
        "id": p.id,
        "name": p.name,
        "roll": p.roll,
        "reg_no": p.reg_no or "",
        "username": p.username,
        "class_id": p.school_class_id,
        "class_label": p.school_class.label() if p.school_class else "",
        "face_sample_count": p.face_sample_count,
        "status": p.status,
        "csv_match_status": p.csv_match_status,
        "csv_match_detail": p.csv_match_detail,
        "submitted_at": p.submitted_at,
        "reviewed_at": p.reviewed_at,
        "reject_reason": p.reject_reason or "",
    }


@api_view(["GET"])
@permission_classes([IsTeacherOrAdmin])
def pending_registrations_view(request):
    """List pending (and recently reviewed) student registration requests.

    Admins see all; Teachers see pending registrations for their assigned classes.
    """
    status_filter = request.query_params.get("status", "pending")
    allowed_classes = services.teacher_class_ids(request.user.id, request.user.role)
    qs = PendingRegistration.objects.select_related("school_class").order_by("-submitted_at")
    if allowed_classes is not None:
        qs = qs.filter(school_class_id__in=allowed_classes)
    if status_filter != "all":
        qs = qs.filter(status=status_filter)
    return Response({"registrations": [_pending_reg_payload(p) for p in qs]})


def _parse_csv_rows(csv_file):
    """Read uploaded CSV and return list-of-dicts with canonical keys.

    Handles ITM University-Gwalior attendance register format:
      S.No. | Roll No. | Name of the Student | ...date columns...
    as well as common Excel/CSV export variants.
    """
    import csv as _csv

    try:
        text = csv_file.read().decode("utf-8-sig", errors="replace")
    except Exception:
        return None, "Could not read file"

    reader = _csv.DictReader(text.splitlines())
    if reader.fieldnames is None:
        return None, "CSV appears to be empty or has no header row"

    # Map arbitrary column names to canonical keys.
    # Normalise: strip whitespace, lowercase, collapse punctuation/spaces to underscore.
    def _norm(h):
        import re
        return re.sub(r"[\s.\-/]+", "_", h.strip().lower()).strip("_")

    def _canon(h):
        n = _norm(h)
        # ── Roll number ──────────────────────────────────────────────────────
        if n in (
            "roll", "roll_no", "roll_number", "rollno",
            "scholar_no", "scholar_number",
            "enrollment_no", "enrolment_no", "enroll_no",
            "s_no", "sr_no",          # some registers label roll as S.No.
        ):
            return "roll"
        # ── Student name ─────────────────────────────────────────────────────
        # ITM register: "Name of the Student"
        if n in (
            "name", "student_name", "full_name",
            "name_of_the_student", "name_of_student",
            "students_name", "candidate_name",
            "stud_name", "sname",
        ):
            return "name"
        # ── Registration / Enrollment number ─────────────────────────────────
        if n in (
            "reg_no", "registration_no", "registration_number",
            "reg_number", "regno", "regn",
        ):
            return "reg_no"
        # ── Serial number — keep as _sno so we never mistake it for roll ─────
        if n in ("sno", "sl_no", "sl", "serial_no", "serial"):
            return "_sno"
        return n

    col_map = {h: _canon(h) for h in (reader.fieldnames or [])}

    rows = []
    for raw in reader:
        row = {col_map.get(k, k): (v or "").strip() for k, v in raw.items()}
        # Skip completely empty rows (common in ITM register CSVs with blank lines)
        if not any(row.values()):
            continue
        rows.append(row)
    return rows, None


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def verify_registration_csv_view(request):
    """Upload attendance-register CSV and match against pending registrations.

    Admins match against all pending; Teachers match against their assigned class sections.
    """
    import difflib

    csv_file = request.FILES.get("csv")
    if not csv_file:
        return Response({"error": "No CSV file uploaded (field name: csv)"}, status=400)

    rows, err = _parse_csv_rows(csv_file)
    if err:
        return Response({"error": err}, status=400)
    if not rows:
        return Response({"error": "CSV file has no data rows"}, status=400)

    allowed_classes = services.teacher_class_ids(request.user.id, request.user.role)
    pending_qs = PendingRegistration.objects.filter(
        status=PendingRegistration.STATUS_PENDING
    ).select_related("school_class")
    if allowed_classes is not None:
        pending_qs = pending_qs.filter(school_class_id__in=allowed_classes)

    updated = []
    for pending in pending_qs:
        p_roll = (pending.roll or "").strip().lower()
        p_name = (pending.name or "").strip().lower()

        best_status = PendingRegistration.CSV_NONE
        best_detail = None
        best_score = 0.0

        for row in rows:
            csv_roll = (row.get("roll") or "").strip().lower()
            csv_name = (row.get("name") or "").strip().lower()

            # Exact roll match → highest priority
            if csv_roll and csv_roll == p_roll:
                best_status = PendingRegistration.CSV_EXACT
                best_detail = {k: v for k, v in row.items() if v}
                best_score = 1.0
                break

            # Fuzzy name match as fallback
            if csv_name and p_name:
                sim = difflib.SequenceMatcher(None, p_name, csv_name).ratio()
                if sim >= 0.82 and sim > best_score:
                    best_score = sim
                    best_status = PendingRegistration.CSV_FUZZY
                    best_detail = {**{k: v for k, v in row.items() if v}, "_similarity": round(sim, 3)}

        pending.csv_match_status = best_status
        pending.csv_match_detail = best_detail
        pending.save(update_fields=["csv_match_status", "csv_match_detail"])
        updated.append(_pending_reg_payload(pending))

    services.log_action(
        request.user,
        "admin.csv_verify",
        target=f"Verified {len(updated)} pending registration(s) against CSV ({len(rows)} rows)",
    )
    return Response({"registrations": updated, "csv_rows": len(rows)})


def _do_approve_pending(pending, reviewed_by):
    """Core approval logic: create Student, User, Enrollments, face centroid.

    Returns the created RoleUser on success, raises on error.
    """
    import numpy as np
    import cv2
    from django.contrib.auth.hashers import is_password_usable
    from .recognition import get_face_app

    User = get_user_model()

    with transaction.atomic():
        # Re-check uniqueness inside transaction
        if User.objects.filter(username=pending.username).exists():
            raise ValueError(f"Username '{pending.username}' is already taken.")

        # Resolve class
        school_class = pending.school_class
        cls_name = school_class.name if school_class else ""
        cls_sec = school_class.section if school_class else ""

        # Create the Student record
        st = Student.objects.create(
            name=pending.name,
            roll=pending.roll,
            reg_no=pending.reg_no or None,
            class_text=cls_name,
            section=cls_sec,
            school_class=school_class,
            created_at=now_iso(),
        )

        # Enroll student in the class AND every subject under that class
        if school_class:
            Enrollment.objects.get_or_create(
                student=st, school_class=school_class, defaults={"created_at": now_iso()}
            )

        # Create user with already-hashed password (skip make_password re-hash)
        user = User(
            username=pending.username,
            password=pending.password_hash,
            role="student",
            student=st,
            full_name=pending.name,
            created_at=now_iso(),
        )
        user.save()

        Token.objects.get_or_create(user=user)

        # Move temp face images to dataset/<student_id>/
        temp_dir = pending.temp_image_dir
        dest_dir = os.path.join(DATASET_DIR, str(st.id))
        embeddings = []
        if temp_dir and os.path.isdir(temp_dir):
            os.makedirs(dest_dir, exist_ok=True)
            face_app = get_face_app((640, 640))
            first_img = True
            for fn in sorted(os.listdir(temp_dir)):
                if not fn.lower().endswith((".jpg", ".jpeg", ".png")):
                    continue
                src = os.path.join(temp_dir, fn)
                dst = os.path.join(dest_dir, fn)
                try:
                    shutil.move(src, dst)
                    # Create profile from first image
                    if first_img:
                        _save_compact_profile(dst, os.path.join(dest_dir, "profile.jpg"))
                        first_img = False
                    # Extract embedding
                    img = cv2.imread(dst)
                    if img is not None:
                        faces = face_app.get(img)
                        if faces:
                            best = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
                            embeddings.append(np.asarray(best.normed_embedding, dtype=np.float32))
                except Exception:
                    continue
            # Clean up empty temp dir
            try:
                os.rmdir(temp_dir)
            except OSError:
                pass

        # Compute and persist face centroid
        if embeddings:
            stack = np.stack(embeddings)
            centroid = np.mean(stack, axis=0)
            norm = np.linalg.norm(centroid)
            if norm > 1e-6:
                centroid = centroid / norm
            services.upsert_face_centroid(st.id, centroid.astype(np.float32), len(embeddings))

        # Mark as approved
        pending.status = PendingRegistration.STATUS_APPROVED
        pending.reviewed_at = now_iso()
        pending.reviewed_by = reviewed_by
        pending.save()

    return user


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def approve_registration_view(request, reg_id):
    """Approve a single pending registration."""
    pending = get_object_or_404(PendingRegistration, id=reg_id)
    if pending.status != PendingRegistration.STATUS_PENDING:
        return Response({"error": f"Registration is already '{pending.status}', cannot approve again."}, status=400)

    allowed_classes = services.teacher_class_ids(request.user.id, request.user.role)
    if allowed_classes is not None and pending.school_class_id not in allowed_classes:
        return Response({"error": "You are not authorized to approve registrations for this class section."}, status=403)

    try:
        user = _do_approve_pending(pending, request.user)
    except ValueError as e:
        return Response({"error": str(e)}, status=400)
    except Exception as e:
        return Response({"error": f"Approval failed: {e}"}, status=500)

    services.log_action(
        request.user,
        "admin.registration_approved",
        target=f"PendingReg #{pending.id} ({pending.name} / {pending.roll})",
    )
    return Response({"ok": True, "student_id": user.student_id, "username": user.username})


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def reject_registration_view(request, reg_id):
    """Reject a pending registration (with optional reason) and clean up temp images."""
    pending = get_object_or_404(PendingRegistration, id=reg_id)
    if pending.status != PendingRegistration.STATUS_PENDING:
        return Response({"error": f"Registration is already '{pending.status}'."}, status=400)

    allowed_classes = services.teacher_class_ids(request.user.id, request.user.role)
    if allowed_classes is not None and pending.school_class_id not in allowed_classes:
        return Response({"error": "You are not authorized to reject registrations for this class section."}, status=403)

    reason = (request.data.get("reason") or "").strip()

    # Delete temp face images
    temp_dir = pending.temp_image_dir
    if temp_dir and os.path.isdir(temp_dir):
        try:
            shutil.rmtree(temp_dir)
        except OSError:
            pass

    pending.status = PendingRegistration.STATUS_REJECTED
    pending.reviewed_at = now_iso()
    pending.reviewed_by = request.user
    pending.reject_reason = reason
    pending.save()

    services.log_action(
        request.user,
        "admin.registration_rejected",
        target=f"PendingReg #{pending.id} ({pending.name} / {pending.roll})",
        detail=reason or "(no reason given)",
    )
    return Response({"ok": True})


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def bulk_approve_registrations_view(request):
    """Approve all pending registrations that matched the CSV (exact or fuzzy)."""
    allowed_classes = services.teacher_class_ids(request.user.id, request.user.role)
    qs = PendingRegistration.objects.filter(
        status=PendingRegistration.STATUS_PENDING,
        csv_match_status__in=[PendingRegistration.CSV_EXACT, PendingRegistration.CSV_FUZZY],
    ).select_related("school_class")
    if allowed_classes is not None:
        qs = qs.filter(school_class_id__in=allowed_classes)

    results = []
    for pending in qs:
        try:
            user = _do_approve_pending(pending, request.user)
            results.append({"id": pending.id, "name": pending.name, "ok": True})
            services.log_action(
                request.user,
                "admin.registration_approved",
                target=f"PendingReg #{pending.id} ({pending.name} / {pending.roll}) [bulk]",
            )
        except Exception as e:
            results.append({"id": pending.id, "name": pending.name, "ok": False, "error": str(e)})

    approved = sum(1 for r in results if r["ok"])
    return Response({"approved": approved, "total": len(results), "results": results})


@api_view(["POST"])
def logout_view(request):
    try:
        if request.auth is not None and hasattr(request.auth, "delete"):
            request.auth.delete()
    except Exception:
        pass
    services.log_action(request.user, "auth.logout", target=request.user.username)
    resp = Response({"ok": True})
    resp.delete_cookie(
        settings.AUTH_COOKIE_NAME,
        path="/",
        samesite="Lax",
    )
    return resp


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
    role = (request.data.get("role") or "teacher").strip().lower()
    if role not in ("teacher", "mentor", "event_organizer"):
        role = "teacher"
    if not username or not password:
        return Response({"error": "username and password required"}, status=400)
    try:
        with transaction.atomic():
            user = get_user_model().objects.create_user(
                username=username,
                password=password,
                role=role,
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
    from .models import RoleUser

    try:
        user_id = int(request.data.get("user_id"))
        class_id = int(request.data.get("class_id"))
    except (TypeError, ValueError):
        return Response({"error": "user_id and class_id required"}, status=400)

    user = RoleUser.objects.filter(id=user_id, role__in=["teacher", "mentor"]).first()
    if not user:
        return Response({"error": "teacher or mentor not found"}, status=404)

    # Mentors are assigned at class level only — no subject required
    if user.role == "mentor":
        try:
            with transaction.atomic():
                a = TeacherAssignment.objects.create(
                    user_id=user_id,
                    school_class_id=class_id,
                    subject_id=None,
                    created_at=now_iso(),
                )
        except IntegrityError:
            return Response({"error": "mentor already assigned to this class section"}, status=409)
        services.log_action(
            request.user,
            "assignment.created",
            target=f"Mentor #{user_id} → class #{class_id}",
        )
        return Response({"assignment_id": a.id}, status=201)

    # Teachers require a subject
    try:
        subject_id = int(request.data.get("subject_id"))
    except (TypeError, ValueError):
        return Response({"error": "subject_id required for teacher assignment"}, status=400)

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
        .objects.filter(role__in=["teacher", "mentor", "event_organizer"])
        .order_by("username")
        .values("id", "username", "full_name", "role", "created_at", "is_active")

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
    user = get_user_model().objects.filter(id=teacher_id, role__in=["teacher", "mentor", "event_organizer"]).first()
    if not user:
        return Response({"error": "user not found"}, status=404)

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
@permission_classes([AllowAny])
@rate_limit(lambda r: f"check_face_{r.META.get('REMOTE_ADDR')}", 60, 60)
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


def _csv_safe(value):
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


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
                _csv_safe(r.student_id),
                _csv_safe(r.name),
                r.timestamp,
                _csv_safe(r.school_class.name) if r.school_class else "",
                _csv_safe(r.school_class.section) if r.school_class else "",
                _csv_safe(r.subject.name) if r.subject else "",
                _csv_safe(r.subject.code) if r.subject else "",
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


# ===========================================================================
# EVENT ATTENDANCE MODULE
# ===========================================================================
from .models import EventSession, EventAttendance
from .permissions import IsEventOrganizerOrAdmin


def _event_payload(event):
    """Serialise an EventSession instance."""
    count = EventAttendance.objects.filter(event=event).count()
    return {
        "id": event.id,
        "name": event.name,
        "venue": event.venue or "",
        "description": event.description or "",
        "event_date": str(event.event_date),
        "start_time": str(event.start_time)[:5],
        "end_time": str(event.end_time)[:5],
        "is_active": event.is_active,
        "latitude": event.latitude,
        "longitude": event.longitude,
        "radius": event.radius,
        "created_at": event.created_at,
        "attendance_count": count,
    }



def _geocode_address(address):
    """Call Nominatim API to get coordinates of an address/venue."""
    if not address:
        return None, None
    
    # ITM University Gwalior default fallback
    addr_lower = address.lower()
    if "itm" in addr_lower or "university" in addr_lower:
        return 26.0607, 78.1396

    import requests
    try:
        url = f"https://nominatim.openstreetmap.org/search?q={address}&format=json&limit=1"
        headers = {
            "User-Agent": "ITM-Attendance-App/1.0 (karanbhadouriya2926@gmail.com)"
        }
        resp = requests.get(url, headers=headers, timeout=3.0)
        if resp.status_code == 200:
            data = resp.json()
            if data:
                return float(data[0]["lat"]), float(data[0]["lon"])
    except Exception:
        pass
    return 26.0607, 78.1396 # Fallback to ITM University Gwalior


@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def event_list_create_view(request):
    """
    GET  — public: list all events.
    POST — event_organizer / admin: create a new event.
    """
    if request.method == "GET":
        events = EventSession.objects.order_by("-event_date", "-id")
        return Response({"events": [_event_payload(e) for e in events]})

    # POST — protected
    if not request.user.is_authenticated or getattr(request.user, "role", None) not in ("event_organizer", "admin"):
        return Response({"error": "Not authorized"}, status=403)

    data = request.data
    name = (data.get("name") or "").strip()
    venue = (data.get("venue") or "").strip()
    description = (data.get("description") or "").strip()
    event_date = (data.get("event_date") or "").strip()
    start_time = (data.get("start_time") or "").strip()
    end_time = (data.get("end_time") or "").strip()
    
    lat_val = data.get("latitude")
    lng_val = data.get("longitude")
    radius_val = data.get("radius")

    if not name or not event_date or not start_time or not end_time:
        return Response({"error": "name, event_date, start_time, end_time are required"}, status=400)

    # Automatically resolve coordinates from venue name if not manually provided
    if not lat_val or not lng_val:
        lat, lng = _geocode_address(venue or "ITM University Gwalior")
    else:
        try:
            lat = float(lat_val)
            lng = float(lng_val)
        except (TypeError, ValueError):
            lat, lng = 26.0607, 78.1396

    try:
        radius = int(radius_val) if radius_val else 300
    except (TypeError, ValueError):
        radius = 300

    # Deactivate any existing active event before creating a new one
    EventSession.objects.filter(is_active=True).update(is_active=False)

    event = EventSession.objects.create(
        name=name,
        venue=venue or None,
        description=description or None,
        event_date=event_date,
        start_time=start_time,
        end_time=end_time,
        latitude=lat,
        longitude=lng,
        radius=radius,
        is_active=True,
        created_by=request.user,
        created_at=now_iso(),
    )
    services.log_action(request.user, "event.created", target=f"Event #{event.id}: {name}")
    return Response(_event_payload(event), status=201)



@api_view(["GET"])
@permission_classes([AllowAny])
def event_active_view(request):
    """Public: return the currently active event (or null)."""
    event = EventSession.objects.filter(is_active=True).order_by("-id").first()
    if not event:
        return Response({"event": None})
    return Response({"event": _event_payload(event)})


@api_view(["GET"])
@permission_classes([AllowAny])
def event_detail_view(request, event_id):
    """Public: get event details by ID."""
    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)
    return Response({"event": _event_payload(event)})


@api_view(["DELETE"])
@permission_classes([IsEventOrganizerOrAdmin])
def event_delete_view(request, event_id):
    """Delete an event session."""
    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)
    name = event.name
    event.delete()
    services.log_action(request.user, "event.deleted", target=f"Event #{event_id}: {name}")
    return Response({"success": True})


@api_view(["PUT"])
@permission_classes([IsEventOrganizerOrAdmin])
def event_update_view(request, event_id):
    """Update event session details."""
    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)

    data = request.data
    name = (data.get("name") or "").strip()
    venue = (data.get("venue") or "").strip()
    description = (data.get("description") or "").strip()
    event_date = (data.get("event_date") or "").strip()
    start_time = (data.get("start_time") or "").strip()
    end_time = (data.get("end_time") or "").strip()
    lat_val = data.get("latitude")
    lng_val = data.get("longitude")
    radius_val = data.get("radius")

    if not name or not event_date or not start_time or not end_time:
        return Response({"error": "name, event_date, start_time, end_time are required"}, status=400)

    # Automatically resolve coordinates from venue name if custom ones are not provided or changed
    if not lat_val or not lng_val:
        lat, lng = _geocode_address(venue or "ITM University Gwalior")
    else:
        try:
            lat = float(lat_val)
            lng = float(lng_val)
        except (TypeError, ValueError):
            lat, lng = 26.0607, 78.1396

    try:
        radius = int(radius_val) if radius_val else 300
    except (TypeError, ValueError):
        radius = 300

    event.name = name
    event.venue = venue or None
    event.description = description or None
    event.event_date = event_date
    event.start_time = start_time
    event.end_time = end_time
    event.latitude = lat
    event.longitude = lng
    event.radius = radius
    event.save()

    services.log_action(request.user, "event.updated", target=f"Event #{event.id}: {name}")
    return Response(_event_payload(event))




@api_view(["POST"])
@permission_classes([IsEventOrganizerOrAdmin])
def event_toggle_view(request, event_id):
    """Toggle active/inactive for an event."""
    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)

    if not event.is_active:
        # Activating — close all others first
        EventSession.objects.filter(is_active=True).update(is_active=False)
        event.is_active = True
        event.save()
        services.log_action(request.user, "event.opened", target=f"Event #{event.id}")
    else:
        event.is_active = False
        event.save()
        services.log_action(request.user, "event.closed", target=f"Event #{event.id}")

    return Response(_event_payload(event))


@api_view(["GET"])
@permission_classes([IsEventOrganizerOrAdmin])
def event_attendance_list_view(request, event_id):
    """Organizer: list all attendees for an event."""
    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)

    records = (
        EventAttendance.objects.filter(event=event)
        .select_related("student", "student__school_class")
        .order_by("checked_in_at")
    )
    rows = []
    for r in records:
        st = r.student
        rows.append({
            "id": r.id,
            "student_id": st.id,
            "name": st.name,
            "roll": st.roll or "",
            "reg_no": st.reg_no or "",
            "class_name": st.class_text or (st.school_class.name if st.school_class else ""),
            "section": st.section or (st.school_class.section if st.school_class else ""),
            "checked_in_at": r.checked_in_at,
            "latitude": r.latitude,
            "longitude": r.longitude,
            "location_name": r.location_name or (f"{r.latitude:.5f}, {r.longitude:.5f}" if r.latitude else "Unknown"),
            "location_accuracy": r.location_accuracy,
            "face_confidence": round(r.face_confidence * 100, 1) if r.face_confidence else None,
        })
    return Response({"event": _event_payload(event), "attendees": rows})


@api_view(["GET"])
@permission_classes([IsEventOrganizerOrAdmin])
def event_attendance_csv_view(request, event_id):
    """Organizer: download attendance as CSV."""
    import csv as _csv
    from io import StringIO

    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found"}, status=404)

    records = (
        EventAttendance.objects.filter(event=event)
        .select_related("student", "student__school_class")
        .order_by("checked_in_at")
    )

    buf = StringIO()
    writer = _csv.writer(buf)
    writer.writerow(["S.No.", "Name", "Roll No.", "Reg No.", "Class", "Section",
                     "Check-In Time", "Location / Place", "Latitude", "Longitude", "Accuracy (m)", "Face Confidence (%)"])
    for i, r in enumerate(records, 1):
        st = r.student
        writer.writerow([
            i,
            st.name,
            st.roll or "",
            st.reg_no or "",
            st.class_text or (st.school_class.name if st.school_class else ""),
            st.section or (st.school_class.section if st.school_class else ""),
            r.checked_in_at,
            r.location_name or (f"{r.latitude:.5f}, {r.longitude:.5f}" if r.latitude else "Unknown"),
            r.latitude or "",
            r.longitude or "",
            round(r.location_accuracy, 1) if r.location_accuracy else "",
            round(r.face_confidence * 100, 1) if r.face_confidence else "",
        ])

    from django.http import HttpResponse as _HttpResponse
    resp = _HttpResponse(buf.getvalue(), content_type="text/csv")
    fname = f"event_attendance_{event.name.replace(' ', '_')}_{event.event_date}.csv"
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return resp



def _reverse_geocode(lat, lng):
    if lat is None or lng is None:
        return None
    import requests
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?format=json&lat={lat}&lon={lng}&zoom=18&addressdetails=1"
        headers = {
            "User-Agent": "ITM-Attendance-App/1.0 (karanbhadouriya2926@gmail.com)"
        }
        resp = requests.get(url, headers=headers, timeout=2.5)
        if resp.status_code == 200:
            data = resp.json()
            address = data.get("address", {})
            place = (
                address.get("amenity") or 
                address.get("building") or 
                address.get("university") or 
                address.get("college") or 
                address.get("office") or 
                address.get("shop") or 
                address.get("tourism")
            )
            road = address.get("road")
            suburb = address.get("suburb") or address.get("neighbourhood")
            city = address.get("city") or address.get("town") or address.get("village")
            
            parts = []
            if place:
                parts.append(place)
            if road:
                parts.append(road)
            if suburb:
                parts.append(suburb)
            if city:
                parts.append(city)
                
            if parts:
                return ", ".join(parts)
            return data.get("display_name")
    except Exception:
        pass
    return None


def _haversine_distance(lat1, lon1, lat2, lon2):
    import math
    R = 6371.0 # Earth radius in km
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 + 
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * 
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c * 1000.0 # Distance in meters


@api_view(["POST"])
@permission_classes([AllowAny])
@rate_limit(lambda r: f"event_checkin_{r.META.get('REMOTE_ADDR')}", 20, 60)
def event_checkin_view(request, event_id):
    """
    Public self-check-in for an event.
    Accepts: face image (images[] or image), latitude, longitude, accuracy.
    Runs face recognition → records attendance with GPS.
    """
    import datetime

    event = EventSession.objects.filter(id=event_id).first()
    if not event:
        return Response({"error": "Event not found."}, status=404)

    if not event.is_active:
        return Response({"error": "This event is not currently accepting check-ins."}, status=400)

    # ── Time window check ──────────────────────────────────────────────────
    from django.utils import timezone
    from zoneinfo import ZoneInfo
    tz = ZoneInfo("Asia/Kolkata")
    now_dt = timezone.now().astimezone(tz).replace(tzinfo=None)
    event_start = datetime.datetime.combine(event.event_date, event.start_time)
    event_end = datetime.datetime.combine(event.event_date, event.end_time)
    if now_dt < event_start:
        return Response({
            "error": f"Check-in opens at {event.start_time.strftime('%I:%M %p')}. Please come back later."
        }, status=400)
    if now_dt > event_end:
        return Response({
            "error": f"Check-in for this event closed at {event.end_time.strftime('%I:%M %p')}."
        }, status=400)


    # ── Face image ─────────────────────────────────────────────────────────
    img_stream, err = _clean_upload(request)
    if err:
        return err

    # ── GPS ────────────────────────────────────────────────────────────────
    try:
        lat = float(request.data.get("latitude")) if request.data.get("latitude") else None
        lng = float(request.data.get("longitude")) if request.data.get("longitude") else None
        acc = float(request.data.get("accuracy")) if request.data.get("accuracy") else None
    except (TypeError, ValueError):
        lat = lng = acc = None

    # ── Geofencing check ───────────────────────────────────────────────────
    if event.latitude is not None and event.longitude is not None:
        if lat is None or lng is None:
            return Response({
                "error": "Location access is required to check in to this event. Please allow location access in your browser."
            }, status=400)
        
        dist = _haversine_distance(lat, lng, event.latitude, event.longitude)
        # Deduct accuracy to account for indoor GPS error margin
        effective_dist = max(0.0, dist - (acc or 0.0))
        if effective_dist > event.radius:
            return Response({
                "error": f"Check-in rejected. You are {int(dist)}m away from the venue (Your coordinates: {lat:.6f}, {lng:.6f}; accuracy: ±{int(acc or 0)}m), but check-in is only allowed within {event.radius}m of the event center."
            }, status=400)


    # ── Face recognition ───────────────────────────────────────────────────

    try:
        from .recognition import (
            extract_face_for_image,
            load_model_if_exists,
            predict_with_model,
        )

        face = extract_face_for_image(img_stream)
        if face is None:
            return Response({"error": "No face detected. Please look directly at the camera in good lighting."}, status=400)

        emb = face["embedding"]
        clf = load_model_if_exists()
        if clf is None:
            return Response({"error": "Face recognition model is not trained yet. Contact the administrator."}, status=503)

        pred_label, conf = predict_with_model(
            clf,
            emb,
            allowed_ids=None,  # Check against ALL registered students (event-wide)
            similarity_threshold=_effective_setting("recognition.live_threshold", LIVE_SIM_THRESHOLD),
        )

        if pred_label is None:
            return Response({
                "error": "Face not recognized. Make sure you are registered and approved in the system."
            }, status=400)

    except Exception as exc:
        return Response({"error": f"Recognition failed: {str(exc)}"}, status=500)

    student = Student.objects.filter(id=int(pred_label)).first()
    if not student:
        return Response({"error": "Student record not found."}, status=404)

    # ── Duplicate check ────────────────────────────────────────────────────
    if EventAttendance.objects.filter(event=event, student=student).exists():
        return Response({
            "error": f"You have already checked in to this event.",
            "already_checked_in": True,
            "student_name": student.name,
            "student_roll": student.roll or "",
        }, status=409)

    # ── Save photo ─────────────────────────────────────────────────────────
    import uuid
    photo_path = None
    try:
        event_photos_dir = os.path.join(DATASET_DIR, "event_photos", str(event_id))
        os.makedirs(event_photos_dir, exist_ok=True)
        photo_filename = f"{student.id}_{uuid.uuid4().hex[:8]}.jpg"
        photo_path = os.path.join(event_photos_dir, photo_filename)
        img_stream.seek(0)
        with open(photo_path, "wb") as f:
            f.write(img_stream.read())
    except Exception:
        photo_path = None

    # ── Record attendance ──────────────────────────────────────────────────
    checked_in_at = now_iso()
    loc_name = _reverse_geocode(lat, lng)
    EventAttendance.objects.create(
        event=event,
        student=student,
        checked_in_at=checked_in_at,
        latitude=lat,
        longitude=lng,
        location_accuracy=acc,
        photo_path=photo_path,
        face_confidence=conf,
        location_name=loc_name,
    )

    services.log_action(None, "event.checkin", target=f"Student #{student.id} → Event #{event.id}")

    return Response({
        "success": True,
        "student_name": student.name,
        "student_roll": student.roll or "",
        "student_reg_no": student.reg_no or "",
        "class_name": student.class_text or (student.school_class.name if student.school_class else ""),
        "section": student.section or (student.school_class.section if student.school_class else ""),
        "checked_in_at": checked_in_at,
        "latitude": lat,
        "longitude": lng,
        "location_name": loc_name or (f"{lat:.5f}, {lng:.5f}" if lat else "Unknown"),
        "event_name": event.name,
        "face_confidence": round(conf * 100, 1),
    })


