#!/usr/bin/env python3
"""Unit tests for capture_clock_from_file clock parse (no network)."""
import datetime, importlib.util, os, unittest
from zoneinfo import ZoneInfo
spec = importlib.util.spec_from_file_location('cc', os.path.join(os.path.dirname(__file__), 'capture_clock_from_file.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

LA = ZoneInfo('America/Los_Angeles')

class ClockParse(unittest.TestCase):
    def test_offset_pins_instant(self):
        t = m.parse_exif_clock('2026:03:12 08:47:06', '-07:00')
        self.assertEqual(t.astimezone(datetime.timezone.utc), datetime.datetime(2026, 3, 12, 15, 47, 6, tzinfo=datetime.timezone.utc))

    def test_naive_is_los_angeles_never_utc(self):
        t = m.parse_exif_clock('2026:03:12 08:47:06')
        self.assertEqual(t.tzinfo, LA)
        self.assertEqual(t.astimezone(datetime.timezone.utc).isoformat(), '2026-03-12T15:47:06+00:00')
        utc = m.parse_exif_clock('2026:03:12 08:47:06', '+00:00')
        self.assertNotEqual(t.utctimetuple(), utc.utctimetuple())

    def test_naive_utc_detector(self):
        dto = '2026:03:12 08:47:06'
        self.assertTrue(m.is_naive_utc(dto, '2026-03-12T08:47:06Z'))
        self.assertTrue(m.is_naive_utc(dto, '2026-03-12T08:47:06+00:00'))
        self.assertFalse(m.is_naive_utc(dto, '2026-03-12T15:47:06Z'))
        self.assertFalse(m.is_naive_utc(dto, None))
        self.assertFalse(m.is_naive_utc(None, '2026-03-12T08:47:06Z'))

    def test_pst_wall(self):
        t = m.parse_exif_clock('2026:01:15 08:47:06')
        self.assertEqual(t.astimezone(datetime.timezone.utc).isoformat(), '2026-01-15T16:47:06+00:00')

if __name__ == '__main__':
    unittest.main()
