# Cartera Rebalancer

Aplicació autoallotjada per repartir l'aportació mensual d'una cartera de fons
indexats i mantenir-la a la teva ponderació objectiu (per defecte **60 / 10 / 30**),
amb seguiment de l'evolució mes a mes. Pensada per córrer al teu servidor de casa
amb Docker.

Mètode: **rebalanceig per flux de caixa**. No es ven res; cada aportació nova es
dirigeix als fons que estan per sota del seu pes objectiu. Tot el càlcul es fa amb
imports en euros, sense necessitat de preus (NAV).

## Què fa

- Calcula quants euros has de posar a cada fons aquest mes per acostar-te al teu objectiu.
- Recorda l'aportació mensual: la poses un cop i es precarrega cada mes fins que la canviïs.
- Desa una foto de la cartera cada mes i dibuixa l'evolució: valor de cada fons,
  pesos reals vs objectiu, i valor vs aportat acumulat.
- Persisteix tot en una base de dades SQLite dins un volum Docker.

## Fons configurats per defecte

| Pes | Fons | ISIN |
|-----|------|------|
| 60% | RV Global desenvolupat | IE00B03HCZ61 |
| 10% | RV Emergents | IE000QAZP7L2 |
| 30% | Renda fixa global (EUR hedged) | IE00B18GC888 |

Els pesos objectiu són editables des de la interfície i es desen al servidor.

## Requisits

- Docker i Docker Compose al servidor.
- Res més: SQLite és el mòdul integrat `node:sqlite` de Node 22, i l'única
  dependència externa és Express. No cal compilar res natiu.

## Desplegament

```bash
git clone <la-url-del-teu-repo> cartera-rebalancer
cd cartera-rebalancer
docker compose up -d --build
```

Obre `http://<ip-del-servidor>:8080` des de qualsevol dispositiu de la xarxa local.

Per canviar el port, edita el costat esquerre del mapatge a `docker-compose.yml`
(per defecte `8080:3000`).

### Comandes útils

```bash
docker compose logs -f        # veure logs
docker compose down           # aturar (les dades es conserven al volum)
docker compose up -d --build  # reconstruir després de canvis
```

## On viuen les dades

A la base de dades SQLite del volum Docker `cartera-data`, muntat a `/data` dins
del contenidor. Sobreviu a reinicis i reconstruccions de la imatge. `docker compose down`
**no** esborra el volum; per esborrar-lo del tot: `docker compose down -v` (perds l'històric).

### Còpia de seguretat

```bash
# exportar la base de dades a un fitxer local
docker run --rm -v cartera-rebalancer_cartera-data:/data -v "$PWD":/backup \
  alpine sh -c "cp /data/cartera.db /backup/cartera-backup.db"
```

(El nom del volum pot dur el prefix del directori del projecte; comprova'l amb
`docker volume ls`.)

## Ús mensual

1. Obre MyInvestor i copia el saldo en euros de cada fons als camps "saldo".
2. Comprova el mes i l'aportació (ja precarregada si l'has fixat per defecte).
3. Prem **Calcular repartiment**. Et donarà les ordres exactes per a cada ISIN.
4. Passa aquestes ordres a MyInvestor.

Cada càlcul desa la foto del mes i actualitza els saldos amb el resultat, de manera
que el mes següent ja parteixes d'aquí.

## Arquitectura

```
.
├── docker-compose.yml      # servei + volum persistent
├── Dockerfile              # imatge node:22-slim
├── backend/
│   ├── server.js           # API REST + serveix el frontend
│   ├── db.js               # esquema SQLite + seeding (node:sqlite)
│   ├── rebalance.js        # lògica de repartiment
│   └── package.json
└── frontend/
    └── index.html          # interfície (parla amb l'API)
```

### API

| Mètode | Ruta | Funció |
|--------|------|--------|
| GET | `/api/state` | fons, saldos i aportació per defecte |
| PUT | `/api/funds` | actualitzar pesos objectiu |
| PUT | `/api/balances` | actualitzar saldos actuals |
| PUT | `/api/settings/contribution` | fixar aportació per defecte |
| POST | `/api/calculate` | calcular repartiment i desar foto del mes |
| GET | `/api/history` | històric mensual |
| DELETE | `/api/history/:month` | esborrar la foto d'un mes |

## Nota

Aquesta és una eina de càlcul personal, no assessorament financer. El mètode de
rebalanceig per flux de caixa amb bandes de tolerància és estàndard per a una
cartera tipus Bogleheads, però la tria dels pesos i les decisions d'inversió són teves.

## Llicència

Ús personal.
