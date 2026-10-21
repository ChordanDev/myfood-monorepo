# apps/scraper: the MyFood price scraper

This directory is [Ratoneando](https://github.com/matiasbontempo/ratoneando-go) by Matias Bontempo,
a Go API that compares Argentine supermarket prices. It is MIT licensed: [`LICENSE.md`](LICENSE.md)
keeps the upstream copyright and applies to everything in this directory. MyFood calls it from
`mix price_sync.run` through `MealPlannerApi.Integrations.GoScraperClient` (issue #410).

Everything below the line further down is the upstream README, unchanged.

## Upstream version

| | |
|---|---|
| Upstream | https://github.com/matiasbontempo/ratoneando-go |
| Imported commit | `8a1b5a9f125aa27362ec4f2996f195d7b632bff7` (`main`, 2026-10-08) |
| Import method | `git subtree add --squash --prefix apps/scraper` |

The import is a squashed subtree: one commit holds the upstream snapshot, and the upstream history
stays upstream. The code here is upstream's, unpatched. This section is the only local change.

### Pulling later upstream changes

From the repository root, on a branch created from `main`:

```bash
git subtree pull --squash --prefix apps/scraper https://github.com/matiasbontempo/ratoneando-go <commit-or-branch>
```

Then update the imported commit above, run `go build ./... && go test ./...` here, and recheck the
contract below. If the pull conflicts on this README, keep this section and take upstream's text
below the line.

`git subtree` finds the previous import through the `git-subtree-dir` and `git-subtree-split` lines
of the squash commit. Merge a pull request that adds or pulls the subtree with a **merge commit**,
never with "Squash and merge", which drops that commit and breaks the next `git subtree pull`.

## Local run with the API

You need Go (the version in `go.mod`; with `GOTOOLCHAIN=auto`, the default, Go downloads it) and
Redis.

1. Start Redis on its default port, for example `redis-server`, or
   `docker run --rm -p 6379:6379 redis:7`.
2. Create the config from the example. `.env` is git-ignored; never commit it.

   ```bash
   cd apps/scraper
   cp .env.example .env
   ```

   The example already has `PORT=3000`, `ENV=debug` and a local `REDIS_URL`. Keep `ENV=debug` (see
   the contract below).
3. Optional: set `VTEX_SHA256_HASH` in `.env`. With the example value `REPLACE_ME`, the VTEX stores
   (Carrefour, Día, Disco, Más Online, Vea) fail and are listed in `failedScrapers`; Jumbo still
   answers. Upstream's runbook explains how to get a current hash:
   [`docs/runbooks/rotate-vtex-hash.md`](docs/runbooks/rotate-vtex-hash.md). The hash expires every
   few months.
4. Start the scraper and check it:

   ```bash
   go run main.go
   curl -s localhost:3000/health
   curl -s 'localhost:3000/?q=leche'
   ```

5. In `apps/api`, run the price sync. `GO_SCRAPER_URL` defaults to `http://localhost:3000` in `dev`
   and `e2e`; it is read at compile time, so recompile after changing it.

   ```bash
   cd apps/api
   mix price_sync.run
   ```

   The summary line `Ingredients: N synced` counts the Ingredients that got prices.

The sync stores a price only for a product whose unit has a `unit_conversions` row for that
Ingredient, and nothing creates those rows yet. For a local check, add one by hand, for example
for an Ingredient named `leche` (`l` is the unit `GoScraperClient` stores for the scraper's `LT`):

```sql
INSERT INTO unit_conversions (id, ingredient_id, from_unit, factor_to_base, inserted_at, updated_at)
SELECT gen_random_uuid(), id, 'l', 1.0, now(), now() FROM ingredients WHERE name = 'leche';
```

After the sync, `SELECT supermarket_id, unit, price_per_unit_cents FROM ingredient_prices;` shows
the stored prices.

## Contract with the API

Checked against the imported commit:

- **Routes.** `GoScraperClient` calls `GET /?q=<query>`. `/raw` answers the same; `/history` and
  `/health` are not used by the API.
- **Response.** `{products: [{id, source, name, link, image, price, unit, unitPrice, history?}],
  failedScrapers: [...], timestamp}`. Empty fields are omitted (`omitempty`).
- **`unavailable`.** The public product has no `unavailable` field because the scraper drops
  unavailable products itself: `cores/api/main.go` skips them for every store built on it (Jumbo
  and all VTEX stores), and the VTEX query also sets `hideUnavailableItems`. The only scraper that
  could return one, Mercado Libre (`cores/html`), is disabled in `controllers/normalized_scrapper.go`.
  The client's `false` default is therefore correct and the client does not change for it.
- **`unit`.** Usually an uppercase code from `unit/mapper.go`: `KG`, `LT`, `UN` or `MT`. When the
  scraper reads no unit from the product name, `unit/extractor.go` passes the store's own unit
  through as the store wrote it (often `un`), or leaves it absent. `GoScraperClient` turns `KG`,
  `LT` and `UN`, in any case, into `kg`, `l` and `unit`, the units `ingredient_prices` accepts, and
  any other value (`MT`, a store's own `gr`, nothing) into `""`, which no conversion matches.
- **Uppercase queries.** A `q` with uppercase letters gets `403 Forbidden`. The client downcases
  every query.
- **`Referer`.** With `ENV=release` the scraper answers `403 Forbidden` unless the `Referer` header
  contains `WEB_URL`; with any other `ENV` it lets every request through. This guards upstream's
  public web app. The client sends no `Referer`, so **the scraper runs with `ENV=debug` for MyFood**,
  locally and in any future deployment. `ENV` is also Gin's mode, so it must be `debug`, `release`
  or `test`. A deployment that needs Gin's release mode would have to make the client send a
  `Referer` containing `WEB_URL` instead; decide that with the deployment.
- **Port.** `PORT` defaults to `3000`, the same default as `GO_SCRAPER_URL`.

## Deployment

Not decided yet (see #410). Where the scraper and its Redis run outside a laptop, and who rotates
`VTEX_SHA256_HASH`, are open. Until then the nightly price sync only works locally. Never commit a
`.env`, a VTEX hash or a Redis URL with credentials: this repository is public.

## CI

`.github/workflows/scraper.yml` runs `go build ./...` and `go test ./...` here when a pull request
or a push to `main` changes `apps/scraper/**` or that workflow. It is a separate workflow, so it
never starts the API and mobile jobs of `ci.yml`.

---

# ratoneando-go

<img alt="Ratoneando Logo" src="https://ratoneando.ar/assets/ratoneando.705c1d01.png" width="100" height="100" />

API de comparación de precios de supermercados utilizada en [https://ratoneando.ar](https://ratoneando.ar) 🐀

## Motivación

Este proyecto fué creado originalmente en Node.js y Fastify, pero decidí reescribirlo en Go para usarlo como una oportunidad de aprendizaje. Por este motivo, [la calidad del código puede no ser la mejor](https://i.kym-cdn.com/photos/images/newsfeed/001/330/845/f24.jpg).

A pesar de eso, el rendimiento de la API es significativamente mejor que la versión en Node.js.

![screenshot](https://utfs.io/f/1b808c20-f370-483f-880f-0459977352ca-1nq2cb.png)
🟡 Node
🔴 Go

## Pre-requisitos

- [Go](https://golang.org/dl/)
- [Redis](https://redis.io/download)
- [Air](https://github.com/air-verse/air) (Opcional)

## Instalación

```bash
git clone git@github.com:matiasbontempo/ratoneando-go.git
cd ratoneando-go
go mod download
```

Si querés usar Air para una mejor experiencia de desarrollo:

```bash
go install github.com/air-verse/air@latest
air init
```

## Configuración

```bash
cp .env.example .env
```

## Ejecución

```bash
go run main.go
```

Si estás usando Air:

```bash
air
```

## Estrucutra del proyecto

- **main.go**: Punto de entrada de la aplicación
- **/config**: Expone las variables de entorno
- **/controllers**: Controladores de la aplicación
- **/cores**: Núcleos de scraping reutilizables
- **/middlewares**: Middlewares para GIN
- **/products**: Modelos y utilidades de productos
- **/routes**: Rutas de la API
- **/scrapers**: Scrapers de los distintos supermercados
- **/units**: Utilidades para el procesamiento de unidades
- **/utils**: Utilidades generales

## Tests

```bash
go test ./...
```

## Herramientas

Los request a VTEX necesitan un hash SHA256 que suele expirar cada algunos meses. Esta herramienta facilita la extracción y verificación de este hash.

### Decodificador

Recibe una URL y devuelve el hash decodificado.

```bash
go run ./cmd/decode_vtex
```

### Verificador

Lee el hash de las variables de entorno, genera una url con el hash y valida si es posible hacer el request.

```bash
go run./cmd/verify_vtex
```

### Estructura de comandos

```
cmd/
  ├── decode_vtex/    # Comando para decodificar URLs VTEX
  └── validate_vtex/  # Comando para validar URLs y hashes VTEX
```

## Contribuir

Si te interesa dar una mano, consultá la [Guía de Contribución](CONTRIBUTING.md) y el [Código de Conducta](CODE_OF_CONDUCT.md).

## Licencia

Este proyecto está licenciado bajo la Licencia MIT. Revisá la [licencia](LICENSE) para más información.
