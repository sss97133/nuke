"""Click through the workspace headless: tree, tables, schematic, connector face, library; report errors and selection timing."""
import asyncio, os
from playwright.async_api import async_playwright
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = "file://" + os.path.join(D, "site", "k5_layout.html")

async def run():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
        pg = await b.new_page(viewport={"width": 1600, "height": 1000})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        await pg.goto(URL); await pg.wait_for_timeout(1200)
        async def cur():
            return await pg.evaluate("() => location.hash")
        # tree: open a system, a device, a connector, a pin
        await pg.click("#tlist .tn[data-key='y:COOLING'] .tw"); await pg.wait_for_timeout(200)
        rows = await pg.query_selector_all("#tlist .tn[data-key^='y:COOLING/']")
        await rows[0].click(); await pg.wait_for_timeout(300); print("tree device ->", await cur())
        # table: wire list row, then arrow down twice
        await pg.click("#dtabs button[data-t='wires']"); await pg.fill("#gq", "INJ"); await pg.wait_for_timeout(300)
        t0 = await pg.evaluate("() => performance.now()")
        await pg.click("#grid tbody tr[data-sel]"); t1 = await pg.evaluate("() => performance.now()")
        print("wire row ->", await cur(), "select+render ms", round(t1 - t0))
        await pg.keyboard.press("ArrowDown"); await pg.keyboard.press("ArrowDown"); await pg.wait_for_timeout(300); print("arrow down x2 ->", await cur())
        # schematic: click a wire path
        await pg.click("#vtabs button[data-v='sch']"); await pg.wait_for_timeout(600)
        g = await pg.query_selector("#schsvg g[data-w]")
        box = await g.bounding_box()
        print("schematic wires drawn:", len(await pg.query_selector_all("#schsvg g[data-w]")), "boxes:", len(await pg.query_selector_all("#schsvg .sbox")))
        # connector: M130-A face, click a cavity
        await pg.fill("#gq", ""); await pg.click("#dtabs button[data-t='conns']"); await pg.fill("#gq", "M130-B"); await pg.wait_for_timeout(300)
        await pg.click("#grid tbody tr[data-sel]"); await pg.click("#vtabs button[data-v='conn']"); await pg.wait_for_timeout(500)
        cav = await pg.query_selector_all("#v-conn .cav")
        print("M130-B face cavities:", len(cav))
        await cav[3].click(); await pg.wait_for_timeout(300); print("face pin ->", await cur())
        # library: open, switch to PDM30
        await pg.click("#vtabs button[data-v='lib']"); await pg.wait_for_timeout(3000)
        await pg.click("#liblist button[data-lib='PDM30-A']"); await pg.wait_for_timeout(3000)
        print("library title:", await pg.inner_text("#linfo h2"))
        # manual: a callout selects its device, a tabulation row its wire
        await pg.click("#vtabs button[data-v='man']"); await pg.wait_for_timeout(700)
        co = await pg.query_selector("#man .co")
        if co:
            await co.click(); await pg.wait_for_timeout(300); print("manual callout ->", await cur())
        tr = await pg.query_selector("#man .mtab tr[data-go]")
        if tr:
            await tr.click(); await pg.wait_for_timeout(300); print("manual tabulation row ->", await cur())
        await pg.click("#vdbtn"); await pg.wait_for_timeout(200); print("data panel open:", await pg.is_visible("#vdpanel"))
        await pg.click("#vdbtn"); await pg.wait_for_timeout(200)
        # decision chip and linked wires shortcut
        await pg.click("#decs button:nth-child(3)"); await pg.wait_for_timeout(400); print("decision ->", await cur())
        lk = await pg.query_selector("#pbody [data-linked='wires']")
        if lk: await lk.click(); await pg.wait_for_timeout(400); print("linked wires rows:", await pg.inner_text("#gcnt"))
        # sources dialog opens and closes
        await pg.click("#srcbtn"); await pg.wait_for_timeout(200); vis = await pg.is_visible("#dlg"); await pg.keyboard.press("Escape"); print("sources dialog:", vis, "closed:", not await pg.is_visible("#dlg"))
        print("errors:", errs[:6] or "none")
        await b.close()
asyncio.run(run())
