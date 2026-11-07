"""End-to-end test for the separate PaperBack Lab using the REAL paperback.rs WASM:
MP3 -> PaperBack PDF -> decode PDF -> original identical MP3 bytes."""
import asyncio, hashlib, os, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).parent
SOURCE=HERE/"paperback_original.mp3"
PDF=HERE/"paperback_printed.pdf"

async def main():
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
        "-f","lavfi","-i","sine=frequency=440:sample_rate=24000:duration=2.5",
        "-c:a","libmp3lame","-b:a","48k",str(SOURCE)],check=True)
    original=SOURCE.read_bytes()
    hash_before=hashlib.sha256(original).hexdigest()
    print("Original MP3:",len(original),"bytes, SHA-256",hash_before,flush=True)
    errors=[]
    async with async_playwright() as browser_tool:
        browser=await browser_tool.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page(accept_downloads=True)
        page.on("pageerror",lambda error:errors.append("JS: "+str(error)))
        page.on("console",lambda msg:errors.append("CONSOLE: "+msg.text) if msg.type=="error" else None)
        page.on("requestfailed",lambda req:errors.append("REQUEST: "+req.url+" "+str(req.failure)))
        try:
            await page.goto("http://127.0.0.1:8000/paperback/",wait_until="domcontentloaded",timeout=60000)
            assert await page.title()=="PaperVoice / PaperBack Lab"
            assert await page.locator("#pane-encode").is_visible()
            await page.locator("#encode-file").set_input_files(str(SOURCE))
            await page.locator("#source-card").wait_for(state="visible")
            # Camera-first setting preserves photo readability at the cost of capacity.
            assert await page.locator('input[name="profile"]:checked').get_attribute("value")=="camera"
            await page.locator("#encode-button").click()
            await page.locator("#encode-result").wait_for(state="visible",timeout=150000)
            summary=await page.locator("#encode-summary").inner_text()
            print("PaperBack generated:",summary,flush=True)
            assert "printable page" in summary
            async with page.expect_download(timeout=120000) as d:
                await page.locator("#pdf-download").click()
            download=await d.value
            await download.save_as(str(PDF))
            print("PaperBack PDF:",PDF.stat().st_size,"bytes",flush=True)
            assert PDF.stat().st_size>2000
            await page.locator("#tab-decode").click()
            assert await page.locator("#pane-decode").is_visible()
            await page.locator("#scan-files").set_input_files(str(PDF))
            await page.locator("#decode-button").click()
            await page.locator("#decode-result").wait_for(state="visible",timeout=150000)
            recovery=await page.locator("#decode-summary").inner_text()
            print("Recovered:",recovery,flush=True)
            assert "original bytes restored" in recovery
            filename=await page.locator("#recovered-download").get_attribute("download")
            assert filename==SOURCE.name,(filename,SOURCE.name)
            data=await page.evaluate("""async () => {
              const res = await fetch(document.querySelector('#recovered-download').href);
              const bytes = new Uint8Array(await res.arrayBuffer());
              const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
              return {size:bytes.length, hash:[...hash].map(n=>n.toString(16).padStart(2,'0')).join('')};
            }""")
            print("Recovered bytes:",data,flush=True)
            assert data["size"]==len(original),(data["size"],len(original))
            assert data["hash"]==hash_before,(data["hash"],hash_before)
            print("PASS: PaperBack Lab ORIGINAL MP3 recovered byte-for-byte and SHA-256 matches.",flush=True)
        except Exception:
            await page.screenshot(path=str(HERE/"paperback_failure.png"),full_page=True)
            print("Encode status:",await page.locator("#encode-status").inner_text(),flush=True)
            print("Decode status:",await page.locator("#decode-status").inner_text(),flush=True)
            print("Page URL:",page.url,flush=True)
            print("Browser errors:",errors[-25:],flush=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())
