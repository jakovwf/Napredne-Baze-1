# PixelBoard

Globalno piksel platno u realnom vremenu (Angular + NestJS + Socket.IO + Redis + Cassandra). Registrovani korisnici boje zajedničko platno, uz cooldown između poteza. Redis drži trenutno stanje platna (atomična Lua skripta, TTL-ovi, Pub/Sub), a Cassandra trajnu istoriju poteza i snapshot-ove, pa se platno vraća i posle pada Redisa.

Projekat iz predmeta Napredne baze podataka (Elfak).

## Pokretanje

Preduslov: Docker sa Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Aplikacija je na `http://localhost:8080`. Cassandra se diže sporo (oko minut), pa `api` i `worker` čekaju da bude spremna.

## Arhitektura

- `frontend`: Angular aplikacija iza nginx-a, koji prosleđuje `/api` i `/socket.io` ka `api`.
- `api`: NestJS REST i Socket.IO; potez se atomski upisuje u Redis.
- `worker`: NestJS proces (isti kod, `APP_ROLE=worker`); prebacuje poteze iz Redis Stream-a u Cassandru i pravi snapshot-ove platna.
- `redis`: trenutno stanje platna, sesije, cooldown i stream poteza (AOF `everysec`).
- `cassandra`: korisnici, istorija poteza, statistika i snapshot-ovi.
- `cassandra-init`: jednokratno primenjuje `infra/cassandra/schema.cql` kad je Cassandra spremna.

Zajednički tipovi i paleta su u `packages/shared`.

## Razvoj

Preduslovi: Node 22 ili noviji, Docker.

```bash
npm install
```

Baze se izlažu samo na loopback (`127.0.0.1`) preko dev override-a:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d redis cassandra cassandra-init
```

Backend van Dockera čita `apps/backend/.env.local`:

```powershell
Copy-Item .env.local.example apps/backend/.env.local
npm run start:api        # u drugom terminalu: npm run start:worker
npm run start:frontend   # http://localhost:4200, proxy ka api na :3000
```

Provera: `GET http://localhost:3000/api/health` vraća 200 dok su Redis i Cassandra dostupni.

### Provere i testovi

```bash
npm run lint
npm run build
npm test
```

Integracioni testovi traže gore podignute baze i nisu deo `npm test`. Rade nad Redis DB 1 i posebnim keyspace-om `pixelboard_test` (pravi se iznova pri svakom pokretanju), pa ne diraju razvojne podatke:

```bash
npm run test:integration -w backend
```

## Demo: pad Redisa

Stanje platna živi u Redisu, a trajna kopija je u Cassandri (snapshot-ovi i istorija poteza). Posle gubitka Redisa `api` sam vraća platno, bez restarta.

Stanje pre pada (SHA-256 i verzija platna):

```powershell
node tools/demo/canvas-hash.mjs http://localhost:8080
```

Običan restart Redisa (AOF vraća sve podatke, oporavak nije potreban, hash je isti):

```powershell
docker compose restart redis
node tools/demo/canvas-hash.mjs http://localhost:8080
```

Gubitak podataka Redisa (briše se i volume), platno se vraća iz Cassandre:

```powershell
# sačekaj da worker upiše poteze u Cassandru (pending 0):
docker compose exec redis redis-cli XINFO GROUPS stream:moves

docker compose rm -sf redis
$project = (docker compose config --format json | ConvertFrom-Json).name
docker volume rm "${project}_redis_data"
docker compose up -d redis

docker compose logs -f api      # vidi se "platno spremno (... snapshot v... + ... poteza iz replay-a)"
node tools/demo/canvas-hash.mjs http://localhost:8080   # čeka 503 dok oporavak traje, pa ispiše isti hash
```

Dok oporavak traje, `GET /api/canvas` vraća 503 sa `Retry-After`, potezi se odbijaju, a `GET /api/health` i dalje vraća 200 (u telu je `canvas: recovering`). Gubi se samo ono što još nije stiglo u Cassandru (po pravilu najviše sekunda poteza), kao i prolazno stanje Redisa: sesije (korisnici se ponovo prijavljuju) i cooldown-ovi.

## Produkcija

U `.env` postavi `NODE_ENV=production` i obavezno promeni `ADMIN_PASSWORD`; u produkciji backend odbija prazan ili `change-me` `ADMIN_PASSWORD`. Na serveru sa HTTPS-om postavi `COOKIE_SECURE=true`.
