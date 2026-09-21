"""Slide Chat 2.0 — client-scoped operations intelligence."""

import csv
import hashlib
import io
import json
import os
import secrets
import time
import zipfile
from datetime import timedelta
from pathlib import Path
from flask import (
    Flask,
    Response,
    abort,
    jsonify,
    render_template,
    redirect,
    request,
    send_file,
    session,
    stream_with_context,
)
from dotenv import load_dotenv
from chat_core.agent import MODEL, TOOLS, Toolbox, run_chat, hosted_key_available
from chat_core.sources import (
    Slide,
    SourceError,
    connector_data,
    scoped_inventory,
    validate_connector,
    redact,
)
from chat_core.store import Store
from chat_core.recipes_handoff import install_handoff

load_dotenv()
ROOT = Path(__file__).resolve().parent


def create_app(test_config=None):
    app = Flask(__name__)
    app.config.update(
        MAX_CONTENT_LENGTH=3_000_000,
        SESSION_COOKIE_NAME="slide_chat_session",
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.getenv("FLASK_ENV") == "production",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        JSON_SORT_KEYS=False,
        RECIPES_HANDOFF_KEY=os.getenv("RECIPES_HANDOFF_KEY", ""),
    )
    if test_config:
        app.config.update(test_config)
    store = Store(
        app.config.get("DATA_DIR") or os.getenv("CHAT_DATA_DIR", str(ROOT / "instance"))
    )
    app.secret_key = os.getenv("SECRET_KEY") or store.cookie_secret
    app.extensions["chat_store"] = store

    def connect_from_recipes(key):
        Slide(key).get("device", {"limit": 1})
        # Preserve existing conversations, connectors and BYO model keys. A map
        # lives in this browser's signed cookie, never a global key-to-workspace lookup.
        accounts = session.get("recipes_workspaces", {})
        current_id = session.get("workspace")
        current = store.get(current_id) if current_id else None
        if current:
            accounts[hashlib.sha256(current["slide_key"].encode()).hexdigest()] = current_id
        fingerprint = hashlib.sha256(key.encode()).hexdigest()
        wid = accounts.get(fingerprint)
        existing = store.get(wid) if wid else None
        if not existing or not secrets.compare_digest(existing["slide_key"], key):
            wid = store.create(key)
        accounts.pop(fingerprint, None)
        accounts[fingerprint] = wid
        session["recipes_workspaces"] = dict(list(accounts.items())[-8:])
        session["workspace"] = wid
        session["csrf"] = secrets.token_urlsafe(32)
        session.permanent = True
        return redirect("/")

    should_connect_recipes = install_handoff(
        app, "chat", connect_from_recipes, "/",
        store.path.parent / "recipes-handoffs.sqlite3",
    )

    def auth():
        bearer = request.headers.get("Authorization", "")
        wid = (
            store.authenticate(bearer[7:])
            if bearer.startswith("Bearer ")
            else session.get("workspace")
        )
        state = store.get(wid) if wid else None
        if state is None:
            abort(401, "Connect your Slide API key to continue.")
        return wid, state

    @app.before_request
    def protect():
        if request.method in (
            "POST",
            "DELETE",
            "PUT",
            "PATCH",
        ) and not request.path.startswith("/api/tools") and request.endpoint != "recipes_handoff.callback":
            if not secrets.compare_digest(
                request.headers.get("X-CSRF-Token", ""), session.get("csrf", "missing")
            ):
                abort(403, "Refresh this page before trying again.")
        if (
            request.content_length
            and request.is_json
            and not isinstance(request.get_json(silent=True), dict)
        ):
            abort(400, "Invalid JSON.")

    @app.after_request
    def headers(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
        )
        return response

    @app.errorhandler(SourceError)
    def source_error(error):
        return jsonify(error=str(error)), 400

    @app.errorhandler(400)
    @app.errorhandler(401)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(409)
    @app.errorhandler(413)
    @app.errorhandler(429)
    def http_error(error):
        return jsonify(error=error.description), error.code

    @app.get("/")
    def index():
        wid = session.get("workspace")
        if not (wid and store.get(wid)) and should_connect_recipes():
            return redirect("/connect/recipes")
        session.setdefault("csrf", secrets.token_urlsafe(32))
        return render_template("index.html", csrf=session["csrf"], model=MODEL)

    @app.get("/api/session")
    def current_session():
        session.setdefault("csrf", secrets.token_urlsafe(32))
        wid = session.get("workspace")
        state = store.get(wid) if wid else None
        if not state:
            return jsonify(connected=False, csrf=session["csrf"], model=MODEL)
        return jsonify(
            connected=True,
            csrf=session["csrf"],
            model=MODEL,
            openai_configured=bool(
                state.get("openai_key") or hosted_key_available(state)
            ),
            connectors=[Toolbox.public_source(c) for c in state["connectors"]],
            conversations=[
                {k: c[k] for k in ("id", "title", "client_id", "updated")}
                for c in state["conversations"]
            ],
        )

    @app.post("/api/session")
    def connect():
        body = request.get_json() or {}
        key = str(body.get("slide_key", "")).strip()
        if not key.startswith("tk_") or len(key) > 300 or "\n" in key or "\r" in key:
            raise SourceError("Enter a valid Slide API key.")
        Slide(key).get("device", {"limit": 1})
        if session.get("workspace"):
            store.delete(session["workspace"])
        session.clear()
        session["workspace"] = store.create(key)
        session["csrf"] = secrets.token_urlsafe(32)
        session.permanent = True
        return jsonify(ok=True, csrf=session["csrf"])

    @app.delete("/api/session")
    def disconnect():
        wid, _ = auth()
        store.delete(wid)
        session.clear()
        # Explicit disconnect should stay disconnected until the next Recipes visit.
        session["recipes_attempted"] = True
        return jsonify(ok=True)

    @app.get("/api/context")
    def context():
        _, state = auth()
        toolbox = Toolbox(state, request.args.get("client_id", ""))
        result = toolbox.context()
        result["inventory"] = redact(toolbox.fleet())
        return jsonify(result)

    @app.post("/api/openai")
    def openai_key():
        wid, _ = auth()
        key = str((request.get_json() or {}).get("key", "")).strip()
        if key and (
            not key.startswith("sk-") or len(key) > 1000 or "\n" in key or "\r" in key
        ):
            raise SourceError("Enter an OpenAI API key.")
        store.update(wid, lambda state: state.update(openai_key=key))
        return jsonify(ok=True)

    @app.post("/api/connectors")
    def add_connector():
        wid, state = auth()
        if len(state["connectors"]) >= 20:
            raise SourceError("This workspace supports up to 20 sources.")
        body = request.get_json() or {}
        if body.get("kind") == "import" and isinstance(body.get("csv"), str):
            body["records"] = list(csv.DictReader(io.StringIO(body["csv"])))
        connection = validate_connector(body, Slide(state["slide_key"]).inventory())
        connection["id"] = secrets.token_urlsafe(12)
        # Test before saving. Never echo connector responses, credentials or exception bodies.
        connector_data(connection)
        store.update(wid, lambda current: current["connectors"].append(connection))
        return jsonify(source=Toolbox.public_source(connection))

    @app.delete("/api/connectors/<source_id>")
    def remove_connector(source_id):
        wid, _ = auth()
        store.update(
            wid,
            lambda state: state.update(
                connectors=[c for c in state["connectors"] if c["id"] != source_id]
            ),
        )
        return jsonify(ok=True)

    @app.get("/api/conversations/<conversation_id>")
    def conversation(conversation_id):
        _, state = auth()
        result = next(
            (c for c in state["conversations"] if c["id"] == conversation_id), None
        )
        if not result:
            abort(404, "Conversation not found.")
        return jsonify(result)

    @app.delete("/api/conversations/<conversation_id>")
    def delete_conversation(conversation_id):
        wid, _ = auth()
        store.update(
            wid,
            lambda state: state.update(
                conversations=[
                    c for c in state["conversations"] if c["id"] != conversation_id
                ]
            ),
        )
        return jsonify(ok=True)

    @app.get("/api/conversations/<conversation_id>/export")
    def export_conversation(conversation_id):
        _, state = auth()
        convo = next(
            (c for c in state["conversations"] if c["id"] == conversation_id), None
        )
        if not convo:
            abort(404, "Conversation not found.")
        lines = [
            "# " + convo["title"],
            "",
            "Client: " + (convo["client_id"] or "All clients"),
        ]
        for m in convo["messages"]:
            lines.extend(["", "## " + m["role"].title(), "", m["content"]])
            for source in m.get("evidence", []):
                lines.extend(
                    [
                        "",
                        f"[{source['id']}] {source['label']} — observed {source['observed_at']}",
                        "```json",
                        json.dumps(source["data"], indent=2),
                        "```",
                    ]
                )
        return send_file(
            io.BytesIO("\n".join(lines).encode()),
            mimetype="text/markdown",
            as_attachment=True,
            download_name="slide-chat.md",
        )

    @app.post("/api/chat")
    def chat():
        wid, state = auth()
        body = request.get_json() or {}
        message = body.get("message", "")
        if not isinstance(message, str) or not message.strip() or len(message) > 16000:
            raise SourceError("Enter a question of up to 16,000 characters.")
        client_id = str(body.get("client_id", ""))
        conversation_id = body.get("conversation_id")
        convo = next(
            (c for c in state["conversations"] if c["id"] == conversation_id), None
        )
        if conversation_id and not convo:
            abort(404, "Conversation not found.")
        if convo and convo["client_id"] != client_id:
            raise SourceError("Start a new conversation when changing clients.")
        if not state.get("openai_key") and not hosted_key_available(state):
            raise SourceError("Add your OpenAI key in Connections to start chatting.")
        if not store.acquire(wid):
            abort(409, "A response is already running in this workspace.")
        if not convo:
            convo = {
                "id": secrets.token_urlsafe(12),
                "title": message.strip()[:70],
                "client_id": client_id,
                "updated": time.time(),
                "messages": [],
            }
        # Per-key and deployment-wide budget guards apply even when a fresh browser workspace is created.
        if not store.allow_request(state["slide_key"], bool(state.get("openai_key"))):
            store.release(wid)
            abort(
                429,
                "Daily request budget reached. Ask the operator to review the configured limit.",
            )

        @stream_with_context
        def generate():
            try:
                yield sse({"type": "conversation", "id": convo["id"]})
                for event in run_chat(state, convo, message.strip(), client_id):
                    if event["type"] == "done":
                        convo["messages"].extend(
                            [
                                {"role": "user", "content": message.strip()},
                                {
                                    "role": "assistant",
                                    "content": event["content"],
                                    "evidence": event["evidence"],
                                    "usage": event["usage"],
                                },
                            ]
                        )
                        convo["messages"] = convo["messages"][-100:]
                        convo["updated"] = time.time()

                        def save(current):
                            current["conversations"] = [convo] + [
                                c
                                for c in current["conversations"]
                                if c["id"] != convo["id"]
                            ][:49]

                        store.update(wid, save)
                    yield sse(event)
            except SourceError as error:
                yield sse({"type": "error", "error": str(error)})
            except GeneratorExit:
                raise
            except Exception:
                app.logger.error("Chat response failed; conversation=%s", convo["id"])
                yield sse(
                    {
                        "type": "error",
                        "error": "The response could not finish. Please try again.",
                    }
                )
            finally:
                store.release(wid)

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={"X-Accel-Buffering": "no"},
        )

    @app.post("/api/token")
    def companion_token():
        wid, _ = auth()
        return jsonify(token=store.token(wid), expires_in_days=30)

    @app.get("/api/tools")
    def list_tools():
        auth()
        return jsonify(tools=TOOLS)

    @app.post("/api/tools/call")
    def call_tool():
        # The companion requires a bearer token; browser-cookie auth alone cannot bypass CSRF.
        if not request.headers.get("Authorization", "").startswith("Bearer "):
            abort(401, "A companion token is required.")
        _, state = auth()
        body = request.get_json() or {}
        toolbox = Toolbox(state, str(body.get("client_id", "")))
        return jsonify(toolbox.call(body.get("name"), body.get("arguments", {})))

    @app.get("/downloads/slide-chat-companion.zip")
    def download():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as archive:
            for path in (ROOT / "companion").rglob("*"):
                if (
                    path.is_file()
                    and "__pycache__" not in path.parts
                    and path.suffix != ".pyc"
                ):
                    archive.write(path, str(path.relative_to(ROOT / "companion")))
        buf.seek(0)
        return send_file(
            buf,
            mimetype="application/zip",
            as_attachment=True,
            download_name="slide-chat-companion.zip",
        )

    @app.get("/health")
    def health():
        return jsonify(status="ok", version="2.0.0", model=MODEL)

    return app


def sse(event):
    return "data: " + json.dumps(event, ensure_ascii=False) + "\n\n"


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "8882")), threaded=True)
