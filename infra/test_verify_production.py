import tempfile
from pathlib import Path
import unittest
import verify_production

class ProductionVerifierTests(unittest.TestCase):
    def test_only_public_keys_are_accepted_from_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'server.env'
            path.write_text('SERVICE_ROLE_KEY=server-only\nANON_KEY="public-value"\n', encoding='utf8')
            self.assertEqual(verify_production.read_public_key(path), 'public-value')
            path.write_text('SERVICE_ROLE_KEY=server-only\n', encoding='utf8')
            with self.assertRaises(verify_production.SafeError):
                verify_production.read_public_key(path)
    def test_environment_is_never_executed_or_interpolated(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'server.env'
            path.write_text('ANON_KEY=${DO_NOT_EVALUATE}\n', encoding='utf8')
            with self.assertRaises(verify_production.SafeError):
                verify_production.read_public_key(path)

if __name__ == '__main__':
    unittest.main()
