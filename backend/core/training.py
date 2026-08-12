"""Background model training with a JSON progress file (port of app.py train helpers)."""

from __future__ import annotations

import json
import os
import threading

from django.conf import settings

from . import recognition


def write_train_status(status_dict: dict) -> None:
    with open(settings.TRAIN_STATUS_FILE, "w") as f:
        json.dump(status_dict, f)


def read_train_status() -> dict:
    if not os.path.exists(settings.TRAIN_STATUS_FILE):
        return {"running": False, "progress": 0, "message": "Not trained"}
    try:
        with open(settings.TRAIN_STATUS_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {"running": False, "progress": 0, "message": "Not trained"}


def start_training() -> bool:
    """Start training in a background thread. Returns True if started."""
    if read_train_status().get("running"):
        return False
    write_train_status({"running": True, "progress": 0, "message": "Starting training"})

    def _progress(p, m):
        write_train_status({"running": p < 100, "progress": p, "message": m})

    def _run():
        try:
            recognition.train_model_background(settings.DATASET_DIR, _progress)
        except Exception as e:
            _progress(0, f"Training failed: {e}")
        finally:
            status = read_train_status()
            if status.get("running"):
                status["running"] = False
                write_train_status(status)

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    return True
