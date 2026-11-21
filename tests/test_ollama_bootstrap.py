from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import textwrap

import pytest


POWERSHELL = shutil.which("powershell.exe") or shutil.which("powershell")
pytestmark = pytest.mark.skipif(POWERSHELL is None, reason="Windows PowerShell is unavailable")
HELPER = Path(__file__).resolve().parents[1] / "scripts" / "ollama_bootstrap.ps1"


def run_bootstrap(tmp_path: Path, scenario: str) -> dict:
    helper_path = str(HELPER).replace("'", "''")
    install_path = str(tmp_path / "Programs" / "Ollama").replace("'", "''")
    temp_path = str(tmp_path / "temp").replace("'", "''")
    harness = textwrap.dedent(
        f"""
        . '{helper_path}' -DefineOnly
        $script:state = [ordered]@{{
            Installed = $false
            Model = $false
            ServerReady = $false
            Signature = $true
            DownloadCount = 0
            VerifyCount = 0
            InstallCount = 0
            PullCount = 0
            StartCount = 0
            CheckApiCount = 0
            HostTargets = @()
            LastInstallPath = ''
            ConfirmCount = 0
            CliCount = 0
            ListenerAddresses = @()
            FreeSpaceBytes = 50GB
        }}
        $resolve = {{ param($path) if ($script:state.Installed) {{ return (Join-Path $path 'ollama.exe') }}; return $null }}
        $freeSpace = {{ param($path) return $script:state.FreeSpaceBytes }}
        $download = {{
            param($uri, $destination)
            $script:state.DownloadCount++
            [IO.Directory]::CreateDirectory((Split-Path $destination)) | Out-Null
            if ('{scenario}' -eq 'empty-installer') {{ [IO.File]::WriteAllText($destination, '') }}
            elseif ('{scenario}' -eq 'download-fails') {{ throw 'Network connection reset' }}
            else {{ [IO.File]::WriteAllText($destination, 'signed-installer') }}
        }}
        $verify = {{ param($path) $script:state.VerifyCount++; return $script:state.Signature }}
        $install = {{ param($path, $directory) $script:state.InstallCount++; if ('{scenario}' -eq 'install-fails') {{ return 5 }}; $script:state.Installed = $true; $script:state.LastInstallPath = $directory; [IO.Directory]::CreateDirectory($directory) | Out-Null; [IO.File]::WriteAllText((Join-Path $directory 'ollama.exe'), 'mock executable'); return 0 }}
        $getListeners = {{ return @($script:state.ListenerAddresses) }}
        $cli = {{
            param($executable, [string[]]$arguments)
            $script:state.CliCount++
            $script:state.HostTargets += $env:OLLAMA_HOST
            if ($arguments[0] -eq 'list') {{
                if (-not $script:state.ServerReady) {{ return @{{ ExitCode = 1; Output = 'service unavailable' }} }}
                $output = "NAME ID SIZE MODIFIED`n"
                if ($script:state.Model) {{ $output += "qwen3.5:4b abc 1 GB now`n" }}
                return @{{ ExitCode = 0; Output = $output }}
            }}
            if ($arguments[0] -eq 'pull') {{
                $script:state.PullCount++
                if ('{scenario}' -notin @('pull-fails', 'api-missing-model')) {{ $script:state.Model = $true; return @{{ ExitCode = 0; Output = 'pulled' }} }}
                if ('{scenario}' -eq 'api-missing-model') {{ return @{{ ExitCode = 0; Output = 'pulled' }} }}
                return @{{ ExitCode = 1; Output = 'download failed' }}
            }}
            return @{{ ExitCode = 1; Output = 'unsupported' }}
        }}
        $checkApi = {{
            $script:state.CheckApiCount++
            if ('{scenario}' -eq 'api-probe-fails') {{ throw 'API 11434 unreachable' }}
            if (-not $script:state.ServerReady) {{ throw 'API not ready' }}
            if ('{scenario}' -eq 'api-missing-model') {{ return @() }}
            if ($script:state.Model) {{ return @('qwen3.5:4b') }}
            return @()
        }}
        $start = {{
            param($executable)
            $script:state.StartCount++
            if ('{scenario}' -ne 'server-never-starts') {{
                $script:state.ServerReady = $true
                $script:state.ListenerAddresses = @('127.0.0.1')
            }}
        }}
        $sleep = {{ }}
        $confirm = {{ param($message) $script:state.ConfirmCount++; return ('{scenario}' -notin @('decline-install', 'decline-model')) }}
        if ('{scenario}' -in @('installed', 'untrusted-installed', 'external-listener', 'private-listener', 'api-probe-fails')) {{ $script:state.Installed = $true; $script:state.Model = $true; $script:state.ServerReady = $true; $script:state.ListenerAddresses = @('127.0.0.1') }}
        if ('{scenario}' -eq 'external-listener') {{ $script:state.ListenerAddresses = @('0.0.0.0') }}
        if ('{scenario}' -eq 'private-listener') {{ $script:state.ListenerAddresses = @('192.168.1.25') }}
        if ('{scenario}' -eq 'inspection-fails') {{ $getListeners = {{ throw 'Listener inspection unavailable' }} }}
        if ('{scenario}' -eq 'decline-model') {{ $script:state.Installed = $true; $script:state.ServerReady = $true }}
        if ('{scenario}' -eq 'untrusted-installed') {{ $script:state.Signature = $false }}
        if ('{scenario}' -eq 'missing-model-check') {{ $script:state.Installed = $true; $script:state.ServerReady = $true }}
        if ('{scenario}' -eq 'signature-fails') {{ $script:state.Signature = $false }}
        if ('{scenario}' -eq 'pull-fails') {{ $script:state.ServerReady = $true }}
        if ('{scenario}' -eq 'low-disk-install') {{ $script:state.FreeSpaceBytes = 2GB }}
        if ('{scenario}' -eq 'low-disk-model') {{ $script:state.Installed = $true; $script:state.ServerReady = $true; $script:state.FreeSpaceBytes = 2GB }}
        if ('{scenario}' -eq 'api-missing-model') {{ $script:state.Installed = $true; $script:state.ServerReady = $true }}
        $originalHost = 'preexisting-user-value'
        $env:OLLAMA_HOST = $originalHost
        $params = @{{
            ModelName = 'qwen3.5:4b'
            InstallDirectory = '{install_path}'
            TempDirectory = '{temp_path}'
            ResolveExecutable = $resolve
            GetFreeSpaceBytes = $freeSpace
            DownloadInstaller = $download
            VerifySignature = $verify
            InstallAction = $install
            GetListenerAddresses = $getListeners
            RunCli = $cli
            CheckApi = $checkApi
            StartServer = $start
            Sleep = $sleep
            ConfirmSetup = $confirm
        }}
        if ('{scenario}' -in @('missing-model-check', 'absent-check')) {{ $params.CheckOnly = $true }}
        if ('{scenario}' -eq 'auto-approve') {{ $params.AutoApprove = $true }}
        if ('{scenario}' -eq 'invalid-model') {{ $params.ModelName = '../remote' }}
        $ready = Initialize-EcoBIOllama @params
        $restoredHost = $env:OLLAMA_HOST
        $installerExists = Test-Path -LiteralPath (Join-Path '{temp_path}' 'OllamaSetup.exe')
        @{{ Ready = [bool]$ready; State = $script:state; RestoredHost = $restoredHost; InstallerExists = $installerExists }} | ConvertTo-Json -Compress -Depth 5 | Write-Output
        """
    ).strip()
    tmp_path.mkdir(parents=True, exist_ok=True)
    harness_path = tmp_path / "bootstrap-test.ps1"
    harness_path.write_text(harness, encoding="utf-8")
    environment = os.environ.copy()
    environment["TEMP"] = str(tmp_path)
    environment["TMP"] = str(tmp_path)
    environment["LOCALAPPDATA"] = str(tmp_path / "local-app-data")
    result = subprocess.run(
        [POWERSHELL, "-NoLogo", "-NoProfile", "-File", str(harness_path)],
        capture_output=True,
        text=True,
        env=environment,
        timeout=20,
        check=False,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    output_lines = [line for line in result.stdout.splitlines() if line.strip().startswith("{")]
    assert output_lines, result.stdout + result.stderr
    return json.loads(output_lines[-1])


def test_installed_local_model_is_reused_without_download_or_pull(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "installed")
    assert result["Ready"] is True
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0
    assert result["State"]["CheckApiCount"] == 1
    assert result["RestoredHost"] == "preexisting-user-value"
    assert set(result["State"]["HostTargets"]) == {"127.0.0.1:11434"}


def test_missing_ollama_is_signed_installed_locally_and_pulls_only_default_model(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "install-and-pull")
    assert result["Ready"] is True
    assert result["State"]["DownloadCount"] == 1
    assert result["State"]["VerifyCount"] == 2
    assert result["State"]["InstallCount"] == 1
    assert result["State"]["PullCount"] == 1
    assert result["State"]["StartCount"] == 1
    assert result["State"]["CheckApiCount"] == 1
    assert result["State"]["LastInstallPath"].endswith("Programs\\Ollama")
    assert result["InstallerExists"] is False
    assert set(result["State"]["HostTargets"]) == {"127.0.0.1:11434"}
    assert result["RestoredHost"] == "preexisting-user-value"


def test_invalid_signature_falls_back_without_running_installer(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "signature-fails")
    assert result["Ready"] is False
    assert result["State"]["DownloadCount"] == 1
    assert result["State"]["VerifyCount"] == 1
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0
    assert result["InstallerExists"] is False


def test_check_only_never_installs_or_pulls_a_missing_model(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "missing-model-check")
    assert result["Ready"] is False
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0
    assert result["State"]["StartCount"] == 0


def test_model_pull_failure_keeps_fallback_and_restores_environment(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "pull-fails")
    assert result["Ready"] is False
    assert result["State"]["PullCount"] == 1
    assert result["RestoredHost"] == "preexisting-user-value"
    assert set(result["State"]["HostTargets"]) == {"127.0.0.1:11434"}


def test_untrusted_model_name_is_rejected_before_any_side_effect(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "invalid-model")
    assert result["Ready"] is False
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["VerifyCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0


def test_untrusted_existing_ollama_is_not_executed_or_replaced(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "untrusted-installed")
    assert result["Ready"] is False
    assert result["State"]["VerifyCount"] == 1
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0
    assert result["State"]["HostTargets"] == []


def test_source_launcher_invokes_shared_bootstrap_with_configured_model(monkeypatch, tmp_path: Path) -> None:
    from scripts import ecobi_launcher
    from unittest.mock import Mock

    helper = tmp_path / "scripts" / "ollama_bootstrap.ps1"
    helper.parent.mkdir()
    helper.touch()
    monkeypatch.setattr(ecobi_launcher.sys, "platform", "win32")
    monkeypatch.setattr(ecobi_launcher.sys, "frozen", False, raising=False)
    monkeypatch.setattr(ecobi_launcher, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(ecobi_launcher.shutil, "which", lambda name: "powershell.exe")
    run = Mock(return_value=subprocess.CompletedProcess([], 0))
    monkeypatch.setattr(ecobi_launcher.subprocess, "run", run)

    ecobi_launcher.prepare_local_ai_runtime(Mock(), check_only=True)

    command = run.call_args.args[0]
    assert command[:7] == ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(helper)]
    assert "-ModelName" in command
    assert ecobi_launcher.config.DEFAULT_MODEL in command
    assert command[-1] == "-CheckOnly"
    assert run.call_args.kwargs["cwd"] == str(tmp_path)


def test_packaged_launcher_resolves_bundled_bootstrap_asset(monkeypatch, tmp_path: Path) -> None:
    from scripts import ecobi_launcher
    from unittest.mock import Mock

    bundle = tmp_path / "_MEIPASS"
    helper = bundle / "scripts" / "ollama_bootstrap.ps1"
    helper.parent.mkdir(parents=True)
    helper.touch()
    monkeypatch.setattr(ecobi_launcher.sys, "platform", "win32")
    monkeypatch.setattr(ecobi_launcher.sys, "frozen", True, raising=False)
    monkeypatch.setattr(ecobi_launcher, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(ecobi_launcher, "BUNDLE_DIR", bundle)
    monkeypatch.setattr(ecobi_launcher.shutil, "which", lambda name: "powershell.exe")
    run = Mock(return_value=subprocess.CompletedProcess([], 0))
    monkeypatch.setattr(ecobi_launcher.subprocess, "run", run)

    ecobi_launcher.prepare_local_ai_runtime(Mock())

    assert str(helper) in run.call_args.args[0]
    assert "-CheckOnly" not in run.call_args.args[0]


def test_installer_failure_keeps_local_fallback_and_cleans_download(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "install-fails")
    assert result["Ready"] is False
    assert result["State"]["DownloadCount"] == 1
    assert result["State"]["VerifyCount"] == 1
    assert result["State"]["InstallCount"] == 1
    assert result["State"]["PullCount"] == 0
    assert result["InstallerExists"] is False


def test_declining_first_run_setup_performs_no_download_or_install(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "decline-install")
    assert result["Ready"] is False
    assert result["State"]["ConfirmCount"] == 1
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0


def test_declining_missing_model_download_keeps_install_and_uses_fallback(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "decline-model")
    assert result["Ready"] is False
    assert result["State"]["ConfirmCount"] == 1
    assert result["State"]["DownloadCount"] == 0
    assert result["State"]["InstallCount"] == 0
    assert result["State"]["PullCount"] == 0


def test_existing_wildcard_ollama_listener_is_rejected_before_cli_use(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "external-listener")
    assert result["Ready"] is False
    assert result["State"]["CliCount"] == 0
    assert result["State"]["HostTargets"] == []


def test_unverifiable_or_private_ollama_listener_uses_fallback(tmp_path: Path) -> None:
    external = run_bootstrap(tmp_path, "private-listener")
    unverifiable = run_bootstrap(tmp_path, "inspection-fails")
    assert external["Ready"] is False
    assert external["State"]["CliCount"] == 0
    assert unverifiable["Ready"] is False
    assert unverifiable["State"]["CliCount"] == 0


def test_empty_installer_and_download_error_are_rejected_cleanly(tmp_path: Path) -> None:
    empty = run_bootstrap(tmp_path, "empty-installer")
    net_err = run_bootstrap(tmp_path, "download-fails")
    assert empty["Ready"] is False
    assert empty["State"]["InstallCount"] == 0
    assert empty["InstallerExists"] is False
    assert net_err["Ready"] is False
    assert net_err["State"]["InstallCount"] == 0
    assert net_err["InstallerExists"] is False


def test_low_disk_space_blocks_install_or_pull_cleanly(tmp_path: Path) -> None:
    low_install = run_bootstrap(tmp_path / "inst", "low-disk-install")
    low_model = run_bootstrap(tmp_path / "mdl", "low-disk-model")
    assert low_install["Ready"] is False
    assert low_install["State"]["DownloadCount"] == 0
    assert low_model["Ready"] is False
    assert low_model["State"]["PullCount"] == 0


def test_http_api_probe_failure_or_missing_model_in_api_falls_back(tmp_path: Path) -> None:
    probe_fail = run_bootstrap(tmp_path / "probe", "api-probe-fails")
    missing_api = run_bootstrap(tmp_path / "missing", "api-missing-model")
    assert probe_fail["Ready"] is False
    assert probe_fail["State"]["CheckApiCount"] == 1
    assert missing_api["Ready"] is False


def test_auto_approve_skips_prompts_and_completes_install_and_pull(tmp_path: Path) -> None:
    result = run_bootstrap(tmp_path, "auto-approve")
    assert result["Ready"] is True
    assert result["State"]["ConfirmCount"] == 0
    assert result["State"]["InstallCount"] == 1
    assert result["State"]["PullCount"] == 1


def test_default_listener_filter_allows_absent_port_without_error(tmp_path: Path) -> None:
    helper_path = str(HELPER).replace("'", "''")
    script = textwrap.dedent(
        f"""
        . '{helper_path}' -DefineOnly
        $absent = Test-EcoBILoopbackListenerAddresses -GetListenerAddresses {{
            Get-NetTCPConnection -State Listen -ErrorAction Stop |
                Where-Object {{ $_.LocalPort -eq 59999 }} |
                Select-Object -ExpandProperty LocalAddress
        }}
        Write-Output "ABSENT_OK=$absent"
        """
    ).strip()
    p = tmp_path / "listener-probe.ps1"
    p.write_text(script, encoding="utf-8")
    res = subprocess.run(
        [POWERSHELL, "-NoLogo", "-NoProfile", "-File", str(p)],
        capture_output=True,
        text=True,
        timeout=15,
        check=False,
    )
    assert res.returncode == 0, res.stderr + res.stdout
    assert "ABSENT_OK=True" in res.stdout
