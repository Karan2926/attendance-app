from django.urls import path

from . import portal_views, views

urlpatterns = [
    # Health / monitoring
    path("health", views.health_view),
    # Public landing stats
    path("landing_stats", views.landing_stats_view),
    # Auth
    path("auth/login", views.login_view),
    path("auth/register", views.register_view),
    path("public_classes", views.public_classes_view),
    path("auth/logout", views.logout_view),
    path("auth/me", views.me_view),
    path("me/attendance", views.my_attendance_view),
    # Pending registration approvals (Teachers & Admin)
    path("pending_registrations", views.pending_registrations_view),
    path("pending_registrations/verify_csv", views.verify_registration_csv_view),
    path("pending_registrations/bulk_approve", views.bulk_approve_registrations_view),
    path("pending_registrations/<int:reg_id>/approve", views.approve_registration_view),
    path("pending_registrations/<int:reg_id>/reject", views.reject_registration_view),
    # Admin — pending registration approvals (legacy alias)
    path("admin/pending_registrations", views.pending_registrations_view),
    path("admin/pending_registrations/verify_csv", views.verify_registration_csv_view),
    path("admin/pending_registrations/bulk_approve", views.bulk_approve_registrations_view),
    path("admin/pending_registrations/<int:reg_id>/approve", views.approve_registration_view),
    path("admin/pending_registrations/<int:reg_id>/reject", views.reject_registration_view),
    # Dashboard
    path("dashboard", views.dashboard_view),
    path("attendance_stats", views.attendance_stats_view),
    # Classes / subjects / teachers / assignments
    path("classes", views.classes_view),
    path("classes/<int:class_id>/subjects", views.subjects_view),
    path("teachers", views.create_teacher_view),
    path("teachers/<int:teacher_id>", views.update_teacher_view),
    path("teachers/<int:teacher_id>/delete", views.delete_teacher_view),
    path("assignments", views.assign_teacher_view),
    path("my_assignments", views.my_assignments_view),
    path("admin/overview", views.admin_overview_view),
    path("admin/system_stats", views.admin_system_stats_view),
    path("admin/system_health", views.admin_system_health_view),
    path("admin/settings", views.admin_settings_view),
    path("admin/settings/update", views.admin_update_settings_view),
    path("admin/audit", views.admin_audit_view),
    # Students
    path("students", views.students_view),
    path("students/<int:student_id>", views.student_detail_view),
    path("students/<int:student_id>/photo", views.student_photo_view),
    path("students/<int:student_id>/upload_face", views.upload_face_view),
    path("students/<int:student_id>/create_login", views.create_student_login_view),
    # Training
    path("train_model", views.train_model_view),
    path("train_status", views.train_status_view),
    path("storage_stats", views.storage_stats_view),
    path("prune_captures", views.prune_captures_view),
    # Recognition
    path("recognize_face", views.recognize_face_view),
    path("recognize_classroom", views.recognize_classroom_view),
    path("confirm_classroom_attendance", views.confirm_classroom_attendance_view),
    path("check_face", views.check_face_view),
    # Records / analytics
    path("attendance_records", views.attendance_records_view),
    path("attendance_records.csv", views.download_csv_view),
    path("attendance_records/<int:record_id>", views.delete_attendance_record_view),
    path("analytics", views.analytics_view),
    # Copilot
    path("copilot", views.copilot_view),
    # Register export
    path("register_export", views.register_export_meta_view),
    path("register_export.xlsx", views.register_export_xlsx_view),
    # Portal API (Phase 3)
    path("portal/v1/health", portal_views.portal_health),
    path("portal/v1/classes", portal_views.portal_classes),
    path("portal/v1/students", portal_views.portal_students),
    path("portal/v1/students/sync", portal_views.portal_students_sync),
    path("portal/v1/students/<int:student_id>/mapping", portal_views.portal_map_student),
    path("portal/v1/attendance", portal_views.portal_attendance),
    path("portal/v1/attendance/export", portal_views.portal_attendance_export),
    path("portal/v1/attendance/push", portal_views.portal_attendance_push),
    # ── Event Attendance Module ──────────────────────────────────────────────
    path("events", views.event_list_create_view),
    path("events/active", views.event_active_view),
    path("events/<int:event_id>", views.event_detail_view),
    path("events/<int:event_id>/update", views.event_update_view),
    path("events/<int:event_id>/delete", views.event_delete_view),

    path("events/<int:event_id>/toggle", views.event_toggle_view),
    path("events/<int:event_id>/checkin", views.event_checkin_view),
    path("events/<int:event_id>/attendance", views.event_attendance_list_view),
    path("events/<int:event_id>/attendance.csv", views.event_attendance_csv_view),
]

