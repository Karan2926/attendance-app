"""Password hasher that verifies legacy Werkzeug-format hashes
(`pbkdf2:sha256:iterations$salt$checksum`), so accounts imported from the
Flask system keep working. New passwords are encoded with Django's default
hasher, so both formats coexist.

Register in settings.PASSWORD_HASHERS (last entry).
"""

import hashlib
import hmac
import re

from django.contrib.auth.hashers import BasePasswordHasher, is_password_usable
from django.utils.crypto import constant_time_compare

_WERKZEUG_RE = re.compile(r"^(?P<method>pbkdf2:[a-z0-9]+):(?P<iterations>\d+)\$(?P<salt>[^$]+)\$(?P<checksum>.+)$")


class WerkzeugPasswordHasher(BasePasswordHasher):
    algorithm = "pbkdf2:sha256"

    def salt(self):
        return ""

    def encode(self, password, salt):
        # Fall back to Django's PBKDF2 (never emit werkzeug hashes for new users)
        from django.contrib.auth.hashers import PBKDF2PasswordHasher

        return PBKDF2PasswordHasher().encode(password)

    def decode(self, encoded):
        raise NotImplementedError

    def verify(self, password, encoded):
        m = _WERKZEUG_RE.match(encoded)
        if not m:
            return False
        method = m.group("method")  # e.g. pbkdf2:sha256
        digest = method.split(":")[1] if ":" in method else "sha256"
        iterations = int(m.group("iterations"))
        salt = m.group("salt").encode()
        checksum = m.group("checksum")
        try:
            derived = hashlib.pbkdf2_hmac(digest, password.encode(), salt, iterations)
        except (ValueError, TypeError):
            return False
        return constant_time_compare(derived.hex(), checksum)

    def safe_summary(self, encoded):
        return {"algorithm": self.algorithm}

    def must_update(self, encoded):
        return False

    def harden_runtime(self, password, encoded):
        pass
