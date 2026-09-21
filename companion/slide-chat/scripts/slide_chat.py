#!/usr/bin/env python3
"""Credential-free distribution: CLI and stdio MCP adapter for Slide Chat."""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


def api(path, body=None):
    base = os.environ.get("SLIDE_CHAT_URL", "https://chat.slide.recipes").rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1")
    ):
        raise ValueError("SLIDE_CHAT_URL must use HTTPS (localhost HTTP is allowed).")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Invalid SLIDE_CHAT_URL.")
    token = os.environ.get("SLIDE_CHAT_TOKEN")
    if not token:
        raise ValueError("Set SLIDE_CHAT_TOKEN in the environment.")
    request = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
    )

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None

    try:
        with urllib.request.build_opener(NoRedirect).open(
            request, timeout=120
        ) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(
            f"Slide Chat returned HTTP {error.code}. Check the token, client scope, and source permissions."
        ) from None
    except urllib.error.URLError:
        raise ValueError("Could not reach Slide Chat.") from None


def call(name, arguments):
    return api(
        "/api/tools/call",
        {
            "name": name,
            "arguments": arguments,
            "client_id": os.environ.get("SLIDE_CLIENT_ID", ""),
        },
    )


def mcp():
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            method = request.get("method")
            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "slide-chat", "version": "2.0.0"},
                }
            elif method == "ping":
                result = {}
            elif method == "tools/list":
                result = {
                    "tools": [
                        {
                            "name": t["name"],
                            "description": t["description"],
                            "inputSchema": t["parameters"],
                            "annotations": {
                                "readOnlyHint": True,
                                "destructiveHint": False,
                            },
                        }
                        for t in api("/api/tools")["tools"]
                    ]
                }
            elif method == "tools/call":
                params = request.get("params", {})
                data = call(params.get("name"), params.get("arguments", {}))
                result = {
                    "content": [
                        {"type": "text", "text": json.dumps(data, ensure_ascii=False)}
                    ],
                    "isError": False,
                }
            else:
                print(
                    json.dumps(
                        {
                            "jsonrpc": "2.0",
                            "id": request["id"],
                            "error": {"code": -32601, "message": "Method not found"},
                        }
                    ),
                    flush=True,
                )
                continue
            response = {"jsonrpc": "2.0", "id": request["id"], "result": result}
        except Exception as error:
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "error": {
                    "code": -32603,
                    "message": (
                        str(error)
                        if isinstance(error, ValueError)
                        else "Tool request failed"
                    ),
                },
            }
        print(json.dumps(response, ensure_ascii=False), flush=True)


def main():
    if sys.argv[1:] == ["--mcp"]:
        mcp()
        return
    try:
        command = sys.argv[1] if len(sys.argv) > 1 else "context"
        if command == "tools":
            result = api("/api/tools")
        elif command == "context":
            result = api(
                "/api/context?client_id="
                + urllib.parse.quote(os.environ.get("SLIDE_CLIENT_ID", ""))
            )
        elif command == "call" and len(sys.argv) == 4:
            result = call(sys.argv[2], json.loads(sys.argv[3]))
        else:
            raise ValueError("Usage: slide_chat.py context|tools|call TOOL JSON|--mcp")
        print(json.dumps(result, indent=2, ensure_ascii=False))
    except Exception as error:
        print(
            str(error) if isinstance(error, ValueError) else "Request failed.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
