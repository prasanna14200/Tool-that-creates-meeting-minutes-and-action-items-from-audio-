"""Small static server for the Meeting Minutes Studio demo."""

from pathlib import Path

from flask import Flask, jsonify, send_from_directory

ROOT = Path(__file__).resolve().parent
DOCS = ROOT / "docs"

app = Flask(__name__, static_folder=str(DOCS), static_url_path="")


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/")
def index():
    return send_from_directory(DOCS, "index.html")


@app.get("/<path:path>")
def static_files(path):
    return send_from_directory(DOCS, path)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=7860)
