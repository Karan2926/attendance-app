from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import (
    Attendance,
    Enrollment,
    FaceEmbedding,
    RoleUser,
    SchoolClass,
    Student,
    Subject,
    TeacherAssignment,
)


@admin.register(RoleUser)
class RoleUserAdmin(UserAdmin):
    list_display = ("username", "role", "student_id", "is_active")
    list_filter = ("role", "is_active")
    search_fields = ("username", "full_name")
    fieldsets = UserAdmin.fieldsets + (("Attendance", {"fields": ("role", "student", "full_name")}),)


@admin.register(SchoolClass)
class SchoolClassAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "section", "academic_year")


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "code", "school_class")


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "roll", "school_class", "portal_student_id")
    search_fields = ("name", "roll", "reg_no")


@admin.register(TeacherAssignment)
class TeacherAssignmentAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "school_class", "subject")


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "school_class")


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ("id", "student", "name", "attendance_day", "subject", "source")
    list_filter = ("source", "attendance_day")


@admin.register(FaceEmbedding)
class FaceEmbeddingAdmin(admin.ModelAdmin):
    list_display = ("student_id", "dim", "sample_count", "updated_at")
