"""Face recognition — Django port of the legacy `model.py`.

InsightFace (buffalo_l) embeddings, class-scoped cosine-similarity matching,
classroom multi-scale detection + tiling + NMS, background training with an
incremental embedding cache, and capture pruning.
"""

from __future__ import annotations

import os
import pickle
from typing import Iterable, Optional, Set

import numpy as np

from django.conf import settings

MODEL_PATH = settings.MODEL_PATH
CACHE_PATH = os.path.join(settings.BASE_DIR, "embedding_cache.pkl")
DATASET_DIR = settings.DATASET_DIR

LIVE_SIM_THRESHOLD = 0.40
CLASSROOM_SIM_THRESHOLD = 0.38
CLASSROOM_STRONG_THRESHOLD = 0.44
MARGIN = 0.05
CLASSROOM_MARGIN = 0.04
# Absolute ceiling for decoded bitmaps (see _decode_image). Higher than the
# upload limit because legitimate classroom shots are large, but still stops
# decompression-bomb OOMs.
MAX_DECODE_PIXELS = 60_000_000

_face_apps: dict[tuple[int, int], object] = {}


def prune_capture_images(dataset_dir: str, keep_profile: bool = True) -> dict:
    deleted = 0
    bytes_freed = 0
    students = 0
    if not os.path.isdir(dataset_dir):
        return {"deleted": 0, "bytes_freed": 0, "students": 0}

    for sid in os.listdir(dataset_dir):
        folder = os.path.join(dataset_dir, sid)
        if not os.path.isdir(folder):
            continue
        students += 1
        for fn in os.listdir(folder):
            if keep_profile and fn == "profile.jpg":
                continue
            if not fn.lower().endswith((".jpg", ".jpeg", ".png")):
                continue
            path = os.path.join(folder, fn)
            try:
                bytes_freed += os.path.getsize(path)
                os.remove(path)
                deleted += 1
            except OSError:
                pass
    return {"deleted": deleted, "bytes_freed": bytes_freed, "students": students}


def dataset_disk_usage(dataset_dir: str) -> dict:
    total = 0
    files = 0
    students = 0
    if not os.path.isdir(dataset_dir):
        return {"bytes": 0, "files": 0, "students": 0, "mb": 0}
    for sid in os.listdir(dataset_dir):
        folder = os.path.join(dataset_dir, sid)
        if not os.path.isdir(folder):
            continue
        students += 1
        for root, _, filenames in os.walk(folder):
            for fn in filenames:
                path = os.path.join(root, fn)
                try:
                    total += os.path.getsize(path)
                    files += 1
                except OSError:
                    pass
    return {
        "bytes": total,
        "files": files,
        "students": students,
        "mb": round(total / (1024 * 1024), 2),
    }


def get_face_app(det_size: tuple[int, int] = (640, 640)):
    from insightface.app import FaceAnalysis

    key = (int(det_size[0]), int(det_size[1]))
    if key not in _face_apps:
        app = FaceAnalysis(name="buffalo_l", allowed_modules=["detection", "recognition"])
        app.prepare(ctx_id=-1, det_size=key)
        _face_apps[key] = app
    return _face_apps[key]


def _decode_image(stream_or_bytes):
    import cv2

    try:
        data = stream_or_bytes.read()
    except Exception:
        return None
    if not data:
        return None
    try:
        arr = np.frombuffer(data, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        return None
    if img is None:
        return None
    # Defense in depth: never hand an absurdly large bitmap to the face model
    # even if a caller bypasses the upload sanitizer.
    h, w = img.shape[:2]
    if w <= 0 or h <= 0 or (w * h) > MAX_DECODE_PIXELS:
        return None
    return img


def extract_face_for_image(stream_or_bytes):
    """Detect the largest face and return embedding + bbox."""
    img = _decode_image(stream_or_bytes)
    if img is None:
        return None

    faces = get_face_app((640, 640)).get(img)
    if len(faces) == 0:
        return None

    faces = sorted(
        faces,
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    f = faces[0]
    bbox = [float(x) for x in f.bbox.tolist()] if hasattr(f.bbox, "tolist") else [float(x) for x in f.bbox]
    return {
        "embedding": f.normed_embedding,
        "bbox": bbox,
        "image_width": int(img.shape[1]),
        "image_height": int(img.shape[0]),
    }


def _iou(a, b) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _enhance_classroom_image(img):
    import cv2

    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l2, a, b]), cv2.COLOR_LAB2BGR)


def _clip_bbox(x1, y1, x2, y2, w, h):
    x1 = max(0, min(int(x1), w - 1))
    y1 = max(0, min(int(y1), h - 1))
    x2 = max(0, min(int(x2), w))
    y2 = max(0, min(int(y2), h))
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _reembed_upscaled_crop(img, bbox, min_face_side: int = 160):
    import cv2

    h, w = img.shape[:2]
    x1, y1, x2, y2 = bbox
    fw, fh = max(1.0, x2 - x1), max(1.0, y2 - y1)
    pad_x, pad_y = fw * 0.45, fh * 0.45
    clipped = _clip_bbox(x1 - pad_x, y1 - pad_y, x2 + pad_x, y2 + pad_y, w, h)
    if not clipped:
        return None
    cx1, cy1, cx2, cy2 = clipped
    crop = img[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return None

    ch, cw = crop.shape[:2]
    side = max(ch, cw)
    if side < min_face_side:
        scale = min_face_side / side
        crop = cv2.resize(
            crop,
            (max(1, int(cw * scale)), max(1, int(ch * scale))),
            interpolation=cv2.INTER_CUBIC,
        )

    try:
        faces = get_face_app((640, 640)).get(crop)
    except Exception:
        return None
    if not faces:
        return None
    faces = sorted(
        faces,
        key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
        reverse=True,
    )
    return np.asarray(faces[0].normed_embedding, dtype=np.float32)


def _iter_classroom_tiles(img, grid_rows: int = 2, grid_cols: int = 2, overlap: float = 0.15):
    import cv2

    h, w = img.shape[:2]
    tile_h = h / grid_rows
    tile_w = w / grid_cols
    step_y = tile_h * (1.0 - overlap)
    step_x = tile_w * (1.0 - overlap)

    y = 0.0
    while y < h:
        x = 0.0
        y2 = min(h, int(y + tile_h * (1.0 + overlap)))
        y1 = int(y)
        if y2 - y1 < 40:
            break
        while x < w:
            x2 = min(w, int(x + tile_w * (1.0 + overlap)))
            x1 = int(x)
            if x2 - x1 < 40:
                break
            tile = img[y1:y2, x1:x2]
            th, tw = tile.shape[:2]
            target = 800
            long_edge = max(th, tw)
            scale = target / long_edge if long_edge < target else 1.0
            if scale != 1.0:
                tile = cv2.resize(
                    tile,
                    (int(tw * scale), int(th * scale)),
                    interpolation=cv2.INTER_LINEAR,
                )
            yield x1, y1, tile, scale
            if x2 >= w:
                break
            x += step_x
        if y2 >= h:
            break
        y += step_y


def extract_embeddings_for_classroom(stream_or_bytes, min_face_px: int = 14):
    import time
    import cv2
    import logging

    logger = logging.getLogger("core.recognition")
    t_start = time.perf_counter()

    img = _decode_image(stream_or_bytes)
    if img is None:
        return []

    orig_h, orig_w = img.shape[:2]
    long_edge = max(orig_h, orig_w)

    # 1. Normalize working resolution to avoid processing excessively huge images (e.g. 4000px+)
    target_max = 1600
    if long_edge > target_max:
        scale_down = target_max / long_edge
        working_img = cv2.resize(
            img,
            (int(orig_w * scale_down), int(orig_h * scale_down)),
            interpolation=cv2.INTER_AREA,
        )
    else:
        scale_down = 1.0
        working_img = img

    working = _enhance_classroom_image(working_img)
    raw_faces = []

    def _add_faces(faces, ox=0.0, oy=0.0, scale=1.0):
        for f in faces:
            x1, y1, x2, y2 = [float(v) for v in f.bbox]
            if scale != 1.0:
                x1, y1, x2, y2 = x1 / scale, y1 / scale, x2 / scale, y2 / scale
            x1, y1, x2, y2 = x1 + ox, y1 + oy, x2 + ox, y2 + oy
            # Map back to original image coordinate space if working_img was scaled down
            if scale_down != 1.0:
                x1, y1, x2, y2 = x1 / scale_down, y1 / scale_down, x2 / scale_down, y2 / scale_down
            raw_faces.append(
                {
                    "bbox": [x1, y1, x2, y2],
                    "embedding": np.asarray(f.normed_embedding, dtype=np.float32),
                    "det_score": float(getattr(f, "det_score", 0.0)),
                }
            )

    # 2. Single full-image pass at (640, 640) to detect all prominent and middle-ground faces
    t_full_start = time.perf_counter()
    try:
        full_faces = get_face_app((640, 640)).get(working)
        _add_faces(full_faces, scale=1.0)
    except Exception as e:
        logger.warning(f"Full-image detection pass failed: {e}")
    t_full_done = time.perf_counter()

    # 3. 2x2 grid tile passes (4 tiles) at (640, 640) for high-detail detection of back-row students
    t_tile_start = time.perf_counter()
    tile_count = 0
    for x0, y0, tile, tile_scale in _iter_classroom_tiles(working, grid_rows=2, grid_cols=2, overlap=0.15):
        tile_count += 1
        try:
            tile_faces = get_face_app((640, 640)).get(tile)
            _add_faces(
                tile_faces,
                ox=float(x0),
                oy=float(y0),
                scale=tile_scale,
            )
        except Exception:
            continue
    t_tile_done = time.perf_counter()

    # 4. Non-Maximum Suppression (NMS) to merge duplicate detections across full pass & tiles
    raw_faces.sort(key=lambda x: x["det_score"], reverse=True)
    kept = []
    for face in raw_faces:
        bbox = face["bbox"]
        fw, fh = bbox[2] - bbox[0], bbox[3] - bbox[1]
        if min(fw, fh) < min_face_px:
            continue
        if any(_iou(bbox, k["bbox"]) >= 0.4 for k in kept):
            continue
        kept.append(face)

    results = []
    for f in kept:
        results.append(
            {
                "bbox": [int(v) for v in f["bbox"]],
                "embedding": f["embedding"],
                "det_score": f["det_score"],
            }
        )

    t_total = time.perf_counter() - t_start
    print(
        f"[Classroom Inference] Detected {len(results)} faces in {t_total:.2f}s "
        f"(Full pass: {t_full_done - t_full_start:.2f}s, {tile_count} Tiles: {t_tile_done - t_tile_start:.2f}s)"
    )
    return results


def load_model_if_exists():
    """Load matcher bundle; prefer DB centroids (production path)."""
    bundle = None
    if os.path.exists(MODEL_PATH):
        with open(MODEL_PATH, "rb") as f:
            bundle = pickle.load(f)

    try:
        from . import services

        db_centroids = services.load_face_centroids()
    except Exception:
        db_centroids = {}

    if db_centroids:
        if bundle is None:
            bundle = {
                "version": 3,
                "centroids": db_centroids,
                "X": None,
                "y": None,
                "clf": None,
            }
        else:
            merged = dict(bundle.get("centroids") or {})
            merged.update(db_centroids)
            bundle["centroids"] = merged
            bundle["version"] = max(int(bundle.get("version") or 2), 3)
        bundle["student_ids"] = sorted(bundle["centroids"].keys())
    return bundle


def _normalize_allowed(allowed_ids: Optional[Iterable[int]]) -> Optional[Set[int]]:
    if allowed_ids is None:
        return None
    return {int(x) for x in allowed_ids}


def predict_with_model(
    bundle,
    emb,
    allowed_ids: Optional[Iterable[int]] = None,
    similarity_threshold: Optional[float] = None,
    use_centroids: bool = True,
    margin: Optional[float] = None,
):
    """Match embedding with cosine similarity against a (class-scoped) gallery.

    Returns (student_id | None, confidence_similarity).
    """
    if emb is None or bundle is None:
        return None, 0.0

    emb = np.asarray(emb, dtype=np.float32)
    allowed = _normalize_allowed(allowed_ids)
    thr = similarity_threshold if similarity_threshold is not None else LIVE_SIM_THRESHOLD
    need_margin = MARGIN if margin is None else margin

    centroids = bundle.get("centroids") if use_centroids else None
    if centroids:
        ids = []
        mats = []
        for sid, vec in centroids.items():
            sid = int(sid)
            if allowed is not None and sid not in allowed:
                continue
            ids.append(sid)
            mats.append(np.asarray(vec, dtype=np.float32))
        if not ids:
            return None, 0.0
        M = np.stack(mats)
        sims = M @ emb
    else:
        X = np.asarray(bundle["X"], dtype=np.float32)
        y = np.asarray(bundle["y"])
        if allowed is not None:
            mask = np.isin(y, list(allowed))
            if not np.any(mask):
                return None, 0.0
            X = X[mask]
            y = y[mask]
        sims = X @ emb
        ids = y

    order = np.argsort(-sims)
    best_i = int(order[0])
    best_sim = float(sims[best_i])
    best_id = int(ids[best_i])

    if best_sim < thr:
        return None, best_sim

    if len(order) > 1:
        for j in order[1:]:
            other_id = int(ids[int(j)])
            if other_id != best_id:
                second = float(sims[int(j)])
                if best_sim - second < need_margin:
                    return None, best_sim
                break

    return best_id, best_sim


def _load_cache() -> dict:
    if not os.path.exists(CACHE_PATH):
        return {}
    try:
        with open(CACHE_PATH, "rb") as f:
            return pickle.load(f)
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    with open(CACHE_PATH, "wb") as f:
        pickle.dump(cache, f)


def _file_signature(path: str) -> str:
    st = os.stat(path)
    return f"{st.st_mtime_ns}:{st.st_size}"


def train_model_background(dataset_dir, progress_callback=None, prune_after=None):
    if prune_after is None:
        prune_after = not settings.KEEP_CAPTURE_IMAGES

    cache = _load_cache()
    student_dirs = [
        d
        for d in os.listdir(dataset_dir)
        if os.path.isdir(os.path.join(dataset_dir, d))
    ]
    total_students = max(1, len(student_dirs))
    processed = 0
    X = []
    y = []
    centroids: dict[int, np.ndarray] = {}
    sample_counts: dict[int, int] = {}

    from . import services

    for sid in student_dirs:
        folder = os.path.join(dataset_dir, sid)
        files = [
            f
            for f in os.listdir(folder)
            if f.lower().endswith((".jpg", ".jpeg", ".png")) and f != "profile.jpg"
        ]
        if not files and os.path.exists(os.path.join(folder, "profile.jpg")):
            files = ["profile.jpg"]

        if not files:
            try:
                existing = services.load_face_centroids([int(sid)])
                if int(sid) in existing:
                    centroids[int(sid)] = existing[int(sid)]
                    sample_counts[int(sid)] = 1
                    X.append(existing[int(sid)])
                    y.append(int(sid))
            except Exception:
                pass
            processed += 1
            if progress_callback:
                progress_callback(int((processed / total_students) * 80),
                                  f"Processed {processed}/{total_students} students")
            continue

        sid_key = str(sid)
        student_cache = cache.get(sid_key, {})
        new_student_cache = {}
        embs = []

        for fn in files:
            path = os.path.join(folder, fn)
            sig = _file_signature(path)
            cached = student_cache.get(fn)
            if cached and cached.get("sig") == sig and cached.get("emb") is not None:
                emb = np.asarray(cached["emb"], dtype=np.float32)
            else:
                import cv2

                img = cv2.imread(path)
                if img is None:
                    continue
                faces = get_face_app((640, 640)).get(img)
                if len(faces) == 0:
                    continue
                faces = sorted(
                    faces,
                    key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]),
                    reverse=True,
                )
                emb = np.asarray(faces[0].normed_embedding, dtype=np.float32)

            new_student_cache[fn] = {"sig": sig, "emb": emb}
            embs.append(emb)
            X.append(emb)
            y.append(int(sid))

        cache[sid_key] = new_student_cache
        if embs:
            stacked = np.stack(embs)
            mean = stacked.mean(axis=0)
            norm = np.linalg.norm(mean) + 1e-9
            centroids[int(sid)] = (mean / norm).astype(np.float32)
            sample_counts[int(sid)] = len(embs)

        processed += 1
        if progress_callback:
            progress_callback(
                int((processed / total_students) * 80),
                f"Processed {processed}/{total_students} students (cached when possible)",
            )

    if prune_after:
        cache = {}
    _save_cache(cache)

    if len(X) == 0 and not centroids:
        if progress_callback:
            progress_callback(0, "No training data found")
        return

    if progress_callback:
        progress_callback(85, "Saving embeddings to database...")

    try:
        for sid, vec in centroids.items():
            services.upsert_face_centroid(sid, vec, sample_counts.get(sid, 1))
    except Exception as e:
        if progress_callback:
            progress_callback(85, f"DB save warning: {e}")

    if X:
        X_arr = np.stack(X).astype(np.float32)
        y_arr = np.array(y)
        n_neighbors = min(3, len(set(y_arr.tolist())))
        from sklearn.neighbors import KNeighborsClassifier

        clf = KNeighborsClassifier(n_neighbors=n_neighbors, metric="euclidean")
        clf.fit(X_arr, y_arr)
    else:
        X_arr, y_arr, clf = None, None, None

    bundle = {
        "version": 3,
        "clf": clf,
        "X": X_arr,
        "y": y_arr,
        "centroids": centroids,
        "student_ids": sorted(centroids.keys()),
    }
    with open(MODEL_PATH, "wb") as f:
        pickle.dump(bundle, f)

    prune_stats = {"deleted": 0, "bytes_freed": 0}
    if prune_after:
        if progress_callback:
            progress_callback(95, "Pruning capture images (keeping profile only)...")
        prune_stats = prune_capture_images(dataset_dir, keep_profile=True)
        if os.path.exists(CACHE_PATH):
            try:
                os.remove(CACHE_PATH)
            except OSError:
                pass

    if progress_callback:
        freed_mb = round(prune_stats.get("bytes_freed", 0) / (1024 * 1024), 2)
        msg = f"Ready — {len(centroids)} students in DB"
        if prune_after:
            msg += f", freed {freed_mb} MB captures"
        progress_callback(100, msg)


def check_face_quality(stream_or_bytes, min_face_ratio=0.035):
    import cv2

    img = _decode_image(stream_or_bytes)
    if img is None:
        return {"ok": False, "reason": "Invalid image"}

    faces = get_face_app((640, 640)).get(img)
    if len(faces) == 0:
        return {"ok": False, "reason": "No face detected — face the camera"}
    if len(faces) > 1:
        return {"ok": False, "reason": "Multiple faces detected — only one person allowed"}

    h, w = img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in faces[0].bbox]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)
    fw, fh = x2 - x1, y2 - y1

    if fw < 40 or fh < 40:
        return {"ok": False, "reason": "Move closer to the camera"}

    face_area_ratio = (fw * fh) / (w * h)
    if face_area_ratio < min_face_ratio:
        return {"ok": False, "reason": "Move closer to the camera"}

    # Quality Check 1: Lighting / Luminance on face
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    face_crop = gray[y1:y2, x1:x2]
    mean_brightness = float(np.mean(face_crop)) if face_crop.size > 0 else float(np.mean(gray))

    if mean_brightness < 55.0:
        return {
            "ok": False,
            "reason": "Too dark — please turn on lights or face a light source",
            "brightness": round(mean_brightness, 1),
        }
    if mean_brightness > 235.0:
        return {
            "ok": False,
            "reason": "Too bright / direct glare — avoid backlight",
            "brightness": round(mean_brightness, 1),
        }

    # Quality Check 2: Sharpness / Motion Blur
    target_crop = face_crop if face_crop.size > 0 else gray
    laplacian_var = float(cv2.Laplacian(target_crop, cv2.CV_64F).var())
    if laplacian_var < 30.0:
        return {
            "ok": False,
            "reason": "Image is blurry — please hold still",
            "sharpness": round(laplacian_var, 1),
        }

    return {
        "ok": True,
        "brightness": round(mean_brightness, 1),
        "sharpness": round(laplacian_var, 1),
    }
