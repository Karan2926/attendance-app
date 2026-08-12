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
from django.http import FileResponse, HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import services, training
from .models import (
    Attendance,
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

DATASET_DIR = settings.DATASET_DIR
os.makedirs(DATASET_DIR, exist_ok=True)

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
# Students
# ---------------------------------------------------------------------------
def _parse_class_subject(request):
    try:
        class_id = int(request.data.get("class_id"))
        subject_id = int(request.data.get("subject_id"))
    except (TypeError, ValueError):
        return None, None
    return class_id, subject_id


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
def upload_face_view(request, student_id):
    if not services.teacher_can_manage_student(request.user.id, request.user.role, student_id):
        return Response({"error": "Not authorized for this student"}, status=403)

    files = request.FILES.getlist("images[]") or request.FILES.getlist("images")
    files = files[: settings.MAX_CAPTURE_IMAGES]
    saved = 0
    folder = os.path.join(DATASET_DIR, str(student_id))
    os.makedirs(folder, exist_ok=True)
    has_profile = os.path.exists(os.path.join(folder, "profile.jpg"))
    for f in files:
        try:
            fname = f"{datetime.datetime.utcnow().timestamp():.6f}_{saved}.jpg"
            path = os.path.join(folder, fname)
            with open(path, "wb") as out:
                for chunk in f.chunks():
                    out.write(chunk)
            if saved == 0 and not has_profile:
                _save_compact_profile(path, os.path.join(folder, "profile.jpg"))
            saved += 1
        except Exception:
            continue
    return Response(
        {
            "saved": saved,
            "note": "Captures are temporary. After Train Model, only profile.jpg is kept.",
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
        services.delete_student_cascade(student_id)
        folder = os.path.join(DATASET_DIR, str(student_id))
        if os.path.isdir(folder):
            shutil.rmtree(folder, ignore_errors=True)
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
    services.delete_student_cascade(student_id)
    folder = os.path.join(DATASET_DIR, str(student_id))
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
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

    return Response(prune_capture_images(DATASET_DIR, keep_profile=True))


# ---------------------------------------------------------------------------
# Recognition
# ---------------------------------------------------------------------------
@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def check_face_view(request):
    if "image" not in request.FILES:
        return Response({"ok": False, "reason": "no image"}, status=400)
    from .recognition import check_face_quality

    return Response(check_face_quality(request.FILES["image"]))


@api_view(["POST"])
@permission_classes([IsTeacherOrAdmin])
def recognize_face_view(request):
    class_id, subject_id, err = _require_assignment(request)
    if err:
        return err

    if "image" not in request.FILES:
        return Response({"recognized": False, "error": "no image"}, status=400)
    img_file = request.FILES["image"]

    try:
        from .recognition import (
            extract_face_for_image,
            load_model_if_exists,
            predict_with_model,
        )

        face = extract_face_for_image(img_file)
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
            clf, emb, allowed_ids=enrolled if enrolled else None
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
def recognize_classroom_view(request):
    class_id, subject_id, err = _require_assignment(request)
    if err:
        return err

    if "image" not in request.FILES:
        return Response({"error": "no image"}, status=400)
    img_file = request.FILES["image"]

    try:
        from .recognition import (
            CLASSROOM_MARGIN,
            CLASSROOM_SIM_THRESHOLD,
            CLASSROOM_STRONG_THRESHOLD,
            extract_embeddings_for_classroom,
            load_model_if_exists,
            predict_with_model,
        )

        faces = extract_embeddings_for_classroom(img_file)
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

        sim_thr = CLASSROOM_SIM_THRESHOLD
        if len(enrolled) <= 5:
            sim_thr = min(sim_thr, 0.25)

        today = datetime.date.today().isoformat()
        results_list = []
        best_by_student = {}

        for face in faces:
            emb = face["embedding"]
            pred_label, conf = predict_with_model(
                clf, emb, allowed_ids=enrolled, similarity_threshold=sim_thr, margin=CLASSROOM_MARGIN
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
                    entry["needs_review"] = float(conf) < CLASSROOM_STRONG_THRESHOLD

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
