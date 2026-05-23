from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import json
import mimetypes
import sqlite3


ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "horas_extras.db"


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS registros (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha TEXT NOT NULL,
                tipo TEXT NOT NULL CHECK(tipo IN ('horas_extras', 'compensar')),
                cantidad REAL NOT NULL DEFAULT 0,
                wo_cm TEXT,
                nota TEXT,
                abonado INTEGER NOT NULL DEFAULT 0,
                abonado_detalle TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS registros_updated_at
            AFTER UPDATE ON registros
            FOR EACH ROW
            BEGIN
                UPDATE registros SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
            END;
            """
        )


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/registros":
            return self.list_registros(parsed.query)
        if parsed.path == "/api/resumen":
            return self.resumen_mes(parsed.query)
        return self.serve_static(parsed.path)

    def do_POST(self):
        if self.path == "/api/registros":
            return self.create_registro()
        return self.not_found()

    def do_PUT(self):
        if self.path.startswith("/api/registros/"):
            registro_id = self.path.rsplit("/", 1)[-1]
            return self.update_registro(registro_id)
        return self.not_found()

    def do_DELETE(self):
        if self.path.startswith("/api/registros/"):
            registro_id = self.path.rsplit("/", 1)[-1]
            return self.delete_registro(registro_id)
        return self.not_found()

    def list_registros(self, query):
        params = parse_qs(query)
        month = params.get("month", [""])[0]
        sql = "SELECT * FROM registros"
        values = []
        if month:
            sql += " WHERE substr(fecha, 1, 7) = ?"
            values.append(month)
        sql += " ORDER BY fecha ASC, id ASC"
        with get_db() as conn:
            rows = [dict(row) for row in conn.execute(sql, values)]
        return self.json_response(rows)

    def resumen_mes(self, query):
        params = parse_qs(query)
        month = params.get("month", [""])[0]
        if not month:
            return self.bad_request("Falta el parametro month.")
        with get_db() as conn:
            rows = [
                dict(row)
                for row in conn.execute(
                    """
                    SELECT fecha,
                           SUM(cantidad) AS total,
                           SUM(CASE WHEN tipo = 'horas_extras' THEN cantidad ELSE 0 END) AS extras,
                           SUM(CASE WHEN tipo = 'compensar' THEN cantidad ELSE 0 END) AS compensar,
                           COUNT(*) AS registros,
                           SUM(abonado) AS abonados
                    FROM registros
                    WHERE substr(fecha, 1, 7) = ?
                    GROUP BY fecha
                    ORDER BY fecha
                    """,
                    [month],
                )
            ]
        return self.json_response(rows)

    def create_registro(self):
        data = self.read_json()
        error = validate_registro(data)
        if error:
            return self.bad_request(error)
        with get_db() as conn:
            cursor = conn.execute(
                """
                INSERT INTO registros (fecha, tipo, cantidad, wo_cm, nota, abonado, abonado_detalle)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    data["fecha"],
                    data["tipo"],
                    float(data["cantidad"]),
                    data.get("wo_cm", "").strip(),
                    data.get("nota", "").strip(),
                    1 if data.get("abonado") else 0,
                    data.get("abonado_detalle", "").strip(),
                ],
            )
            row = conn.execute("SELECT * FROM registros WHERE id = ?", [cursor.lastrowid]).fetchone()
        return self.json_response(dict(row), status=201)

    def update_registro(self, registro_id):
        data = self.read_json()
        try:
            registro_id = int(registro_id)
        except ValueError:
            return self.bad_request("ID invalido.")

        allowed = {
            "fecha",
            "tipo",
            "cantidad",
            "wo_cm",
            "nota",
            "abonado",
            "abonado_detalle",
        }
        updates = {key: data[key] for key in allowed if key in data}
        if not updates:
            return self.bad_request("No hay datos para actualizar.")

        merged = self.get_registro(registro_id)
        if not merged:
            return self.not_found()
        merged.update(updates)
        error = validate_registro(merged)
        if error:
            return self.bad_request(error)

        columns = []
        values = []
        for key, value in updates.items():
            columns.append(f"{key} = ?")
            if key == "cantidad":
                value = float(value)
            if key == "abonado":
                value = 1 if value else 0
            if isinstance(value, str):
                value = value.strip()
            values.append(value)
        values.append(registro_id)

        with get_db() as conn:
            conn.execute(f"UPDATE registros SET {', '.join(columns)} WHERE id = ?", values)
            row = conn.execute("SELECT * FROM registros WHERE id = ?", [registro_id]).fetchone()
        return self.json_response(dict(row))

    def delete_registro(self, registro_id):
        try:
            registro_id = int(registro_id)
        except ValueError:
            return self.bad_request("ID invalido.")
        with get_db() as conn:
            cursor = conn.execute("DELETE FROM registros WHERE id = ?", [registro_id])
        if cursor.rowcount == 0:
            return self.not_found()
        return self.json_response({"ok": True})

    def get_registro(self, registro_id):
        with get_db() as conn:
            row = conn.execute("SELECT * FROM registros WHERE id = ?", [registro_id]).fetchone()
        return dict(row) if row else None

    def serve_static(self, path):
        if path == "/":
            path = "/index.html"
        file_path = (ROOT / path.lstrip("/")).resolve()
        if ROOT not in file_path.parents and file_path != ROOT:
            return self.not_found()
        if not file_path.exists() or not file_path.is_file():
            return self.not_found()
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(file_path.read_bytes())

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8")
        return json.loads(body or "{}")

    def json_response(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def bad_request(self, message):
        return self.json_response({"error": message}, status=400)

    def not_found(self):
        return self.json_response({"error": "No encontrado."}, status=404)

    def log_message(self, format, *args):
        return


def validate_registro(data):
    if not data.get("fecha"):
        return "La fecha es obligatoria."
    if data.get("tipo") not in {"horas_extras", "compensar"}:
        return "El tipo debe ser horas extras o a compensar."
    try:
        cantidad = float(data.get("cantidad", 0))
    except (TypeError, ValueError):
        return "La cantidad debe ser numerica."
    if cantidad <= 0:
        return "La cantidad debe ser mayor a cero."
    return None


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("Servidor iniciado en http://127.0.0.1:8000")
    server.serve_forever()
