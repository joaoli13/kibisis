# kibisis.dev

kibisis.dev is an experimental semantic atlas for classical Greek and Roman literature. It combines hybrid search, metadata filters, 3D semantic visualization, and source-grounded generated answers so readers can move from an idea to authors, works, passages, and cited textual evidence.

Live site: [kibisis.dev](https://kibisis.dev)

The public corpus is derived from PerseusDL / Tufts University and related canonical Greek and Latin data. The app only publishes passages classified as CC-compatible, and keeps provenance visible in the interface and API responses.

## Why Kibisis?

In the Perseus myth, the kibisis is the pouch or satchel given to the hero to carry Medusa's head. The name fits this portal as a careful container for powerful textual fragments: passages, sources, metadata, and generated interpretations stay bound to their provenance.

## What It Does

- Search ideas, scenes, authors, and works across classical texts.
- Navigate the corpus hierarchically from authors to works to passages.
- Inspect semantic relationships in a 3D atlas.
- Generate answers constrained to selected passages and cited sources.
- Preserve source metadata such as author, work, passage reference, CTS URN, license status, and dataset snapshot.

## How To Use The Site

Start at [kibisis.dev](https://kibisis.dev) and search for an idea, scene, author, or work. You can also begin by exploring the authors directly: authors are positioned semantically in relation to their works, and selecting an author lets you narrow to that author's works before reaching individual passages.

Every visible point is organized semantically. A point marks the tip of a vector representing the meaning of an author, work, or passage, depending on the current map level. Moving through the hierarchy keeps the exploration fast and interpretable: author to work to passage.

Use the metadata filters to refine by genre, period, language, text type, author, or work. Switch the map level when you want a broader author/work view or a passage-level view inside a smaller scope.

Open passages from the results or the 3D atlas to inspect source metadata and provenance. When you have selected useful passages, generate an answer to produce a source-grounded synthesis based only on that context.

## Support

kibisis.dev has ongoing server, generative model, and embedding costs. If the project is useful to you, you can help keep it online through [Buy me a coffee](https://www.buymeacoffee.com/joaoli13).

Follow project updates on [X / Twitter](https://x.com/joaoli13).

## Repository Layout

- `app/` - Next.js application and API routes.
- `pipeline/` - corpus ingestion, classification, embedding, and export pipeline.
- `infra/` - local database and migration utilities.
- `brand/` - project marks, lockups, and visual assets.

Local corpora, generated data, agent files, and environment files should stay outside the public repository.

## Quickstart

Prerequisites: Docker, Node.js 22+, npm, Python 3.12, and uv.

1. Install app dependencies:

```bash
cd app
npm install
```

2. Start local Postgres with `pgvector`:

```bash
docker compose -f infra/docker-compose.yml up -d
```

3. Apply migrations:

```bash
DATABASE_URL=postgresql://perseus:perseus@localhost:5432/perseus infra/apply-migrations.sh
```

4. Run the app with the root `.env` exported:

```bash
cd app
set -a && source ../.env && set +a && npm run dev
```

Open `http://localhost:3000/pt`.

## Pipeline

Place upstream corpora under `data-sources/` before running the ingestion pipeline:

- `PerseusDL/canonical-greekLit` as `data-sources/canonical-greekLit` or `data-sources/greekLit_data`
- `PerseusDL/canonical-latinLit` as `data-sources/canonical-latinLit` or `data-sources/latinLit_data`
- `PerseusDL/catalog` as `data-sources/catalog` or `data-sources/catalog_data`

Then run a small local pipeline pass:

```bash
cd pipeline
uv run pytest
PYTHONPATH=src uv run python scripts/run_pipeline.py --language eng --cc-only --limit 10 --persist
```

## Database Compatibility

Development defaults to local Postgres with `pgvector` and `pg_trgm`. Neon remains compatible because the app and pipeline depend on `DATABASE_URL`, standard Postgres SQL, full-text GIN indexes, and `pgvector`.

## Vercel + Neon

When using the Neon integration in Vercel, set the Vercel project root directory to `app`.

Use the pooled `DATABASE_URL` for the deployed app. Use the direct `DATABASE_URL_UNPOOLED` for schema migrations, data restores, and pipeline writes.

After linking Neon to the Vercel project, pull the production environment locally:

```bash
cd app
vercel env pull .env.production.local --environment=production
set -a && source .env.production.local && set +a
cd ..
```

Apply schema and load a data dump into Neon:

```bash
infra/dump-data.sh
DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" infra/bootstrap-neon.sh
```

For a repeat load into an already populated target, opt in explicitly:

```bash
RESET_DATA=true DATABASE_URL_UNPOOLED="$DATABASE_URL_UNPOOLED" infra/load-data.sh
```

## License Governance

The raw pipeline may ingest all corpus files for audit and diagnostics, but the API and static export publish only passages classified as `cc_compatible`. Unknown or restricted files are default-denied.

Generated answers are an exploration aid, not a critical edition or final scholarly judgment. Always verify cited passages against the listed sources.
