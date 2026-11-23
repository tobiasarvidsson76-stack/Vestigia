"""Database operations shared by SQLite development and PostgreSQL deployments."""
import sqlite3
from contextlib import closing, contextmanager

class Postgres:
    def __init__(self, url):
        import psycopg
        self.conn=psycopg.connect(url)

    def execute(self, query, args=()):
        return self.conn.execute(query.replace('?', '%s'),args or None)

    def close(self):
        self.conn.close()

    def __enter__(self):
        return self

    def __exit__(self, error, *_):
        if error is None:
            self.conn.commit()
        else:
            self.conn.rollback()

@contextmanager
def connect(path, url):
    if url:
        conn=Postgres(url)
    else:
        conn=sqlite3.connect(path,timeout=15,isolation_level=None)
        conn.execute('PRAGMA foreign_keys = ON')
    with closing(conn) as handle:
        yield handle
