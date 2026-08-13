"""Threshold calibration for live face recognition.

Computes the similarity distribution of genuine vs imposter matches using the
real dataset:
  - Gallery  : student centroids from model.pkl (mean of all captured poses)
  - Probes   : freshly extracted embeddings from each student's profile.jpg
  - Genuine  : probe vs its own centroid  (should match)
  - Imposter : probe vs every OTHER centroid (should NOT match)

Then sweeps thresholds and reports FRR / FAR / EER so you can pick the
operating point that best fits your attendance accuracy requirements.

Run (from backend/):
    .venv/bin/python calibrate_threshold.py [--far 0.01]
"""

from __future__ import annotations

import argparse
import json
import os
import pickle
import sys

import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.environ.get("MODEL_PATH", os.path.join(BASE_DIR, "model.pkl"))
DATASET_DIR = os.environ.get("DATASET_DIR", os.path.join(BASE_DIR, "dataset"))


def get_face_app(det_size=(640, 640)):
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(name="buffalo_l")
    try:
        app.prepare(ctx_id=0, det_size=det_size)
    except Exception:
        app.prepare(ctx_id=-1, det_size=det_size)
    return app


def extract_embedding(app, path):
    import cv2

    img = cv2.imread(path)
    if img is None:
        return None
    faces = app.get(img)
    if not faces:
        return None
    faces.sort(
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    return np.asarray(faces[0].normed_embedding, dtype=np.float32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--far", type=float, default=0.01, help="max acceptable false-accept rate")
    args = ap.parse_args()

    if not os.path.exists(MODEL_PATH):
        sys.exit(f"model.pkl not found at {MODEL_PATH}")
    with open(MODEL_PATH, "rb") as f:
        bundle = pickle.load(f)
    centroids = bundle.get("centroids") or {}
    if not centroids:
        sys.exit("model.pkl has no centroids")

    print(f"Loaded {len(centroids)} centroids from model.pkl")
    print("Extracting embeddings from dataset profile images...")
    app = get_face_app((640, 640))

    probes = {}
    for sid in sorted(centroids, key=int):
        folder = os.path.join(DATASET_DIR, str(sid))
        profile = os.path.join(folder, "profile.jpg")
        if not os.path.exists(profile):
            continue
        emb = extract_embedding(app, profile)
        if emb is not None:
            probes[int(sid)] = emb

    print(f"Extracted {len(probes)} probe embeddings")

    gallery_ids = [int(s) for s in centroids]
    gallery_ids.sort()

    genuine = []
    imposter = []
    centroid_by_id = {int(k): v for k, v in centroids.items()}
    for sid, emb in probes.items():
        gal = np.asarray(centroid_by_id[sid], dtype=np.float32)
        genuine.append(float(emb @ gal))
        for other in gallery_ids:
            if other == sid:
                continue
            ovec = np.asarray(centroid_by_id[other], dtype=np.float32)
            imposter.append(float(emb @ ovec))

    genuine = np.array(genuine)
    imposter = np.array(imposter)

    thresholds = np.arange(0.20, 0.55, 0.01)
    print(f"\nGenuine matches : {len(genuine)}  (mean {genuine.mean():.3f}, min {genuine.min():.3f})")
    print(f"Imposter matches: {len(imposter)}  (mean {imposter.mean():.3f}, max {imposter.max():.3f})")

    def frr_at(t):
        return 0.0 if len(genuine) == 0 else float((genuine < t).mean())

    def far_at(t):
        return 0.0 if len(imposter) == 0 else float((imposter >= t).mean())

    rows = []
    eer = None
    for t in thresholds:
        frr = frr_at(t)
        far = far_at(t)
        rows.append((float(t), frr, far, frr + far))
        if eer is None and far <= frr:
            eer = t

    print("\n  thr    FRR      FAR     FRR+FAR")
    for t, frr, far, s in rows:
        print(f" {t:.2f}  {frr:.4f}  {far:.4f}   {s:.4f}")

    best = min(rows, key=lambda r: r[3])
    print(f"\nEqual Error Rate point (FAR ~= FRR): {eer:.2f}")
    print(f"Balanced optimum (min FRR+FAR)     : {best[0]:.2f} "
          f"(FRR {best[1]:.4f}, FAR {best[2]:.4f})")

    safe = [r for r in rows if r[2] <= args.far]
    if safe:
        chosen = max(safe, key=lambda r: -r[1])
        print(f"Safe point (FAR<={args.far}, max FRR)   : {chosen[0]:.2f} "
              f"(FRR {chosen[1]:.4f}, FAR {chosen[2]:.4f})")
    else:
        chosen = best

    summary = {
        "n_students": len(gallery_ids),
        "n_probes": int(len(genuine)),
        "n_genuine": int(len(genuine)),
        "n_imposter": int(len(imposter)),
        "genuine_mean": float(genuine.mean()),
        "genuine_min": float(genuine.min()),
        "imposter_mean": float(imposter.mean()),
        "imposter_max": float(imposter.max()),
        "eer_threshold": float(eer) if eer else None,
        "balanced_optimum": best[0],
        "safe_threshold": chosen[0],
        "safe_frr": float(chosen[1]),
        "safe_far": float(chosen[2]),
    }
    out = os.path.join(BASE_DIR, "threshold_calibration.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=2)
    print(f"\nSaved summary -> {out}")


if __name__ == "__main__":
    main()