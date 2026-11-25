# API load test

Script stdlib-only (`urllib`, `concurrent.futures`) para medir latencia, reintentos y saturación de query gates del backend.

## Ejemplos

```bash
# 1 usuario, calienta caché y mide 9 requests
python scripts/api_loadtest.py --base-url https://mi-vps --email a@b.cl --password '***' \
  --scenario search --warmup 1 --requests 9 --concurrency 1 --out search_c1.csv

# 3 concurrentes sobre comparador (comparación frío/caliente con warmup aparte)
python scripts/api_loadtest.py --base-url https://mi-vps --email a@b.cl --password '***' \
  --scenario compare --warmup 2 --requests 12 --concurrency 3 --out compare_c3.csv --admin

# Frío vs caliente: mismo payload dos veces, mira warmup_ms aparte de p50/p95
python scripts/api_loadtest.py --base-url https://mi-vps --email a@b.cl --password '***' \
  --scenario mixed --warmup 0 --requests 6 --concurrency 1 --out cold.csv
```

## Muestrear recursos del VPS en paralelo

```bash
# CPU/RAM por contenedor a CSV cada 2s mientras corre el load test
ssh root@mi-vps 'while true; do docker stats --no-stream --format \
  "{{.Name}},{{.CPUPerc}},{{.MemUsage}}"; sleep 2; done' > vps_resources.csv &

# Snapshot continuo interactivo (CPU/RAM por contenedor)
ssh root@mi-vps 'docker stats'
```

La RAM real del proceso se ve en `docker stats` (columna `MEM USAGE / LIMIT`), no en la latencia: una latencia estable con memoria creciente indica fuga, no saturación de CPU. Para detalle fino usa `docker stats --no-stream` en bucle y grafica `vps_resources.csv`.

## Advertencia

Contra producción **máximo `--concurrency 3`**. El gate `heavy`/`corpus` responde `503` con `Retry-After`; el script reintenta hasta 5 veces con backoff. Si ves `retries` alto y `queue_wait_ms` creciendo, detén el test.

## Leer `/api/admin/query-gates`

Con `--admin` el script imprime `gates_before`/`gates_after` (también manual: `curl -H "Authorization: Bearer $TOKEN" https://mi-vps/api/admin/query-gates`).

- `avg_hold_s`: tiempo medio que una consulta retuvo el slot. Si sube tras el test, la carga saturó CPU/IO sostenidamente.
- `saturations`: veces que el gate rechazó por estar lleno. Cualquier valor > 0 durante el test indica que `--concurrency` superó `HEAVY_QUERY_MAX_CONCURRENCY` / `CORPUS_QUERY_MAX_CONCURRENCY`.
