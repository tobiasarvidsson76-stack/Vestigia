CREATE TABLE IF NOT EXISTS cities (
    owner TEXT PRIMARY KEY,
    state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commands (
    owner TEXT NOT NULL REFERENCES cities(owner) ON DELETE CASCADE,
    id TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (owner, id)
);
PRAGMA user_version = 1;
