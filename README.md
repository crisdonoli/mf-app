# MiningFOMC (`fomc-app`)

Full-stack analytical web application for exploring, auditing, and comparing historical Federal Open Market Committee (FOMC) documents (1976–2020).

## Database Structure (`./fomc-data`)

The application reads its versioned Parquet datasets directly from `./fomc-data` (and tracks its version metadata in `./fomc-data/VERSION.json` and `./fomc-data/manifest.json`):

| Dataset | Local Path | Container Mount |
| :--- | :--- | :--- |
| Text Metadata, Agendas, Speeches, Participants | `./fomc-data` | `/fomc-data` (`ro`) |
| Prototype Similarity Matrices | `./fomc-data/similarities/model=bge-m3/pooling=chunk` | `/fomc-similarities` (`ro`) |
| Zero-Shot Macro & Subclass Labels | `./fomc-data/labels/zero_shot` | `/fomc-labels` (`ro`) |
| Relevance Probabilities | `./fomc-data/relevance/model` | `/fomc-relevance` (`ro`) |
| Accepted Corrections Ledger | `./fomc-data/corrections/accepted_fixes.parquet` | `/fomc-corrections` (`rw`) |

On startup, the backend logs the active database version and a `[FOUND] / [MISSING]` diagnostic summary for every dataset, exposing them at `GET /api/health` and `GET /api/stats`.

## Key Capabilities

- **Matrix Axis & Normalization Semantics:** Y-Axis = Topics, X-Axis = Chunk Sequence / Slices; normalization options are `None`, `Topic`, and `Slice` across both Explorer and Comparator.
- **Document Comparator (`/comparator`):**
  - Advanced basket filters (date/range, speaker, sex/gender, and metric threshold `>=` on any topic) + **Add All**.
  - **Combine** cohort grouping (`Year`, `Custom Year Range`, `Speaker`, `Speaker Role`, `Speaker Sex/Gender`, `Month`, `Quarter`, `Semester`) with `Mean` or `Median` aggregation.
  - Numeric **Temporal Partitions (`N`)** input and **Inspect Slice** range slider with `<` / `>` step buttons.
  - Reactive **Radar Chart**, **Time-Series Multi-Line Chart** across all slices with topic legend toggles, and **Export CSV** on the Standardized Category Scores table.
- **Access Control, Approval Workflow & Admin Console (`/admin`):**
  - Unauthenticated visitors can only access the Landing Page (`/`).
  - Root admin bootstrapped from `ADMIN_USERNAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`.
  - New researcher registrations enter `PENDING` status until approved in `/admin`.
  - Admin **Fix Request Review Queue** supports Accept/Reject with optional comments, triggers automatic in-app user notifications, and appends accepted fixes atomically to `accepted_fixes.parquet`.
- **Collaborative Case Studies (`/portfolio` & `/community`):**
  - Save, edit, toggle Public/Private, or delete studies in `/portfolio`.
  - Browse public studies in `/community` with clickable **Forked from** and **Forked by** lineage links, and **Fork Study** directly from the Comparator.
- **Explorer Relevance Tab & Interactive Distribution Fix Editor (`/explorer`):**
  - Generalized `ClassificationInspector` powers both **Zero-Shot Inspector** and **Relevance Probabilities** (`Relevant` vs `Irrelevant`).
  - **Report Error / Feedback** modals on Chunks and Similarity Matrix, plus **Allow Fix Request** mode with interactive auto-normalizing probability curve sliders, **Hard Label** toggle, and synchronized dual Macro + Sub-Class editors.

## Quick Start (`DEV`)

```bash
cp .env.example .env
# Edit .env to set ADMIN_PASSWORD and JWT_SECRET_KEY
docker compose -f docker-compose.dev.yml up --build
```

## Production Deployment (`miningfomc.com`)

```bash
cp .env.example .env
# Set strong ADMIN_PASSWORD, JWT_SECRET_KEY, and POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d --build
```
