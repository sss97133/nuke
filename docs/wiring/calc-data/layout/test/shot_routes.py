import asyncio, os
from playwright.async_api import async_playwright
D = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1600, "height": 1000})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file://" + os.path.join(D, "site", "_routes_test.html"))
        await pg.wait_for_timeout(1000)
        await pg.click("#views button[data-view='bay']"); await pg.wait_for_timeout(400)
        # zoom to the test route area by selecting M130-A and framing
        await pg.evaluate("location.hash='M130-A'")
        await pg.fill('#f-q', 'M130-A'); await pg.wait_for_timeout(200)
        await pg.click("#grid tr[data-id='M130-A']"); await pg.wait_for_timeout(300)
        await pg.click('#z-sel'); await pg.wait_for_timeout(500)
        seg = await pg.query_selector("#ov .rt")
        box = await seg.bounding_box() if seg else None
        print('route element', bool(seg), box)
        # click the route's centreline point via JS event on the element
        await pg.evaluate("""() => { const s = document.querySelector('#ov .rt'); const r = s.getBoundingClientRect();
          const ev = (t, x, y) => s.dispatchEvent(new PointerEvent(t, {bubbles: true, clientX: x, clientY: y, pointerId: 1}));
          window.__segid = s.dataset.seg; }""")
        await pg.evaluate("() => { const b = [...document.querySelectorAll('#tabs button')].find(x => x.dataset.tab === 'routes'); b.click(); }")
        await pg.wait_for_timeout(300)
        await pg.click("#grid tr[data-id='seg:T-SEG-1']"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=os.path.join(D, "test", "routes_selected.png"))
        print("errors:", errs)
        await b.close()
asyncio.run(main())
