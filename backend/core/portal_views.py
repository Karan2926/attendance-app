"""College portal API (Phase 3) — Django port of portal_api.py.

The React college website calls these JSON endpoints. Auth is a shared API key
(PORTAL_API_KEY) — not teacher browser sessions.
"""

from __future__ import annotations

import datetime
import json

from django.conf import settings
from django.db import IntegrityError
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import PortalSyncLog, SchoolClass, Student
from . import services


def _check_api_key(request):
    if not settings.PORTAL_API_KEY:
        return {"error": "Portal API not configured", "hint": "Set PORTAL_API_KEY on the attendance server"}, 503
    provided = ""
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        provided = auth[7:].strip()
    if not provided:
        provided = request.headers.get("X-Portal-Api-Key", "").strip()
    if not provided or provided != settings.PORTAL_API_KEY:
        return {"error": "Unauthorized"}, 401
    return None


@api_view(["GET"])
@permission_classes([AllowAny])
def portal_health(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    return Response(
        {
            "ok": True,
            "service": "smart-attendance",
            "students": Student.objects.count(),
            "face_embeddings": services.face_embedding_count(),
            "push_configured": bool(settings.PORTAL_PUSH_URL),
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def portal_classes(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    return Response(
        {
            "classes": [
                {
                    "id": c.id,
                    "name": c.name,
                    "section": c.section,
                    "academic_year": c.academic_year,
                    "label": c.label(),
                }
                for c in SchoolClass.objects.all().order_by("name", "section")
            ]
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def portal_students(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    class_id = _int_param(request.query_params, "class_id")
    qs = Student.objects.all().order_by("id")
    if class_id:
        qs = qs.filter(school_class_id=class_id)
    students = []
    for s in qs:
        students.append(
            {
                "id": s.id,
                "portal_student_id": s.portal_student_id,
                "name": s.name,
                "roll": s.roll,
                "class_id": s.school_class_id,
                "mapped": bool(s.portal_student_id),
            }
        )
    mapped = sum(1 for s in students if s["mapped"])
    return Response(
        {
            "count": len(students),
            "mapped": mapped,
            "unmapped": len(students) - mapped,
            "students": students,
        }
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def portal_students_sync(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])

    payload = request.data or {}
    items = payload.get("students")
    if not isinstance(items, list) or not items:
        return Response({"error": "students array required"}, status=400)

    created = 0
    updated = 0
    errors = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            errors.append({"index": i, "error": "invalid item"})
            continue
        try:
            raw_class = item.get("class_id")
            class_id = int(raw_class) if raw_class is not None and str(raw_class).strip() != "" else None
            portal_id = str(item.get("portal_student_id", "")).strip()
            name = str(item.get("name", ""))
            roll = str(item.get("roll", "") or "")

            existing = None
            if portal_id:
                existing = Student.objects.filter(portal_student_id=portal_id).first()
            if not existing:
                existing = Student.objects.filter(name=name, roll=roll or None).first()
            if existing:
                existing.name = name or existing.name
                existing.roll = roll or existing.roll
                existing.school_class_id = class_id
                existing.portal_student_id = portal_id or existing.portal_student_id
                existing.save()
                updated += 1
            else:
                Student.objects.create(
                    name=name,
                    roll=roll or None,
                    school_class_id=class_id,
                    portal_student_id=portal_id or None,
                )
                created += 1
        except Exception:
            errors.append({"index": i, "error": "could not upsert student"})

    services.log_portal_sync(
        "inbound", "students", "ok" if not errors else "partial",
        json.dumps({"created": created, "updated": updated, "errors": len(errors)}),
    )
    return Response({"created": created, "updated": updated, "errors": errors})


@api_view(["PATCH"])
@permission_classes([AllowAny])
def portal_map_student(request, student_id):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    portal_student_id = str((request.data or {}).get("portal_student_id", "")).strip()
    if not portal_student_id:
        return Response({"error": "portal_student_id required"}, status=400)
    st = Student.objects.filter(id=student_id).first()
    if not st:
        return Response({"error": "student not found"}, status=404)
    try:
        st.portal_student_id = portal_student_id
        st.save()
    except IntegrityError:
        return Response(
            {"error": "portal_student_id already linked to another student"}, status=409
        )
    return Response({"student_id": student_id, "portal_student_id": portal_student_id})


def _int_param(query, name):
    raw = query.get(name)
    if raw in (None, ""):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _apply_attendance_filters(request):
    day = (request.query_params.get("date") or "").strip() or None
    date_from = (request.query_params.get("from") or "").strip() or None
    date_to = (request.query_params.get("to") or "").strip() or None
    class_id = _int_param(request.query_params, "class_id")
    subject_id = _int_param(request.query_params, "subject_id")
    if not day and not date_from and not date_to:
        day = datetime.date.today().isoformat()
    return day, date_from, date_to, class_id, subject_id


@api_view(["GET"])
@permission_classes([AllowAny])
def portal_attendance(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    day, date_from, date_to, class_id, subject_id = _apply_attendance_filters(request)
    records = services.export_attendance(
        day=day, date_from=date_from, date_to=date_to, class_id=class_id, subject_id=subject_id
    )
    unmapped = sum(1 for r in records if not r.get("portal_student_id"))
    return Response(
        {
            "filters": {"date": day, "from": date_from, "to": date_to, "class_id": class_id, "subject_id": subject_id},
            "count": len(records),
            "unmapped_students": unmapped,
            "records": records,
        }
    )


@api_view(["GET"])
@permission_classes([AllowAny])
def portal_attendance_export(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])
    day, date_from, date_to, class_id, subject_id = _apply_attendance_filters(request)
    records = services.export_attendance(
        day=day, date_from=date_from, date_to=date_to, class_id=class_id, subject_id=subject_id
    )
    services.log_portal_sync(
        "outbound", "attendance_export", "ok",
        json.dumps({"count": len(records), "date": day, "from": date_from, "to": date_to}),
    )
    return Response(
        {"schema_version": 1, "system": "smart-attendance", "count": len(records), "records": records}
    )


@api_view(["POST"])
@permission_classes([AllowAny])
def portal_attendance_push(request):
    err = _check_api_key(request)
    if err:
        return Response(err[0], status=err[1])

    payload = request.data or {}
    day = str(payload.get("date") or request.query_params.get("date") or "").strip() or None
    class_id = payload.get("class_id") or _int_param(request.query_params, "class_id")
    subject_id = payload.get("subject_id") or _int_param(request.query_params, "subject_id")
    if not day:
        day = datetime.date.today().isoformat()

    records = services.export_attendance(day=day, class_id=class_id, subject_id=subject_id)
    pack = {
        "schema_version": 1,
        "system": "smart-attendance",
        "date": day,
        "count": len(records),
        "records": records,
    }
    ok, detail = _push_pack_to_portal(pack)
    services.log_portal_sync("outbound", "attendance_push", "ok" if ok else "error", detail)
    if not ok:
        return Response({"error": "push failed", "detail": detail, "count": len(records)}, status=502)
    return Response({"pushed": True, "detail": detail, "count": len(records)})


def _push_pack_to_portal(pack: dict):
    if not settings.PORTAL_PUSH_URL:
        return False, "PORTAL_PUSH_URL not set"
    import urllib.error
    import urllib.request

    body = json.dumps(pack).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if settings.PORTAL_PUSH_TOKEN:
        headers["Authorization"] = f"Bearer {settings.PORTAL_PUSH_TOKEN}"
    req = urllib.request.Request(
        settings.PORTAL_PUSH_URL, data=body, headers=headers, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return True, f"portal responded {resp.status}"
    except urllib.error.HTTPError as e:
        return False, f"portal HTTP {e.code}"
    except Exception:
        return False, "portal unreachable"
