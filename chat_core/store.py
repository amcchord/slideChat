"""Encrypted server-side state. Browser cookies contain only an opaque workspace id."""

import hashlib
import json
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from cryptography.fernet import Fernet


class Store:
    def __init__(self, directory):
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "chat.sqlite3"
        key = os.environ.get("CHAT_ENCRYPTION_KEY")
        if not key:
            keyfile = directory / "encryption.key"
            try:
                fd = os.open(keyfile, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "wb") as target:
                    target.write(Fernet.generate_key())
            except FileExistsError:
                pass
            key = keyfile.read_bytes()
        self.cipher = Fernet(key)
        self.cookie_secret = hashlib.sha256(
            b"slide-chat-cookies" + (key.encode() if isinstance(key, str) else key)
        ).hexdigest()
        with self.connection() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, payload BLOB NOT NULL, updated REAL NOT NULL, busy_until REAL DEFAULT 0)"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS usage (bucket TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(bucket,day))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS tokens (digest TEXT PRIMARY KEY, workspace TEXT NOT NULL, expires REAL NOT NULL)"
            )
        os.chmod(self.path, 0o600)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self, slide_key):
        wid = secrets.token_urlsafe(32)
        state = {
            "slide_key": slide_key,
            "connectors": [],
            "conversations": [],
            "created": time.time(),
        }
        with self.connection() as db:
            db.execute(
                "DELETE FROM workspaces WHERE updated<?", (time.time() - 30 * 86400,)
            )
            db.execute(
                "DELETE FROM tokens WHERE expires<? OR workspace NOT IN (SELECT id FROM workspaces)",
                (time.time(),),
            )
            db.execute(
                "INSERT INTO workspaces(id,payload,updated) VALUES(?,?,?)",
                (wid, self.encode(state), time.time()),
            )
        return wid

    def encode(self, state):
        return self.cipher.encrypt(json.dumps(state, separators=(",", ":")).encode())

    def get(self, wid):
        with self.connection() as db:
            row = db.execute(
                "SELECT payload FROM workspaces WHERE id=? AND updated>?",
                (wid, time.time() - 30 * 86400),
            ).fetchone()
        return json.loads(self.cipher.decrypt(row[0])) if row else None

    def update(self, wid, mutate):
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT payload FROM workspaces WHERE id=?", (wid,)
            ).fetchone()
            if not row:
                raise ValueError("Workspace expired. Reconnect your Slide key.")
            state = json.loads(self.cipher.decrypt(row[0]))
            result = mutate(state)
            db.execute(
                "UPDATE workspaces SET payload=?, updated=? WHERE id=?",
                (self.encode(state), time.time(), wid),
            )
        return result

    def delete(self, wid):
        with self.connection() as db:
            db.execute("DELETE FROM tokens WHERE workspace=?", (wid,))
            db.execute("DELETE FROM workspaces WHERE id=?", (wid,))

    def acquire(self, wid, seconds=3600):
        with self.connection() as db:
            return (
                db.execute(
                    "UPDATE workspaces SET busy_until=? WHERE id=? AND busy_until<?",
                    (time.time() + seconds, wid, time.time()),
                ).rowcount
                == 1
            )

    def release(self, wid):
        with self.connection() as db:
            db.execute("UPDATE workspaces SET busy_until=0 WHERE id=?", (wid,))

    def token(self, wid):
        raw = "sc_" + secrets.token_urlsafe(40)
        with self.connection() as db:
            db.execute(
                "DELETE FROM tokens WHERE workspace=? OR expires<?", (wid, time.time())
            )
            db.execute(
                "INSERT INTO tokens VALUES(?,?,?)",
                (
                    hashlib.sha256(raw.encode()).hexdigest(),
                    wid,
                    time.time() + 30 * 86400,
                ),
            )
        return raw

    def authenticate(self, token):
        with self.connection() as db:
            row = db.execute(
                "SELECT workspace FROM tokens WHERE digest=? AND expires>?",
                (hashlib.sha256(token.encode()).hexdigest(), time.time()),
            ).fetchone()
        return row[0] if row else None

    def allow_request(self, slide_key, own_openai_key=False):
        day = time.strftime("%Y-%m-%d", time.gmtime())
        account = hashlib.sha256(slide_key.encode()).hexdigest()
        limits = [(account, int(os.getenv("CHAT_DAILY_WORKSPACE_REQUESTS", "100")))]
        if not own_openai_key:
            limits.append(
                ("deployment", int(os.getenv("CHAT_DAILY_HOSTED_REQUESTS", "200")))
            )
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM usage WHERE day<?", (day,))
            for bucket, limit in limits:
                row = db.execute(
                    "SELECT count FROM usage WHERE bucket=? AND day=?", (bucket, day)
                ).fetchone()
                if row and row[0] >= limit:
                    return False
            for bucket, _ in limits:
                db.execute(
                    "INSERT INTO usage VALUES(?,?,1) ON CONFLICT(bucket,day) DO UPDATE SET count=count+1",
                    (bucket, day),
                )
        return True
