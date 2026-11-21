# EcoBI Intelligence

**Plataforma Corporativa Local-First de Inteligência Financeira, Contabilidade ESG (GHG Protocol), Modelagem Preditiva, Simulação What-If, Validação Determinística e Geração Automatizada de Projetos Power BI (PBIP/PBIR).**

---

## 1. Visão Geral e Arquitetura

O **EcoBI Intelligence** é um sistema monolítico modular **100% local-first** projetado para operar em estações de trabalho corporativas com orçamento estrito de memória RAM de **no máximo 8 GB (8192 MB)** para o processo do EcoBI, sem qualquer envio de dados empresariais para APIs de IA em nuvem externa.

### Pilares Arquiteturais
- **Backend e Orquestração**: Python 3.11+ e FastAPI (`backend/main.py`) servindo tanto a API REST (`/api/*`) quanto a interface web estática (`frontend/`).
- **Persistência Transacional**: SQLite 3 local (`data/runtime/ecobi.db`) com `PRAGMA journal_mode = WAL`, `PRAGMA foreign_keys = ON`, migrações versionadas (`001_initial_schema`, `002_seed_emission_factors`) e trilha de auditoria imutável.
- **Motores Analíticos Determinísticos**:
  - **Qualidade e Ingestão em Chunking** (`backend/services/data_quality.py`): leitura de arquivos CSV (em blocos de 10.000 linhas) e Excel (`.xlsx`), inferência de tipos, detecção de duplicatas, nulos, inconsistências físicas e preservação integral de outliers suspeitos.
  - **Análise Financeira e ESG** (`backend/services/analytics.py`): cálculo determinístico de Receita Bruta, Receita Líquida, Custos Fixos/Variáveis, Lucro Operacional, Margens, ROI Ambiental, Eficiência Energética e Emissões de GEE (**Escopos 1, 2 e 3** segundo GHG Protocol Brasil / MCTI), mantendo **créditos de carbono estritamente segregados das emissões brutas**.
  - **Motor Preditivo Temporal** (`backend/services/predictive.py`): treinamento com `Scikit-learn` (`Ridge` e `RandomForestRegressor`), divisão cronológica estrita (`shuffle=False`), backtesting em múltiplas janelas, comparação contra *naive baseline* (MAE, RMSE, WAPE e viés) e intervalos de incerteza (P10–P90).
  - **Simulador de Impacto What-If** (`backend/services/simulation.py`): projeção paramétrica condicional separando explicitamente `historical_values`, `forecast_values`, `simulated_scenario` e `observed_impacts`.
- **Governança e Portão de Publicação** (`backend/services/validation_engine.py`): motor de validação determinístico que audita análises e emite parecer `APROVADO`, `APROVADO_COM_RESSALVAS` ou `REJEITADO`, bloqueando terminantemente a exportação para o Power BI de qualquer análise `REJEITADO`.
- **Assistente IA Local com Allowlist Fechada** (`backend/services/llm_agent.py`): integração via API REST local do **Ollama** (`http://127.0.0.1:11434`) usando `qwen3.5:4b` por padrão (e `qwen3.5:9b` opcional condicionado à memória livre >= 10 GB), restrito a **6 ferramentas autorizadas** validadas por Pydantic e com fallback determinístico offline.
- **Gerador Nativo Power BI Desktop** (`backend/services/powerbi_generator.py`): geração automatizada de pacotes **PBIP / PBIR** contendo `.pbip`, `definition.pbism`, `model.bim` (compatibilityLevel 1567, 5 tabelas, relacionamentos e 10 medidas DAX oficiais), `definition.pbir`, `report.json` (4 páginas executivas), tema visual `EcoBITheme.json`, dados CSV reconciliados (`tolerância <= 1e-4`) e arquivo `.zip` para download.
- **Interface Web Sustainable Tech** (`frontend/index.html`, `frontend/styles.css`, `frontend/app.js`): 10 telas acessíveis (WCAG 2.1 AA, `:focus-visible`, `prefers-reduced-motion`) utilizando a paleta oficial `#183A32`, `#4F7A59`, `#B9D6C2`, `#DCE8D9`, `#F5F6F0` e `#C8784A`.

---

## 2. Estrutura do Diretório

```text
EcoBI/
├── AGENTS.md                        # Regras globais de engenharia e governança
├── PLAN.md                          # Plano diretor e arquitetura do sistema
├── README.md                        # Documentação técnica e guia de execução
├── requirements.txt                 # Dependências de produção
├── requirements-dev.txt             # Dependências de desenvolvimento e testes
├── .env.example                     # Template de variáveis de ambiente locais
├── .specs/                          # Especificações, design, tarefas e verificação (TLC Spec-Driven)
├── backend/
│   ├── config.py                    # Configurações centralizadas e orçamento de 8 GB RAM
│   ├── database.py                  # Camada SQLite WAL, migrações 001-002, CRUD e expurgo LGPD
│   ├── security.py                  # Sessões locais, RBAC, mascaramento PII, anti-injection e Path Traversal
│   ├── memory_guard.py              # Governança de memória RAM via psutil e semáforo LLM
│   ├── main.py                      # Aplicação FastAPI (rotas REST /api/* e servidor estático)
│   └── services/
│       ├── data_quality.py          # Ingestão em chunks, perfilamento de qualidade e mapeamento canônico
│       ├── connectors.py            # Conectores somente-leitura (SQLite, PostgreSQL, Diretório) e ingestão incremental
│       ├── analytics.py             # Motor determinístico Financeiro, ESG (Escopos 1, 2 e 3) e Benchmark Setorial
│       ├── predictive.py            # Motor preditivo Scikit-learn com split temporal e backtesting
│       ├── drift_monitor.py         # Monitoramento determinístico de Drift (PSI) e degradação de WAPE
│       ├── recalibration.py         # Recalibração preditiva assistida (Incumbente vs Candidato vs Promovido)
│       ├── simulation.py            # Simulador de cenários What-If com premissas explícitas
│       ├── validation_engine.py     # Validation Engine determinístico (APROVADO / RESSALVAS / REJEITADO)
│       ├── llm_agent.py             # Agente Ollama local (6 tools), benchmark 4B vs 9B e unload ocioso
│       ├── lora_evaluator.py        # Pipeline local de avaliação experimental de adaptadores LoRA setoriais
│       ├── scheduler.py             # Agendador local assíncrono cooperativo (sync conectores e backup online)
│       ├── multiproject.py          # Consolidação executiva multiprojeto, ranking e governança RBAC
│       └── powerbi_generator.py     # Gerador e validador de pacotes Power BI PBIP/PBIR (.zip)
├── frontend/
│   ├── index.html                   # 12 telas/seções da interface Sustainable Tech
│   ├── styles.css                   # Design System CSS3 responsivo e acessível
│   └── app.js                       # Lógica cliente Vanilla JS ES6+ integrada à API
├── scripts/
│   ├── ecobi_launcher.py            # Launcher Windows com validação de banco, migrations e health check
│   ├── start_ecobi.bat              # Script duplo-clique de inicialização rápida
│   └── start_ecobi.ps1              # Script PowerShell de inicialização e monitoramento
├── docs/
│   └── windows_deployment.md        # Guia completo de implantação, operação e troubleshooting no Windows
├── ecobi.spec                       # Especificação PyInstaller para empacotamento executável Windows
├── samples/
│   ├── generate_samples.py          # Gerador determinístico de datasets sintéticos
│   ├── ecobi_varejo_piloto.csv      # Série limpa de 24 meses para fluxo piloto completo
│   ├── ecobi_dados_adversos.csv     # Dataset adverso (duplicatas, nulos, outliers, PII e injection)
│   └── ecobi_curto_insuficiente.csv # Série curta (5 meses) para validação de bloqueio preditivo
└── tests/                           # Suíte automatizada Pytest (33 testes cobrindo C1 a C24)
```

---

## 3. Instalação e Execução Local

### 3.1. Pré-requisitos
- **Python**: 3.11 ou superior (testado em Python 3.13 no Windows).
- **Memória RAM**: 8 GB disponíveis para o EcoBI (16 GB no host recomendados para uso simultâneo com Power BI Desktop).
- **Opcional**: [Ollama](https://ollama.com/) instalado localmente (`127.0.0.1:11434`) com o modelo `qwen3.5:4b` e [Power BI Desktop](https://powerbi.microsoft.com/desktop/) para abertura visual dos arquivos `.pbip`.

### 3.2. Configuração do Ambiente Virtual
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

### 3.3. Inicialização Rápida no Windows (Release Piloto)
Para iniciar a aplicação com bootstrap automatizado, verificação de integridade do banco SQLite, aplicação de migrações e abertura automática da interface no navegador:
```powershell
.\scripts\start_ecobi.bat
# ou via PowerShell:
.\scripts\start_ecobi.ps1
# ou via Launcher Python:
.\.venv\Scripts\python.exe scripts/ecobi_launcher.py
```
Acesse no navegador: **`http://127.0.0.1:8000`**

---

## 4. Execução dos Testes e Verificação de Qualidade

Para validar a compilação e executar toda a suíte de testes unitários, de integração e de governança (`C1` a `C24`):

```powershell
.\.venv\Scripts\python.exe -m compileall -q backend samples tests scripts
.\.venv\Scripts\python.exe -m pytest -v
```

### Resultado Verificado da Suíte
- **Total de testes**: `33 passed, 0 failed` (21 testes do MVP `C1`–`C12` + 4 testes da Fase 2 `C13`–`C16` + 4 testes da Fase 3 `C17`–`C20` + 4 testes da Fase 4 `C21`–`C24`).
- **Consumo medido de RAM (`psutil`)**: `~230.12 MB RSS` (**2.81%** do orçamento máximo de `8192.0 MB`).
- **Funcionalidades da Fase 4 integradas**:
  - `scripts/ecobi_launcher.py`, `scripts/start_ecobi.bat`, `scripts/start_ecobi.ps1`, `ecobi.spec`, `docs/windows_deployment.md` (Empacotamento Windows e Lifecycle Bootstrap C21).
  - `POST /api/scheduler/jobs`, `GET /api/scheduler/jobs`, `POST /api/scheduler/jobs/{id}/toggle`, `POST /api/scheduler/jobs/{id}/run-now`, `GET /api/scheduler/runs` (Agendador Assíncrono Cooperativo de Sincronização Incremental de Conectores e Backup Online SQLite assinado com HMAC-SHA256, expurgo LGPD e restore trial C22/C23).
  - `GET /api/multiproject/overview`, `POST /api/multiproject/compare`, `GET /api/multiproject/ranking` (Visão executiva multiprojeto, separação de créditos de carbono, linhagem REAL vs ESTIMADO, ranking de ecoeficiência e controle estrito por RBAC C24).
- **Funcionalidades da Fase 2 integradas**:
  - `POST /api/projects/{project_id}/drift/analyze` e `GET /api/projects/{project_id}/drift/reports` (Monitoramento de Drift PSI e degradação de WAPE).
  - `POST /api/system/model-benchmark`, `GET /api/system/model-benchmarks` e `POST /api/settings/model/unload` (Benchmark 4B vs 9B e liberação de RAM de modelos ociosos).
  - `POST /api/system/backups`, `GET /api/system/backups` e `POST /api/system/backups/{backup_id}/verify` (Backup online SQLite com assinatura HMAC-SHA256 e `PRAGMA integrity_check`).
  - `GET /api/users`, `POST /api/users` e `GET /api/sectors/benchmarks` (Gestão multiusuário RBAC e benchmarks de intensidade ESG para 6 setores econômicos).
- **Funcionalidades da Fase 3 integradas**:
  - `POST /api/projects/{project_id}/connectors`, `GET /api/projects/{project_id}/connectors`, `POST /api/projects/{project_id}/connectors/{connector_id}/sync` e `GET /api/projects/{project_id}/connectors/runs` (Conectores corporativos somente-leitura para SQLite externo, PostgreSQL Read-Only e diretórios monitorados com ingestão incremental e linhagem SHA-256).
  - `POST /api/projects/{project_id}/recalibrations/propose`, `GET /api/projects/{project_id}/recalibrations` e `POST /api/projects/{project_id}/recalibrations/{proposal_id}/decide` (Recalibração preditiva assistida com separação estrita entre modelo incumbente, candidato e promovido).
  - `POST /api/system/lora/evaluate` e `GET /api/system/lora/evaluations` (Pipeline local de avaliação experimental de adaptadores LoRA setoriais sob orçamento de 8 GB RAM).

---

## 5. Governança, Segurança, LGPD e Limitações Conhecidas

1. **Soberania de Dados e LGPD**:
   - Nenhuma chamada externa para APIs de IA em nuvem (OpenAI, Anthropic, Google Cloud etc.) é permitida (`BLOCK_EXTERNAL_AI=True`).
   - Dados pessoais (CPF, CNPJ, e-mail, telefone) são automaticamente detectados e mascarados nas visualizações e amostras (`security.mask_pii_dataframe`).
   - O endpoint `POST /api/system/lgpd-purge` (e a exclusão de projeto em cascata) remove transacionalmente registros do banco SQLite e arquivos físicos residuais em `data/` e `exports/`.
2. **Modo Offline do Ollama**:
   - Caso o daemon local do Ollama (`127.0.0.1:11434`) não esteja em execução, o EcoBI Intelligence **não falha**: o assistente aciona automaticamente o roteador determinístico local auditado (`execution_mode: "deterministic_fallback"`), mantendo todas as 6 ferramentas analíticas operacionais.
3. **Abertura de Projetos PBIP/PBIR no Power BI Desktop**:
   - O EcoBI gera e valida toda a estrutura aberta `.pbip` / `.pbir` (`model.bim`, `report.json`, `EcoBITheme.json`, CSVs reconciliados e pacote `.zip`). A renderização interativa final em janela desktop requer o **Microsoft Power BI Desktop** instalado na máquina Windows com o recurso de visualização *Power BI Project (.pbip)* habilitado.


## Inicialização local no Windows

### Estado da homologação final — 2026-11-20

A suíte completa executada nesta retomada passou com **72 testes** e um aviso de depreciação Starlette/httpx. Os testes direcionados dos fluxos revisados passaram (**7**); o onboarding passou em Node (**7**). O TLC `check_proofs.py` registrou **36 provas aprovadas e 0 reprovadas**, mas retorna código não zero porque o worktree está sujo em `HEAD 9e7513b`; a verificação independente continua necessária.

Não há evidência visual nova: o Chrome DevTools MCP exige aprovação indisponível nesta política, e nenhuma outra ferramenta foi usada para contornar a restrição. Ollama não está instalado, portanto instalação real, download de modelo e inferência local não foram comprovados. Os fluxos API usam fixtures sintéticas, e a instalação limpa ainda não foi executada. O EcoBI **não está declarado finalizado**. Consulte `.specs/features/ecobi-finalization/verification.md` e `.specs/features/ecobi-finalization/validation.md` para o estado e os bloqueios atuais.

### Conclusão definitiva — 2026-11-20 (TLC 4.1.0)

A rodada definitiva de conclusão validou o EcoBI em instância local isolada com navegador real (Google Chrome CDP), cobrindo os 12 módulos ponta a ponta, inferência local real com `qwen3.5:4b` (`BLOCK_EXTERNAL_AI=True`), estabilidade do segundo upload sob pressão de RAM, e o tutorial interativo com recorte SVG real, tooltip de altura fixa sem rolagem vertical e sem sobreposição nos 4 viewports (`1440×900`, `1280×800`, `768×1024`, `390×844`) em Light e Dark Mode (18 capturas reais em `.specs/features/ecobi-finalization/evidence/`). Dados corporativos reais e abertura física no Power BI Desktop permanecem fora do ambiente local de validação; consulte `.specs/features/ecobi-finalization/requirement-matrix.md` e `verification.md`.

Execute `.\start.ps1` a partir da pasta do EcoBI, ou `.\start.ps1 -NoBrowser` para não abrir o navegador (ou dê duplo-clique em `start.bat`). O launcher usa o `.venv` do projeto; se ele não existir, localiza automaticamente Python 3.11+ (`py -3`, `py -3.11` ou `python`), cria o `.venv` e instala as dependências declaradas somente nesse ambiente. Quando Ollama ou `qwen3.5:4b` já estão disponíveis, o bootstrap reutiliza sem novo download; em caso de ausência ou falha, mantém o fallback determinístico local com `BLOCK_EXTERNAL_AI=True`.

### Homologação Final Windows — 2026-11-21

- **Suíte automatizada:** `93 passed` em Pytest (`tests/test_resilience_recovery.py`, `tests/test_ollama_bootstrap.py` 21/21, `tests/test_powerbi_generator.py` 3/3, `tests/test_finalization_frontend.py` 3/3, etc.) + `7 passed` em Node (`tests/frontend/onboarding.test.cjs`), `node --check`, `compileall` e AST PowerShell aprovados.
- **Instalação limpa em clone isolado:** validado `start.ps1 -CheckOnly` e inicialização ao vivo em clone `git archive` sem `.venv`/`data`/`.env`, criação automática do `.venv` e instalação de `requirements.txt`, verificação de assinatura Authenticode oficial do `OllamaSetup.exe` (`O=Ollama Inc.`, 1.857.946.272 bytes, sem executar sobre o host), prontidão `/api/health` + `/`, prevenção de instância duplicada na mesma porta e proteção contra porta ocupada/SQLite corrompido.
- **Power BI Desktop (`2.159.1231.0`):** medidas DAX alinhadas às respectivas tabelas, parâmetro M `PastaDados` + `Table.PromoteHeaders` e validação cruzada `queryRef` contra `model.bim`; projeto `.pbip` sintético aberto no Power BI Desktop com processo `PBIDesktop` e engine local `msmdsrv` ativos e janela `EcoBI_Homolog` responsiva sem diálogos de erro.
- **Jornada completa de 17 passos no Google Chrome + reinício:** fluxo ponta a ponta com `qwen3.5:4b` local ativo, 0 erros de console/rede após correção da sessão demo rápida (`analyst`), reinício completo do servidor e persistência verificada (`PRAGMA integrity_check=ok`, `WAL`, `foreign_key_check=[]`).
- **Limites externos mantidos:** ausência de ISO/Sandbox Windows para VM limpa do zero (Ollama pré-existente preservado no host) e ausência de credenciais/servidor PostgreSQL corporativo externo real (`psycopg2` não incluso em `requirements.txt`).
