import importlib.util
import io
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("refresh_market", Path(__file__).with_name("refresh-market-views.py"))
refresh_market = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh_market)


class RefreshMarketContracts(unittest.TestCase):
    def test_default_plan_is_unchanged_and_dry_run_never_connects(self):
        out = io.StringIO()
        with patch.object(refresh_market, "connect_db") as connect, redirect_stdout(out):
            self.assertEqual(refresh_market.main(["--dry-run"]), 0)
        self.assertEqual(out.getvalue().splitlines(), refresh_market.VIEWS)
        connect.assert_not_called()

    def test_subset_is_deduplicated_and_dependency_ordered(self):
        out = io.StringIO()
        with redirect_stdout(out):
            refresh_market.main(["--dry-run", "--views", "public.mv_family_sales",
                                 "public.mv_model_family_names", "public.mv_family_market", "public.mv_family_sales"])
        self.assertEqual(out.getvalue().splitlines(), ["public.mv_model_family_names", "public.mv_family_market", "public.mv_family_sales"])

    def test_arbitrary_sql_target_is_rejected_without_connection(self):
        with patch.object(refresh_market, "connect_db") as connect:
            with self.assertRaises(ValueError):
                refresh_market.refresh("public.vehicles; DELETE FROM public.vehicles")
            with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                refresh_market.main(["--views", "public.vehicles"])
        connect.assert_not_called()

    def test_failure_never_falls_back_to_blocking_refresh_and_closes_connection(self):
        conn = MagicMock()
        conn.cursor.return_value.execute.side_effect = [None, RuntimeError("lock timeout")]
        with patch.object(refresh_market, "connect_db", return_value=conn):
            with self.assertRaises(RuntimeError):
                refresh_market.refresh("public.mv_family_market")
        self.assertEqual(conn.cursor.return_value.execute.call_args.args[0],
                         "REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_family_market;")
        conn.close.assert_called_once()

    def test_year_prices_use_the_existing_owner_and_budget(self):
        conn = MagicMock()
        with patch.object(refresh_market, "connect_db", return_value=conn):
            refresh_market.refresh("public.mv_family_year_prices")
        self.assertEqual([c.args[0] for c in conn.cursor.return_value.execute.call_args_list],
                         ["SET statement_timeout = '20min';", "SELECT public.refresh_family_year_prices();"])
        conn.close.assert_called_once()

    def test_private_empty_cached_copy_has_explicit_bounded_first_build(self):
        conn = MagicMock()
        conn.cursor.return_value.fetchone.return_value = (False, False, False, True)
        with patch.object(refresh_market, "connect_db", return_value=conn):
            refresh_market.refresh("public.mv_family_year_prices_v2")
        calls = [c.args[0] for c in conn.cursor.return_value.execute.call_args_list]
        self.assertIn("statement_timeout = '120s'", calls[-2])
        self.assertEqual(calls[-1], "REFRESH MATERIALIZED VIEW public.mv_family_year_prices_v2;")
        conn.close.assert_called_once()

    def test_beside_build_refuses_populated_public_read_or_unpatched_copy(self):
        for state in [None, (True, False, False, True), (False, True, False, True),
                      (False, False, True, True), (False, False, False, False)]:
            with self.subTest(state=state):
                conn = MagicMock()
                conn.cursor.return_value.fetchone.return_value = state
                with patch.object(refresh_market, "connect_db", return_value=conn), self.assertRaises(RuntimeError):
                    refresh_market.refresh("public.mv_family_year_prices_v2")
                self.assertEqual(conn.cursor.return_value.execute.call_count, 1)
                conn.close.assert_called_once()

    def test_single_attempt_failure_stops_before_dependent_folds(self):
        with patch.object(refresh_market, "refresh", side_effect=RuntimeError("failed")) as run, \
                patch.object(refresh_market.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            self.assertEqual(refresh_market.main(["--attempts", "1", "--views", "public.mv_model_family_names", "public.mv_family_sales"]), 1)
        run.assert_called_once_with("public.mv_model_family_names")
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
