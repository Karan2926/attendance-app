"""AI Attendance Copilot — rules-first assistant (no LLM). Django port of copilot.py."""

from __future__ import annotations

import datetime
import re
from typing import Any, Optional

from .models import Attendance, Student
from . import services


def _today() -> str:
    return datetime.date.today().isoformat()


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _parse_threshold(text: str, default: float = 75.0) -> float:
    m = re.search(r"(\d{1,3})\s*%?", text)
    if not m:
        return default
    val = float(m.group(1))
    if val > 100:
        val = 100.0
    return val


def _resolve_class(user_id: int, role: str, query: str):
    classes = services.list_classes_for_user(user_id, role)
    if not classes:
        return None, "No classes are available for your account. Ask admin to assign you."

    q = _norm(query)
    ranked = sorted(classes, key=lambda c: len(c.name or ""), reverse=True)
    for c in ranked:
        name = _norm(c.name or "")
        section = _norm(c.section or "")
        label = _norm(c.label())
        tokens = [name, label]
        if section:
            tokens.append(f"{name} {section}")
            tokens.append(f"sec {section}")
            tokens.append(f"section {section}")
        for t in tokens:
            if t and t in q:
                return {"id": c.id, "name": c.name, "section": c.section, "label": c.label()}, None

    if len(classes) == 1:
        c = classes[0]
        return {"id": c.id, "name": c.name, "section": c.section, "label": c.label()}, None

    options = ", ".join(c.label() for c in classes[:8])
    return None, f"Which class? Try naming one of: {options}"


def _resolve_subject(user_id: int, role: str, class_id: int, query: str):
    subjects = services.list_subjects_for_class(user_id, role, class_id)
    if not subjects:
        return None, "No subjects found for that class (or you are not assigned)."

    q = _norm(query)
    ranked = sorted(subjects, key=lambda s: len(s.name or ""), reverse=True)
    for s in ranked:
        name = _norm(s.name or "")
        code = _norm(s.code or "")
        if name and name in q:
            return {"id": s.id, "name": s.name, "code": s.code}, None
        if code and code in q:
            return {"id": s.id, "name": s.name, "code": s.code}, None

    if len(subjects) == 1:
        s = subjects[0]
        return {"id": s.id, "name": s.name, "code": s.code}, None

    options = ", ".join(
        (f"{s['name']}" + (f" ({s['code']})" if s["code"] else ""))
        if isinstance(s, dict)
        else (f"{s.name}" + (f" ({s.code})" if s.code else ""))
        for s in subjects[:8]
    )
    return None, f"Which subject? Try naming one of: {options}"


def _roster(class_id: int) -> list[dict]:
    return [
        {"id": s.id, "name": s.name, "roll": s.roll or "-"}
        for s in services.roster_for_class(class_id)
    ]


def _present_ids(class_id: int, subject_id: Optional[int], day: str) -> set[int]:
    qs = Attendance.objects.filter(school_class_id=class_id, attendance_day=day)
    if subject_id:
        qs = qs.filter(subject_id=subject_id)
    return {int(s) for s in qs.values_list("student_id", flat=True) if s is not None}


def intent_absent_today(user_id: int, role: str, query: str) -> dict[str, Any]:
    cls, err = _resolve_class(user_id, role, query)
    if err:
        return {"intent": "absent_today", "ok": False, "answer": err, "data": {}}
    sub, _ = _resolve_subject(user_id, role, cls["id"], query)

    day = _today()
    subject_id = sub["id"] if sub else None
    roster = _roster(cls["id"])
    present = _present_ids(cls["id"], subject_id, day)
    absent = [s for s in roster if s["id"] not in present]

    scope = cls["label"]
    if sub:
        scope += f" / {sub['name']}"

    if not roster:
        answer = f"No students enrolled in {cls['label']}."
    elif not absent:
        answer = f"Everyone in the roster is marked present today for {scope} ({len(present)}/{len(roster)})."
    else:
        lines = [f"**Absent today — {scope}** ({len(absent)} of {len(roster)})", ""]
        for s in absent:
            lines.append(f"- {s['name']} (Roll: {s['roll']})")
        lines.append("")
        lines.append(f"Present: {len(present)} · Absent: {len(absent)}")
        if not sub:
            lines.append("_Tip: mention a subject (e.g. DBMS) for subject-specific absences._")
        answer = "\n".join(lines)

    return {
        "intent": "absent_today",
        "ok": True,
        "answer": answer,
        "data": {
            "class": cls,
            "subject": sub,
            "date": day,
            "absent": absent,
            "present_count": len(present),
            "roster_count": len(roster),
        },
    }


def intent_present_today(user_id: int, role: str, query: str) -> dict[str, Any]:
    cls, err = _resolve_class(user_id, role, query)
    if err:
        return {"intent": "present_today", "ok": False, "answer": err, "data": {}}
    sub, _ = _resolve_subject(user_id, role, cls["id"], query)
    day = _today()
    subject_id = sub["id"] if sub else None
    roster = {s["id"]: s for s in _roster(cls["id"])}
    present_ids = _present_ids(cls["id"], subject_id, day)
    present = [roster[i] for i in present_ids if i in roster]

    scope = cls["label"] + (f" / {sub['name']}" if sub else "")
    if not present:
        answer = f"No present marks yet today for {scope}."
    else:
        lines = [f"**Present today — {scope}** ({len(present)})", ""]
        for s in sorted(present, key=lambda x: x["name"]):
            lines.append(f"- {s['name']} (Roll: {s['roll']})")
        answer = "\n".join(lines)

    return {
        "intent": "present_today",
        "ok": True,
        "answer": answer,
        "data": {"class": cls, "subject": sub, "date": day, "present": present},
    }


def intent_at_risk(user_id: int, role: str, query: str) -> dict[str, Any]:
    threshold = _parse_threshold(query, 75.0)
    classes = services.list_classes_for_user(user_id, role)
    cls, cerr = _resolve_class(user_id, role, query)

    class_id = None
    class_label = "your classes"
    if cls:
        class_id = cls["id"]
        class_label = cls["label"]
    elif len(classes) > 1:
        cls = None
    elif cerr:
        return {"intent": "at_risk", "ok": False, "answer": cerr, "data": {}}

    today = datetime.date.today()
    flagged = []
    students = []

    if class_id is not None:
        ids = services.student_ids_in_class(class_id)
        students = list(Student.objects.filter(id__in=ids).order_by("name"))
    else:
        class_ids = services.teacher_class_ids(user_id, role)
        if class_ids is None:
            students = list(Student.objects.all().order_by("name"))
        elif not class_ids:
            students = []
        else:
            students = list(
                Student.objects.filter(services.models_or_enrolled(class_ids))
                .distinct()
                .order_by("name")
            )

    for st in students:
        sid = st.id
        qs = Attendance.objects.filter(student_id=sid).values("attendance_day").distinct()
        if class_id is not None:
            qs = qs.filter(school_class_id=class_id)
        days_present = qs.count()
        try:
            start = datetime.datetime.fromisoformat(st.created_at).date()
        except Exception:
            start = today
        total_days = max((today - start).days + 1, 1)
        pct = round((days_present / total_days) * 100, 1)
        if pct < threshold:
            flagged.append(
                {
                    "id": sid,
                    "name": st.name,
                    "roll": st.roll or "-",
                    "pct": pct,
                    "days_present": days_present,
                    "total_days": total_days,
                }
            )

    flagged.sort(key=lambda x: x["pct"])
    scope = class_label

    if not flagged:
        answer = f"No students below **{threshold:.0f}%** in {scope}."
    else:
        lines = [
            f"**At risk (below {threshold:.0f}%) — {scope}** · {len(flagged)} student(s)",
            "",
        ]
        for s in flagged[:50]:
            lines.append(
                f"- {s['name']} (Roll: {s['roll']}) — {s['pct']}% "
                f"({s['days_present']}/{s['total_days']} days)"
            )
        if len(flagged) > 50:
            lines.append(f"…and {len(flagged) - 50} more")
        answer = "\n".join(lines)

    return {
        "intent": "at_risk",
        "ok": True,
        "answer": answer,
        "data": {"threshold": threshold, "flagged": flagged, "class": cls},
    }


def intent_summarize_classroom(user_id: int, role: str, query: str) -> dict[str, Any]:
    day = _today()
    cls, _ = _resolve_class(user_id, role, query)
    class_ids = services.teacher_class_ids(user_id, role)

    qs = Attendance.objects.filter(attendance_day=day).select_related(
        "school_class", "subject"
    )
    if cls:
        qs = qs.filter(school_class_id=cls["id"])
    elif class_ids is not None:
        if not class_ids:
            return {
                "intent": "summarize_classroom",
                "ok": True,
                "answer": "No class assignments found for your account.",
                "data": {},
            }
        qs = qs.filter(school_class_id__in=class_ids)

    rows_classroom = list(qs.filter(source="classroom").order_by("timestamp"))
    rows = rows_classroom
    used_fallback = False
    if not rows:
        rows = list(qs.order_by("timestamp"))
        used_fallback = True

    if not rows:
        scope = cls["label"] if cls else "your classes"
        return {
            "intent": "summarize_classroom",
            "ok": True,
            "answer": (
                f"No classroom-photo attendance found for **{day}** in {scope}. "
                "Run Classroom Photo → Confirm & Save, then ask again."
            ),
            "data": {"date": day, "saved": 0},
        }

    by_class: dict[str, list] = {}
    for r in rows:
        label = r.school_class.name if r.school_class else "Unknown class"
        if r.school_class and r.school_class.section:
            label += f" — Sec {r.school_class.section}"
        sub = r.subject.name if r.subject else "—"
        key = f"{label} / {sub}"
        by_class.setdefault(key, []).append(r.name or "")

    lines = [f"**Classroom session summary — {day}**", ""]
    if used_fallback:
        lines.append("_Showing today's marks (source not tagged classroom)._")
        lines.append("")
    total = 0
    for key, names in by_class.items():
        uniq = sorted(set(n for n in names if n))
        total += len(uniq)
        lines.append(f"**{key}** — {len(uniq)} marked present")
        for n in uniq[:20]:
            lines.append(f"- {n}")
        if len(uniq) > 20:
            lines.append(f"- … +{len(uniq) - 20} more")
        lines.append("")
    lines.append(f"**Total unique present marks in summary:** {total}")
    return {
        "intent": "summarize_classroom",
        "ok": True,
        "answer": "\n".join(lines).strip(),
        "data": {"date": day, "groups": {k: sorted(set(v)) for k, v in by_class.items()}, "total": total},
    }


def intent_help() -> dict[str, Any]:
    answer = (
        "**AI Attendance Copilot** (rules-based — no cloud LLM)\n\n"
        "Try questions like:\n"
        "- Who is absent today in CSE-A / DBMS?\n"
        "- Who is present today in Internship?\n"
        "- Flag students with <75% attendance\n"
        "- Flag students below 60% in CSE-A\n"
        "- Summarize today's classroom photo session\n\n"
        "Tips: mention **class** and **subject** names as they appear in Admin."
    )
    return {"intent": "help", "ok": True, "answer": answer, "data": {}}


def detect_intent(query: str) -> str:
    q = _norm(query)
    if not q or q in {"help", "?", "hi", "hello"}:
        return "help"
    if any(k in q for k in ("summarize", "summary", "classroom photo", "classroom session", "group photo")):
        return "summarize_classroom"
    if any(k in q for k in ("at risk", "flag", "below", "less than", "<", "under", "%", "percent", "75", "attendance %")):
        if "absent" in q and "%" not in q and "percent" not in q and "flag" not in q and "below" not in q:
            return "absent_today"
        return "at_risk"
    if "present" in q and "absent" not in q:
        return "present_today"
    if "absent" in q or "who missed" in q or "not present" in q:
        return "absent_today"
    if "who" in q and ("today" in q or "class" in q):
        return "absent_today"
    return "help"


def ask(user_id: int, role: str, query: str) -> dict[str, Any]:
    query = (query or "").strip()
    if not query:
        return intent_help()

    intent = detect_intent(query)
    if intent == "absent_today":
        return intent_absent_today(user_id, role, query)
    if intent == "present_today":
        return intent_present_today(user_id, role, query)
    if intent == "at_risk":
        return intent_at_risk(user_id, role, query)
    if intent == "summarize_classroom":
        return intent_summarize_classroom(user_id, role, query)
    return intent_help()
