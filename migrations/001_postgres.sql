CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS cities (
    owner text PRIMARY KEY,
    state text NOT NULL
);
CREATE TABLE IF NOT EXISTS commands (
    owner text NOT NULL REFERENCES cities(owner) ON DELETE CASCADE,
    id text NOT NULL,
    payload text NOT NULL,
    PRIMARY KEY (owner, id)
);
CREATE TABLE IF NOT EXISTS city_anchors (
    owner text NOT NULL REFERENCES cities(owner) ON DELETE CASCADE,
    tile text NOT NULL,
    position geometry(Point, 4326) NOT NULL,
    PRIMARY KEY (owner, tile)
);
CREATE INDEX IF NOT EXISTS city_anchors_position ON city_anchors USING gist (position);
