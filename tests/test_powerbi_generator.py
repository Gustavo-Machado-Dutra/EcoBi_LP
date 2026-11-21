"""Testes do Gerador de Projetos Power BI Desktop (PBIP/PBIR) e Reconciliação Numérica.

Cobre C10, geração completa de projeto PBIP a partir de análises aprovadas, conformidade com os
schemas JSON oficiais da Microsoft (model.bim 1567, definition.pbir, definition.pbism),
verificação das 10+ medidas DAX e relacionamentos, 4 páginas temáticas no report.json,
paleta Sustainable Tech oficial no EcoBITheme.json, exportação CSV em data/, download do .zip
e reconciliação matemática com tolerância < 1e-4.
"""

from __future__ import annotations

import io
import json
from pathlib import Path
from typing import Any, Dict
import zipfile

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend import config, database
from backend.services import analytics, powerbi_generator, predictive, validation_engine


# ============================================================================
# C10: Geração Estrutural PBIP/PBIR e Reconciliação Numérica
# ============================================================================

def test_pbip_pbir_generation_and_reconciliation(
    client: TestClient,
    auth_headers: Dict[str, str],
    sample_paths: Dict[str, Path],
) -> None:
    """Gera pacote PBIP/PBIR em análise APROVADO, valida 10+ DAX, 4 páginas, tema e reconciliação < 1e-4 (C10)."""
    # 1. Cria projeto
    proj_resp = client.post(
        "/api/projects",
        json={"name": "EcoBI Varejo Sustentável Piloto", "sector": "Varejo", "currency": "BRL"},
        headers=auth_headers,
    )
    assert proj_resp.status_code == 201
    project_id = proj_resp.json()["id"]

    # Ingestão do dataset piloto robusto (24 meses)
    with open(sample_paths["piloto"], "rb") as f:
        up_resp = client.post(
            f"/api/projects/{project_id}/datasets/upload",
            files={"file": ("piloto_pbi.csv", f, "text/csv")},
            headers=auth_headers,
        )
    dataset_id = up_resp.json()["dataset"]["id"]

    # 2. Executa Análise Financeira/ESG
    fin_an_res = analytics.run_financial_esg_analysis(
        project_id=project_id,
        dataset_id=dataset_id,
        actor="qa_tester",
    )
    fin_an_id = fin_an_res["analysis_id"]

    # Valida no Validation Engine (deve resultar em APROVADO)
    val_fin = validation_engine.validate_analysis(project_id, fin_an_id, actor="qa_auditor")
    assert val_fin["status"] == "APROVADO"
    assert val_fin["can_publish_to_powerbi"] is True

    # 3. Executa Análise Preditiva
    pred_res = predictive.run_predictive_analysis(
        project_id=project_id,
        dataset_id=dataset_id,
        target_column="receita_bruta",
        model_type="ridge",
        forecast_horizon=6,
        actor="qa_tester",
    )
    pred_an_id = pred_res["analysis_id"]

    val_pred = validation_engine.validate_analysis(project_id, pred_an_id, actor="qa_auditor")
    assert val_pred["status"] in ("APROVADO", "APROVADO_COM_RESSALVAS")
    assert val_pred["can_publish_to_powerbi"] is True

    # 4. Geração do Projeto Power BI (PBIP/PBIR) via Endpoint REST
    resp_gen = client.post(
        f"/api/projects/{project_id}/powerbi/generate",
        json={
            "analysis_ids": [fin_an_id, pred_an_id],
            "report_title": "EcoBI",
        },
        headers=auth_headers,
    )
    assert resp_gen.status_code == 201
    gen_data = resp_gen.json()
    assert "report_id" in gen_data
    report_id = gen_data["report_id"]
    slug = gen_data["slug"]
    bundle_path = Path(gen_data["bundle_path"])

    # 5. Validação Física da Estrutura de Pastas e Arquivos Gerados
    assert bundle_path.exists(), f"Pasta do bundle {bundle_path} não foi criada no disco."

    # A) Arquivo de projeto raiz .pbip
    pbip_file = bundle_path / f"{slug}.pbip"
    assert pbip_file.exists(), f"Arquivo {pbip_file} não encontrado na raiz."
    with open(pbip_file, "r", encoding="utf-8") as f:
        pbip_meta = json.load(f)
        assert pbip_meta.get("version") == "1.0"
        assert "artifacts" in pbip_meta

    # B) SemanticModel: definition.pbism e model.bim
    sem_dir = bundle_path / f"{slug}.SemanticModel"
    assert sem_dir.exists()
    pbism_file = sem_dir / "definition.pbism"
    assert pbism_file.exists()
    with open(pbism_file, "r", encoding="utf-8") as f:
        pbism_meta = json.load(f)
        assert pbism_meta.get("version") == "1.0"

    model_bim_file = sem_dir / "model.bim"
    assert model_bim_file.exists()
    with open(model_bim_file, "r", encoding="utf-8") as f:
        bim = json.load(f)
        assert bim.get("compatibilityLevel") == 1567
        model_obj = bim.get("model", {})

        # Validação das Tabelas
        tables = model_obj.get("tables", [])
        table_names = {t["name"] for t in tables}
        expected_tables = {"FactOperacoesMensais", "DimCalendario", "FactPrevisoes", "FactSimulacoes", "DimValidacao"}
        assert expected_tables.issubset(table_names)

        # Validação das Medidas DAX: Mínimo 10 medidas oficiais
        measures = []
        for t in tables:
            measures.extend(t.get("measures", []))
        assert len(measures) >= 10
        measure_names = {m["name"] for m in measures}
        assert "Faturamento Liquido" in measure_names
        assert "Lucro Operacional" in measure_names
        assert "Emissoes Brutas tCO2e" in measure_names
        assert "Creditos Carbono Separados tCO2e" in measure_names
        assert "Taxa Reciclagem %" in measure_names

        # Validação de Relacionamentos
        relationships = model_obj.get("relationships", [])
        assert len(relationships) >= 1

    # C) Report: definition.pbir e report.json (4 páginas oficiais)
    rep_dir = bundle_path / f"{slug}.Report"
    assert rep_dir.exists()
    pbir_file = rep_dir / "definition.pbir"
    assert pbir_file.exists()
    with open(pbir_file, "r", encoding="utf-8") as f:
        pbir_meta = json.load(f)
        assert pbir_meta.get("version") == "1.0"

    report_json_file = rep_dir / "report.json"
    assert report_json_file.exists()
    with open(report_json_file, "r", encoding="utf-8") as f:
        rep_json = json.load(f)
        sections = rep_json.get("sections", [])
        assert len(sections) == 4, f"Esperado exatamente 4 páginas de relatório, encontrado: {len(sections)}"
        page_names = [s["displayName"] for s in sections]
        assert "Visão Executiva & Governança" in page_names
        assert "Performance Financeira & Margens" in page_names
        assert "Contabilidade ESG & GHG Protocol" in page_names
        assert "Previsões & Simulações What-If" in page_names

    # D) Tema Sustentável: EcoBITheme.json com as 6 cores da paleta Sustainable Tech
    theme_file = rep_dir / "StaticResources" / "RegisteredResources" / "EcoBITheme.json"
    if not theme_file.exists():
        theme_file = rep_dir / "StaticResources" / "SharedResources" / "BaseThemes" / "EcoBITheme.json"
    assert theme_file.exists()
    with open(theme_file, "r", encoding="utf-8") as f:
        theme_json = json.load(f)
        colors = theme_json.get("dataColors", [])
        # Confirma presença das cores obrigatórias
        assert "#183A32" in colors  # Forest
        assert "#4F7A59" in colors  # Natural
        assert "#C8784A" in colors  # Terracotta

    # E) Dados CSV reais na subpasta data/
    data_dir = bundle_path / "data"
    assert data_dir.exists()
    assert (data_dir / "DimCalendario.csv").exists()
    assert (data_dir / "FactOperacoesMensais.csv").exists()
    assert (data_dir / "FactPrevisoes.csv").exists()

    # 6. Reconciliação Numérica via validate_pbip_bundle (Tolerância < 1e-4)
    expected_kpis = {
        "receita_bruta_total": fin_an_res["financial_kpis"]["receita_bruta_total"],
        "receita_liquida_total": fin_an_res["financial_kpis"]["receita_liquida_total"],
        "total_gross_emissions_co2e_tons": fin_an_res["esg_kpis"]["total_gross_emissions_co2e_tons"],
        "scope1_co2e_tons": fin_an_res["esg_kpis"]["scope1_co2e_tons"],
        "scope2_co2e_tons": fin_an_res["esg_kpis"]["scope2_co2e_tons"],
    }
    reconciliation_report = powerbi_generator.validate_pbip_bundle(
        bundle_dir=bundle_path,
        expected_kpis=expected_kpis,
    )
    assert reconciliation_report["valid"] is True
    assert len(reconciliation_report["discrepancies"]) == 0
    assert reconciliation_report["reconciliation_tolerance"] < 1e-4

    # 7. Download do Pacote .ZIP via Endpoint REST
    download_url = gen_data["download_url"]
    resp_dl = client.get(download_url, headers=auth_headers)
    assert resp_dl.status_code == 200
    assert resp_dl.headers["content-type"] == "application/zip"

    # Inspeciona o arquivo ZIP recebido na resposta
    zip_bytes = io.BytesIO(resp_dl.content)
    with zipfile.ZipFile(zip_bytes, "r") as zf:
        namelist = zf.namelist()
        assert any(f.endswith(".pbip") for f in namelist)
        assert any("model.bim" in f for f in namelist)
        assert any("report.json" in f for f in namelist)
        assert any("EcoBITheme.json" in f for f in namelist)


def test_pbip_deduplicates_repeated_analyses_preserving_source_period_rows(
    client: TestClient,
    auth_headers: Dict[str, str],
    sample_paths: Dict[str, Path],
    tmp_path: Path,
) -> None:
    project_response = client.post(
        "/api/projects",
        json={"name": "EcoBI Repeated Periods", "sector": "Varejo", "currency": "BRL"},
        headers=auth_headers,
    )
    project_id = project_response.json()["id"]

    sample_data = pd.read_csv(sample_paths["piloto"])
    sample_data = pd.concat([sample_data, sample_data.iloc[[0]]], ignore_index=True)
    repeated_period_sample = tmp_path / "piloto_repeated_period.csv"
    sample_data.to_csv(repeated_period_sample, index=False)

    with open(repeated_period_sample, "rb") as sample_file:
        upload_response = client.post(
            f"/api/projects/{project_id}/datasets/upload",
            files={"file": ("piloto_repeated_periods.csv", sample_file, "text/csv")},
            headers=auth_headers,
        )
    dataset_id = upload_response.json()["dataset"]["id"]

    analysis_ids = []
    analysis_result = None
    for _ in range(6):
        analysis_result = analytics.run_financial_esg_analysis(
            project_id=project_id,
            dataset_id=dataset_id,
            actor="qa_tester",
        )
        analysis_id = analysis_result["analysis_id"]
        validation = validation_engine.validate_analysis(project_id, analysis_id, actor="qa_auditor")
        assert validation["status"] == "APROVADO"
        analysis_ids.append(analysis_id)

    generated = powerbi_generator.generate_pbip_project(
        project_id=project_id,
        analysis_ids=analysis_ids,
        report_title="Periods",
        actor="qa_tester",
    )
    fact_path = Path(generated["bundle_path"]) / "data" / "FactOperacoesMensais.csv"
    fact_rows = pd.read_csv(fact_path)

    assert len(fact_rows) == len(analysis_result["monthly_series"])
    expected_period_counts = pd.Series(
        [row["periodo"] for row in analysis_result["monthly_series"]]
    ).value_counts().sort_index()
    actual_period_counts = fact_rows["Periodo"].value_counts().sort_index()
    assert actual_period_counts.to_dict() == expected_period_counts.to_dict()
    expected_revenue_by_period = (
        pd.DataFrame(analysis_result["monthly_series"])
        .groupby("periodo")["receita_bruta"]
        .sum()
        .sort_index()
    )
    actual_revenue_by_period = fact_rows.groupby("Periodo")["ReceitaBruta"].sum().sort_index()
    assert actual_revenue_by_period.to_dict() == pytest.approx(
        expected_revenue_by_period.to_dict(), abs=0.01
    )
    assert fact_rows["Periodo"].duplicated().sum() == 1
    assert fact_rows["ReceitaBruta"].sum() == pytest.approx(
        analysis_result["financial_kpis"]["receita_bruta_total"], abs=0.01
    )
    assert fact_rows["TotalGrossEmissionsCO2eTons"].sum() == pytest.approx(
        analysis_result["esg_kpis"]["total_gross_emissions_co2e_tons"], abs=0.0001
    )
    assert generated["reconciliation"]["receita_bruta_total"] == pytest.approx(
        analysis_result["financial_kpis"]["receita_bruta_total"], abs=0.01
    )


def test_pbip_queryrefs_match_model_tables_and_m_promotes_headers(
    client: TestClient,
    auth_headers: Dict[str, str],
    sample_paths: Dict[str, Path],
) -> None:
    proj_resp = client.post(
        "/api/projects",
        json={"name": "EcoBI PowerBI Schema Alignment", "sector": "Varejo", "currency": "BRL"},
        headers=auth_headers,
    )
    assert proj_resp.status_code == 201
    project_id = proj_resp.json()["id"]

    with open(sample_paths["piloto"], "rb") as f:
        up_resp = client.post(
            f"/api/projects/{project_id}/datasets/upload",
            files={"file": ("piloto_schema.csv", f, "text/csv")},
            headers=auth_headers,
        )
    dataset_id = up_resp.json()["dataset"]["id"]

    fin_res = analytics.run_financial_esg_analysis(project_id=project_id, dataset_id=dataset_id, actor="qa_tester")
    validation_engine.validate_analysis(project_id, fin_res["analysis_id"], actor="qa_auditor")

    generated = powerbi_generator.generate_pbip_project(
        project_id=project_id,
        analysis_ids=[fin_res["analysis_id"]],
        report_title="SchemaCheck",
        actor="qa_tester",
    )
    bundle_dir = Path(generated["bundle_dir"])
    bim = json.loads((bundle_dir / "SchemaCheck.SemanticModel" / "model.bim").read_text(encoding="utf-8"))
    rep = json.loads((bundle_dir / "SchemaCheck.Report" / "report.json").read_text(encoding="utf-8"))
    pbir = json.loads((bundle_dir / "SchemaCheck.Report" / "definition.pbir").read_text(encoding="utf-8"))

    by_path = pbir["datasetReference"]["byPath"]["path"]
    assert (bundle_dir / "SchemaCheck.Report" / by_path).resolve().is_dir()

    model_obj = bim["model"]
    expressions = {e["name"]: e["expression"] for e in model_obj.get("expressions", [])}
    assert "PastaDados" in expressions
    assert str((bundle_dir / "data").resolve()) in expressions["PastaDados"]

    fields_by_table = {}
    for table in model_obj["tables"]:
        fields_by_table[table["name"]] = {c["name"] for c in table.get("columns", [])} | {
            m["name"] for m in table.get("measures", [])
        }
        for part in table.get("partitions", []):
            expr = part["source"]["expression"]
            assert "Table.PromoteHeaders" in expr
            assert "PastaDados" in expr

    assert "WAPE Modelo %" in fields_by_table["FactPrevisoes"]
    assert "Economia Projetada BRL" in fields_by_table["FactSimulacoes"]
    assert "Emissoes Evitadas Simuladas tCO2e" in fields_by_table["FactSimulacoes"]

    sections_by_name = {s["displayName"]: s for s in rep["sections"]}
    assert any(
        "TableValidacaoGovernanca" in vc["config"]
        for vc in sections_by_name["Visão Executiva & Governança"]["visualContainers"]
    )
    assert any(
        "ChartEvolucaoFinanceira" in vc["config"]
        for vc in sections_by_name["Performance Financeira & Margens"]["visualContainers"]
    )
    assert any(
        "ChartEmissoesPorEscopo" in vc["config"]
        for vc in sections_by_name["Contabilidade ESG & GHG Protocol"]["visualContainers"]
    )
    assert any(
        "TableCenariosSimulados" in vc["config"]
        for vc in sections_by_name["Previsões & Simulações What-If"]["visualContainers"]
    )

    for sec in rep["sections"]:
        for vc in sec["visualContainers"]:
            cfg = json.loads(vc["config"])
            for proj_items in cfg["singleVisual"]["projections"].values():
                for item in proj_items:
                    t_name, f_name = item["queryRef"].split(".", 1)
                    assert f_name in fields_by_table[t_name], f"Missing {item['queryRef']}"

    validation = powerbi_generator.validate_pbip_bundle(bundle_dir)
    assert validation["valid"] is True, validation["discrepancies"]
