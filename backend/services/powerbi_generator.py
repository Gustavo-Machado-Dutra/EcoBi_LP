"""EcoBI Intelligence - Gerador Nativo de Projetos Power BI (PBIP/PBIR).

Gera projetos Power BI Desktop no formato moderno aberto (.pbip e .pbir):
- Validação BLOQUEANTE de governança: qualquer análise REJEITADA ou não validada bloqueia
  imediatamente a exportação.
- Estrutura de pastas oficial PBIP/PBIR v1:
  * <Slug>.pbip (version 1.0, artifacts -> report path <Slug>.Report)
  * <Slug>.SemanticModel/definition.pbism (version 4.0, settings)
  * <Slug>.SemanticModel/model.bim (compatibilityLevel 1567, 5 tabelas, relacionamentos e 10+ medidas DAX)
  * <Slug>.Report/definition.pbir (datasetReference byPath -> ../<Slug>.SemanticModel)
  * <Slug>.Report/report.json (4 páginas estruturadas com visuais reais)
  * <Slug>.Report/StaticResources/RegisteredResources/EcoBITheme.json (Paleta Sustainable Tech)
  * CSVs auditados em data/ dentro do bundle
- Função de validação determinística do bundle (validate_pbip_bundle) com reconciliação numérica (1e-4).
- Empacotamento em arquivo .zip e persistência em powerbi_reports e audit_logs.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import pandas as pd

from backend import config
from backend import database

logger = logging.getLogger("ecobi.powerbi_generator")


def _slugify(text: str) -> str:
    """Converte título em slug seguro para nomes de arquivo e pastas."""
    s = re.sub(r"[^\w\s-]", "", text).strip()
    s = re.sub(r"[-\s]+", "_", s)
    return s or "EcoBI_Relatorio"


# ============================================================================
# Especificação de Medidas DAX Oficiais
# ============================================================================

OPERATIONAL_DAX_MEASURES: List[Dict[str, Any]] = [
    {
        "name": "Faturamento Liquido",
        "expression": "SUM(FactOperacoesMensais[ReceitaLiquida])",
        "formatString": "R$ #,##0.00",
        "description": "Receita Líquida Operacional total consolidada em Reais (BRL).",
    },
    {
        "name": "Custo Total",
        "expression": "SUM(FactOperacoesMensais[CustoTotal])",
        "formatString": "R$ #,##0.00",
        "description": "Soma de custos fixos e variáveis operacionais.",
    },
    {
        "name": "Lucro Operacional",
        "expression": "[Faturamento Liquido] - [Custo Total]",
        "formatString": "R$ #,##0.00",
        "description": "Resultado operacional líquido (EBITDA aproximado).",
    },
    {
        "name": "Margem Liquida %",
        "expression": "DIVIDE([Lucro Operacional], [Faturamento Liquido], 0) * 100",
        "formatString": "0.00\\%",
        "description": "Percentual de margem líquida operacional.",
    },
    {
        "name": "Consumo Energia kWh",
        "expression": "SUM(FactOperacoesMensais[EnergiaKwh])",
        "formatString": "#,##0.00",
        "description": "Consumo total de energia elétrica adquirida em kWh.",
    },
    {
        "name": "Emissoes Brutas tCO2e",
        "expression": "SUM(FactOperacoesMensais[TotalGrossEmissionsCO2eTons])",
        "formatString": "#,##0.0000",
        "description": "Emissões brutas totais de GEE em tCO2e (Escopos 1 + 2 + 3) sem abatimentos.",
    },
    {
        "name": "Creditos Carbono Separados tCO2e",
        "expression": "SUM(FactOperacoesMensais[CreditosCarbonoTCO2e])",
        "formatString": "#,##0.0000",
        "description": "Créditos de carbono adquiridos mantidos estritamente segregados.",
    },
    {
        "name": "Taxa Reciclagem %",
        "expression": "DIVIDE(SUM(FactOperacoesMensais[ResiduosRecicladosKg]), SUM(FactOperacoesMensais[ResiduosGeradosKg]), 0) * 100",
        "formatString": "0.00\\%",
        "description": "Percentual de resíduos sólidos destinados para reciclagem.",
    },
    {
        "name": "Taxa Logistica Reversa %",
        "expression": "DIVIDE(SUM(FactOperacoesMensais[DevolucoesLogisticaReversaUn]), SUM(FactOperacoesMensais[VolumeTotalEntregasUn]), 0) * 100",
        "formatString": "0.00\\%",
        "description": "Índice de devoluções por logística reversa em relação ao volume de entregas.",
    },
]

PREDICTIVE_DAX_MEASURES: List[Dict[str, Any]] = [
    {
        "name": "WAPE Modelo %",
        "expression": "AVERAGE(FactPrevisoes[WAPE_Modelo]) * 100",
        "formatString": "0.00\\%",
        "description": "Erro percentual ponderado absoluto médio do modelo preditivo.",
    },
]

SIMULATION_DAX_MEASURES: List[Dict[str, Any]] = [
    {
        "name": "Emissoes Evitadas Simuladas tCO2e",
        "expression": "SUM(FactSimulacoes[EmissoesEvitadasTCO2e])",
        "formatString": "#,##0.0000",
        "description": "Total de emissões evitadas calculadas nos cenários What-If.",
    },
    {
        "name": "Economia Projetada BRL",
        "expression": "SUM(FactSimulacoes[EconomiaProjetadaBRL])",
        "formatString": "R$ #,##0.00",
        "description": "Economia financeira projetada acumulada nas simulações.",
    },
]

OFFICIAL_DAX_MEASURES: List[Dict[str, Any]] = (
    OPERATIONAL_DAX_MEASURES + PREDICTIVE_DAX_MEASURES + SIMULATION_DAX_MEASURES
)


# ============================================================================
# Construtor do Tema Sustainable Tech
# ============================================================================

def _build_theme_json() -> Dict[str, Any]:
    """Constrói o tema visual oficial Sustainable Tech com as 6 cores EcoBI."""
    return {
        "name": "EcoBI Sustainable Tech Theme",
        "dataColors": [
            config.OFFICIAL_THEME_COLORS["forest"],      # #183A32
            config.OFFICIAL_THEME_COLORS["natural"],     # #4F7A59
            config.OFFICIAL_THEME_COLORS["mint"],        # #B9D6C2
            config.OFFICIAL_THEME_COLORS["sage"],        # #DCE8D9
            config.OFFICIAL_THEME_COLORS["offwhite"],    # #F5F6F0
            config.OFFICIAL_THEME_COLORS["terracotta"],  # #C8784A
            "#2E5C4E",
            "#8EB49B",
        ],
        "background": config.OFFICIAL_THEME_COLORS["offwhite"],
        "foreground": config.OFFICIAL_THEME_COLORS["forest"],
        "tableAccent": config.OFFICIAL_THEME_COLORS["natural"],
        "visualStyles": {
            "*": {
                "*": {
                    "outspace": [{"color": {"solid": {"color": config.OFFICIAL_THEME_COLORS["offwhite"]}}}],
                }
            }
        },
    }


# ============================================================================
# Construtor do Modelo Semântico (model.bim)
# ============================================================================

def _csv_m_expression(filename: str) -> str:
    """Constrói expressão Power Query (M) com promoção automática de cabeçalhos via parâmetro PastaDados."""
    return (
        "let\n"
        f'    Source = Csv.Document(File.Contents(PastaDados & "\\{filename}"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n'
        "    PromotedHeaders = Table.PromoteHeaders(Source, [PromoteAllScalars=true])\n"
        "in\n"
        "    PromotedHeaders"
    )


def _build_model_bim(slug: str, data_dir: Optional[Path] = None) -> Dict[str, Any]:
    """Gera o schema tabular completo do modelo semântico (model.bim compatibilidade 1567)."""
    resolved_data_dir = str(data_dir.resolve()) if data_dir is not None else "data"
    escaped_data_dir = resolved_data_dir.replace('"', '""')
    return {
        "name": f"{slug}_SemanticModel",
        "compatibilityLevel": 1567,
        "model": {
            "culture": "pt-BR",
            "dataAccessOptions": {
                "legacyRedirects": True,
                "returnErrorValuesAsNull": True,
            },
            "defaultPowerBIDataSourceVersion": "powerBI_V3",
            "expressions": [
                {
                    "name": "PastaDados",
                    "kind": "m",
                    "expression": f'"{escaped_data_dir}" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
                }
            ],
            "tables": [
                {
                    "name": "DimCalendario",
                    "columns": [
                        {"name": "Periodo", "dataType": "string", "isKey": True, "sourceColumn": "Periodo"},
                        {"name": "Ano", "dataType": "int64", "sourceColumn": "Ano"},
                        {"name": "Mes", "dataType": "int64", "sourceColumn": "Mes"},
                        {"name": "NomeMes", "dataType": "string", "sourceColumn": "NomeMes"},
                        {"name": "AnoMes", "dataType": "string", "sourceColumn": "AnoMes"},
                    ],
                    "partitions": [
                        {
                            "name": "DimCalendario-Partition",
                            "mode": "import",
                            "source": {"type": "m", "expression": _csv_m_expression("DimCalendario.csv")},
                        }
                    ],
                },
                {
                    "name": "FactOperacoesMensais",
                    "columns": [
                        {"name": "Periodo", "dataType": "string", "sourceColumn": "Periodo"},
                        {"name": "ReceitaBruta", "dataType": "double", "sourceColumn": "ReceitaBruta"},
                        {"name": "ImpostosDevolucoes", "dataType": "double", "sourceColumn": "ImpostosDevolucoes"},
                        {"name": "ReceitaLiquida", "dataType": "double", "sourceColumn": "ReceitaLiquida"},
                        {"name": "CustoFixo", "dataType": "double", "sourceColumn": "CustoFixo"},
                        {"name": "CustoVariavel", "dataType": "double", "sourceColumn": "CustoVariavel"},
                        {"name": "CustoTotal", "dataType": "double", "sourceColumn": "CustoTotal"},
                        {"name": "LucroOperacional", "dataType": "double", "sourceColumn": "LucroOperacional"},
                        {"name": "EnergiaKwh", "dataType": "double", "sourceColumn": "EnergiaKwh"},
                        {"name": "CombustivelLitros", "dataType": "double", "sourceColumn": "CombustivelLitros"},
                        {"name": "ResiduosGeradosKg", "dataType": "double", "sourceColumn": "ResiduosGeradosKg"},
                        {"name": "ResiduosRecicladosKg", "dataType": "double", "sourceColumn": "ResiduosRecicladosKg"},
                        {"name": "ResiduosAterroKg", "dataType": "double", "sourceColumn": "ResiduosAterroKg"},
                        {"name": "DevolucoesLogisticaReversaUn", "dataType": "double", "sourceColumn": "DevolucoesLogisticaReversaUn"},
                        {"name": "VolumeTotalEntregasUn", "dataType": "double", "sourceColumn": "VolumeTotalEntregasUn"},
                        {"name": "Scope1CO2eTons", "dataType": "double", "sourceColumn": "Scope1CO2eTons"},
                        {"name": "Scope2CO2eTons", "dataType": "double", "sourceColumn": "Scope2CO2eTons"},
                        {"name": "Scope3CO2eTons", "dataType": "double", "sourceColumn": "Scope3CO2eTons"},
                        {"name": "TotalGrossEmissionsCO2eTons", "dataType": "double", "sourceColumn": "TotalGrossEmissionsCO2eTons"},
                        {"name": "CreditosCarbonoTCO2e", "dataType": "double", "sourceColumn": "CreditosCarbonoTCO2e"},
                    ],
                    "measures": OPERATIONAL_DAX_MEASURES,
                    "partitions": [
                        {
                            "name": "FactOperacoesMensais-Partition",
                            "mode": "import",
                            "source": {"type": "m", "expression": _csv_m_expression("FactOperacoesMensais.csv")},
                        }
                    ],
                },
                {
                    "name": "FactPrevisoes",
                    "columns": [
                        {"name": "Periodo", "dataType": "string", "sourceColumn": "Periodo"},
                        {"name": "Target", "dataType": "string", "sourceColumn": "Target"},
                        {"name": "ValorPrevisto", "dataType": "double", "sourceColumn": "ValorPrevisto"},
                        {"name": "LimiteInferior90", "dataType": "double", "sourceColumn": "LimiteInferior90"},
                        {"name": "LimiteSuperior90", "dataType": "double", "sourceColumn": "LimiteSuperior90"},
                        {"name": "WAPE_Modelo", "dataType": "double", "sourceColumn": "WAPE_Modelo"},
                        {"name": "WAPE_Baseline", "dataType": "double", "sourceColumn": "WAPE_Baseline"},
                    ],
                    "measures": PREDICTIVE_DAX_MEASURES,
                    "partitions": [
                        {
                            "name": "FactPrevisoes-Partition",
                            "mode": "import",
                            "source": {"type": "m", "expression": _csv_m_expression("FactPrevisoes.csv")},
                        }
                    ],
                },
                {
                    "name": "FactSimulacoes",
                    "columns": [
                        {"name": "IdSimulacao", "dataType": "string", "sourceColumn": "IdSimulacao"},
                        {"name": "CenarioNome", "dataType": "string", "sourceColumn": "CenarioNome"},
                        {"name": "EconomiaProjetadaBRL", "dataType": "double", "sourceColumn": "EconomiaProjetadaBRL"},
                        {"name": "EmissoesEvitadasTCO2e", "dataType": "double", "sourceColumn": "EmissoesEvitadasTCO2e"},
                        {"name": "InvestimentoAmbientalBRL", "dataType": "double", "sourceColumn": "InvestimentoAmbientalBRL"},
                        {"name": "NovaEmissaoTotalTCO2e", "dataType": "double", "sourceColumn": "NovaEmissaoTotalTCO2e"},
                    ],
                    "measures": SIMULATION_DAX_MEASURES,
                    "partitions": [
                        {
                            "name": "FactSimulacoes-Partition",
                            "mode": "import",
                            "source": {"type": "m", "expression": _csv_m_expression("FactSimulacoes.csv")},
                        }
                    ],
                },
                {
                    "name": "DimValidacao",
                    "columns": [
                        {"name": "IdAnalise", "dataType": "string", "sourceColumn": "IdAnalise"},
                        {"name": "StatusValidacao", "dataType": "string", "sourceColumn": "StatusValidacao"},
                        {"name": "DataValidacao", "dataType": "string", "sourceColumn": "DataValidacao"},
                        {"name": "TotalRegras", "dataType": "int64", "sourceColumn": "TotalRegras"},
                        {"name": "RegrasAprovadas", "dataType": "int64", "sourceColumn": "RegrasAprovadas"},
                        {"name": "Ressalvas", "dataType": "string", "sourceColumn": "Ressalvas"},
                    ],
                    "partitions": [
                        {
                            "name": "DimValidacao-Partition",
                            "mode": "import",
                            "source": {"type": "m", "expression": _csv_m_expression("DimValidacao.csv")},
                        }
                    ],
                },
            ],
            "relationships": [
                {
                    "name": "Rel_Calendario_Operacoes",
                    "fromTable": "FactOperacoesMensais",
                    "fromColumn": "Periodo",
                    "toTable": "DimCalendario",
                    "toColumn": "Periodo",
                },
                {
                    "name": "Rel_Calendario_Previsoes",
                    "fromTable": "FactPrevisoes",
                    "fromColumn": "Periodo",
                    "toTable": "DimCalendario",
                    "toColumn": "Periodo",
                },
            ],
        },
    }


# ============================================================================
# Construtor do Relatório Power BI (report.json - 4 Páginas)
# ============================================================================

def _build_report_json() -> Dict[str, Any]:
    """Gera o arquivo de definição de layout do relatório (report.json) com 4 páginas oficiais."""
    return {
        "config": json.dumps({
            "version": "5.55",
            "themeCollection": {
                "baseTheme": {"name": "EcoBI Sustainable Tech Theme", "reportVersionAtImport": "5.55"}
            },
            "activeSectionIndex": 0,
            "defaultDrillFilterOtherVisuals": True,
        }),
        "layoutOptimization": 0,
        "resourcePackages": [
            {
                "resourcePackage": {
                    "type": 1,
                    "name": "RegisteredResources",
                    "items": [
                        {"type": 201, "path": "EcoBITheme.json", "name": "EcoBITheme.json"}
                    ],
                }
            }
        ],
        "sections": [
            {
                "name": "ReportSection1",
                "displayName": "Visão Executiva & Governança",
                "filters": "[]",
                "ordinal": 0,
                "visualContainers": [
                    {
                        "x": 20, "y": 20, "width": 300, "height": 140, "z": 1000,
                        "config": json.dumps({"name": "CardExecFaturamento", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Faturamento Liquido"}]}}}),
                    },
                    {
                        "x": 340, "y": 20, "width": 300, "height": 140, "z": 1001,
                        "config": json.dumps({"name": "CardExecLucro", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Lucro Operacional"}]}}}),
                    },
                    {
                        "x": 660, "y": 20, "width": 300, "height": 140, "z": 1002,
                        "config": json.dumps({"name": "CardExecEmissoes", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Emissoes Brutas tCO2e"}]}}}),
                    },
                    {
                        "x": 980, "y": 20, "width": 280, "height": 140, "z": 1003,
                        "config": json.dumps({"name": "CardExecReciclagem", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Taxa Reciclagem %"}]}}}),
                    },
                    {
                        "x": 20, "y": 180, "width": 1240, "height": 500, "z": 1004,
                        "config": json.dumps({"name": "TableValidacaoGovernanca", "singleVisual": {"visualType": "tableEx", "projections": {"Values": [{"queryRef": "DimValidacao.IdAnalise"}, {"queryRef": "DimValidacao.StatusValidacao"}, {"queryRef": "DimValidacao.DataValidacao"}, {"queryRef": "DimValidacao.TotalRegras"}, {"queryRef": "DimValidacao.RegrasAprovadas"}, {"queryRef": "DimValidacao.Ressalvas"}]}}}),
                    },
                ],
                "width": 1280,
                "height": 720,
            },
            {
                "name": "ReportSection2",
                "displayName": "Performance Financeira & Margens",
                "filters": "[]",
                "ordinal": 1,
                "visualContainers": [
                    {
                        "x": 20, "y": 20, "width": 300, "height": 140, "z": 2000,
                        "config": json.dumps({"name": "CardFaturamentoLiquido", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Faturamento Liquido"}]}}}),
                    },
                    {
                        "x": 340, "y": 20, "width": 300, "height": 140, "z": 2001,
                        "config": json.dumps({"name": "CardCustoTotal", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Custo Total"}]}}}),
                    },
                    {
                        "x": 660, "y": 20, "width": 300, "height": 140, "z": 2002,
                        "config": json.dumps({"name": "CardLucroOperacional", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Lucro Operacional"}]}}}),
                    },
                    {
                        "x": 980, "y": 20, "width": 280, "height": 140, "z": 2003,
                        "config": json.dumps({"name": "CardMargemLiquida", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Margem Liquida %"}]}}}),
                    },
                    {
                        "x": 20, "y": 180, "width": 1240, "height": 500, "z": 2004,
                        "config": json.dumps({"name": "ChartEvolucaoFinanceira", "singleVisual": {"visualType": "lineChart", "projections": {"Category": [{"queryRef": "DimCalendario.Periodo"}], "Y": [{"queryRef": "FactOperacoesMensais.ReceitaLiquida"}, {"queryRef": "FactOperacoesMensais.CustoTotal"}, {"queryRef": "FactOperacoesMensais.LucroOperacional"}]}}}),
                    },
                ],
                "width": 1280,
                "height": 720,
            },
            {
                "name": "ReportSection3",
                "displayName": "Contabilidade ESG & GHG Protocol",
                "filters": "[]",
                "ordinal": 2,
                "visualContainers": [
                    {
                        "x": 20, "y": 20, "width": 380, "height": 140, "z": 3000,
                        "config": json.dumps({"name": "CardEmissoesBrutas", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Emissoes Brutas tCO2e"}]}}}),
                    },
                    {
                        "x": 420, "y": 20, "width": 380, "height": 140, "z": 3001,
                        "config": json.dumps({"name": "CardCreditosCarbono", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Creditos Carbono Separados tCO2e"}]}}}),
                    },
                    {
                        "x": 820, "y": 20, "width": 440, "height": 140, "z": 3002,
                        "config": json.dumps({"name": "CardTaxaReciclagem", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactOperacoesMensais.Taxa Reciclagem %"}]}}}),
                    },
                    {
                        "x": 20, "y": 180, "width": 600, "height": 500, "z": 3003,
                        "config": json.dumps({"name": "ChartEmissoesPorEscopo", "singleVisual": {"visualType": "columnChart", "projections": {"Category": [{"queryRef": "DimCalendario.Periodo"}], "Y": [{"queryRef": "FactOperacoesMensais.Scope1CO2eTons"}, {"queryRef": "FactOperacoesMensais.Scope2CO2eTons"}, {"queryRef": "FactOperacoesMensais.Scope3CO2eTons"}]}}}),
                    },
                    {
                        "x": 640, "y": 180, "width": 620, "height": 500, "z": 3004,
                        "config": json.dumps({"name": "ChartResiduosReciclagem", "singleVisual": {"visualType": "lineChart", "projections": {"Category": [{"queryRef": "DimCalendario.Periodo"}], "Y": [{"queryRef": "FactOperacoesMensais.ResiduosGeradosKg"}, {"queryRef": "FactOperacoesMensais.ResiduosRecicladosKg"}]}}}),
                    },
                ],
                "width": 1280,
                "height": 720,
            },
            {
                "name": "ReportSection4",
                "displayName": "Previsões & Simulações What-If",
                "filters": "[]",
                "ordinal": 3,
                "visualContainers": [
                    {
                        "x": 20, "y": 20, "width": 400, "height": 140, "z": 4000,
                        "config": json.dumps({"name": "CardWapeModelo", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactPrevisoes.WAPE Modelo %"}]}}}),
                    },
                    {
                        "x": 440, "y": 20, "width": 400, "height": 140, "z": 4001,
                        "config": json.dumps({"name": "CardEconomiaSimulada", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactSimulacoes.Economia Projetada BRL"}]}}}),
                    },
                    {
                        "x": 860, "y": 20, "width": 400, "height": 140, "z": 4002,
                        "config": json.dumps({"name": "CardEmissoesEvitadas", "singleVisual": {"visualType": "card", "projections": {"Values": [{"queryRef": "FactSimulacoes.Emissoes Evitadas Simuladas tCO2e"}]}}}),
                    },
                    {
                        "x": 20, "y": 180, "width": 1240, "height": 500, "z": 4003,
                        "config": json.dumps({"name": "TableCenariosSimulados", "singleVisual": {"visualType": "tableEx", "projections": {"Values": [{"queryRef": "FactSimulacoes.CenarioNome"}, {"queryRef": "FactSimulacoes.EconomiaProjetadaBRL"}, {"queryRef": "FactSimulacoes.EmissoesEvitadasTCO2e"}, {"queryRef": "FactSimulacoes.NovaEmissaoTotalTCO2e"}]}}}),
                    },
                ],
                "width": 1280,
                "height": 720,
            },
        ],
    }


# ============================================================================
# Validador de Integridade e Reconciliação Numérica do Pacote PBIP
# ============================================================================

def validate_pbip_bundle(
    bundle_dir: Union[str, Path],
    expected_kpis: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Inspeciona a estrutura técnica e reconciliação numérica do projeto Power BI gerado.

    Verifica:
    - Integridade e sintaxe de todos os arquivos JSON.
    - Presença das 10+ medidas DAX e dos relacionamentos no model.bim.
    - Existência das 4 páginas de relatório no report.json.
    - Presença das cores oficiais da paleta no EcoBITheme.json.
    - Reconciliação numérica dos dados nos CSVs auditados (tolerância <= 1e-4).
    """
    base_dir = Path(bundle_dir).resolve()
    discrepancies: List[str] = []

    if not base_dir.exists():
        return {"valid": False, "discrepancies": [f"Diretório do bundle não existe: '{base_dir}'."]}

    # Localização dos arquivos essenciais
    pbip_files = list(base_dir.glob("*.pbip"))
    if not pbip_files:
        discrepancies.append("Arquivo de projeto .pbip ausente na raiz do bundle.")
    else:
        try:
            with open(pbip_files[0], "r", encoding="utf-8") as f:
                pbip_data = json.load(f)
                if pbip_data.get("version") != "1.0":
                    discrepancies.append(f"Versão inválida no .pbip: {pbip_data.get('version')}")
        except Exception as e:
            discrepancies.append(f"Erro ao analisar arquivo .pbip: {e}")

    # Validação do SemanticModel
    sem_dirs = list(base_dir.glob("*.SemanticModel"))
    table_fields: Dict[str, set[str]] = {}
    if not sem_dirs:
        discrepancies.append("Pasta *.SemanticModel ausente.")
    else:
        sem_dir = sem_dirs[0]
        pbism_path = sem_dir / "definition.pbism"
        if not pbism_path.exists():
            discrepancies.append("definition.pbism ausente no SemanticModel.")
        else:
            try:
                with open(pbism_path, "r", encoding="utf-8") as f:
                    pbism_data = json.load(f)
                    if str(pbism_data.get("version", "")) not in ("1.0", "4.0"):
                        discrepancies.append(f"Versão inválida no definition.pbism: {pbism_data.get('version')}")
            except Exception as e:
                discrepancies.append(f"Erro de parsing no definition.pbism: {e}")

        model_bim_path = sem_dir / "model.bim"
        if not model_bim_path.exists():
            discrepancies.append("model.bim ausente no SemanticModel.")
        else:
            try:
                with open(model_bim_path, "r", encoding="utf-8") as f:
                    bim_data = json.load(f)
                    if bim_data.get("compatibilityLevel") != 1567:
                        discrepancies.append(f"CompatibilityLevel inválido no model.bim: {bim_data.get('compatibilityLevel')}")

                    tables = bim_data.get("model", {}).get("tables", [])
                    table_names = {t["name"] for t in tables}
                    expected_tables = {"FactOperacoesMensais", "DimCalendario", "FactPrevisoes", "FactSimulacoes", "DimValidacao"}
                    if not expected_tables.issubset(table_names):
                        discrepancies.append(f"Tabelas ausentes no model.bim. Esperado: {expected_tables}; Encontrado: {table_names}")

                    # Contagem de medidas DAX, mapeamento de campos e validação M
                    all_measures = []
                    for t in tables:
                        t_name = t["name"]
                        cols = {c["name"] for c in t.get("columns", [])}
                        meas = {m["name"] for m in t.get("measures", [])}
                        table_fields[t_name] = cols | meas
                        all_measures.extend(t.get("measures", []))
                        for part in t.get("partitions", []):
                            m_expr = str(part.get("source", {}).get("expression", ""))
                            if "Table.PromoteHeaders" not in m_expr or "File.Contents" not in m_expr:
                                discrepancies.append(
                                    f"Partição '{part.get('name', t_name)}' sem Table.PromoteHeaders/File.Contents válido."
                                )
                    if len(all_measures) < 10:
                        discrepancies.append(f"Poucas medidas DAX encontradas ({len(all_measures)} < 10).")

                    # Relacionamentos
                    relationships = bim_data.get("model", {}).get("relationships", [])
                    if len(relationships) < 1:
                        discrepancies.append("Nenhum relacionamento modelado no model.bim.")
            except Exception as e:
                discrepancies.append(f"Erro de parsing no model.bim: {e}")

    # Validação do Report e Tema
    rep_dirs = list(base_dir.glob("*.Report"))
    if not rep_dirs:
        discrepancies.append("Pasta *.Report ausente.")
    else:
        rep_dir = rep_dirs[0]
        pbir_path = rep_dir / "definition.pbir"
        if not pbir_path.exists():
            discrepancies.append("definition.pbir ausente no Report.")
        else:
            try:
                with open(pbir_path, "r", encoding="utf-8") as f:
                    pbir_data = json.load(f)
                    by_path = pbir_data.get("datasetReference", {}).get("byPath", {}).get("path", "")
                    if not by_path or not (rep_dir / by_path).resolve().exists():
                        discrepancies.append(f"datasetReference.byPath inválido no definition.pbir: '{by_path}'")
            except Exception as e:
                discrepancies.append(f"Erro de parsing no definition.pbir: {e}")

        report_json_path = rep_dir / "report.json"
        if not report_json_path.exists():
            discrepancies.append("report.json ausente no Report.")
        else:
            try:
                with open(report_json_path, "r", encoding="utf-8") as f:
                    rep_data = json.load(f)
                    sections = rep_data.get("sections", [])
                    if len(sections) < 4:
                        discrepancies.append(f"Poucas páginas no report.json ({len(sections)} < 4).")
                    if table_fields:
                        for sec in sections:
                            for vc in sec.get("visualContainers", []):
                                vc_cfg = vc.get("config", "{}")
                                cfg_obj = json.loads(vc_cfg) if isinstance(vc_cfg, str) else vc_cfg
                                projections = cfg_obj.get("singleVisual", {}).get("projections", {})
                                for proj_items in projections.values():
                                    for item in proj_items:
                                        qref = str(item.get("queryRef", ""))
                                        if "." in qref:
                                            t_ref, f_ref = qref.split(".", 1)
                                            if t_ref not in table_fields or f_ref not in table_fields[t_ref]:
                                                discrepancies.append(
                                                    f"Referência visual inválida '{qref}' na página '{sec.get('displayName')}'."
                                                )
            except Exception as e:
                discrepancies.append(f"Erro de parsing no report.json: {e}")

        theme_path = rep_dir / "StaticResources" / "RegisteredResources" / "EcoBITheme.json"
        if not theme_path.exists():
            discrepancies.append("EcoBITheme.json ausente no Report.")
        else:
            try:
                with open(theme_path, "r", encoding="utf-8") as f:
                    theme_data = json.load(f)
                    colors = theme_data.get("dataColors", [])
                    for c_name, c_hex in config.OFFICIAL_THEME_COLORS.items():
                        if c_hex not in colors:
                            discrepancies.append(f"Cor oficial '{c_name}' ({c_hex}) ausente na paleta do tema.")
            except Exception as e:
                discrepancies.append(f"Erro de parsing no EcoBITheme.json: {e}")

    # Reconciliação Numérica com Dados CSV em data/
    csv_data_dir = base_dir / "data"
    fact_csv = csv_data_dir / "FactOperacoesMensais.csv"
    reconciled_kpis: Dict[str, Any] = {}
    max_diff: float = 0.0

    if fact_csv.exists():
        try:
            df_fact = pd.read_csv(fact_csv)
            rec_bruta_sum = float(df_fact["ReceitaBruta"].sum()) if "ReceitaBruta" in df_fact.columns else 0.0
            rec_liq_sum = float(df_fact["ReceitaLiquida"].sum()) if "ReceitaLiquida" in df_fact.columns else 0.0
            custo_tot_sum = float(df_fact["CustoTotal"].sum()) if "CustoTotal" in df_fact.columns else 0.0
            lucro_op_sum = float(df_fact["LucroOperacional"].sum()) if "LucroOperacional" in df_fact.columns else 0.0
            scope1_sum = float(df_fact["Scope1CO2eTons"].sum()) if "Scope1CO2eTons" in df_fact.columns else 0.0
            scope2_sum = float(df_fact["Scope2CO2eTons"].sum()) if "Scope2CO2eTons" in df_fact.columns else 0.0
            gross_emiss_sum = float(df_fact["TotalGrossEmissionsCO2eTons"].sum()) if "TotalGrossEmissionsCO2eTons" in df_fact.columns else 0.0
            credits_sum = float(df_fact["CreditosCarbonoTCO2e"].sum()) if "CreditosCarbonoTCO2e" in df_fact.columns else 0.0

            reconciled_kpis = {
                "receita_bruta_total": round(rec_bruta_sum, 2),
                "receita_liquida_total": round(rec_liq_sum, 2),
                "custo_total": round(custo_tot_sum, 2),
                "lucro_operacional_total": round(lucro_op_sum, 2),
                "scope1_co2e_tons": round(scope1_sum, 4),
                "scope2_co2e_tons": round(scope2_sum, 4),
                "total_gross_emissions_co2e_tons": round(gross_emiss_sum, 4),
                "creditos_carbono_tco2e": round(credits_sum, 4),
            }

            if expected_kpis:
                # Tolerância estrita de reconciliação de 1e-4
                for k, exp_val in expected_kpis.items():
                    if k in reconciled_kpis:
                        act_val = reconciled_kpis[k]
                        diff = abs(float(act_val) - float(exp_val))
                        if diff > max_diff:
                            max_diff = diff
                        if diff > 1e-4:
                            discrepancies.append(
                                f"Discrepância numérica no KPI '{k}': esperado {exp_val}, real {act_val} (diff: {diff:.6f})."
                            )
        except Exception as e:
            discrepancies.append(f"Falha na reconciliação dos CSVs: {e}")
    else:
        discrepancies.append("Arquivo de dados FactOperacoesMensais.csv ausente em data/.")

    is_valid = len(discrepancies) == 0
    return {
        "valid": is_valid,
        "bundle_dir": str(base_dir),
        "reconciled_kpis": reconciled_kpis,
        "reconciliation_tolerance": max_diff,
        "discrepancies": discrepancies,
    }


# ============================================================================
# Geração Completa do Projeto PBIP/PBIR
# ============================================================================

def generate_pbip_project(
    project_id: str,
    analysis_ids: List[str],
    report_title: str,
    actor: str = "system",
) -> Dict[str, Any]:
    """Gera o projeto Power BI (.pbip e .pbir) a partir de análises validadas.

    REGRA BLOQUEANTE DE GOVERNANÇA:
    Consulta get_validation_by_analysis para cada ID. Se faltar validação ou se
    status for 'REJEITADO', levanta ValueError imediato bloqueando a geração.
    """
    if not analysis_ids:
        raise ValueError("Ao menos uma análise deve ser selecionada para exportação.")

    # 1. Inspeção Bloqueante de Governança
    validations_map: Dict[str, Dict[str, Any]] = {}
    analyses_map: Dict[str, Dict[str, Any]] = {}

    for aid in analysis_ids:
        an_rec = database.get_analysis(aid)
        if not an_rec:
            raise ValueError(
                f"Bloqueio de governança: análise com ID '{aid}' não encontrada no sistema."
            )
        analyses_map[aid] = an_rec

        val_rec = database.get_validation_by_analysis(aid)
        if not val_rec:
            raise ValueError(
                f"Bloqueio de governança: análise rejeitada ou não validada não pode ser "
                f"publicada no Power BI (análise '{aid}' não possui laudo de validação emitido)."
            )

        status_val = str(val_rec.get("status", "")).upper()
        if status_val == "REJEITADO":
            raise ValueError(
                f"Bloqueio de governança: análise rejeitada ou não validada não pode ser "
                f"publicada no Power BI (análise '{aid}' possui parecer REJEITADO)."
            )

        validations_map[aid] = val_rec

    # 2. Definição de Estrutura de Diretórios
    slug = _slugify(report_title)
    bundle_dir = config.EXPORTS_DIR / project_id / slug
    bundle_dir.mkdir(parents=True, exist_ok=True)

    sem_model_dir = bundle_dir / f"{slug}.SemanticModel"
    sem_model_dir.mkdir(parents=True, exist_ok=True)

    report_dir = bundle_dir / f"{slug}.Report"
    report_dir.mkdir(parents=True, exist_ok=True)

    static_res_dir = report_dir / "StaticResources" / "RegisteredResources"
    static_res_dir.mkdir(parents=True, exist_ok=True)

    data_dir = bundle_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    # 3. Consolidação dos Dados dos CSVs Auditados
    monthly_rows: List[Dict[str, Any]] = []
    simulation_rows: List[Dict[str, Any]] = []
    predictive_rows: List[Dict[str, Any]] = []
    validation_rows: List[Dict[str, Any]] = []

    expected_kpis_for_check: Dict[str, Any] = {}
    monthly_rows_by_source: Dict[tuple, Dict[str, Any]] = {}

    for aid in analysis_ids:
        an = analyses_map[aid]
        an_type = an.get("analysis_type", "")
        res_raw = an.get("result_json", {})
        if isinstance(res_raw, str):
            try:
                res_data = json.loads(res_raw)
            except Exception:
                res_data = {}
        else:
            res_data = res_raw or {}

        # Fatos Mensais de Análise Financeira/ESG
        if an_type == "financial_esg":
            dataset_id = str(an.get("dataset_id") or "")
            if not dataset_id:
                raise ValueError(f"A análise financeira '{aid}' não possui dataset de origem para reconciliação.")
            source_row_occurrences: Dict[tuple, int] = {}
            analysis_monthly_rows: List[Dict[str, Any]] = []
            for m in res_data.get("monthly_series", []):
                monthly_row = {
                    "Periodo": str(m.get("periodo", "")),
                    "ReceitaBruta": float(m.get("receita_bruta", 0.0)),
                    "ImpostosDevolucoes": float(m.get("impostos_devolucoes", 0.0)),
                    "ReceitaLiquida": float(m.get("receita_liquida", 0.0)),
                    "CustoFixo": float(m.get("custo_fixo", 0.0)),
                    "CustoVariavel": float(m.get("custo_variavel", 0.0)),
                    "CustoTotal": float(m.get("custo_total", 0.0)),
                    "LucroOperacional": float(m.get("lucro_operacional", 0.0)),
                    "EnergiaKwh": float(m.get("energia_kwh", 0.0)),
                    "CombustivelLitros": float(m.get("combustivel_litros", 0.0)),
                    "ResiduosGeradosKg": float(m.get("residuos_gerados_kg", 0.0)),
                    "ResiduosRecicladosKg": float(m.get("residuos_reciclados_kg", 0.0)),
                    "ResiduosAterroKg": max(0.0, float(m.get("residuos_gerados_kg", 0.0)) - float(m.get("residuos_reciclados_kg", 0.0))),
                    "DevolucoesLogisticaReversaUn": float(m.get("devolucoes_logistica_reversa_un", 0.0)),
                    "VolumeTotalEntregasUn": float(m.get("volume_total_entregas_un", 0.0)),
                    "Scope1CO2eTons": float(m.get("scope1_co2e_tons", 0.0)),
                    "Scope2CO2eTons": float(m.get("scope2_co2e_tons", 0.0)),
                    "Scope3CO2eTons": float(m.get("scope3_co2e_tons", 0.0)),
                    "TotalGrossEmissionsCO2eTons": float(m.get("total_gross_emissions_co2e_tons", 0.0)),
                    "CreditosCarbonoTCO2e": float(m.get("creditos_carbono_tco2e", 0.0)),
                }
                analysis_monthly_rows.append(monthly_row)
                source_row_id = m.get("source_row_id")
                if source_row_id is None:
                    source_signature = (dataset_id, tuple(monthly_row.items()))
                    occurrence = source_row_occurrences.get(source_signature, 0)
                    source_row_occurrences[source_signature] = occurrence + 1
                    source_key = (*source_signature, occurrence)
                else:
                    source_key = (dataset_id, str(source_row_id))

                existing_row = monthly_rows_by_source.get(source_key)
                if existing_row is not None:
                    if existing_row != monthly_row:
                        raise ValueError(
                            f"Período de origem inconsistente em análises financeiras do dataset '{dataset_id}'."
                        )
                    continue
                monthly_rows_by_source[source_key] = monthly_row
                monthly_rows.append(monthly_row)

            fin_k = res_data.get("financial_kpis", {})
            esg_k = res_data.get("esg_kpis", {})
            source_totals = {
                "receita_liquida_total": (
                    sum(row["ReceitaLiquida"] for row in analysis_monthly_rows),
                    float(fin_k.get("receita_liquida_total", 0.0)),
                ),
                "total_gross_emissions_co2e_tons": (
                    sum(row["TotalGrossEmissionsCO2eTons"] for row in analysis_monthly_rows),
                    float(esg_k.get("total_gross_emissions_co2e_tons", 0.0)),
                ),
            }
            for metric, (source_total, analysis_total) in source_totals.items():
                if abs(source_total - analysis_total) > 1e-4:
                    raise ValueError(
                        f"A série mensal da análise '{aid}' não reconcilia com o KPI '{metric}'."
                    )

        # Fatos de Cenários What-If
        elif an_type == "scenario":
            sim_sc = res_data.get("simulated_scenario", {})
            simulation_rows.append({
                "IdSimulacao": aid,
                "CenarioNome": str(an.get("prompt_text", "Cenário What-If")),
                "EconomiaProjetadaBRL": float(sim_sc.get("projected_cost_savings_brl", 0.0)),
                "EmissoesEvitadasTCO2e": float(sim_sc.get("projected_emissions_avoided_co2e_tons", 0.0)),
                "InvestimentoAmbientalBRL": float(sim_sc.get("environmental_investment_brl", 0.0)),
                "NovaEmissaoTotalTCO2e": float(sim_sc.get("projected_total_gross_emissions_co2e_tons", 0.0)),
            })

        # Fatos Preditivos
        elif an_type == "predictive":
            metrics = res_data.get("metrics", {})
            w_mod = float(metrics.get("model_wape", 0.0))
            w_base = float(metrics.get("baseline_wape", 0.0))
            for f_item in res_data.get("forecast", []):
                predictive_rows.append({
                    "Periodo": str(f_item.get("period", "")),
                    "Target": str(res_data.get("target_column", "Receita")),
                    "ValorPrevisto": float(f_item.get("predicted_value", 0.0)),
                    "LimiteInferior90": float(f_item.get("ci_lower_90", 0.0)),
                    "LimiteSuperior90": float(f_item.get("ci_upper_90", 0.0)),
                    "WAPE_Modelo": w_mod,
                    "WAPE_Baseline": w_base,
                })

        # Dimensão de Validação e Governança
        val = validations_map[aid]
        rules_list = []
        if isinstance(val.get("rules_json"), str):
            try:
                rules_list = json.loads(val["rules_json"])
            except Exception:
                rules_list = []
        elif isinstance(val.get("rules_json"), list):
            rules_list = val["rules_json"]

        total_rules = len(rules_list)
        passed_rules = sum(1 for r in rules_list if r.get("status") in ("PASSED", "PASSOU", "OK"))

        validation_rows.append({
            "IdAnalise": aid,
            "StatusValidacao": str(val.get("status", "APROVADO")),
            "DataValidacao": str(val.get("created_at", "")),
            "TotalRegras": total_rules,
            "RegrasAprovadas": passed_rules,
            "Ressalvas": str(val.get("discrepancies_json", "Nenhuma")),
        })

    if monthly_rows:
        expected_kpis_for_check = {
            "receita_bruta_total": round(sum(row["ReceitaBruta"] for row in monthly_rows), 2),
            "receita_liquida_total": round(sum(row["ReceitaLiquida"] for row in monthly_rows), 2),
            "total_gross_emissions_co2e_tons": round(
                sum(row["TotalGrossEmissionsCO2eTons"] for row in monthly_rows), 4
            ),
            "scope1_co2e_tons": round(sum(row["Scope1CO2eTons"] for row in monthly_rows), 4),
            "scope2_co2e_tons": round(sum(row["Scope2CO2eTons"] for row in monthly_rows), 4),
            "scope3_co2e_tons": round(sum(row["Scope3CO2eTons"] for row in monthly_rows), 4),
            "creditos_carbono_tco2e": round(sum(row["CreditosCarbonoTCO2e"] for row in monthly_rows), 4),
        }

    # Geração da DimCalendario baseada nos períodos encontrados
    calendar_rows: List[Dict[str, Any]] = []
    seen_periods = set()
    for row in monthly_rows + predictive_rows:
        per = str(row.get("Periodo", "")).strip()
        if per and per not in seen_periods:
            seen_periods.add(per)
            year = 2024
            month = 1
            try:
                parts = per.split("-")
                year = int(parts[0])
                month = int(parts[1]) if len(parts) > 1 else 1
            except Exception:
                pass
            month_names = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
            m_name = month_names[month - 1] if 1 <= month <= 12 else "ND"
            calendar_rows.append({
                "Periodo": per,
                "Ano": year,
                "Mes": month,
                "NomeMes": m_name,
                "AnoMes": f"{year}-{month:02d}",
            })

    calendar_rows.sort(key=lambda x: x["Periodo"])

    # Gravação dos CSVs em data/
    def _write_csv(file_path: Path, rows: List[Dict[str, Any]], fieldnames: List[str]) -> None:
        with open(file_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            if rows:
                writer.writerows(rows)

    _write_csv(
        data_dir / "FactOperacoesMensais.csv",
        monthly_rows,
        [
            "Periodo", "ReceitaBruta", "ImpostosDevolucoes", "ReceitaLiquida", "CustoFixo",
            "CustoVariavel", "CustoTotal", "LucroOperacional", "EnergiaKwh", "CombustivelLitros",
            "ResiduosGeradosKg", "ResiduosRecicladosKg", "ResiduosAterroKg",
            "DevolucoesLogisticaReversaUn", "VolumeTotalEntregasUn", "Scope1CO2eTons",
            "Scope2CO2eTons", "Scope3CO2eTons", "TotalGrossEmissionsCO2eTons", "CreditosCarbonoTCO2e",
        ],
    )

    _write_csv(
        data_dir / "DimCalendario.csv",
        calendar_rows,
        ["Periodo", "Ano", "Mes", "NomeMes", "AnoMes"],
    )

    _write_csv(
        data_dir / "FactPrevisoes.csv",
        predictive_rows,
        ["Periodo", "Target", "ValorPrevisto", "LimiteInferior90", "LimiteSuperior90", "WAPE_Modelo", "WAPE_Baseline"],
    )

    _write_csv(
        data_dir / "FactSimulacoes.csv",
        simulation_rows,
        ["IdSimulacao", "CenarioNome", "EconomiaProjetadaBRL", "EmissoesEvitadasTCO2e", "InvestimentoAmbientalBRL", "NovaEmissaoTotalTCO2e"],
    )

    _write_csv(
        data_dir / "DimValidacao.csv",
        validation_rows,
        ["IdAnalise", "StatusValidacao", "DataValidacao", "TotalRegras", "RegrasAprovadas", "Ressalvas"],
    )

    # 4. Gravação dos Arquivos Oficiais do Power BI Project
    # <Slug>.pbip
    pbip_content = {
        "version": "1.0",
        "artifacts": [{"report": {"path": f"{slug}.Report"}}],
        "settings": {"enableAutoRecovery": True},
    }
    pbip_file_path = bundle_dir / f"{slug}.pbip"
    with open(pbip_file_path, "w", encoding="utf-8") as f:
        json.dump(pbip_content, f, indent=2, ensure_ascii=False)

    # <Slug>.SemanticModel/definition.pbism
    pbism_content = {"version": "1.0", "settings": {}}
    with open(sem_model_dir / "definition.pbism", "w", encoding="utf-8") as f:
        json.dump(pbism_content, f, indent=2, ensure_ascii=False)

    # <Slug>.SemanticModel/model.bim
    model_bim_content = _build_model_bim(slug, data_dir=data_dir)
    with open(sem_model_dir / "model.bim", "w", encoding="utf-8") as f:
        json.dump(model_bim_content, f, indent=2, ensure_ascii=False)

    # <Slug>.Report/definition.pbir
    pbir_content = {
        "version": "1.0",
        "datasetReference": {
            "byPath": {"path": f"../{slug}.SemanticModel"},
            "byConnection": None,
        },
    }
    with open(report_dir / "definition.pbir", "w", encoding="utf-8") as f:
        json.dump(pbir_content, f, indent=2, ensure_ascii=False)

    # <Slug>.Report/report.json
    report_json_content = _build_report_json()
    with open(report_dir / "report.json", "w", encoding="utf-8") as f:
        json.dump(report_json_content, f, indent=2, ensure_ascii=False)

    # <Slug>.Report/StaticResources/RegisteredResources/EcoBITheme.json
    theme_content = _build_theme_json()
    with open(static_res_dir / "EcoBITheme.json", "w", encoding="utf-8") as f:
        json.dump(theme_content, f, indent=2, ensure_ascii=False)

    # 5. Validação Determinística do Bundle Gerado
    val_result = validate_pbip_bundle(bundle_dir, expected_kpis=expected_kpis_for_check if expected_kpis_for_check else None)
    if not val_result["valid"]:
        raise ValueError(
            f"Falha na validação técnica do bundle PBIP gerado: {val_result['discrepancies']}"
        )

    # 6. Empacotamento em Arquivo .ZIP
    zip_path = config.EXPORTS_DIR / project_id / f"{slug}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for file_p in bundle_dir.rglob("*"):
            if file_p.is_file():
                arcname = file_p.relative_to(bundle_dir.parent)
                zipf.write(file_p, arcname=arcname)

    # Determinação do status consolidado de validação (APROVADO ou APROVADO_COM_RESSALVAS)
    all_statuses = [validations_map[aid].get("status") for aid in analysis_ids]
    final_validation_status = (
        "APROVADO_COM_RESSALVAS"
        if "APROVADO_COM_RESSALVAS" in all_statuses
        else "APROVADO"
    )

    # 7. Persistência em PowerBI Reports e Logs de Auditoria
    pbi_record = database.create_powerbi_report(
        project_id=project_id,
        analysis_id=analysis_ids[0] if len(analysis_ids) == 1 else None,
        validation_id=validations_map[analysis_ids[0]]["id"] if len(analysis_ids) == 1 else None,
        report_name=report_title,
        bundle_dir=str(bundle_dir),
        zip_path=str(zip_path),
        validation_status=final_validation_status,
        structure_valid=True,
        reconciliation=val_result.get("reconciled_kpis", {}),
    )

    database.log_audit(
        actor=actor,
        action="POWERBI_PBIP_GENERATED_SUCCESSFULLY",
        resource_type="powerbi_report",
        resource_id=pbi_record["id"],
        project_id=project_id,
        details={
            "report_title": report_title,
            "bundle_dir": str(bundle_dir),
            "zip_path": str(zip_path),
            "analyses_included": analysis_ids,
            "validation_status": final_validation_status,
            "measures_count": len(OFFICIAL_DAX_MEASURES),
        },
    )

    return {
        "report_id": pbi_record["id"],
        "project_id": project_id,
        "report_title": report_title,
        "slug": slug,
        "pbip_path": str(pbip_file_path),
        "bundle_dir": str(bundle_dir),
        "bundle_path": str(bundle_dir),
        "zip_path": str(zip_path),
        "status": "GENERATED_SUCCESSFULLY",
        "validation_status": final_validation_status,
        "structure_valid": True,
        "reconciliation": val_result.get("reconciled_kpis", {}),
        "analyses_included": analysis_ids,
        "created_at": pbi_record["created_at"],
    }
