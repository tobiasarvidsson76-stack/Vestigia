# Vestigia

Vestigia is a walking city builder. The development build includes a browser fixture and an Expo app for Android and iOS. Both share the same game service and economy. The simulated fixture requires no map key, external account or payment credentials.

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

## Native development build

In the repository root run `./dev`. From `mobile`, using Node 22 or newer:

```sh
npm ci
export EXPO_PUBLIC_VESTIGIA_API=https://YOUR-FORWARDED-SERVER-URL
npm run android
# On macOS with Xcode and CocoaPods, use npm run ios instead.
```

Use the forwarded HTTPS API URL for a physical device. For a local Android emulator on the same machine as the API, the host address is `10.0.2.2`. To use an installed development build, run `npm start` in `mobile`. The Expo app uses the same fixture arrows and clock when talking to the fixture backend. Once connected to a GPS backend it requests location only when you locate the city, start a walk or use an on-site action. Screen-locked tracking is an opt-in for that walk. If background permission is declined it records in the foreground. The task stores unsent fixes on the device and synchronizes them when the app is active again.

### GPS and Google Maps

The Android package and iOS bundle ID are both `com.vestigia.city`. Enable the Maps SDKs in a billing-enabled Google Cloud project. Restrict the Android key to that package and the signing certificate SHA-1 used for the build. Restrict the iOS key to the bundle ID. Set `VESTIGIA_MAPS_ANDROID_KEY` and/or `VESTIGIA_MAPS_IOS_KEY` in the native build environment and rebuild. The GPS client offers the site list even without a map key.

A separate pedestrian graph controls access and haul routing. To exercise the GPS service with simulated coordinates around the provided origin, prepare the sample graph:

```sh
python3 import_pedestrian.py fixtures/pedestrian.json /tmp/vestigia-graph.json 59 18
VESTIGIA_PEDESTRIAN_GRAPH=/tmp/vestigia-graph.json ./dev
```

Start a fresh city for a different graph. For a real area, replace the input with a bounded Overpass JSON export containing pedestrian ways and all referenced nodes, including their tags. Use the center latitude and longitude as the metric projection origin. The importer excludes forbidden ways and keeps separately tagged layers disconnected except at explicit transitions. Shared OSM node IDs define junctions. The importer pairs aligned sidewalks that identify the same street and layer. The optional `vestigia:section` way tag links curated pavement pieces for road credit. OSM imports require the applicable attribution and data license terms. Keep the imported graph bounded and review crossing and access coverage before a device walk. Use a separate save database for a different deployment or test district.

### PostgreSQL and real accounts

`docker compose up --build` starts the fixture game using its own PostGIS database. For an external deployment set `VESTIGIA_DATABASE_URL` to the Vestigia database connection string. The server applies the SQL migrations on startup. Native sign-in uses email and password for existing Supabase accounts. Set `VESTIGIA_SUPABASE_URL` and `VESTIGIA_SUPABASE_KEY` on the game server, provision the testers in Supabase, and serve the API behind HTTPS. Authentication is optional for local fixture runs. Keep the database URL and provider configuration in the deployment environment, outside GitHub.

### Store configuration

The product ID on both platforms is `vestigia_haul_vouchers_5`, configured as a one-time consumable pack. Google Play requires an app and store product under `com.vestigia.city`, a test track and billing testers, and service-account credentials with Android Publisher access. Set `VESTIGIA_GOOGLE_PLAY_BILLING=1` and provide Google application default credentials to the server. For Apple, configure the product under the same bundle ID and an App Store sandbox tester. Set `VESTIGIA_APPLE_ROOT_CERTS` to the path or path-separated list of Apple root certificates, `VESTIGIA_APPLE_APP_ID` to the numeric App Store app ID, and `VESTIGIA_APPLE_SANDBOX=1` for sandbox testing. Install `requirements-billing.txt` in deployments that enable live verification.

Store tests require an authenticated GPS-mode city. The app displays the localized price and submits the purchase to the server before finishing it with the store. Unfinished purchases retry on launch or foreground. The database keeps a receipt fingerprint to prevent replay, including after city deletion. Location history and city ownership data are removed on deletion.

## Test

```sh
python3 -m unittest discover -s tests -v
node --check static/app.js
cd mobile && npm ci && npm run typecheck
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
| `POST /api/planner/route` | Route from the current fix or town store to a revealed site |
| `POST /api/command` | Applies an action and returns the updated snapshot |

Commands take an `Idempotency-Key` header and a JSON object with an `op` field. For instance, use `{"op":"walk","enabled":true}`, followed by `{"op":"step","dx":1,"dy":0}`. Retry a command with the original key and payload. A different payload using the same key returns 422. The database commits state and the command fingerprint together. Rule violations return 422 without applying the action. City and location data can be removed with the delete endpoint.

GPS mode additionally accepts `{"op":"gps samples","session":"walk-id","samples":[{"latitude":59,"longitude":18,"accuracy":5,"at":1720000000}]}`, where `at` is Unix time in seconds. Send a current sample before starting the first walk. Supply the same session ID with the walk start and every active batch. Sample positions are reconciled before inventory commands and request bodies are not retained. Supabase mode adds `POST /api/login` and `POST /api/refresh`. Platform stores add `GET /api/billing/config` and `POST /api/billing/redeem`.

Catalog version 1 uses the tables in `catalog_v1.json` and the additional rules in `catalog.py`. The save migration accepts the original fixture state and preserves its running batches and existing grades.

## Acceptance status

The automated suite checks the starter cottage, catalog and batch capacity, education and research, save upgrades, household consumption, surveys, road wear, export grades, 48-hour catch-up with deliveries, GPS replay and access filtering, and entitlement deduplication with a simulated platform verification response. The native TypeScript, Expo bundle generation and module discovery can be checked without platform credentials.

Physical-device checks and full native compilation, an entire city progression playthrough, real pedestrian coverage, live PostgreSQL/PostGIS startup, and live Supabase, Maps, Google Play and Apple sandbox verification have separate acceptance requirements. The current workspace restricts listening sockets and access to the Docker daemon. A bounded import and basic map matching are implemented. Pairing opposite pavements with missing street metadata and anchor placement in areas without a usable pedestrian graph remain open.
