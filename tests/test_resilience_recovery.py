from __future__ import annotations

import asyncio
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import threading
from typing import Dict

import httpx
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import config, database
from backend.services import connectors, llm_agent
from scripts import ecobi_launcher


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


def _isolated_launcher(iso_root: Path) -> Path:
    scripts_dir = iso_root / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    target = scripts_dir / "ecobi_launcher.py"
    shutil.copy2(Path(__file__).resolve().parents[1] / "scripts" / "ecobi_launcher.py", target)
    return target


def test_launcher_rejects_port_occupied_by_other_service(tmp_path: Path) -> None:
    class OtherHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"other-app")

        def log_message(self, format, *args):
            return

    port = _free_port()
    server = HTTPServer(("127.0.0.1", port), OtherHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        iso_root = tmp_path / "occupied_app"
        launcher = _isolated_launcher(iso_root)
        env = os.environ.copy()
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
        res = subprocess.run(
            [sys.executable, str(launcher), "--port", str(port), "--no-browser"],
            cwd=iso_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
        assert res.returncode == 1
        combined = res.stdout + res.stderr
        assert "ocupada" in combined.lower()
        assert "aplicacao pronta" not in combined.lower()
    finally:
        server.shutdown()
        server.server_close()


def test_launcher_detects_running_ecobi_and_avoids_duplicate_process(tmp_path: Path) -> None:
    class FakeEcoBIHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/health":
                payload = json.dumps({"status": "healthy", "service": "ecobi-intelligence", "block_external_ai": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_response(200)
            self.end_headers()

        def log_message(self, format, *args):
            return

    port = _free_port()
    server = HTTPServer(("127.0.0.1", port), FakeEcoBIHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        iso_root = tmp_path / "running_ecobi"
        launcher = _isolated_launcher(iso_root)
        env = os.environ.copy()
        env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
        res = subprocess.run(
            [sys.executable, str(launcher), "--port", str(port), "--no-browser"],
            cwd=iso_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
        assert res.returncode == 0, res.stdout + res.stderr
        combined = res.stdout + res.stderr
        assert "nenhum processo duplicado iniciado" in combined.lower()
    finally:
        server.shutdown()
        server.server_close()


def test_launcher_fails_safely_on_corrupted_sqlite_and_recovers_after_replace(tmp_path: Path) -> None:
    iso_root = tmp_path / "corrupt_db_app"
    runtime_dir = iso_root / "data" / "runtime"
    runtime_dir.mkdir(parents=True)
    db_file = runtime_dir / "ecobi.db"
    db_file.write_bytes(b"NOT_A_VALID_SQLITE_DATABASE_HEADER_0000")

    launcher = _isolated_launcher(iso_root)
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1])
    port = _free_port()
    res = subprocess.run(
        [sys.executable, str(launcher), "--port", str(port), "--no-browser"],
        cwd=iso_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=25,
        check=False,
    )
    assert res.returncode == 1
    combined = res.stdout + res.stderr
    assert "corrompido" in combined.lower() or "invalido" in combined.lower()
    assert "aplicacao pronta" not in combined.lower()

    db_file.unlink()
    logger = ecobi_launcher.setup_launcher_logging(iso_root / "data" / "logs")
    paths = ecobi_launcher.ensure_environment(iso_root, logger, initialize_database=True)
    with sqlite3.connect(paths["db_path"]) as conn:
        assert conn.execute("PRAGMA integrity_check;").fetchall() == [("ok",)]


def test_ensure_environment_raises_on_locked_sqlite(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    def raise_locked(_db_path):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(ecobi_launcher.database, "init_db", raise_locked)
    logger = ecobi_launcher.setup_launcher_logging(tmp_path / "logs")
    with pytest.raises(sqlite3.OperationalError, match="locked"):
        ecobi_launcher.ensure_environment(tmp_path, logger, initialize_database=True)


def test_wait_for_readiness_requires_both_health_and_frontend_root() -> None:
    state = {"root_code": 500}

    class PartialHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/api/health":
                payload = json.dumps({"status": "healthy", "service": "ecobi-intelligence", "block_external_ai": True}).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(payload)
                return
            self.send_response(state["root_code"])
            self.end_headers()

        def log_message(self, format, *args):
            return

    port = _free_port()
    server = HTTPServer(("127.0.0.1", port), PartialHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        assert ecobi_launcher.wait_for_readiness(f"http://127.0.0.1:{port}", timeout_sec=1.2) is False
        state["root_code"] = 200
        assert ecobi_launcher.wait_for_readiness(f"http://127.0.0.1:{port}", timeout_sec=2.0) is True
    finally:
        server.shutdown()
        server.server_close()


def test_assistant_falls_back_on_ollama_500_oom_and_ignores_http_proxy(
    client: TestClient,
    auth_headers: Dict[str, str],
    sample_paths: Dict[str, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    proj = client.post("/api/projects", json={"name": "Resilience LLM", "sector": "Varejo"}, headers=auth_headers).json()
    with sample_paths["piloto"].open("rb") as f:
        ds = client.post(
            f"/api/projects/{proj['id']}/datasets/upload",
            files={"file": ("piloto.csv", f, "text/csv")},
            headers=auth_headers,
        ).json()["dataset"]

    monkeypatch.setenv("HTTP_PROXY", "http://198.51.100.99:8888")
    monkeypatch.setenv("HTTPS_PROXY", "http://198.51.100.99:8888")

    seen_trust_env = []

    class FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            seen_trust_env.append(kwargs.get("trust_env"))

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def get(self, url, **kwargs):
            return httpx.Response(200, json={"models": [{"name": config.DEFAULT_MODEL}]}, request=httpx.Request("GET", url))

        async def post(self, url, **kwargs):
            return httpx.Response(500, json={"error": "model requires more system memory"}, request=httpx.Request("POST", url))

    monkeypatch.setattr(llm_agent.httpx, "AsyncClient", FakeAsyncClient)

    result = asyncio.run(
        llm_agent.process_assistant_message(
            project_id=proj["id"],
            message="Calcule a qualidade do dataset.",
            dataset_id=ds["id"],
            actor="qa_resilience",
        )
    )
    assert result["execution_mode"] == "deterministic_local_fallback"
    assert result["ollama_status"] == "offline"
    assert seen_trust_env and all(flag is False for flag in seen_trust_env)


def test_connectors_xlsx_watched_directory_and_postgresql_redaction_on_missing_driver(
    client: TestClient,
    auth_headers: Dict[str, str],
    tmp_path: Path,
) -> None:
    proj = client.post("/api/projects", json={"name": "Connectors Audit", "sector": "Varejo"}, headers=auth_headers).json()
    proj_id = proj["id"]

    watch_dir = config.DATA_DIR / "watched" / "xlsx_audit"
    watch_dir.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame({
        "periodo": ["2025-01", "2025-02"],
        "receita_bruta": [50000.0, 55000.0],
        "receita_liquida": [45000.0, 49500.0],
        "energia_kwh": [900.0, 950.0],
    })
    df.to_excel(watch_dir / "lote_excel.xlsx", index=False)

    conn_xlsx = client.post(
        f"/api/projects/{proj_id}/connectors",
        json={
            "name": "Diretorio XLSX",
            "connector_type": "watched_directory",
            "config": {"directory_path": str(watch_dir)},
            "query_or_table": "*.xlsx",
            "watermark_column": "periodo",
        },
        headers=auth_headers,
    )
    assert conn_xlsx.status_code == 201
    xlsx_id = conn_xlsx.json()["id"]

    sync1 = client.post(f"/api/projects/{proj_id}/connectors/{xlsx_id}/sync", json={}, headers=auth_headers)
    assert sync1.status_code == 200
    assert sync1.json()["run_status"] == "SUCCESS"
    assert sync1.json()["rows_ingested"] == 2

    sync2 = client.post(f"/api/projects/{proj_id}/connectors/{xlsx_id}/sync", json={}, headers=auth_headers)
    assert sync2.status_code == 200
    assert sync2.json()["run_status"] == "NO_CHANGES"

    secret_pw = "SuperSecretCorpPass987"
    pg_resp = client.post(
        f"/api/projects/{proj_id}/connectors",
        json={
            "name": "Postgres Sem Driver",
            "connector_type": "postgresql_readonly",
            "config": {"dsn": f"postgresql://svc_ro:{secret_pw}@10.0.0.5:5432/corp_bi"},
            "query_or_table": "SELECT * FROM fato_esg",
            "watermark_column": "periodo",
        },
        headers=auth_headers,
    )
    assert pg_resp.status_code == 201
    pg_id = pg_resp.json()["id"]
    assert secret_pw not in json.dumps(pg_resp.json())

    pg_sync = client.post(f"/api/projects/{proj_id}/connectors/{pg_id}/sync", json={}, headers=auth_headers)
    assert pg_sync.status_code in (400, 422, 500)
    assert secret_pw not in pg_sync.text

    for bad_sql in ("SELECT * INTO backup_tbl FROM vendas", "SELECT 1; DROP TABLE vendas", "SELECT * FROM x -- comment"):
        with pytest.raises(PermissionError):
            connectors.validate_readonly_query(bad_sql, "sqlite_external")
