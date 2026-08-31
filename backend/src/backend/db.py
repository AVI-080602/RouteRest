"""A single, shared way to open a database connection.

What this module is for: every other module that needs the database
(fatigue_rules.py, and whatever comes next) calls get_connection() rather
than each building its own connection string, so the connection details
live in exactly one place. Reads the same environment variable names as
backend/db/.env, so the same .env file used to set up the database also
configures the backend that queries it.
"""

import os
from pathlib import Path

import psycopg
from dotenv import load_dotenv

# Loaded once, at import time, from the same .env file backend/db/README.md
# tells you to create. Kept here rather than relying on the shell already
# having these variables set, so `uv run fastapi dev ...` works the same
# way regardless of how or where it is launched from.
load_dotenv(Path(__file__).resolve().parent.parent.parent / "db" / ".env")


def get_connection() -> psycopg.Connection:
    """Opens a new connection to the RouteRest database using environment
    variables. Callers are responsible for closing what they open, this
    function only knows how to connect, not how long the caller needs it
    for."""
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "routerest"),
        user=os.environ.get("POSTGRES_USER", "postgres"),
        password=os.environ["POSTGRES_PASSWORD"],
    )
