import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import bootstrap_admin


class BootstrapAdminTests(unittest.TestCase):
    def test_existing_account_does_not_request_or_change_password(self):
        user = "11111111-1111-4111-8111-111111111111"
        hotel = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        responses = ["t", json.dumps([{"id": hotel, "name": "Sample Hotel"}]), json.dumps([user]), "Department grants: 4"]
        with patch.object(bootstrap_admin, "database", side_effect=responses) as database, patch.object(bootstrap_admin, "read_password") as password, patch.object(bootstrap_admin, "create_user") as create_user, patch("sys.argv", ["bootstrap_admin.py", "--email", "admin@example.com"]), contextlib.redirect_stdout(io.StringIO()):
            bootstrap_admin.main()
        password.assert_not_called()
        create_user.assert_not_called()
        sql = database.call_args_list[-1].args[0]
        self.assertIn("begin;", sql)
        self.assertIn("admin.bootstrap", sql)
        self.assertNotIn("password", sql)

    def test_multiple_hotels_require_explicit_scope(self):
        with patch.object(bootstrap_admin, "database", side_effect=["t", '[{"id":"a","name":"A"},{"id":"b","name":"B"}]']), patch("sys.argv", ["bootstrap_admin.py", "--email", "admin@example.com"]):
            with self.assertRaisesRegex(RuntimeError, "Multiple hotels"):
                bootstrap_admin.main()

    def test_env_parser_does_not_execute_shell_expansion(self):
        with tempfile.TemporaryDirectory() as directory:
            file = Path(directory) / ".env"
            file.write_text("SERVICE_ROLE_KEY=${DO_NOT_EXECUTE}\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "No literal"):
                bootstrap_admin.read_service_key(file)

    def test_sql_quotes_are_escaped(self):
        self.assertEqual(bootstrap_admin.sql_literal("Hotel's name"), "'Hotel''s name'")

    def test_password_entry_requires_a_terminal(self):
        with patch("sys.stdin.isatty", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "interactive terminal"):
                bootstrap_admin.read_password()


if __name__ == "__main__":
    unittest.main()
