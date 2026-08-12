"""API tests for the Digital Attendance Django backend.

Run from django_react/backend:
    python manage.py test core
"""

import io

from django.test import TestCase, override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from .models import (
    Attendance,
    Enrollment,
    RoleUser,
    SchoolClass,
    Student,
    Subject,
    TeacherAssignment,
)


def make_user(username="admin1", role="admin", **kw):
    return RoleUser.objects.create_user(
        username=username,
        password=kw.pop("password", "testpass123"),
        role=role,
        **kw,
    )


@override_settings(
    ALLOW_PUBLIC_REGISTER=True,
    REGISTER_INVITE_CODE="",
)
class AuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_login_success_returns_token(self):
        make_user("alice", "admin", password="secret123")
        res = self.client.post("/api/auth/login", {"username": "alice", "password": "secret123"})
        self.assertEqual(res.status_code, 200)
        self.assertIn("token", res.data)
        self.assertEqual(res.data["user"]["role"], "admin")

    def test_login_wrong_password(self):
        make_user("alice", "admin")
        res = self.client.post("/api/auth/login", {"username": "alice", "password": "nope1234"})
        self.assertEqual(res.status_code, 400)

    def test_me_requires_auth(self):
        res = self.client.get("/api/auth/me")
        self.assertEqual(res.status_code, 403)

    def test_me_with_token(self):
        u = make_user("bob", "teacher")
        token, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        res = self.client.get("/api/auth/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["username"], "bob")

    def test_register_student(self):
        cls = SchoolClass.objects.create(name="CSE", section="A")
        Student.objects.create(name="Sam", roll="R1", school_class=cls)
        res = self.client.post(
            "/api/auth/register",
            {"roll": "R1", "username": "samuser", "password": "longpassword"},
        )
        self.assertEqual(res.status_code, 201)
        self.assertIn("token", res.data)

    def test_register_unknown_roll(self):
        res = self.client.post(
            "/api/auth/register",
            {"roll": "NOPE", "username": "nopeuser", "password": "longpassword"},
        )
        self.assertEqual(res.status_code, 400)

    def test_register_short_password(self):
        cls = SchoolClass.objects.create(name="CSE", section="A")
        Student.objects.create(name="Sam", roll="R1", school_class=cls)
        res = self.client.post(
            "/api/auth/register",
            {"roll": "R1", "username": "samuser2", "password": "short"},
        )
        self.assertEqual(res.status_code, 400)

    def test_logout_deletes_token(self):
        u = make_user("carl", "teacher")
        token, _ = Token.objects.get_or_create(user=u)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
        res = self.client.post("/api/auth/logout")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Token.objects.filter(key=token.key).exists())


def _auth_client(user):
    token, _ = Token.objects.get_or_create(user=user)
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"Token {token.key}")
    return c


def _class_with_subject():
    cls = SchoolClass.objects.create(name="B.Tech CSE", section="A", academic_year="2025-26")
    subj = Subject.objects.create(name="Data Structures", code="DS101", school_class=cls)
    return cls, subj


class RoleAccessTests(TestCase):
    def test_student_cannot_access_teacher_views(self):
        st = make_user("stu", "student")
        c = _auth_client(st)
        res = c.get("/api/classes")
        self.assertEqual(res.status_code, 403)

    def test_teacher_cannot_admin(self):
        t = make_user("tea", "teacher")
        c = _auth_client(t)
        res = c.post("/api/teachers", {"username": "x", "password": "longpass123"})
        self.assertEqual(res.status_code, 403)

    def test_admin_can_create_class(self):
        a = make_user("admin1", "admin")
        c = _auth_client(a)
        res = c.post("/api/classes", {"name": "CSE", "section": "B"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(SchoolClass.objects.filter(name="CSE", section="B").exists())

    def test_teacher_cannot_create_class(self):
        t = make_user("tea", "teacher")
        c = _auth_client(t)
        res = c.post("/api/classes", {"name": "CSE"})
        self.assertEqual(res.status_code, 403)


class AdminFlowTests(TestCase):
    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.c = _auth_client(self.admin)

    def test_full_admin_flow(self):
        cls, subj = _class_with_subject()
        # Create teacher
        res = self.c.post(
            "/api/teachers", {"username": "teacher1", "password": "teacher123", "full_name": "Prof X"}
        )
        self.assertEqual(res.status_code, 201)
        teacher = RoleUser.objects.get(username="teacher1")
        self.assertEqual(teacher.role, "teacher")

        # Assign teacher
        res = self.c.post(
            "/api/assignments",
            {"user_id": teacher.id, "class_id": cls.id, "subject_id": subj.id},
        )
        self.assertEqual(res.status_code, 201)
        self.assertTrue(TeacherAssignment.objects.filter(user=teacher).exists())

        # Duplicate assignment rejected
        res = self.c.post(
            "/api/assignments",
            {"user_id": teacher.id, "class_id": cls.id, "subject_id": subj.id},
        )
        self.assertEqual(res.status_code, 409)

        # Assign subject to wrong class rejected
        other = SchoolClass.objects.create(name="ME", section="A")
        res = self.c.post(
            "/api/assignments",
            {"user_id": teacher.id, "class_id": cls.id, "subject_id": subj.id},
        )
        self.assertEqual(res.status_code, 409)

        # Admin overview lists everything
        res = self.c.get("/api/admin/overview")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["classes"]), 2)
        self.assertEqual(len(res.data["teachers"]), 1)

    def test_create_subject_bad_class(self):
        res = self.c.post("/api/classes/999/subjects", {"name": "X"})
        self.assertEqual(res.status_code, 404)


class StudentTests(TestCase):
    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.c = _auth_client(self.admin)
        self.cls, self.subj = _class_with_subject()

    def test_create_student_creates_enrollment(self):
        res = self.c.post(
            "/api/students",
            {"name": "Karan", "roll": "23", "reg_no": "REG-1", "class_id": self.cls.id},
        )
        self.assertEqual(res.status_code, 201)
        sid = res.data["student_id"]
        st = Student.objects.get(id=sid)
        self.assertEqual(st.name, "Karan")
        self.assertEqual(st.school_class_id, self.cls.id)
        self.assertTrue(Enrollment.objects.filter(student=st, school_class=self.cls).exists())

    def test_duplicate_roll_rejected(self):
        self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        res = self.c.post("/api/students", {"name": "B", "roll": "1", "class_id": self.cls.id})
        self.assertEqual(res.status_code, 400)

    def test_list_students(self):
        self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        res = self.c.get("/api/students")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["students"]), 1)

    def test_update_student(self):
        res = self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        sid = res.data["student_id"]
        res = self.c.put(
            f"/api/students/{sid}",
            {"name": "A2", "roll": "1", "class_id": self.cls.id},
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Student.objects.get(id=sid).name, "A2")

    def test_update_student_missing_name(self):
        res = self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        sid = res.data["student_id"]
        res = self.c.put(f"/api/students/{sid}", {"name": "", "class_id": self.cls.id})
        self.assertEqual(res.status_code, 400)

    def test_delete_student_cascades(self):
        res = self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        sid = res.data["student_id"]
        st = Student.objects.get(id=sid)
        Attendance.objects.create(student=st, school_class=self.cls, subject=self.subj)
        res = self.c.delete(f"/api/students/{sid}")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Student.objects.filter(id=sid).exists())
        self.assertEqual(Attendance.objects.filter(student_id=sid).count(), 0)

    def test_create_student_login(self):
        res = self.c.post("/api/students", {"name": "A", "roll": "1", "class_id": self.cls.id})
        sid = res.data["student_id"]
        res = self.c.post(f"/api/students/{sid}/create_login", {"username": "stua", "password": "longpass123"})
        self.assertEqual(res.status_code, 201)
        self.assertTrue(RoleUser.objects.filter(username="stua", role="student").exists())


class AttendanceMarkTests(TestCase):
    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.c = _auth_client(self.admin)
        self.cls, self.subj = _class_with_subject()
        self.st1 = Student.objects.create(name="S1", roll="1", school_class=self.cls)
        self.st2 = Student.objects.create(name="S2", roll="2", school_class=self.cls)

    def test_attendance_records_initial_empty(self):
        res = self.c.get("/api/attendance_records")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["records"], [])

    def test_direct_mark_present_service(self):
        from .services import mark_present

        saved = mark_present([self.st1.id, self.st2.id], self.cls.id, self.subj.id, self.admin.id)
        self.assertEqual(saved, 2)
        self.assertEqual(Attendance.objects.count(), 2)

    def test_mark_present_deduplicates_same_day(self):
        from .services import mark_present

        saved = mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        self.assertEqual(saved, 1)
        # Second call for same student/class/subject/day is a duplicate
        saved2 = mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        self.assertEqual(saved2, 0)
        self.assertEqual(Attendance.objects.count(), 1)

    def test_attendance_stats(self):
        from .services import mark_present

        mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        res = self.c.get("/api/attendance_stats")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["dates"]), 30)
        self.assertEqual(sum(res.data["counts"]), 1)

    def test_delete_attendance_record(self):
        from .services import mark_present

        mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        rec = Attendance.objects.first()
        res = self.c.delete(f"/api/attendance_records/{rec.id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Attendance.objects.count(), 0)

    def test_analytics(self):
        from .services import mark_present

        mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        res = self.c.get(f"/api/analytics?class_id={self.cls.id}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["rows"]), 2)

    def test_csv_download(self):
        from .services import mark_present

        mark_present([self.st1.id], self.cls.id, self.subj.id, self.admin.id)
        res = self.c.get("/api/attendance_records.csv")
        self.assertEqual(res.status_code, 200)
        self.assertIn("student_id", res.content.decode())
        self.assertIn("S1", res.content.decode())

    def test_recognize_face_requires_class_subject(self):
        # Even with an image, missing class_id/subject_id must fail with 400
        f = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01")
        f.name = "x.jpg"
        res = self.c.post("/api/recognize_face", {"image": f}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_confirm_classroom_attendance(self):
        res = self.c.post(
            "/api/confirm_classroom_attendance",
            {
                "student_ids": [self.st1.id, self.st2.id],
                "class_id": self.cls.id,
                "subject_id": self.subj.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["saved"], 2)

    def test_confirm_classroom_attendance_filters_enrolled(self):
        outsider = Student.objects.create(name="Out", roll="99")
        res = self.c.post(
            "/api/confirm_classroom_attendance",
            {
                "student_ids": [outsider.id],
                "class_id": self.cls.id,
                "subject_id": self.subj.id,
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["saved"], 0)


class CopilotTests(TestCase):
    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.c = _auth_client(self.admin)
        self.cls, self.subj = _class_with_subject()
        self.st1 = Student.objects.create(name="Alice", roll="1", school_class=self.cls)
        self.st2 = Student.objects.create(name="Bob", roll="2", school_class=self.cls)

    def _present(self, st, day):
        Attendance.objects.create(
            student=st,
            school_class=self.cls,
            subject=self.subj,
            attendance_day=day,
            source="classroom",
        )

    def test_copilot_help(self):
        res = self.c.post("/api/copilot", {"query": "help"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["intent"], "help")

    def test_copilot_present_today(self):
        import datetime

        self._present(self.st1, datetime.date.today().isoformat())
        res = self.c.post(
            "/api/copilot",
            {"query": "Who is present today in B.Tech CSE?"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["intent"], "present_today")
        self.assertIn("Alice", res.data["answer"])

    def test_copilot_absent_today(self):
        import datetime

        self._present(self.st1, datetime.date.today().isoformat())
        res = self.c.post(
            "/api/copilot",
            {"query": "Who is absent today in B.Tech CSE?"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["intent"], "absent_today")
        self.assertIn("Bob", res.data["answer"])

    def test_copilot_at_risk(self):
        import datetime

        past = (datetime.date.today() - datetime.timedelta(days=30)).isoformat()
        Student.objects.filter(id=self.st1.id).update(created_at=past)
        res = self.c.post(
            "/api/copilot",
            {"query": "Flag students below 10% attendance"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["intent"], "at_risk")

    def test_copilot_query_too_long(self):
        res = self.c.post("/api/copilot", {"query": "x" * 600}, format="json")
        self.assertEqual(res.status_code, 400)


class RegisterExportTests(TestCase):
    def setUp(self):
        self.admin = make_user("admin1", "admin")
        self.c = _auth_client(self.admin)
        self.cls, self.subj = _class_with_subject()
        Student.objects.create(name="S1", roll="1", school_class=self.cls)

    def test_register_export_meta(self):
        res = self.c.get("/api/register_export")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["current_month"], 8)
        self.assertIn("month_names", res.data)

    def test_register_export_xlsx(self):
        import datetime

        day = datetime.date.today().isoformat()
        Attendance.objects.create(
            student=Student.objects.get(roll="1"),
            school_class=self.cls,
            subject=self.subj,
            attendance_day=day,
        )
        res = self.c.get(
            "/api/register_export.xlsx",
            {
                "class_id": self.cls.id,
                "subject_id": self.subj.id,
                "year": datetime.date.today().year,
                "month": datetime.date.today().month,
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("spreadsheet", res["Content-Type"])

    def test_register_export_requires_params(self):
        res = self.c.get("/api/register_export.xlsx")
        self.assertEqual(res.status_code, 400)


class PortalApiTests(TestCase):
    def setUp(self):
        from django.conf import settings

        self._old = settings.PORTAL_API_KEY
        settings.PORTAL_API_KEY = "test-key-123"
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer test-key-123")

    def tearDown(self):
        from django.conf import settings

        settings.PORTAL_API_KEY = self._old

    def test_health(self):
        res = self.client.get("/api/portal/v1/health")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["ok"])

    def test_health_requires_key(self):
        c = APIClient()
        res = c.get("/api/portal/v1/health")
        self.assertEqual(res.status_code, 401)

    def test_students_sync(self):
        cls, _ = _class_with_subject()
        res = self.client.post(
            "/api/portal/v1/students/sync",
            {
                "students": [
                    {
                        "portal_student_id": "P-1",
                        "name": "Portal Student",
                        "roll": "101",
                        "class_id": cls.id,
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["created"], 1)
        self.assertTrue(Student.objects.filter(portal_student_id="P-1").exists())

    def test_attendance_export(self):
        res = self.client.get("/api/portal/v1/attendance")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["count"], 0)
