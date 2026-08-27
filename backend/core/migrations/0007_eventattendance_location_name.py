from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("core", "0006_event_attendance_module"),
    ]
    operations = [
        migrations.AddField(
            model_name="eventattendance",
            name="location_name",
            field=models.TextField(blank=True, null=True),
        ),
    ]
