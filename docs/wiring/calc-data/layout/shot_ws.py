"""Headless screenshots of the workspace: python3 shot_ws.py <out_dir> [names...]
Each shot: (name, viewport, colour scheme, start hash, actions). Reports page errors."""
import asyncio, os, sys
from playwright.async_api import async_playwright

D = os.path.dirname(os.path.abspath(__file__))
URL = "file://" + os.path.join(D, "site", "k5_layout.html")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(D, "shots")
ONLY = set(sys.argv[2:])
os.makedirs(OUT, exist_ok=True)

SHOTS = [
    ("m01_manual_p1", (1600, 1000), "light", "", []),
    ("m02_manual_fig", (1600, 1000), "light", "", [("mscroll", 900)]),
    ("m02b_manual_fig_lights", (1600, 1000), "light", "y.LIGHTING_EXTERIOR", [("mscroll", 900)]),
    ("m03_manual_conn", (1600, 1000), "light", "", [("mscroll", 2300)]),
    ("m04_manual_lights_wire", (1600, 1000), "light", "w.85a", []),
    ("m05_manual_tab", (1600, 1000), "light", "y.COOLING", [("mscroll", 99999)]),
    ("m06_manual_dark", (1600, 1000), "dark", "c.M130-A", [("mscroll", 1150)]),
    ("m07_phone_manual", (400, 860), "light", "", [("mscroll", 0)]),
    ("d01_data_panel", (1600, 1000), "light", "", [("click", "#vdbtn")]),
    ("w01_vehicle_top", (1600, 1000), "light", "", [("view", "vehicle")]),
    ("w02_vehicle_m130", (1600, 1000), "light", "c.M130-A", [("view", "vehicle"), ("frame",)]),
    ("w03_vehicle_side_wire", (1600, 1000), "light", "w.4a", [("view", "vehicle"), ("v2", "side")]),
    ("w04_vehicle_bay_seg", (1600, 1000), "light", "s.DC-63", [("view", "vehicle"), ("v2", "bay"), ("frame",)]),
    ("w05_vehicle_3d", (1600, 1000), "light", "c.ISOLATOR", [("view", "vehicle"), ("v2", "3d"), ("wait", 6000)]),
    ("w06_connector_m130", (1600, 1000), "light", "p.M130-A~A02", [("view", "conn")]),
    ("w07_connector_list", (1600, 1000), "light", "c.FIREWALL-CABIN", [("view", "conn")]),
    ("w08_schematic_engine", (1600, 1000), "light", "w.4a", [("view", "sch")]),
    ("w09_schematic_lights", (1600, 1000), "light", "y.LIGHTING_EXTERIOR", [("view", "sch")]),
    ("w10_library_m130", (1600, 1000), "light", "p.M130-A~A01", [("view", "lib"), ("wait", 5000)]),
    ("w10b_library_deutsch", (1600, 1000), "light", "c.FIREWALL-BODY-A", [("view", "lib"), ("wait", 5000)]),
    ("w11_bom", (1600, 1000), "light", "c.ISOLATOR", [("tab", "bom")]),
    ("w12_open_decision", (1600, 1000), "light", "", [("dec", 1)]),
    ("w13_pins", (1600, 1000), "light", "c.PDM30-A", [("tab", "pins")]),
    ("w14_dark", (1600, 1000), "dark", "c.M130-A", [("view", "sch")]),
    ("w15_medium", (1180, 860), "light", "c.M130-A", [("view", "vehicle")]),
    ("w16_phone", (400, 860), "light", "", []),
    ("w17_phone_props", (400, 860), "light", "", [("scroll", 900)]),
    ("w18_phone_dock", (400, 860), "light", "", [("scroll", 2200)]),
    ("w19_tree_search", (1600, 1000), "light", "", [("tq", "superseal")]),
]


async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        for name, vpsz, scheme, hsh, acts in SHOTS:
            if ONLY and name not in ONLY:
                continue
            ctx = await b.new_context(viewport={"width": vpsz[0], "height": vpsz[1]}, color_scheme=scheme, device_scale_factor=1)
            pg = await ctx.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.on("console", lambda m: errs.append("console: " + m.text) if m.type == "error" else None)
            await pg.goto(URL + ("#" + hsh if hsh else ""))
            await pg.wait_for_timeout(1200)
            for a in acts:
                if a[0] == "view":
                    await pg.click(f"#vtabs button[data-v='{a[1]}']"); await pg.wait_for_timeout(900)
                elif a[0] == "v2":
                    await pg.click(f"#v2seg button[data-v2='{a[1]}']"); await pg.wait_for_timeout(900)
                elif a[0] == "tab":
                    await pg.click(f"#dtabs button[data-t='{a[1]}']"); await pg.wait_for_timeout(500)
                elif a[0] == "frame":
                    await pg.click("#zbar button[data-z='sel']"); await pg.wait_for_timeout(700)
                elif a[0] == "dec":
                    await pg.click(f"#decs button:nth-child({a[1]})"); await pg.wait_for_timeout(700)
                elif a[0] == "wait":
                    await pg.wait_for_timeout(a[1])
                elif a[0] == "scroll":
                    await pg.evaluate("y => window.scrollTo(0, y)", a[1]); await pg.wait_for_timeout(400)
                elif a[0] == "mscroll":
                    await pg.evaluate("y => { const m = document.querySelector('#man'); m.scrollTo(0, y); }", a[1]); await pg.wait_for_timeout(400)
                elif a[0] == "click":
                    await pg.click(a[1]); await pg.wait_for_timeout(400)
                elif a[0] == "tq":
                    await pg.fill("#tq", a[1]); await pg.wait_for_timeout(500)
            await pg.screenshot(path=os.path.join(OUT, name + ".png"))
            print(name, "errors:", errs[:5] if errs else "none")
            await ctx.close()
        await b.close()

asyncio.run(run())
