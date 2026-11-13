"""Tests for landing_drain_loop.with_retry: transient network failures back off and retry; real errors surface."""
import socket
import unittest
import urllib.error

from landing_drain_loop import is_retryable, with_retry


class Flaky:
    def __init__(self, errors, value='ok'):
        self.errors, self.value, self.calls = list(errors), value, 0

    def __call__(self):
        self.calls += 1
        if self.errors:
            raise self.errors.pop(0)
        return self.value


class WithRetryTest(unittest.TestCase):
    def setUp(self):
        self.waits = []

    def run_retry(self, fn, **kw):
        return with_retry(fn, sleep=self.waits.append, **kw)

    def test_urlerror_timeout_is_retried_with_backoff(self):
        # the crash seen 2026-11-09 10:38 AST: URLError(<urlopen error timed out>) from pending()
        fn = Flaky([urllib.error.URLError(socket.timeout('timed out')), TimeoutError(), ConnectionResetError()])
        self.assertEqual(self.run_retry(fn, base=5, cap=300), 'ok')
        self.assertEqual(fn.calls, 4)
        self.assertEqual(self.waits, [5, 10, 20])

    def test_backoff_is_capped(self):
        fn = Flaky([TimeoutError()] * 5)
        self.run_retry(fn, attempts=6, base=100, cap=300)
        self.assertEqual(self.waits, [100, 200, 300, 300, 300])

    def test_gives_up_after_attempts_and_reraises(self):
        fn = Flaky([TimeoutError()] * 3)
        with self.assertRaises(TimeoutError):
            self.run_retry(fn, attempts=3)
        self.assertEqual(fn.calls, 3)

    def test_gateway_http_errors_retry_but_client_errors_do_not(self):
        e503 = urllib.error.HTTPError('u', 503, 'x', {}, None)
        e400 = urllib.error.HTTPError('u', 400, 'x', {}, None)
        self.assertTrue(is_retryable(e503))
        self.assertFalse(is_retryable(e400))
        fn = Flaky([e400])
        with self.assertRaises(urllib.error.HTTPError):
            self.run_retry(fn)
        self.assertEqual((fn.calls, self.waits), (1, []))

    def test_programming_errors_are_not_retried(self):
        fn = Flaky([KeyError('x')])
        with self.assertRaises(KeyError):
            self.run_retry(fn)
        self.assertEqual(fn.calls, 1)


if __name__ == '__main__':
    unittest.main()
