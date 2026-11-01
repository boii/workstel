import unittest
from commission_secret_service import update_flag, CommissionError
class CommissionFlagTests(unittest.TestCase):
    def test_only_flag_changes_and_other_environment_lines_are_preserved(self):
        original='WORKSTEL_SECRET_SERVICE_ENABLED=false\nWORKSTEL_FRONTEND_ORIGIN=https://example.org\n'
        enabled=update_flag(original,True)
        self.assertIn('WORKSTEL_SECRET_SERVICE_ENABLED=true\n',enabled)
        self.assertIn('WORKSTEL_FRONTEND_ORIGIN=https://example.org\n',enabled)
        self.assertEqual(update_flag(enabled,False),original)
    def test_missing_duplicate_or_interpolated_flags_are_rejected(self):
        for text in ['', 'WORKSTEL_SECRET_SERVICE_ENABLED=${FLAG}\n','WORKSTEL_SECRET_SERVICE_ENABLED=true\nWORKSTEL_SECRET_SERVICE_ENABLED=false\n']:
            with self.assertRaises(CommissionError):update_flag(text,True)
if __name__=='__main__':unittest.main()
