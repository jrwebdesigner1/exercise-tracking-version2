"""Provision a therapist account without public registration."""

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError


def main():
    load_dotenv(Path(__file__).with_name(".env"))
    parser = argparse.ArgumentParser(description="Create a CHANRE CARE therapist")
    parser.add_argument("--name", required=True)
    parser.add_argument("--email")
    args = parser.parse_args()
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        parser.error("MONGODB_URI must be set in backend/.env")
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    db = client.get_default_database(default="chanre_care")
    email_index = db.users.index_information().get("email_1")
    if email_index and not email_index.get("sparse"):
        db.users.drop_index("email_1")
    db.users.create_index("email", unique=True, sparse=True)
    try:
        doc = {"name": args.name.strip(), "role": "THERAPIST", "active": True, "createdAt": datetime.now(timezone.utc)}
        if args.email:
            doc["email"] = args.email.lower().strip()
        result = db.users.insert_one(doc)
    except DuplicateKeyError:
        parser.error("An account already uses this email")
    print(f"Created therapist {result.inserted_id}")


if __name__ == "__main__":
    main()
