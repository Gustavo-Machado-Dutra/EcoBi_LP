# EcoBI Intelligence — Landing Page Institucional

> **EcoBI — Onde nasce o Sustentável.**  
> *Inteligência que transforma dados em sustentabilidade.*

Landing page institucional da **EcoBI Intelligence**, empresa de consultoria online que une educação, tecnologia, análise de dados, Inteligência Artificial e Business Intelligence para apoiar pequenas empresas e startups na construção de operações mais eficientes e responsáveis.

---

## Direção Artística & Identidade Visual

- **Minimalismo editorial e apresentação de produto:** ritmo visual que alterna superfícies limpas, fotografia real de natureza, seções tipográficas em linhas arquitetônicas, ambiente imersivo em verde-floresta profundo e demonstrações interativas da plataforma EcoBI Intelligence.
- **Logo oficial preservado:** [`assets/ecobi-logo.png`](assets/ecobi-logo.png).
- **Modo Claro (Editorial):** identidade institucional em branco (`#FFFFFF`), verde escuro (`#396D3C`) e amarelo-dourado (`#F2C230`).
- **Modo Escuro (Base oficial do aplicativo + destaque institucional EcoBI):** reproduz as superfícies e gráficos oficiais de `frontend/styles.css` (`#101522`, `#141A2C`, `#1A2132`, `#252E43`, bordas `#30394D` / `#3C4660`, tipografia `#E4E9F5` / `#B1BAD0` / `#8491A7` e superfície de gráficos `#131A29`), combinados ao amarelo institucional `#F2C230` (hover `#FFD65A`, contraste `#101522`) como principal cor de destaque da identidade EcoBI, preservando cores semânticas e séries ambientais.
- **Alternância e persistência:** detecção automática da preferência do sistema operacional (`prefers-color-scheme`) e persistência em `localStorage` (`ecobi_lp_theme`).

---

## Estrutura do Projeto

```text
EcoBi_LP/
├── index.html                   # Estrutura semântica HTML5 (14 seções + modal)
├── assets/
│   ├── ecobi-logo.png           # Logo oficial da EcoBI Intelligence (400×400 RGBA)
│   ├── forest-canopy.jpg        # Fotografia editorial de floresta sob luz natural
│   └── botanical-foliage.jpg    # Fotografia editorial de folhagem natural
├── css/
│   ├── tokens.css               # Tokens visuais centralizados (Light & Dark Mode)
│   └── styles.css               # Composições editoriais, responsividade e acessibilidade
├── js/
│   └── main.js                  # Alternância de tema, menu mobile, vitrine do Hero,
│                                # explorador dos 8 módulos, simulador What-If, filtros, FAQ e modal
├── .gitignore
└── README.md
```

---

## Como Executar Localmente

Na raiz do projeto (`EcoBi_LP/`):

```powershell
python -m http.server 8000
```

Acesse **`http://127.0.0.1:8000`** no navegador (ou abra [`index.html`](index.html) diretamente).

---

## Como Publicar

Por ser um projeto estático puro (sem etapa de build), publique diretamente a raiz do repositório em **GitHub Pages**, **Vercel**, **Netlify** ou **Cloudflare Pages** (comando de build vazio e diretório de saída `.`).
