from datetime import datetime, timezone
import os
import time

from arango import ArangoClient
from arango.exceptions import ServerConnectionError

ARANGO_HOST = os.getenv("ARANGO_HOST", "arangodb")
ARANGO_PORT = os.getenv("ARANGO_PORT", "8529")
ARANGO_USER = os.getenv("ARANGO_USER", "root")
ARANGO_PASSWORD = os.getenv("ARANGO_PASSWORD", "openSesame")
TARGET_DB = os.getenv("TARGET_DB", "demo_db")
COLLECTION = os.getenv("COLLECTION", "messages")


def connect_with_retry(retries: int = 30, delay_sec: int = 2):
    client = ArangoClient(hosts=f"http://{ARANGO_HOST}:{ARANGO_PORT}")

    for attempt in range(1, retries + 1):
        try:
            sys_db = client.db("_system", username=ARANGO_USER, password=ARANGO_PASSWORD)
            # `StandardDatabase` has no `ping()` in current python-arango versions.
            # A successful version() call confirms connectivity and auth.
            sys_db.version()
            return client, sys_db
        except ServerConnectionError:
            pass

        print(f"[{attempt}/{retries}] Waiting for ArangoDB at {ARANGO_HOST}:{ARANGO_PORT}...")
        time.sleep(delay_sec)

    raise RuntimeError("Could not connect to ArangoDB in time")


def ensure_db_and_collection(client, sys_db):
    if not sys_db.has_database(TARGET_DB):
        sys_db.create_database(TARGET_DB)

    db = client.db(TARGET_DB, username=ARANGO_USER, password=ARANGO_PASSWORD)

    if not db.has_collection(COLLECTION):
        db.create_collection(COLLECTION)

    return db.collection(COLLECTION)


def main():
    client, sys_db = connect_with_retry()
    collection = ensure_db_and_collection(client, sys_db)

    payload = {
        "text": "Hello, World",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    insert_result = collection.insert(payload)
    doc_key = insert_result["_key"]

    fetched_doc = collection.get(doc_key)

    print("Inserted document:")
    print(payload)
    print("\nFetched document from ArangoDB:")
    print(fetched_doc)


if __name__ == "__main__":
    main()
