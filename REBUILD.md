# Rebuild completo (nueva versión de datos)

## 1. Actualizar datos
- Reemplazar `fomc-data/` con la nueva versión.
- Verificar `fomc-data/VERSION.json` y `fomc-data/manifest.json`.

## 2. Rebuild del índice invertido
```bash
docker cp scripts/build_text_index.py miningfomc-backend:/tmp/build_text_index.py
docker exec miningfomc-backend python /tmp/build_text_index.py \
  --data-dir /fomc-data --output-dir /tmp/text_index --overwrite
docker cp miningfomc-backend:/tmp/text_index ./fomc-data/text_index
```

## 3. Rebuild del caché de matrices
```bash
docker cp scripts/build_matrix_cache.py miningfomc-backend:/tmp/build_matrix_cache.py
docker exec miningfomc-backend python /tmp/build_matrix_cache.py \
  --data-dir /fomc-data --output-dir /tmp/matrix_cache --overwrite
docker cp miningfomc-backend:/tmp/matrix_cache ./fomc-data/matrix_cache
```

## 4. Rebuild y redeploy del backend
```bash
docker compose -f docker-compose.prod.yml build backend
docker compose -f docker-compose.prod.yml up -d backend
```

## 5. Verificar
```bash
docker exec miningfomc-backend python -c \
  "from app.config import get_settings; s=get_settings(); print('text_index:', s.resolve_text_index_dir()); print('matrix_cache:', s.resolve_matrix_cache_dir()); print('search_cache:', s.resolve_search_cache_dir())"
curl -s -H "Authorization: Bearer TU_TOKEN_ADMIN" https://miningfomc.com/api/admin/query-gates | python -m json.tool
```

## 6. Limpiar cachés viejos (si cambió la estructura de datos)
```bash
docker exec miningfomc-backend python -c "from app.core.query_engine import clear_speaker_catalog_cache; clear_speaker_catalog_cache()"
```

## Notas
- Los cachés en disco (text_index, matrix_cache, search_cache) son read-only en el contenedor (mount :ro). Se construyen fuera y se copian.
- Si cambió el schema de los Parquet, actualizar `build_text_index.py` y `build_matrix_cache.py`.
- El `.env` del VPS tiene prioridad sobre los defaults de `docker-compose.prod.yml`.
- Después de un rebuild, la caché de búsqueda en Postgres persiste (tabla `search_cache`). Si quieres limpiarla: `docker exec miningfomc-postgres psql -U miningfomc -d miningfomc -c "DELETE FROM search_cache;"`.
