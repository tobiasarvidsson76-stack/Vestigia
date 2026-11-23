# Vestigia

Vestigia is a walking city builder. This repository contains the first integrated development build, with a phone-width browser interface and a simulated pedestrian world. It runs with Python and SQLite and uses a local basemap, clock and voucher store. The fixture requires no map key, external account or payment credentials.

## Run it

Use Python 3.10 or later.

```sh
./dev
```

Open http://localhost:8080, or forward port 8080 in a Codespace and open the forwarded URL on your phone. The first visit creates a city and keeps its bearer token in that browser. The city save is in `vestigia.sqlite3`. Set `VESTIGIA_DB` to use a different file and `PORT` to use a different port. Keep the forwarded port private. The fixture endpoints intentionally expose test controls to each city owner.

### First cottage

1. Start a walk and move east once. On the pine tile, place and finish the lumberjack station using its grant.
2. Collect its opening log and move east again. Place and finish the granted sawmill, then deliver the log to its input.
3. Advance the clock by at least three minutes and collect the plank. Move east, plan a cottage and deposit the plank in its construction buffer.
4. Advance the clock by fifteen minutes, return to the grove, collect another log and take it to the sawmill. Repeat the delivery and finish the cottage. Claim rent from its site panel after advancing the clock an hour.

The arrow buttons simulate 60 m fixture walks and advance the clock by 30 seconds. After a long clock jump, use another movement or the same-site fix endpoint before taking an on-site action. Research, surveying, hiring and claiming rent work remotely. Delete the city from the City panel to remove its save.

## Test

```sh
python3 -m unittest discover -s tests -v
node --check static/app.js
```

The suite covers the fresh-city cottage route, range enforcement, offline storage and rent, hidden prospect grades, shared-key concurrency, survey persistence, production restarted by a haul, sandbox receipt replay, hourly versus offline household consumption, HTTP handler behavior, road return trips and jitter, export quality floors and replay, catalog dependencies, and whole-output capacity checks across all 193 recipes. The HTTP test exercises request parsing and routing in memory. The workspace sandbox denied opening a listening socket during verification. Live browser and physical-device checks remain outstanding.

## Fixture HTTP API

All endpoints return JSON except the static application files. Create a city with `POST /api/city`. The response contains its `token` and public `city`. Use `Authorization: Bearer <token>` for subsequent requests.

| Request | Result |
| --- | --- |
| `GET /api/catalog` | Versioned sites, recipes, crops, prices, technologies and household uses |
| `GET /api/city` | Public city snapshot after elapsed events reconcile |
| `DELETE /api/city` | Removes the city and its replay records |
| `POST /api/quote` | Route distance, fee and duration for a source and destination |
| `POST /api/command` | Applies an action and returns the updated snapshot |

Commands take an `Idempotency-Key` header and a JSON object with an `op` field. For instance, use `{"op":"walk","enabled":true}`, followed by `{"op":"step","dx":1,"dy":0}`. Retry a command with the original key and payload. A different payload using the same key returns 422. The database commits state and the command fingerprint together. Rule violations return 422 without applying the action. City and location data can be removed with the delete endpoint.

The SQL migration initializes the fixture database. Catalog version 1 uses the tables in `catalog_v1.json` and the additional rules in `catalog.py`. The JSON state is a new-save format. Legacy-save migration is outstanding.

## Delivery status

The build includes fixture walking and discovery, personal cargo and vehicles, production and quality lots, research, schooling, household consumption, construction and upgrades, surveys, paid road tiers, scheduled hired deliveries, sandbox vouchers, exports and local market orders. This is a partial implementation of the full GDD acceptance contract.

The native mobile build and its real GPS and screen-lock flows, Google Maps, live pedestrian imports and inaccessible-site replacement, live app-store purchases, Supabase, and PostgreSQL/PostGIS remain outstanding. The fixture uses a synthetic connected street grid and a simplified road matcher. The full economy playthrough, physical-device checks and live-provider acceptance runs remain outstanding. A live release would need owner-provided map keys, a pedestrian data source, authentication configuration and Apple/Google store products and credentials. GitHub publication and Codespaces startup have not been verified in this workspace.
