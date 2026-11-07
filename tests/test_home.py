"""Navigation regression test for new PaperVoice homepage and three preserved apps."""
import asyncio
from playwright.async_api import async_playwright

BASE="http://127.0.0.1:8000"

async def main():
    async with async_playwright() as pt:
        browser=await pt.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page()
        errors=[]
        page.on("pageerror",lambda err:errors.append(str(err)))
        try:
            await page.goto(BASE+"/",wait_until="domcontentloaded",timeout=60000)
            assert "PaperVoice" in await page.title()
            assert await page.locator("h1").inner_text() == "Put your voice\non paper."
            for route,name in [
                ("/classic/","PaperVoice Classic"),
                ("/paperback/","PaperBack Lab"),
                ("/research/","SHEET/7 Research"),
            ]:
                item=page.locator(f'a.version[href="{route}"]')
                assert await item.count()==1,(route,"homepage link missing")
                assert name in await item.inner_text(),route
                assert (await page.request.get(BASE+route)).status==200,route
            print("PASS: Homepage lists all three projects with working routes.",flush=True)

            await page.locator('a.version[href="/classic/"]').click()
            assert page.url.endswith("/classic/"),page.url
            await page.wait_for_load_state("load",timeout=60000)
            assert await page.locator("#tab-decode").is_visible()
            await page.locator("#tab-create").click()
            assert await page.locator("#create-panel").is_visible()
            for asset in ["app.js","create.js","tabs.js"]:
                assert (await page.request.get(BASE+"/"+asset)).status==200,asset
            await page.locator('a.back-home[href="/"]').click()
            assert page.url.endswith("/"),page.url
            print("PASS: Original QR interface works at /classic/ and returns home.",flush=True)

            await page.locator('a.version[href="/paperback/"]').click()
            assert page.url.endswith("/paperback/")
            assert await page.locator("#encode-file").is_visible()
            assert await page.locator("#tab-decode").is_visible()
            await page.locator('a.back[href="/"]').click()
            assert page.url.endswith("/")
            print("PASS: PaperBack Lab route and home navigation work.",flush=True)

            await page.locator('a.version[href="/research/"]').click()
            assert page.url.endswith("/research/")
            assert await page.locator("#source-file").is_visible()
            assert await page.locator("#target").input_value()=="7"
            assert await page.locator("#restore").count()==1
            print("PASS: SHEET/7 Research route opens with seven-sheet target.",flush=True)
            print("Browser page errors:",errors,flush=True)
        except Exception:
            await page.screenshot(path="tests/homepage_failure.png",full_page=True)
            print("Page errors:",errors,flush=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())