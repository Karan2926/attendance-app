from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ("core", "0007_eventattendance_location_name"),
    ]
    operations = [
        migrations.AddField(
            model_name="eventsession",
            name="latitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="eventsession",
            name="longitude",
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="eventsession",
            name="radius",
            field=models.IntegerField(default=300),
        ),
    ]
