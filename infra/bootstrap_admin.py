#!/usr/bin/env python3
"""Provision the first Workstel metadata administrator on the hotel server.

Uses local Supabase Admin API and PostgreSQL operator access. Passwords are
read from the terminal and never passed in process arguments or SQL.
"""
import argparse
import getpass
import json
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request
import uuid


def sql_literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def database(sql):
    result = subprocess.run(
        ["docker", "exec", "-i", "-u", "postgres", "workstel-db",
         "psql", "-X", "-q", "-At", "--set=ON_ERROR_STOP=1", "--dbname=postgres"],
        input=sql, text=True, capture_output=True, check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Database operation failed. No database error or secret was printed.")
    return result.stdout.strip()


def read_service_key(env_file):
    values = {}
    for raw in env_file.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key = key.strip().removeprefix("export ").strip()
        if separator and key in {"SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"}:
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                value = value[1:-1]
            values[key] = value
    for name in ("SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"):
        value = values.get(name, "")
        if len(value) > 20 and not any(character.isspace() for character in value) and "$" not in value:
            return value
    raise RuntimeError("No literal server-side service key was found in the server .env file.")


def create_user(email, password, service_key):
    headers = {"apikey": service_key, "Content-Type": "application/json"}
    if not service_key.startswith("sb_secret_"):
        headers["Authorization"] = "Bearer " + service_key
    request = urllib.request.Request(
        "http://127.0.0.1:8000/auth/v1/admin/users",
        data=json.dumps({"email": email, "password": password, "email_confirm": True}).encode(),
        headers=headers, method="POST",
    )
    # Never forward an administrative credential through an environment proxy or redirect.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, file_pointer, code, message, headers, new_url):
            return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=20) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError("Auth admin request failed (HTTP " + str(error.code) + "). Response body suppressed.") from None
    except urllib.error.URLError:
        raise RuntimeError("The local Auth gateway could not be reached.") from None
    return str(uuid.UUID(str(result.get("id", ""))))


def read_password():
    if not sys.stdin.isatty():
        raise RuntimeError("Run this script directly in an interactive terminal for hidden password entry.")
    first = getpass.getpass("New admin password (hidden, 12+ characters): ")
    second = getpass.getpass("Confirm password (hidden): ")
    if first != second:
        raise RuntimeError("Passwords do not match. No account was created.")
    if len(first) < 12 or len(first.encode("utf-8")) > 72:
        raise RuntimeError("Use at least 12 characters and at most 72 UTF-8 bytes.")
    return first


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True)
    parser.add_argument("--env-file", default="/opt/workstel/.env")
    parser.add_argument("--hotel-id", help="Required when multiple hotels already exist.")
    args = parser.parse_args()
    email = args.email.strip().lower()
    if email.count("@") != 1 or len(email) > 254 or any(character.isspace() for character in email):
        raise RuntimeError("Enter a valid email address.")
    env_file = Path(args.env_file)
    # Refuse to create an account if the Workstel schema has not been installed.
    ready = database("select to_regclass('workstel_private.staff_access') is not null and to_regprocedure('public.workstel_session()') is not null;")
    if ready != "t":
        raise RuntimeError("Workstel migration is missing. Install it before provisioning staff.")

    hotels = json.loads(database("select coalesce(json_agg(row_to_json(h)),'[]'::json) from (select id,name from public.workstel_hotels order by name) h;"))
    if args.hotel_id:
        hotel_id = str(uuid.UUID(args.hotel_id))
        matching = [hotel for hotel in hotels if hotel["id"] == hotel_id]
        if not matching:
            raise RuntimeError("The selected hotel does not exist.")
        hotel_name = matching[0]["name"]
    elif len(hotels) == 1:
        hotel_id, hotel_name = hotels[0]["id"], hotels[0]["name"]
    elif len(hotels) > 1:
        raise RuntimeError("Multiple hotels exist. Rerun with --hotel-id to avoid granting access to the wrong hotel.")
    else:
        hotel_name = input("Hotel name: ").strip()
        if not 1 <= len(hotel_name) <= 150:
            raise RuntimeError("Hotel name must contain 1 to 150 characters.")
        hotel_id = str(uuid.uuid4())

    users = json.loads(database(
        "select coalesce(json_agg(id::text),'[]'::json) from auth.users where lower(email)=" + sql_literal(email) + ";"
    ))
    if len(users) > 1:
        raise RuntimeError("Multiple identities match this email; review them before granting access.")
    if users:
        user_id = str(uuid.UUID(users[0]))
        print("Existing Auth account found. Its password and email-confirmation state will not be changed.")
    else:
        service_key = read_service_key(env_file)
        password = read_password()
        user_id = create_user(email, password, service_key)
        del password, service_key
        print("Auth account created. Password was not displayed or written to a file.")

    hotel = sql_literal(hotel_id) + "::uuid"
    user = sql_literal(user_id) + "::uuid"
    statements = [
        "begin;",
        "insert into public.workstel_hotels(id,name) values (" + hotel + "," + sql_literal(hotel_name) + ") on conflict(id) do nothing;",
    ]
    for code, name in (
        ("front-office", "Front Office"), ("sales", "Sales & Marketing"),
        ("engineering", "Engineering"), ("it", "IT"),
    ):
        statements.append(
            "insert into public.workstel_departments(hotel_id,code,name) values (" + hotel + "," + sql_literal(code) + "," + sql_literal(name) + ") on conflict(hotel_id,code) do nothing;"
        )
    statements.extend([
        "insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit,enabled) "
        "select " + user + ",hotel_id,id,true,true,true,true,true from public.workstel_departments where hotel_id=" + hotel + " "
        "on conflict(user_id,hotel_id,department_id) do update set can_read=true,can_write=true,can_archive=true,can_audit=true,enabled=true;",
        "insert into workstel_private.audit_events(actor_id,hotel_id,resource_id,action,outcome) values (null," + hotel + "," + user + ",'admin.bootstrap','success');",
        "commit;",
        "select 'Department grants: '||count(*) from workstel_private.staff_access where user_id=" + user + " and hotel_id=" + hotel + " and enabled;",
    ])
    summary = database("\n".join(statements))
    print("Workstel metadata administrator provisioned for the selected hotel.")
    print(summary)
    print("Real password storage and reveal remain disabled. Do not share credentials or database backups.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        sys.exit(1)
