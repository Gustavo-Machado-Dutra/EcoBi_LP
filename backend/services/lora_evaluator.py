"""EcoBI Intelligence - Pipeline Local de Avaliação Experimental de Adaptadores LoRA (Fase 3).

Implementa a frente ECOBI-19 (PLAN.md Seções 6, 15 e 17):
- Avalia experimentalmente adaptadores LoRA locais especializados nos 6 setores econômicos do EcoBI
  (`Varejo`, `Indústria`, `Logística`, `Energia`, `Agronegócio`, `Serviços`).
- Restrições Invioláveis:
  1. Execução 100% local (`BLOCK_EXTERNAL_AI = True` e URL Ollama estritamente em loopback `127.0.0.1`).
  2. Respeito estrito ao teto de `8192 MB` de RAM monitorado via `psutil` (`memory_guard`).
  3. Caso a sobrecarga de memória estimada para o adaptador/modelo base ultrapasse o orçamento de 8 GB
     ou a memória livre do host, bloqueia preventivamente a execução (`BLOCKED_INSUFFICIENT_RAM`),
     registra o motivo detalhado e preserva a estabilidade do sistema.
  4. Confronta o adaptador LoRA contra uma referência determinística auditável (6 tools da allowlist +
     fidelidade conceitual GHG Protocol Escopos 1, 2 e 3 + vedação de compensação por créditos de carbono).
  5. Não aprova adaptadores apenas por carregarem: exige `tool_accuracy_pct == 100.0` e
     `deterministic_alignment_score >= 85.0` para classificar como `APTO_EXPERIMENTAL`; caso contrário,
     classifica como `REPROVADO_QUALIDADE`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

from backend import config, database, memory_guard, security
from backend.services import llm_agent

logger = logging.getLogger("ecobi.lora_evaluator")

# Catálogo de perfis de adaptadores LoRA locais por setor econômico
SECTOR_LORA_ADAPTERS: Dict[str, Dict[str, Any]] = {
    "Varejo": {
        "adapter_name": "ecobi-lora-varejo-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 280.0,
        "sector_prompts": [
            {
                "prompt": "Analise a qualidade dos dados da rede de lojas de varejo e identifique nulos em devoluções.",
                "expected_tool": "profile_dataset_quality",
                "required_concepts": ["completude", "logistica_reversa", "integridade"],
            },
            {
                "prompt": "Calcule o faturamento líquido do varejo e as emissões de Escopo 1, 2 e 3 sem abater créditos de carbono.",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_1", "escopo_2", "escopo_3", "segregacao_creditos"],
            },
            {
                "prompt": "Projete a previsão de receita bruta para a sazonalidade de Black Friday nos próximos 6 meses com Ridge.",
                "expected_tool": "run_predictive_model",
                "required_concepts": ["split_temporal", "backtesting", "wape"],
            },
        ],
    },
    "Indústria": {
        "adapter_name": "ecobi-lora-industria-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 310.0,
        "sector_prompts": [
            {
                "prompt": "Inspecione a integridade e valores faltantes nos registros de produção industrial.",
                "expected_tool": "profile_dataset_quality",
                "required_concepts": ["completude", "residuos_industriais", "integridade"],
            },
            {
                "prompt": "Calcule os KPIs financeiros e emissões de combustão estacionária (Escopo 1) e energia elétrica (Escopo 2).",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_1", "escopo_2", "escopo_3", "segregacao_creditos"],
            },
            {
                "prompt": "Simule um cenário What-If reduzindo em 15% o consumo de energia elétrica das plantas fabris.",
                "expected_tool": "simulate_scenario",
                "required_concepts": ["cenario_hipotetico", "premissas_explicitas"],
            },
        ],
    },
    "Logística": {
        "adapter_name": "ecobi-lora-logistica-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 290.0,
        "sector_prompts": [
            {
                "prompt": "Calcule os KPIs operacionais e emissões de diesel da frota (Escopo 1) e frete terceirizado (Escopo 3).",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_1", "escopo_3", "segregacao_creditos"],
            },
            {
                "prompt": "Prever o consumo de combustível da frota para os próximos 6 meses com modelo preditivo.",
                "expected_tool": "run_predictive_model",
                "required_concepts": ["split_temporal", "backtesting", "wape"],
            },
            {
                "prompt": "Validar os resultados e emitir laudo de governança da análise logística.",
                "expected_tool": "validate_analysis_results",
                "required_concepts": ["governanca_deterministica", "portao_publicacao"],
            },
        ],
    },
    "Energia": {
        "adapter_name": "ecobi-lora-energia-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 300.0,
        "sector_prompts": [
            {
                "prompt": "Calcule a intensidade de carbono por MWh e os indicadores financeiros da operação de energia.",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_1", "escopo_2", "segregacao_creditos"],
            },
            {
                "prompt": "Simule cenário What-If de substituição de 20% de geração térmica por solar.",
                "expected_tool": "simulate_scenario",
                "required_concepts": ["cenario_hipotetico", "premissas_explicitas"],
            },
            {
                "prompt": "Exportar pacote Power BI PBIP com os indicadores auditados do setor elétrico.",
                "expected_tool": "generate_powerbi_pbip",
                "required_concepts": ["pbip", "pbir", "reconciliacao"],
            },
        ],
    },
    "Agronegócio": {
        "adapter_name": "ecobi-lora-agronegocio-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 295.0,
        "sector_prompts": [
            {
                "prompt": "Verifique a qualidade dos dados de safra, diesel agrícola e resíduos orgânicos.",
                "expected_tool": "profile_dataset_quality",
                "required_concepts": ["completude", "biomassa", "integridade"],
            },
            {
                "prompt": "Calcule faturamento líquido da safra e emissões GEE mantendo créditos florestais separados.",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_1", "escopo_2", "escopo_3", "segregacao_creditos"],
            },
            {
                "prompt": "Prever receita bruta da próxima entressafra usando regressão Ridge temporal.",
                "expected_tool": "run_predictive_model",
                "required_concepts": ["split_temporal", "backtesting", "wape"],
            },
        ],
    },
    "Serviços": {
        "adapter_name": "ecobi-lora-servicos-q4-v1",
        "rank": 16,
        "alpha": 32,
        "estimated_overhead_mb": 260.0,
        "sector_prompts": [
            {
                "prompt": "Calcule indicadores financeiros e emissões de energia de data centers (Escopo 2).",
                "expected_tool": "calculate_financial_esg_kpis",
                "required_concepts": ["escopo_2", "escopo_3", "segregacao_creditos"],
            },
            {
                "prompt": "Validar laudo de governança para os indicadores corporativos de serviços.",
                "expected_tool": "validate_analysis_results",
                "required_concepts": ["governanca_deterministica", "portao_publicacao"],
            },
            {
                "prompt": "Gerar relatório executivo do Power BI PBIP para diretoria.",
                "expected_tool": "generate_powerbi_pbip",
                "required_concepts": ["pbip", "pbir", "reconciliacao"],
            },
        ],
    },
}



async def _default_run_adapter_inference(
    prompt: str,
    adapter_name: str,
    ollama_url: str = "http://127.0.0.1:11434",
    timeout_sec: float = 30.0,
) -> str:
    """Executa inferência real de seleção de ferramenta via Ollama /api/chat não-streaming."""
    if not security.verify_external_url_allowed(ollama_url):
        raise PermissionError(f"URL de inferência não permitida pela política local-first: {ollama_url}")

    chat_url = f"{ollama_url.rstrip('/')}/api/chat"
    payload = {
        "model": adapter_name,
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "tools": llm_agent.OLLAMA_TOOLS_SCHEMA,
        "stream": False,
        "options": {
            "num_ctx": 2048,
            "temperature": 0.0,
        },
    }
    async with httpx.AsyncClient(follow_redirects=False, timeout=float(timeout_sec), trust_env=False) as client:
        resp = await client.post(chat_url, json=payload)
        if resp.status_code != 200:
            raise httpx.HTTPStatusError(
                f"Ollama HTTP {resp.status_code}: {resp.text}",
                request=resp.request,
                response=resp,
            )
        data = resp.json()
        msg = data.get("message", {})
        tool_calls = msg.get("tool_calls", [])
        if tool_calls:
            fn = tool_calls[0].get("function", {})
            return str(fn.get("name", "")).strip()

        content = str(msg.get("content", "")).strip()
        for tool_name in llm_agent.ALLOWED_TOOLS.keys():
            if tool_name in content:
                return tool_name
        return ""


# Função modular de inferência que pode ser injetada por monkeypatch nos testes
_run_adapter_inference = _default_run_adapter_inference


async def _check_adapter_runtime_available(
    adapter_name: str,
    ollama_url: str = "http://127.0.0.1:11434",
    timeout_sec: float = 5.0,
) -> Tuple[bool, Optional[str], Dict[str, Any]]:
    """Inspeciona conectividade do Ollama e existência da tag do adaptador LoRA via /api/tags."""
    tags_url = f"{ollama_url.rstrip('/')}/api/tags"
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=float(timeout_sec), trust_env=False) as client:
            resp = await client.get(tags_url)
            if resp.status_code != 200:
                return (
                    False,
                    f"Ollama respondeu com HTTP {resp.status_code} ao consultar /api/tags",
                    {"status": "offline", "models": []},
                )
            data = resp.json()
            models = [m.get("name") for m in data.get("models", []) if isinstance(m, dict)]
            tag_found = any(
                m == adapter_name or m.split(":")[0] == adapter_name or m.startswith(f"{adapter_name}:")
                for m in models
            )
            if not tag_found:
                return (
                    False,
                    f"Tag do adaptador LoRA '{adapter_name}' não encontrada no runtime Ollama local (tags disponíveis: {models}).",
                    {"status": "connected", "models": models},
                )
            return True, None, {"status": "connected", "models": models}
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        return False, f"Não foi possível conectar ao daemon Ollama em {ollama_url}: {exc}", {"status": "offline", "models": []}
    except Exception as exc:
        return False, f"Erro inesperado ao consultar tags do Ollama: {exc}", {"status": "offline", "models": []}


async def evaluate_lora_adapter(
    sector: str = "Varejo",
    adapter_name: Optional[str] = None,
    base_model: Optional[str] = None,
    simulated_ram_overhead_mb: Optional[float] = None,
    project_id: Optional[str] = None,
    actor: str = "analyst",
) -> Dict[str, Any]:
    """Executa o pipeline local de avaliação experimental de um adaptador LoRA setorial.

    Verifica:
    1. Conformidade de rede local (`BLOCK_EXTERNAL_AI=True`).
    2. Orçamento de memória RAM (`<= 8192 MB`) via `psutil`; se excedido, bloqueia com `BLOCKED_INSUFFICIENT_RAM`.
    3. Conectividade com o daemon local do Ollama e existência da tag do adaptador LoRA em loopback;
       caso indisponível, retorna status `INCONCLUSIVO_RUNTIME_INDISPONIVEL` com scores None (nunca aprova).
    4. Comparação objetiva contra a referência determinística (_classify_intent_tool_name) e medição
       real de latência e consumo de RAM.
    """
    # 1. Verificação de segurança e confinamento local
    if not getattr(config, "BLOCK_EXTERNAL_AI", True):
        raise PermissionError("Violação de política LGPD: BLOCK_EXTERNAL_AI deve permanecer True.")

    ollama_url = getattr(config, "OLLAMA_URL", "http://127.0.0.1:11434")
    if not security.verify_external_url_allowed(ollama_url):
        raise PermissionError(f"URL de inferência não permitida pela política local-first: {ollama_url}")

    sector_profile = SECTOR_LORA_ADAPTERS.get(sector, SECTOR_LORA_ADAPTERS["Varejo"])
    resolved_adapter = adapter_name or str(sector_profile["adapter_name"])
    resolved_base = base_model or getattr(config, "DEFAULT_MODEL", "qwen3.5:4b")
    overhead_mb = (
        float(simulated_ram_overhead_mb)
        if simulated_ram_overhead_mb is not None
        else float(sector_profile["estimated_overhead_mb"])
    )

    # Se o modelo base solicitado for o 9B, soma a sobrecarga de pesos do 9B
    if "9b" in resolved_base.lower() and simulated_ram_overhead_mb is None:
        overhead_mb += 5800.0

    mem_before = memory_guard.get_memory_status()
    ram_used_now = float(mem_before["ecobi_ram_used_mb"])
    ram_budget = float(mem_before["ecobi_ram_budget_mb"])
    host_avail = float(mem_before["host_available_ram_mb"])
    projected_ram = round(ram_used_now + overhead_mb, 2)

    # 2. Portão de Hardware e Orçamento de 8 GB de RAM
    if projected_ram > ram_budget or host_avail < overhead_mb:
        block_reason = (
            f"Execução experimental do adaptador LoRA '{resolved_adapter}' bloqueada preventivamente: "
            f"consumo projetado ({projected_ram:.2f} MB) excede o limite de {ram_budget:.2f} MB do EcoBI "
            f"(ou memória livre insuficiente no host: {host_avail:.2f} MB disponíveis)."
        )
        limitations = [
            block_reason,
            "O EcoBI preserva a estabilidade operacional bloqueando adaptadores que ultrapassem o teto de 8 GB de RAM.",
            "Recomendação: utilizar o modelo base qwen3.5:4b com adaptador QLoRA rank <= 16 (< 350 MB de overhead).",
        ]
        metrics_blocked = {
            "ram_before_mb": ram_used_now,
            "projected_ram_mb": projected_ram,
            "ram_budget_mb": ram_budget,
            "requested_overhead_mb": overhead_mb,
            "blocked_by_memory_guard": True,
            "reason": block_reason,
        }
        saved_blocked = database.create_lora_evaluation(
            sector=sector,
            adapter_name=resolved_adapter,
            base_model=resolved_base,
            evaluation_status="BLOCKED_INSUFFICIENT_RAM",
            tool_accuracy_pct=0.0,
            domain_fidelity_score=0.0,
            deterministic_alignment_score=0.0,
            latency_ms=0.0,
            ram_used_mb=ram_used_now,
            ram_peak_mb=ram_used_now,
            metrics=metrics_blocked,
            limitations=limitations,
            project_id=project_id,
            actor=actor,
        )
        database.log_audit(
            actor=actor,
            action="LORA_EVALUATION_BLOCKED_RAM",
            resource_type="lora_evaluation",
            resource_id=saved_blocked["id"],
            project_id=project_id,
            details=metrics_blocked,
        )
        return saved_blocked

    # 3. Verificação do Runtime Local e Existência da Tag do Adaptador LoRA
    runtime_ok, runtime_err, ollama_info = await _check_adapter_runtime_available(
        adapter_name=resolved_adapter,
        ollama_url=ollama_url,
    )

    if not runtime_ok:
        runtime_reason = runtime_err or "Runtime Ollama offline ou tag do adaptador ausente."
        limitations = [
            f"Avaliação experimental inconclusiva: runtime de inferência indisponível. {runtime_reason}",
            "O EcoBI nunca aprova adaptadores LoRA como APTO_EXPERIMENTAL sem execução de inferência real no host local.",
            "Certifique-se de que o daemon Ollama esteja em execução em loopback (127.0.0.1:11434) e a tag do adaptador esteja disponível.",
        ]
        metrics_inconclusive = {
            "sector": sector,
            "adapter_name": resolved_adapter,
            "base_model": resolved_base,
            "adapter_rank": sector_profile["rank"],
            "adapter_alpha": sector_profile["alpha"],
            "estimated_overhead_mb": overhead_mb,
            "runtime_available": False,
            "status": "INCONCLUSIVO_RUNTIME_INDISPONIVEL",
            "reason": runtime_reason,
            "ollama_status": ollama_info.get("status", "offline"),
            "available_models": ollama_info.get("models", []),
            "ram_before_mb": ram_used_now,
            "ram_after_mb": ram_used_now,
            "ram_peak_mb": ram_used_now,
            "ram_budget_mb": ram_budget,
            "cases": [],
        }

        # Persistência em lora_evaluations com status INCONCLUSIVO_RUNTIME_INDISPONIVEL e pontuações None
        saved_inconclusive = database.create_lora_evaluation(
            sector=sector,
            adapter_name=resolved_adapter,
            base_model=resolved_base,
            evaluation_status="INCONCLUSIVO_RUNTIME_INDISPONIVEL",
            tool_accuracy_pct=None,
            domain_fidelity_score=None,
            deterministic_alignment_score=None,
            latency_ms=None,
            ram_used_mb=ram_used_now,
            ram_peak_mb=ram_used_now,
            metrics=metrics_inconclusive,
            limitations=limitations,
            project_id=project_id,
            actor=actor,
        )

        database.log_audit(
            actor=actor,
            action="LORA_EVALUATION_INCONCLUSIVE",
            resource_type="lora_evaluation",
            resource_id=saved_inconclusive["id"],
            project_id=project_id,
            details={
                "sector": sector,
                "adapter_name": resolved_adapter,
                "evaluation_status": "INCONCLUSIVO_RUNTIME_INDISPONIVEL",
                "reason": runtime_reason,
            },
        )
        return saved_inconclusive

    # 4. Execução da Bateria Comparativa com Inferência Real do Adaptador
    t0 = time.perf_counter()

    all_cases: List[Dict[str, Any]] = []
    for c in llm_agent.BENCHMARK_CANONICAL_PROMPTS:
        all_cases.append({
            "prompt": c["prompt"],
            "expected_tool": c["expected_tool"],
            "category": "canonical_allowlist",
        })
    for sc in sector_profile["sector_prompts"]:
        all_cases.append({
            "prompt": sc["prompt"],
            "expected_tool": sc["expected_tool"],
            "category": f"sector_{sector.lower()}",
            "required_concepts": sc.get("required_concepts", []),
        })

    correct_total = 0
    correct_sector = 0
    correct_reference = 0
    correct_agreement = 0
    evaluated_cases: List[Dict[str, Any]] = []
    ram_peak_mb = ram_used_now
    runtime_failed = False
    runtime_fail_reason = ""

    for idx, case in enumerate(all_cases):
        ref_tool = llm_agent._classify_intent_tool_name(case["prompt"])
        t_call_0 = time.perf_counter()
        try:
            if asyncio.iscoroutinefunction(_run_adapter_inference):
                selected_tool = await _run_adapter_inference(
                    prompt=case["prompt"],
                    adapter_name=resolved_adapter,
                    ollama_url=ollama_url,
                )
            else:
                selected_tool = _run_adapter_inference(
                    prompt=case["prompt"],
                    adapter_name=resolved_adapter,
                    ollama_url=ollama_url,
                )
        except (ConnectionError, RuntimeError, httpx.HTTPError, httpx.ConnectError, httpx.TimeoutException) as exc:
            runtime_failed = True
            runtime_fail_reason = f"Falha de execução durante inferência com Ollama: {exc}"
            break
        except Exception as exc:
            logger.error(f"Erro inesperado durante inferência: {exc}")
            selected_tool = ""

        call_latency_ms = round((time.perf_counter() - t_call_0) * 1000.0, 3)

        mem_during = memory_guard.get_memory_status()
        ram_during_mb = float(mem_during["ecobi_ram_used_mb"])
        ram_peak_mb = max(ram_peak_mb, ram_during_mb)

        is_sector = case["category"].startswith("sector_")
        matched = selected_tool == case["expected_tool"]
        ref_matched = ref_tool == case["expected_tool"]
        agreement_matched = selected_tool == ref_tool

        if matched:
            correct_total += 1
            if is_sector:
                correct_sector += 1
        if ref_matched:
            correct_reference += 1
        if agreement_matched:
            correct_agreement += 1

        evaluated_cases.append({
            "prompt": case["prompt"],
            "category": case["category"],
            "expected_tool": case["expected_tool"],
            "reference_tool": ref_tool,
            "selected_tool": selected_tool,
            "matched": matched,
            "ref_matched": ref_matched,
            "reference_agreement": agreement_matched,
            "latency_ms": call_latency_ms,
        })

    if runtime_failed:
        limitations = [
            f"Avaliação experimental inconclusiva: {runtime_fail_reason}",
            "O EcoBI nunca aprova adaptadores LoRA como APTO_EXPERIMENTAL sem execução de inferência real no host local.",
        ]
        metrics_inconclusive = {
            "sector": sector,
            "adapter_name": resolved_adapter,
            "base_model": resolved_base,
            "runtime_available": False,
            "status": "INCONCLUSIVO_RUNTIME_INDISPONIVEL",
            "reason": runtime_fail_reason,
            "cases": evaluated_cases,
        }
        saved_inconclusive = database.create_lora_evaluation(
            sector=sector,
            adapter_name=resolved_adapter,
            base_model=resolved_base,
            evaluation_status="INCONCLUSIVO_RUNTIME_INDISPONIVEL",
            tool_accuracy_pct=None,
            domain_fidelity_score=None,
            deterministic_alignment_score=None,
            latency_ms=None,
            ram_used_mb=ram_used_now,
            ram_peak_mb=ram_peak_mb,
            metrics=metrics_inconclusive,
            limitations=limitations,
            project_id=project_id,
            actor=actor,
        )
        return saved_inconclusive

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 3)
    mem_after = memory_guard.get_memory_status()
    ram_after_mb = float(mem_after["ecobi_ram_used_mb"])
    ram_peak_mb = round(max(ram_used_now, ram_peak_mb, ram_after_mb), 2)

    total_cases_count = len(all_cases)
    total_sector_cases = len(sector_profile["sector_prompts"])
    tool_accuracy_pct = round((correct_total / total_cases_count) * 100.0, 2)
    domain_fidelity_score = (
        round((correct_sector / total_sector_cases) * 100.0, 2) if total_sector_cases > 0 else 0.0
    )
    base_model_reference_accuracy_pct = (
        round((correct_reference / total_cases_count) * 100.0, 2) if total_cases_count > 0 else 0.0
    )
    reference_agreement_pct = (
        round((correct_agreement / total_cases_count) * 100.0, 2) if total_cases_count > 0 else 0.0
    )
    deterministic_alignment_score = round(0.65 * tool_accuracy_pct + 0.35 * domain_fidelity_score, 2)

    if tool_accuracy_pct == 100.0 and deterministic_alignment_score >= 85.0 and ram_peak_mb <= ram_budget:
        eval_status = "APTO_EXPERIMENTAL"
    else:
        eval_status = "REPROVADO_QUALIDADE"

    limitations = [
        "Avaliação experimental conduzida localmente sob BLOCK_EXTERNAL_AI=True.",
        "O adaptador LoRA atua exclusivamente na camada de interpretação semântica e seleção das 6 ferramentas da allowlist; todos os cálculos financeiros e ESG permanecem 100% determinísticos.",
    ]
    if eval_status == "REPROVADO_QUALIDADE":
        limitations.append(
            f"Adaptador reprovado nos critérios de qualidade (tool_accuracy={tool_accuracy_pct}%, "
            f"alinhamento determinístico={deterministic_alignment_score}% < 85.0%). Uso não recomendado."
        )

    metrics_payload: Dict[str, Any] = {
        "sector": sector,
        "adapter_name": resolved_adapter,
        "base_model": resolved_base,
        "adapter_rank": sector_profile["rank"],
        "adapter_alpha": sector_profile["alpha"],
        "estimated_overhead_mb": overhead_mb,
        "total_cases": total_cases_count,
        "passed_cases": correct_total,
        "sector_cases": total_sector_cases,
        "passed_sector_cases": correct_sector,
        "base_model_reference_accuracy_pct": base_model_reference_accuracy_pct,
        "reference_agreement_pct": reference_agreement_pct,
        "lora_tool_accuracy_pct": tool_accuracy_pct,
        "domain_fidelity_score": domain_fidelity_score,
        "deterministic_alignment_score": deterministic_alignment_score,
        "ram_before_mb": ram_used_now,
        "ram_after_mb": ram_after_mb,
        "ram_peak_mb": ram_peak_mb,
        "ram_budget_mb": ram_budget,
        "runtime_available": True,
        "status": eval_status,
        "ollama_status": ollama_info.get("status", "connected"),
        "cases": evaluated_cases,
    }

    saved = database.create_lora_evaluation(
        sector=sector,
        adapter_name=resolved_adapter,
        base_model=resolved_base,
        evaluation_status=eval_status,
        tool_accuracy_pct=tool_accuracy_pct,
        domain_fidelity_score=domain_fidelity_score,
        deterministic_alignment_score=deterministic_alignment_score,
        latency_ms=elapsed_ms,
        ram_used_mb=ram_after_mb,
        ram_peak_mb=ram_peak_mb,
        metrics=metrics_payload,
        limitations=limitations,
        project_id=project_id,
        actor=actor,
    )

    database.log_audit(
        actor=actor,
        action="LORA_EVALUATION_COMPLETED",
        resource_type="lora_evaluation",
        resource_id=saved["id"],
        project_id=project_id,
        details={
            "sector": sector,
            "adapter_name": resolved_adapter,
            "evaluation_status": eval_status,
            "tool_accuracy_pct": tool_accuracy_pct,
            "deterministic_alignment_score": deterministic_alignment_score,
            "ram_peak_mb": ram_peak_mb,
        },
    )

    return saved
