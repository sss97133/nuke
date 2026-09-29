"""Headless screenshots of the built page: python3 shot.py <out_dir> [names...]
Each shot: (name, viewport, color_scheme, actions). Reports page errors."""
import asyncio, os, sys
from playwright.async_api import async_playwright

D = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(D, "site", "k5_layout.html")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, "shots")
ONLY = set(sys.argv[2:])
os.makedirs(OUT, exist_ok=True)


async def click_view(pg, v):
    await pg.click(f"#views button[data-view='{v}']"); await pg.wait_for_timeout(500)


async def select(pg, end_id):
    await pg.evaluate("id => { location.hash = id; }", end_id)
    await pg.fill("#f-q", end_id); await pg.wait_for_timeout(200)
    row = await pg.query_selector(f"#grid tr[data-id='{end_id}']")
    if row:
        await row.click()
    await pg.wait_for_timeout(700)


SHOTS = [
    ("01_top_default", (1600, 1000), "light", []),
    ("02_side", (1600, 1000), "light", [("view", "side")]),
    ("03_bay", (1600, 1000), "light", [("view", "bay")]),
    ("04_select_m130", (1600, 1000), "light", [("select", "M130-A"), ("frame", None)]),
    ("05_select_notdrawn", (1600, 1000), "light", [("select", "CKP")]),
    ("06_parts_tab", (1600, 1000), "light", [("tab", "parts")]),
    ("07_dark_bay", (1600, 1000), "dark", [("view", "bay"), ("select", "ODYSSEY")]),
    ("08_phone", (400, 860), "light", []),
    ("08b_phone_insp", (400, 860), "light", [("scroll", 560)]),
    ("08c_phone_table", (400, 860), "light", [("scroll", 2400)]),
    ("09_below", (1600, 1000), "light", [("scroll", 1100)]),
    ("11_routes_bay", (1600, 1000), "light", [("view", "bay"), ("tab", "routes"), ("clickrow", "seg:ENG-T0~1")]),
    ("12_route_dc", (1600, 1000), "light", [("view", "bay"), ("tab", "routes"), ("clickrow", "seg:DC-63"), ("frame", None)]),
    ("13_cost_tab", (1600, 1000), "light", [("select", "ISOLATOR"), ("tab", "cost"), ("inspscroll", 1500)]),
    ("14_work_tab", (1600, 1000), "light", [("select", "IBOOSTER"), ("tab", "work"), ("inspscroll", 2200)]),
    ("15_sub_call", (1600, 1000), "light", [("view", "top"), ("select", "SUB-2"), ("inspscroll", 900)]),
    ("16_dark_routes", (1600, 1000), "dark", [("view", "bay"), ("select", "CLT-ECU"), ("frame", None)]),
    ("17_3d_bay", (1600, 1000), "light", [("view3d", None)]),
    ("18_3d_select", (1600, 1000), "light", [("view3d", None), ("select", "ODYSSEY"), ("frame", None)]),
]


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, (w, h), scheme, acts in SHOTS:
            if ONLY and name not in ONLY:
                continue
            ctx = await b.new_context(viewport={"width": w, "height": h}, color_scheme=scheme, device_scale_factor=1)
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type in ("error", "warning") else None)
            await pg.goto(URL)
            await pg.wait_for_timeout(1200)
            full = False
            for a, arg in acts:
                if a == "view":
                    await click_view(pg, arg)
                elif a == "select":
                    await select(pg, arg)
                elif a == "tab":
                    await pg.click(f"#tabs button[data-tab='{arg}']"); await pg.wait_for_timeout(300)
                elif a == "frame":
                    await pg.click("#z-sel"); await pg.wait_for_timeout(500)
                elif a == "view3d":
                    await pg.click("#views button[data-view='3d']"); await pg.wait_for_timeout(9000)
                elif a == "clickrow":
                    row = await pg.query_selector(f"#grid tr[data-id='{arg}']") or await pg.query_selector("#grid tbody tr[data-id^='seg:']")
                    if row:
                        await row.click(); await pg.wait_for_timeout(500)
                elif a == "inspscroll":
                    await pg.evaluate("y => document.querySelector('#insp-body').scrollTop = y", arg); await pg.wait_for_timeout(300)
                elif a == "scroll":
                    await pg.evaluate("y => window.scrollTo(0, y)", arg); await pg.wait_for_timeout(300)
            full = False
            await pg.screenshot(path=os.path.join(OUT, name + ".png"), full_page=full)
            print(name, "errors:", errs[:6])
            await ctx.close()
        await b.close()


asyncio.run(main())
