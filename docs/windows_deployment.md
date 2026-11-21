# Manual de Implantação e Operação do EcoBI Intelligence no Windows

Este documento descreve os procedimentos de instalação, inicialização, operação, gestão de logs, backups e solução de problemas do **EcoBI Intelligence** para o Release Piloto Corporativo em ambiente Windows.

---

## 1. Visão Geral da Arquitetura de Implantação

O EcoBI Intelligence é projetado como uma aplicação **local-first** que roda diretamente na estação de trabalho corporativa:
- **Backend**: Python + FastAPI servido pelo Uvicorn em loopback (`http://127.0.0.1:8000`).
- **Banco de Dados**: SQLite em modo WAL (`data/runtime/ecobi.db`), sem necessidade de servidor de banco externo para operação independente.
- **Frontend**: Interface web nativa Sustainable Tech (`frontend/`) servida estaticamente e aberta no navegador padrão do sistema.
- **Segurança**: Bloqueio total de IA externa (`BLOCK_EXTERNAL_AI=True`), autenticação local com RBAC, trilha de auditoria completa em `audit_logs` e compatibilidade total com a LGPD.

---

## 2. Pré-requisitos de Sistema

- **Sistema Operacional**: Windows 10 ou Windows 11 (64-bit).
- **Memória RAM**: Mínimo de 8 GB recomendados (o EcoBI opera com teto estrito de 8192 MB de RAM).
- **Armazenamento**: 1 GB de espaço livre em disco para runtime, logs e backups locais.
- **Opcional (IA Generativa Avançada)**: Daemon [Ollama](https://ollama.com/) local instalado com o modelo `qwen3.5:4b` ou `qwen2.5:3b`. Caso o Ollama não esteja em execução, o assistente opera em modo determinístico local sem interrupção das funções analíticas.

---

## 3. Estrutura de Diretórios de Dados

Ao iniciar, o launcher garante automaticamente a criação da seguinte estrutura sob a pasta `data/`:
```text
EcoBI/
├── data/
│   ├── runtime/      # Banco de dados SQLite de produção (ecobi.db, ecobi.db-wal)
│   ├── logs/         # Logs operacionais com rotação (ecobi.log, ecobi.log.1..)
│   ├── backups/      # Backups online atômicos assinados (*.db.bak)
│   ├── exports/      # Pacotes gerados do Power BI (PBIP/PBIR) e relatórios
│   └── watched/      # Diretório padrão para ingestão por watched_directory
```

---

## 4. Como Iniciar a Aplicação

### Método 1: Duplo-Clique (Operadores e Usuários Finais)
1. Navegue até a pasta do projeto.
2. Dê duplo-clique no arquivo `start.bat` na raiz do projeto (ou `scripts\start_ecobi.bat`).
3. O script aciona automaticamente o PowerShell com política local de execução, prepara o ambiente `.venv` na primeira execução, inicializa o banco SQLite e o runtime Ollama local (`qwen3.5:4b`) e abre o navegador padrão em `http://127.0.0.1:8000` após o readiness check (`/api/health` e `/`).

### Método 2: PowerShell (Administradores e Técnicos)
Abra o PowerShell na pasta do projeto e execute:
```powershell
.\start.ps1
# ou diretamente:
.\scripts\start_ecobi.ps1
```
Parâmetros opcionais disponíveis:
```powershell
.\start.ps1 -Port 8080 -NoBrowser
.\start.ps1 -AutoApprove   # Autoriza instalação do Ollama e download do modelo sem prompt interativo
```

### Método 3: Validação de Ambiente (Check-Only)
Para verificar se o banco de dados e as dependências estão íntegros sem subir o servidor HTTP:
```powershell
.\.venv\Scripts\python.exe scripts\ecobi_launcher.py --check-only
```

---

## 5. Gestão de Logs e Auditoria

- **Arquivo Principal de Log**: `data/logs/ecobi.log`.
- **Política de Rotação**: Arquivos limitados a 10 MB cada, mantendo até 5 arquivos de histórico rotacionados (`ecobi.log.1`, `ecobi.log.2`, etc.).
- **Auditoria de Conformidade**: Todas as ações críticas (login, importação de bases, criação de análises, execução de agendamentos e geração de backups) são registradas de forma indelével na tabela `audit_logs` do SQLite.

---

## 6. Automação de Sincronização e Backups

O EcoBI conta com um agendador local assíncrono cooperativo (`backend/services/scheduler.py`):
1. **Sincronização de Conectores**: Ingestão incremental automática configurável por minutos ou diária.
2. **Backups Assinados**: Backups online do SQLite gerados periodicamente com assinatura criptográfica HMAC-SHA256.
3. **Trial Restore**: Todo backup automático executa uma rotina de restauração experimental em banco temporário, validando a integridade física (`PRAGMA integrity_check`) sem tocar nos dados ativos.
4. **Política de Retenção LGPD**: Backups com mais de 30 dias (ou excedentes a 10 cópias) são expurgados de maneira auditada.

---

## 7. Solução de Problemas (Troubleshooting)

| Sintoma | Causa Provável | Ação Recomendada |
|---|---|---|
| Porta 8000 ocupada | Outro processo local está utilizando a porta 8000 | Inicie com porta alternativa: `.\scripts\start_ecobi.ps1 -Port 8001` |
| Navegador não abre automaticamente | Política do sistema ou navegador padrão não configurado | Acesse manualmente `http://127.0.0.1:8000` no seu navegador web |
| Erro de banco de dados bloqueado | Processo anterior travou ou outra instância está aberta | Feche as instâncias do Python via Gerenciador de Tarefas e reinicie |
| Backup não verificado | Alteração manual indevida no arquivo `.db.bak` | Consulte o relatório em `POST /api/system/backups/{id}/verify` para ver as divergências detectadas |

---

## 8. Procedimento de Encerramento e Desinstalação

- **Encerramento Limpo**: Pressione `Ctrl+C` na janela do console do launcher. O Uvicorn e o Agendador concluirão as tarefas ativas e fecharão as conexões SQLite com segurança.
O EcoBI não instala serviço próprio de sistema. Se o Ollama foi instalado pelo bootstrap, ele permanece como aplicativo separado no perfil do usuário; remova-o pelo desinstalador do Ollama antes de excluir os modelos locais, se desejar recuperar espaço.


## Inicialização por um comando
Na raiz do repositório, execute `.\start.ps1` (ou dê duplo-clique em `start.bat`). O script delega a `scripts/start_ecobi.ps1`, prepara o `.venv` local com Python 3.11+ e instala dependências só nesse ambiente. Na primeira inicialização normal do Windows, o launcher verifica espaço livre (~5 GB recomendados), procura Ollama; se estiver ausente, baixa o instalador oficial (com `-AutoApprove` ou confirmação interativa), verifica a assinatura Authenticode do editor (`O=Ollama Inc.`), instala no perfil do usuário e baixa somente o modelo padrão configurado, validando em seguida a API HTTP em `127.0.0.1:11434/api/tags`. O fluxo não baixa nem instala nada em `-CheckOnly`, detecta instâncias EcoBI já ativas na mesma porta evitando processos duplicados, falha de modo explícito em porta ocupada ou banco SQLite corrompido/bloqueado e mantém o fallback analítico local com `BLOCK_EXTERNAL_AI=True`.
