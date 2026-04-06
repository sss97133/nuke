#!/usr/bin/env python3
"""Export Chrome cookies for a domain as JSON. Used by fb-enrich-with-cookies.mjs."""
import json, sys
from pycookiecheat import chrome_cookies

domain = sys.argv[1] if len(sys.argv) > 1 else "https://www.facebook.com"
cookies = chrome_cookies(domain)
print(json.dumps(cookies))
