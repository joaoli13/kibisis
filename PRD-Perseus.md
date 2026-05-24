# PRD — Perseus (nome provisório)

Um portal de busca semântica sobre os clássicos greco-romanos a partir do corpus Perseus Digital Library / Open Greek and Latin.

---

## 1. Visão Geral

Portal de pesquisa e exploração semântica sobre literatura grega e latina antiga, baseado nos repositórios canônicos do Perseus. O usuário pesquisa **ideias, cenas e temas** — não citações exatas — e navega passagens em um mapa 3D, com busca híbrida (lexical + vetorial) e síntese assistida por IA com citações ancoradas no texto.

Seguindo o mesmo padrão de Constitutional Map AI e Letterum: pipeline em Python que gera embeddings e clusters, JSON estático para o front, e Neon Postgres para busca full-text/vetorial e RAG.

---

## 2. Objetivos

- Disponibilizar busca semântica em passagens de clássicos greco-romanos.
- Permitir navegação visual (3D) por proximidade conceitual entre autores, obras e épocas.
- Oferecer síntese com citações (RAG) ancorada nas passagens recuperadas.
- **Processar 100% do corpus disponível**, mas **publicar apenas o que tiver licença CC compatível**.
- Manter granularidade de chunk que respeite limite operacional (~100 mil registros).

---

## 3. Escopo

### Incluído
- Repositórios **PerseusDL/canonical-greekLit** e **PerseusDL/canonical-latinLit** (TEI/XML).
- Repositório **PerseusDL/catalog** (metadados canônicos, autores, obras, URNs CTS).
- Originais (grego, latim) e traduções (inglês) presentes nos repositórios.
- Multilíngue na interface: PT, EN, ES.

### Fora do escopo (fase 1)
- `PerseusDL/treebank_data` (análise sintática).
- `PerseusDL/lexica` (dicionários — adiar para fase 3 como enriquecimento).
- Materiais de arte e arqueologia.
- `OpenGreekAndLatin/First1KGreek` (avaliar para fase 4).

---

## 4. Fontes de Dados

| Repositório | Conteúdo | Uso |
|---|---|---|
| `PerseusDL/canonical-greekLit` | Literatura grega canônica em TEI/XML | Corpus principal grego |
| `PerseusDL/canonical-latinLit` | Literatura latina canônica em TEI/XML | Corpus principal latino |
| `PerseusDL/catalog` | Metadados de autores, obras, edições, URNs CTS | Catálogo e normalização |

Todos clonados localmente no diretório `Perseus/` já criado.

**Licença declarada nos repositórios:** CC BY-SA 4.0 (padrão), com ressalva de que status pode variar por arquivo. Tratar como configurável por item, não global.

---

## 5. Estratégia de Licenciamento (decisão central do projeto)

Processo em dois estágios:

1. **Ingestão completa** — todos os arquivos TEI são parseados, segmentados e indexados em uma base "interna" (`raw`), independentemente de licença.
2. **Publicação filtrada** — apenas registros com `license_status = 'cc_compatible'` são exportados para o JSON estático e para a base de produção do Neon.

### Detecção de licença (M0)
- Ler `<licence>` / `<availability>` do TEI header.
- Cruzar com README do repositório e arquivos `LICENSE.md`.
- Default: se não detectado, marcar como `unknown` → **não publicar**.
- Tabela de exceções manual para obras polêmicas ou edições específicas.
- Para cada registro, persistir: `license`, `license_source`, `edition_year`, `translator`, `is_public_domain_original`.

---

## 6. Pipeline (M0 → M5)

Espelhando a estrutura de Constitutional Map AI:

```
M0 License Scanner →  varre TEI headers, monta tabela de licenças por arquivo
M1 Ingestor        →  clone/pull dos repos, parse TEI/XML, normaliza catálogo
M2 Segmenter       →  divide em passagens canônicas (livro/capítulo/seção) e
                      gera chunks de ~700–1.200 palavras com URN preservada.
                      Texto é "limpo" do TEI: remove tags/atributos irrelevantes
                      pro embedding (ver "Limpeza de TEI" abaixo)
M3 Embedder        →  Google Gemini gemini-embedding-001 (768D), cache em Parquet
M4 Clusterer       →  UMAP 50D (cluster) + UMAP 3D (viz), HDBSCAN global,
                      por gênero e por idioma
M5 Exporter        →  filtro por licença + export JSON estático (CDN) e
                      upsert no Neon (pgvector + full-text)
```

### Granularidade de chunk
- Unidade primária: **passagem canônica** (livro/capítulo/seção/verso).
- Re-chunkagem para 700–1.200 palavras quando a passagem canônica for menor ou maior que o ideal.
- Cada chunk preserva: `cts_urn`, `passage_ref`, `author`, `work`, `language`, `text_type` (original/translation), `genre`, `period`.

### Limpeza de TEI (diretriz central)
**Princípio:** o texto que vai pro embedding precisa ser representação semântica do conteúdo, não markup. Toda tag/atributo que não agregue sentido literário deve ser removido antes do M3 Embedder.

- **Manter (estrutural/semântico):** `<div>` de livro/capítulo/seção (apenas para segmentação), `<l>` (verso), `<p>`, `<said>`/`<q>` (fala, opcionalmente com marcador textual tipo "—"), `<speaker>` quando aplicável.
- **Remover tags, manter conteúdo textual:** `<hi>`, `<emph>`, `<foreign>`, `<seg>`, `<w>`, `<pb>`, `<lb>`, `<milestone>`, `<cit>`, `<bibl>` inline, `<persName>`/`<placeName>` (preservar o nome, descartar wrapper).
- **Remover tag E conteúdo:** `<note>` editorial, `<app>`/`<rdg>` (aparato crítico — ruído pro embedding), `<gap>`, `<del>`, `<orig>` quando há `<reg>`, `<sic>` quando há `<corr>`, comentários XML, `<teiHeader>` (já consumido pelo M0/M1).
- **Atributos:** descartar todos os atributos de apresentação (`rend`, `type` editorial, `xml:id` interno). Preservar apenas o necessário pra reconstruir `cts_urn`/`passage_ref` (em metadado, não no texto).
- **Normalização de texto:** colapsar whitespace, normalizar Unicode (NFC), preservar acentuação grega/latina e pontuação significativa.
- **Saída:** texto limpo (`text` da tabela `passages`) + cópia "raw" opcional em coluna separada apenas se útil pra debugging — não vai pro embedding.

**Implementação — decisão: lxml puro (sem XSLT, sem BeautifulSoup).**
- Razão: M2 já precisa de Python pra word-count, re-chunkagem, normalização Unicode, cruzamento com licenças. XSLT 1.0 (limitado) ou 2.0/3.0 (exige Saxon/JVM) só adicionariam linguagem extra sem reduzir Python. BeautifulSoup é descartado porque "conserta" XML malformado silenciosamente — preferimos falhar alto.
- Estilo declarativo preservado: registry `{xpath: handler}`, cada handler testável isoladamente.
- **Parser endurecido** (obrigatório):
  ```python
  parser = etree.XMLParser(
      resolve_entities=False, no_network=True,
      load_dtd=False, huge_tree=False,
  )
  ```
- Testes de regressão em amostras de cada autor/gênero (Homero, Platão, Tucídides, Cícero, Virgílio, Tácito etc.) pra garantir que nenhuma regra come conteúdo legítimo. Snapshot do texto limpo versionado no repo.

### Estimativa de volume
Corpus Classics declarado: ~68,9M palavras. Com chunks de ~1.000 palavras → ~69 mil registros antes de filtro de licença e duplicatas. Cabe folgado em <100k.

---

## 7. Modelo de Dados

### Tabela principal: `passages`
```
id, cts_urn, author_id, work_id, language, text_type,
passage_ref, text, source_file, license, license_source,
period, genre, embedding (vector 768),
umap_3d (x,y,z), umap_50d, cluster_id, topics[]
```

### Tabelas auxiliares
- `authors` (id, name_canonical, name_variants, period, wikidata_id)
- `works` (id, author_id, title, language_original, genre, cts_urn)
- `editions` (id, work_id, language, translator, year, license)
- `clusters` (id, scope, label_auto, centroid, size)
- `licenses_audit` (file_path, declared_license, decision, decision_reason)

---

## 8. Funcionalidades do App

### Busca
- **Busca híbrida** (RRF, como Letterum): lexical (`plainto_tsquery` + GIN) + vetorial (pgvector).
- Filtros: autor, obra, gênero, período (Arcaico/Clássico/Helenístico/Romano), idioma, tipo de texto (original/tradução).

### Visualização
- **Mapa 3D** (Plotly.js scatter3d) com pontos = passagens; cor por cluster, autor, gênero ou período.
- Painel lateral com texto da passagem clicada, metadados, URN canônica e link para a fonte original.
- Presets de navegação: "Filosofia", "Épica e Mito", "Tragédia", "História", "Retórica e Política".

### RAG com citações (como Letterum)
- Resposta sintética sobre uma ideia/cena, com citações numeradas inline e lista final de fontes.
- Sempre marcar: tradução é auxiliar de descoberta, não substitui edição crítica.

### Trilhas temáticas (opcional fase 2)
- Clusters pré-rotulados: virtude e educação, tirania e liberdade, guerra e glória, morte e destino, hospitalidade, retórica judicial, amor e desejo, fundação de cidades etc.

### i18n
- PT, EN, ES (next-intl, igual aos projetos anteriores).

### Governança e provenance
- Footer e payload da API expõem licença CC BY-SA 4.0, atribuição ao Perseus/Tufts, snapshot do dataset.
- Logging e rate limiting (como Letterum).

---

## 9. Stack

Cópia direta dos projetos anteriores, com pequenos ajustes:

| Camada | Tecnologia |
|---|---|
| Pipeline | Python 3.12, uv, lxml (TEI, parser endurecido), pandas, Pydantic, umap-learn, hdbscan, google-generativeai, psycopg2 |
| Embeddings | Google Gemini `gemini-embedding-001` (768D) |
| Banco | Neon (Postgres serverless) — pgvector + full-text GIN |
| Web | Next.js 16, React 19, TypeScript, Tailwind |
| Viz 3D | Plotly.js (`plotly.js-dist-min` + `react-plotly.js`) |
| Busca | Híbrida vetorial + lexical, fundida por Reciprocal Rank Fusion |
| Estado | Zustand |
| i18n | next-intl (EN / PT / ES) |
| Hosting | Vercel |
| Geração IA (RAG) | Gemini |

Fallback estático local em `app/public/data/` para dev sem Neon (padrão Letterum).

---

## 10. Estrutura do Repositório

```
perseus/
├── pipeline/
│   ├── scripts/
│   │   ├── run_pipeline.py
│   │   ├── run_m0.py        # License scanner
│   │   ├── run_m1.py        # Ingestor (TEI/XML)
│   │   ├── run_m2.py        # Segmenter + chunker
│   │   ├── run_m3.py        # Embedder
│   │   ├── run_m4.py        # Clusterer
│   │   └── run_m5.py        # Exporter (filtro licença + Neon)
│   ├── src/
│   │   ├── m0_license/
│   │   ├── m1_ingestor/     # parser TEI, normalização catalog, URN CTS
│   │   ├── m2_segmenter/
│   │   ├── m3_embedder/
│   │   ├── m4_clusterer/
│   │   ├── m5_exporter/
│   │   └── shared/          # Pydantic models, períodos, gêneros, mapa idioma
│   ├── tests/
│   └── pyproject.toml
│
├── app/                     # Next.js 16
│   ├── app/
│   │   ├── [locale]/
│   │   └── api/
│   │       ├── search/      # híbrida (RRF)
│   │       ├── passage/     # detalhe + texto integral
│   │       ├── synthesize/  # RAG com citações
│   │       └── compare/
│   ├── components/
│   │   ├── AtlasClient.tsx
│   │   ├── Canvas3D.tsx
│   │   ├── SearchPanel.tsx
│   │   ├── PassageDetail.tsx
│   │   └── SynthesisPanel.tsx
│   ├── lib/
│   ├── stores/
│   ├── messages/            # en.json, pt.json, es.json
│   └── public/data/         # JSON estático filtrado por licença
│
├── data-sources/            # submódulos / clones dos repos Perseus
│   ├── canonical-greekLit/
│   ├── canonical-latinLit/
│   └── catalog/
│
├── .env.example
├── LICENSE.md
└── README.md
```

---

## 11. Roadmap

**Fase 1 — MVP**
- M0–M5 pipeline funcional.
- Subconjunto inicial publicado: traduções inglesas de filosofia + história + tragédia + épica, todas CC-compatíveis.
- Busca híbrida + mapa 3D + detalhe da passagem.
- Síntese com citações (RAG) sobre o top-N da busca.
- i18n PT/EN/ES.

**Fase 2 — Originais e trilhas**
- Originais gregos e latinos alinhados às traduções.
- Trilhas temáticas e presets.

**Fase 3 — Enriquecimento**
- Integração com lexica (LSJ, Lewis & Short) como tooltip lexical.
- Vinculação Wikidata (autores, escolas, datas, lugares).
- Cross-linguagem (busca em inglês recupera grego/latim semanticamente próximos).

**Fase 4 — Expansão**
- Avaliar `First1KGreek` (Open Greek and Latin).
- Mapa de influências autor-a-autor.
- Comparação multi-autor lado a lado.

---

## 12. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| TEI irregular entre coleções/edições | Parser tolerante + suite de testes por tipo de arquivo |
| Licença ambígua por arquivo | M0 dedicado; default `unknown` → não publica |
| Traduções em inglês arcaico afetando embeddings | Marcar `edition_year`; eventual normalização ortográfica |
| Granularidade ruim (versos curtos / obras enormes) | Chunkagem 700–1.200 palavras preservando passagem canônica |
| Nomes de autores não normalizados (Plato/Platon/Πλάτων) | Tabela `authors` com `name_variants[]` e Wikidata como chave |
| Volume > 100k após chunkagem | Filtro por licença + escolha por gênero/idioma na fase 1 |

---

## 13. Tarefas explícitas — DX e ciclo do banco

Automatizar o ciclo do banco desde o dia 1 evita o ritual "funciona na minha máquina" e mantém pipeline + app + testes alinhados. Stack alvo: **Neon Local** (Docker) para dev/teste, Neon serverless em produção; migrations versionadas (sugestão: `dbmate` ou `node-pg-migrate` — definir antes de M5).

- [ ] **Scripts de ciclo de vida** — criar comandos npm/uv unificados:
  - `db:up` → sobe Neon Local via Docker (com pgvector pré-instalado), cria role/database, aplica `CREATE EXTENSION`.
  - `db:migrate` → aplica todas as migrations pendentes; idempotente; suporta `--dry-run`.
  - `db:reset` → derruba volume, sobe limpo, roda migrations e (opcional) seed mínimo.
  - `db:test` → cria/recria base `perseus_test` isolada, aplica migrations, exporta `DATABASE_URL` para a suite de testes.
- [ ] **Testes de integração resilientes** — validar conexão no setup; se o banco estiver indisponível, ou bootstrappar automaticamente (`db:test` em CI/local) ou falhar com mensagem clara apontando o script a rodar (não erro críptico de conexão). Cobertura mínima: smoke test em pgvector (`SELECT '[1,2,3]'::vector`) e em full-text (`to_tsvector`).
- [ ] **Documentação curta** no README com o caminho feliz (`make db:up && make db:migrate && make db:test`) e troubleshooting de portas/Docker.
- [ ] **CI** — job que sobe Neon Local em service container, roda `db:migrate` + `db:test`, falha cedo se schema divergir.

### Decisões pendentes (travar antes de M5)
- [ ] **Ferramenta de migrations**: avaliar `dbmate` (Go, SQL puro, agnóstico de stack — preferência inicial, porque o pipeline Python também aplica migrations) vs `node-pg-migrate` (Node, casa com o app Next.js mas amarra a Node). Decidir e registrar aqui antes da primeira migration.
- [ ] **Seed mínimo para `db:reset`**: definir snapshot fixo (sugestão: 1 autor + 1 obra + 5 passagens já embeddadas) para a UI rodar sem precisar do pipeline completo. Versionar como SQL ou JSON no repo.

---

## 14. Atribuição

Dados: PerseusDL / Tufts University, sob CC BY-SA 4.0 (salvo indicação contrária por arquivo). Atribuição preservada no footer do app, payloads de API, exports estáticos e README — mesmo padrão de Letterum e Constitutional Map AI.

Código (pipeline + app): MIT.
