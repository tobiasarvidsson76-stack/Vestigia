CREATE TABLE IF NOT EXISTS voucher_entitlements (
    receipt_hash TEXT PRIMARY KEY,
    owner TEXT REFERENCES cities(owner) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity = 5),
    granted_at BIGINT NOT NULL
);
