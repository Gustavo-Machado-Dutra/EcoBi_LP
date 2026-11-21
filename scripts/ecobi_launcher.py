"""Launcher Local do EcoBI Intelligence para Ambientes Windows (Fase 4: ECOBI-20).

Executa:
1. Validação de diretórios locais de runtime, logs e backups.
2. Inicialização determinística do banco SQLite e aplicação das migrations (001 a 006).
3. Verificação de disponibilidade da porta e detecção de instância EcoBI já ativa.
4. Preparação e verificação de prontidão do runtime Ollama local e modelo configurado.
5. Gerenciamento de logging com rotação em data/logs/ecobi.log.
6. Inicialização do servidor Uvicorn / FastAPI e verificação de readiness (/api/health + /).
7. Abertura automática do navegador padrão na interface local Sustainable Tech.
8. Tratamento gracioso de sinais de encerramento (SIGINT/SIGTERM/SIGBREAK).
"""

from __future__ import annotations

import argparse
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from typing import Dict, Optional
import urllib.request
import webbrowser

# Garante que a raiz do repositório esteja no PYTHONPATH
if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
    ROOT_DIR = Path(sys.executable).resolve().parent
    BUNDLE_DIR = Path(sys._MEIPASS).resolve()
else:
    ROOT_DIR = Path(__file__).resolve().parent.parent
    BUNDLE_DIR = ROOT_DIR

if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend import config, database


def setup_launcher_logging(log_dir: Path) -> logging.Logger:
    """Configura logging para console e arquivo rotacionado ecobi.log."""
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / "ecobi.log"

    logger = logging.getLogger("ecobi.launcher")
    logger.setLevel(logging.INFO)

    # Evita handlers duplicados em chamadas repetidas
    if not logger.handlers:
        c_handler = logging.StreamHandler(sys.stdout)
        c_format = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", datefmt="%H:%M:%S")
        c_handler.setFormatter(c_format)
        logger.addHandler(c_handler)

        f_handler = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")
        f_format = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s")
        f_handler.setFormatter(f_format)
        logger.addHandler(f_handler)

    return logger


def ensure_environment(base_dir: Path, logger: logging.Logger, *, initialize_database: bool = True) -> Dict[str, Path]:
    """Garante que a estrutura de diretórios e arquivos de persistência estejam prontos."""
    data_dir = (base_dir / "data").resolve()
    runtime_dir = data_dir / "runtime"
    logs_dir = data_dir / "logs"
    backups_dir = data_dir / "backups"
    exports_dir = data_dir / "exports"

    for d in (runtime_dir, logs_dir, backups_dir, exports_dir):
        d.mkdir(parents=True, exist_ok=True)

    db_path = runtime_dir / "ecobi.db"
    os.environ["ECOBI_DB_PATH"] = str(db_path)

    logger.info("Estrutura de diretórios locais validada em: %s", data_dir)
    if initialize_database:
        logger.info("Inicializando banco de dados local SQLite (WAL) e aplicando migrations...")
        try:
            database.init_db(db_path)
        except sqlite3.OperationalError as exc:
            logger.error(
                "Banco de dados SQLite bloqueado ou inacessivel (%s): %s. "
                "Encerre outras instancias do EcoBI ou verifique permissoes em %s.",
                db_path,
                exc,
                runtime_dir,
            )
            raise
        except sqlite3.DatabaseError as exc:
            logger.error(
                "Banco de dados SQLite invalido ou corrompido (%s): %s. "
                "Restaure um backup valido de %s antes de reiniciar.",
                db_path,
                exc,
                backups_dir,
            )
            raise
        logger.info("Banco de dados pronto e migrations aplicadas com sucesso.")
    return {
        "data_dir": data_dir,
        "runtime_dir": runtime_dir,
        "logs_dir": logs_dir,
        "backups_dir": backups_dir,
        "exports_dir": exports_dir,
        "db_path": db_path,
    }


def _urlopen_direct(url: str, timeout: float = 2.0):
    """Abre URL loopback ignorando variaveis HTTP_PROXY/HTTPS_PROXY."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(url, timeout=timeout)


def check_port_availability(host: str, port: int, logger: Optional[logging.Logger] = None) -> str:
    """Verifica se a porta local esta livre, ocupada pelo proprio EcoBI ou por outro servico.

    Retorna:
    - 'available': porta livre para bind local.
    - 'ecobi_running': uma instancia saudavel do EcoBI ja esta respondendo nesta porta.
    - 'occupied': outro processo esta ocupando a porta.
    """
    in_use = False
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        if probe.connect_ex((host, port)) == 0:
            in_use = True

    if not in_use:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as binder:
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                binder.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            try:
                binder.bind((host, port))
            except OSError:
                in_use = True

    if not in_use:
        return "available"

    health_url = f"http://{host}:{port}/api/health"
    try:
        with _urlopen_direct(health_url, timeout=2.0) as resp:
            if resp.status == 200:
                payload = json.loads(resp.read().decode("utf-8"))
                if payload.get("service") == "ecobi-intelligence":
                    if logger:
                        logger.info("EcoBI ja esta em execucao em http://%s:%s.", host, port)
                    return "ecobi_running"
    except Exception:
        pass

    if logger:
        logger.error(
            "A porta %s:%s ja esta ocupada por outro processo. "
            "Encerre o processo conflitante ou execute com outra porta (ex.: .\\start.ps1 -Port %s).",
            host,
            port,
            port + 1 if port < 65535 else 8001,
        )
    return "occupied"


def wait_for_health_check(url: str, timeout_sec: float = 30.0, logger: Optional[logging.Logger] = None) -> bool:
    """Executa polling no endpoint /api/health até que o backend responda HTTP 200."""
    t0 = time.perf_counter()
    while (time.perf_counter() - t0) < timeout_sec:
        try:
            with _urlopen_direct(url, timeout=2.0) as resp:
                if resp.status == 200:
                    if logger:
                        logger.info("Health check aprovado em %s (%.2fs)", url, time.perf_counter() - t0)
                    return True
        except Exception:
            time.sleep(0.5)
    if logger:
        logger.error("Timeout de %.1fs aguardando backend responder em %s", timeout_sec, url)
    return False


def wait_for_readiness(base_url: str, timeout_sec: float = 30.0, logger: Optional[logging.Logger] = None) -> bool:
    """Verifica prontidao efetiva de backend (/api/health) e frontend (/) antes de declarar sistema pronto."""
    health_url = f"{base_url.rstrip('/')}/api/health"
    root_url = f"{base_url.rstrip('/')}/"
    t0 = time.perf_counter()
    while (time.perf_counter() - t0) < timeout_sec:
        try:
            with _urlopen_direct(health_url, timeout=2.0) as h_resp:
                if h_resp.status != 200:
                    time.sleep(0.4)
                    continue
                h_data = json.loads(h_resp.read().decode("utf-8"))
                if h_data.get("status") != "healthy" or h_data.get("block_external_ai") is not True:
                    time.sleep(0.4)
                    continue
            with _urlopen_direct(root_url, timeout=2.0) as r_resp:
                if r_resp.status == 200:
                    if logger:
                        logger.info(
                            "Servicos verificados (/api/health e frontend HTTP 200) em %.2fs.",
                            time.perf_counter() - t0,
                        )
                    return True
        except Exception:
            time.sleep(0.4)
    if logger:
        logger.error("Timeout de %.1fs aguardando prontidao de backend/frontend em %s", timeout_sec, base_url)
    return False


def prepare_local_ai_runtime(logger: logging.Logger, check_only: bool = False, auto_approve: bool = False) -> None:
    """Prepares only the signed per-user Ollama runtime and configured local model on Windows."""
    if sys.platform != "win32":
        return

    powershell = shutil.which("powershell.exe")
    helper_dir = BUNDLE_DIR / "scripts" if getattr(sys, "frozen", False) else ROOT_DIR / "scripts"
    helper = helper_dir / "ollama_bootstrap.ps1"
    if not powershell or not helper.is_file():
        logger.warning("Windows Ollama bootstrap is unavailable; deterministic fallback remains enabled.")
        return

    command = [
        powershell,
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(helper),
        "-ModelName",
        config.DEFAULT_MODEL,
    ]
    if check_only:
        command.append("-CheckOnly")
    if auto_approve:
        command.append("-AutoApprove")
    try:
        result = subprocess.run(command, cwd=str(ROOT_DIR), check=False)
    except OSError as exc:
        logger.warning("Windows Ollama bootstrap could not start (%s); deterministic fallback remains enabled.", exc)
        return
    if result.returncode:
        logger.warning("Windows Ollama bootstrap exited with code %s; deterministic fallback remains enabled.", result.returncode)


def check_local_ai_runtime(logger: logging.Logger) -> bool:
    """Checks the approved local Ollama endpoint without installing resources."""
    if not config.BLOCK_EXTERNAL_AI:
        logger.error("BLOCK_EXTERNAL_AI must remain enabled; local AI is disabled.")
        return False

    from backend.security import verify_external_url_allowed

    ollama_url = config.OLLAMA_URL.rstrip("/")
    if not verify_external_url_allowed(ollama_url):
        logger.warning("Configured Ollama destination is not the approved local endpoint; using deterministic fallback.")
        return False

    try:
        import httpx

        response = httpx.get(
            f"{ollama_url}/api/tags",
            timeout=2.0,
            follow_redirects=False,
            trust_env=False,
        )
        response.raise_for_status()
        models = response.json().get("models", [])
    except Exception as exc:
        logger.warning("Local Ollama is unavailable (%s); EcoBI will use its deterministic fallback.", exc)
        return False

    available = {item.get("name") for item in models if isinstance(item, dict)}
    if config.DEFAULT_MODEL not in available:
        logger.warning("Configured local model '%s' is not installed; EcoBI will use its deterministic fallback.", config.DEFAULT_MODEL)
        return False

    logger.info("Local Ollama and configured default model '%s' are available.", config.DEFAULT_MODEL)
    return True


def main() -> None:
    """Ponto de entrada do launcher executável."""
    parser = argparse.ArgumentParser(description="Launcher Local do EcoBI Intelligence")
    parser.add_argument("--host", choices=(config.ECOBI_HOST,), default=config.ECOBI_HOST, help="Bind local fixo; somente 127.0.0.1")
    parser.add_argument("--port", type=int, choices=range(1, 65536), default=config.ECOBI_PORT, help="Porta HTTP local")
    parser.add_argument("--no-browser", action="store_true", help="Não abre automaticamente o navegador web")
    parser.add_argument("--check-only", action="store_true", help="Apenas valida o ambiente e encerra")
    parser.add_argument("--auto-approve", action="store_true", help="Autoriza instalacao do Ollama e download do modelo sem prompt interativo")
    args = parser.parse_args()
    config.ECOBI_PORT = args.port
    os.environ["ECOBI_PORT"] = str(args.port)
    config.LOCAL_ALLOWED_ORIGINS = [f"http://127.0.0.1:{args.port}", f"http://localhost:{args.port}"]

    base_dir = ROOT_DIR
    logs_dir = base_dir / "data" / "logs"
    logger = setup_launcher_logging(logs_dir)

    logger.info("=======================================================")
    logger.info(" EcoBI Intelligence — Plataforma Corporativa Local")
    logger.info(" Versão: 4.0.0 (Release Piloto Windows)")
    logger.info("=======================================================")

    logger.info("Preparando ambiente...")
    try:
        ensure_environment(base_dir, logger, initialize_database=not args.check_only)
    except (sqlite3.DatabaseError, OSError):
        sys.exit(1)

    logger.info("Preparando runtime de IA local...")
    prepare_local_ai_runtime(logger, check_only=args.check_only, auto_approve=args.auto_approve)
    logger.info("Verificando servicos locais de IA...")
    check_local_ai_runtime(logger)

    if args.check_only:
        logger.info("Modo --check-only concluído com êxito.")
        return

    server_url = f"http://{args.host}:{args.port}"
    port_state = check_port_availability(args.host, args.port, logger=logger)
    if port_state == "ecobi_running":
        if not args.no_browser:
            logger.info("Abrindo interface web existente no navegador padrao: %s", server_url)
            webbrowser.open(server_url)
        logger.info("Aplicacao ja esta pronta em %s (nenhum processo duplicado iniciado).", server_url)
        return
    if port_state == "occupied":
        sys.exit(1)

    import uvicorn
    from backend.main import app

    logger.info("Iniciando aplicacao em %s...", server_url)

    # Configuração do servidor Uvicorn em processo controlado
    uvicorn_config = uvicorn.Config(
        app=app,
        host=args.host,
        port=args.port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(uvicorn_config)

    # Tratamento de interrupção graciosa
    def handle_sigint(_sig, _frame):
        logger.info("Recebido sinal de encerramento. Finalizando EcoBI graciosamente...")
        server.should_exit = True

    signal.signal(signal.SIGINT, handle_sigint)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_sigint)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, handle_sigint)

    import threading

    def _verify_readiness_and_open_browser():
        logger.info("Verificando servicos (readiness)...")
        if wait_for_readiness(server_url, timeout_sec=30.0, logger=logger):
            logger.info("Aplicacao pronta em %s", server_url)
            if not args.no_browser:
                logger.info("Abrindo interface web no navegador padrão: %s", server_url)
                webbrowser.open(server_url)

    t = threading.Thread(target=_verify_readiness_and_open_browser, daemon=True)
    t.start()

    logger.info("EcoBI em execução. Pressione Ctrl+C na janela para encerrar com segurança.")
    try:
        server.run()
    except Exception as exc:
        logger.error("Erro inesperado durante a execução do servidor: %s", exc)
        sys.exit(1)
    finally:
        logger.info("Servidor encerrado. Banco de dados e logs sincronizados.")


if __name__ == "__main__":
    main()
