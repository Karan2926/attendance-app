import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("core", "0005_nullable_subject_for_mentor_assignment"),
    ]
    operations = [
        migrations.AlterField(
            model_name="roleuser",
            name="role",
            field=models.CharField(
                choices=[
                    ("admin", "admin"),
                    ("teacher", "teacher"),
                    ("mentor", "mentor"),
                    ("event_organizer", "event_organizer"),
                    ("student", "student"),
                ],
                default="student",
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="EventSession",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=255)),
                ("venue", models.CharField(blank=True, max_length=255, null=True)),
                ("description", models.TextField(blank=True, null=True)),
                ("event_date", models.DateField()),
                ("start_time", models.TimeField()),
                ("end_time", models.TimeField()),
                ("is_active", models.BooleanField(default=False)),
                ("created_at", models.TextField(blank=True, null=True)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="events_created", to=settings.AUTH_USER_MODEL)),
            ],
            options={"db_table": "event_sessions"},
        ),
        migrations.CreateModel(
            name="EventAttendance",
            fields=[
                ("id", models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("checked_in_at", models.TextField()),
                ("latitude", models.FloatField(blank=True, null=True)),
                ("longitude", models.FloatField(blank=True, null=True)),
                ("location_accuracy", models.FloatField(blank=True, null=True)),
                ("photo_path", models.TextField(blank=True, null=True)),
                ("face_confidence", models.FloatField(blank=True, null=True)),
                ("event", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="attendances", to="core.eventsession")),
                ("student", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="event_attendances", to="core.student")),
            ],
            options={"db_table": "event_attendance"},
        ),
        migrations.AlterUniqueTogether(
            name="eventattendance",
            unique_together={("event", "student")},
        ),
    ]
