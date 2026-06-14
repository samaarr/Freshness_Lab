"""MongoDB client singleton."""
from functools import lru_cache
from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database

from config import COLLECTION_LEDGER, COLLECTION_LLM_CACHE, COLLECTION_SERVICES, DB_NAME, MONGODB_URI


@lru_cache(maxsize=1)
def get_client() -> MongoClient:
    return MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10_000)


def get_db() -> Database:
    return get_client()[DB_NAME]


def services() -> Collection:
    return get_db()[COLLECTION_SERVICES]


def ledger() -> Collection:
    return get_db()[COLLECTION_LEDGER]


def llm_cache() -> Collection:
    return get_db()[COLLECTION_LLM_CACHE]
