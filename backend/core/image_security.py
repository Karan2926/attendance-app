"""Image upload hardening.

Every image that enters the system (face uploads, live recognition, classroom
photos) is passed through :func:`sanitize_image` before it is stored or fed to
the face pipeline. This defends against:

* non-image files uploaded with any filename/content-type
* decompression bombs (tiny file that decodes to a huge bitmap)
* oversized images that would exhaust CPU/RAM in the face pipeline
* embedded payloads in EXIF / other metadata (stripped by re-encoding)

Rules are enforced twice: on the raw bytes (size + magic bytes + lazy Pillow
dimension check) and on the decoded pixels (re-encode). The return value is a
clean JPEG stream that only contains pixels.
"""

from __future__ import annotations

import io

from django.conf import settings

_ALLOWED_FORMATS = {
    b"\xff\xd8\xff": "JPEG",
    b"\x89PNG\r\n\x1a\n": "PNG",
    b"GIF87a": "GIF",
    b"GIF89a": "GIF",
    b"BM": "BMP",
}
_WEBP_MAGIC = b"RIFF"


def sniff_format(data: bytes):
    """Return the image format name from magic bytes, or None."""
    if not data:
        return None
    if data.startswith(_WEBP_MAGIC) and data[8:12] == b"WEBP":
        return "WEBP"
    for magic, name in _ALLOWED_FORMATS.items():
        if data.startswith(magic):
            return name
    return None


class ImageValidationError(ValueError):
    """Raised when an upload is not a safe, decodable image."""


def sanitize_image(data: bytes) -> bytes:
    """Validate raw upload bytes and return a clean JPEG stream.

    Raises :class:`ImageValidationError` with a user-safe message when the
    upload is rejected.
    """
    # Limits read at call time so env/override changes take effect live.
    max_file_bytes = int(settings.MAX_IMAGE_UPLOAD_MB) * 1024 * 1024
    max_pixels = int(settings.MAX_IMAGE_PIXELS)
    max_side = int(settings.MAX_IMAGE_SIDE)

    if not data:
        raise ImageValidationError("Empty file")

    if len(data) > max_file_bytes:
        raise ImageValidationError(
            f"File too large (max {max_file_bytes // (1024 * 1024)} MB)"
        )

    fmt = sniff_format(data)
    if fmt is None:
        raise ImageValidationError(
            "Unsupported file type. Upload JPEG, PNG or WebP images only."
        )

    try:
        from PIL import Image
    except ImportError:
        raise ImageValidationError("Image library unavailable")

    try:
        img = Image.open(io.BytesIO(data))
    except Exception:
        raise ImageValidationError("Corrupted or invalid image")

    width, height = img.size
    if width <= 0 or height <= 0:
        raise ImageValidationError("Invalid image dimensions")
    if width > max_side or height > max_side:
        raise ImageValidationError("Image dimensions are too large")
    if width * height > max_pixels:
        raise ImageValidationError("Image has too many pixels")

    try:
        # Force pixel decode now; a truncated file fails here, not later.
        img.load()
    except Exception:
        raise ImageValidationError("Corrupted or invalid image")

    # Re-encode to RGB JPEG — strips metadata, color profiles, and any
    # embedded payload, and normalizes format for cv2/insightface.
    try:
        out = io.BytesIO()
        img.convert("RGB").save(out, format="JPEG", quality=90)
        out.seek(0)
    except Exception:
        raise ImageValidationError("Failed to process image")

    return out.getvalue()


def read_upload(file_obj) -> tuple[bytes, str | None]:
    """Read an UploadedFile and sanitize it.

    Returns (clean_bytes, error_message). error_message is None on success.
    """
    try:
        data = file_obj.read()
    except Exception:
        return b"", "Could not read upload"
    try:
        return sanitize_image(data), None
    except ImageValidationError as e:
        return b"", str(e)
