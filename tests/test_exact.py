"""Verify bit-perfect MP3 -> QR PDF -> decoded MP3 without transcoding."""
import asyncio, hashlib, math, subprocess
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).parent
MP3=HERE/"exact_source_48kbps.mp3"
SHEET=HERE/"exact_printable.pdf"

async def main():
    # A short MP3 is large enough to span multiple pages of exact-original QRs.
    subprocess.run(["ffmpeg","-nostdin","-loglevel","error","-f","lavfi",
        "-i","sine=frequency=520:sample_rate=44100:duration=3.5","-ac","1",
        "-c:a","libmp3lame","-b:a","48k","-y",str(MP3)],check=True)
    original=MP3.read_bytes()
    original_hash=hashlib.sha256(original).hexdigest()
    errors=[]
    async with async_playwright() as tool:
        browser=await tool.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page(accept_downloads=True)
        page.on("pageerror",lambda e:errors.append("JS "+str(e)))
        page.on("requestfailed",lambda r:errors.append("ASSET "+r.url+" "+str(r.failure)))
        try:
            await page.goto("http://127.0.0.1:8000/classic/",wait_until="load",timeout=60000)
            await page.locator("#tab-create").click()
            assert await page.locator("#encoding-mode").input_value()=="exact"
            await page.locator("#source-audio").set_input_files(str(MP3))
            estimate=await page.locator("#exact-estimate").inner_text()
            print("Original input:",len(original),"bytes",original_hash,flush=True)
            print("Preflight estimate:",estimate,flush=True)
            assert "Bit-perfect" in estimate
            await page.locator("#make-qr").click()
            await page.locator("#create-preview").wait_for(state="visible",timeout=120000)
            summary=await page.locator("#qr-summary").inner_text()
            print("Creation:",summary,flush=True)
            assert "BIT-PERFECT" in summary
            assert "printed page" in summary
            async with page.expect_download(timeout=120000) as download_info:
                await page.locator("#download-sheet").click()
            await (await download_info.value).save_as(str(SHEET))
            print("PDF file size",SHEET.stat().st_size,flush=True)
            await page.locator("#tab-decode").click()
            await page.locator("#picker").set_input_files(str(SHEET))
            await page.locator("#decode").click()
            # Fail early if the decoder reports an incomplete sheet.
            await page.locator("#output").wait_for(state="visible",timeout=110000)
            rendered=await page.locator("#info").inner_text()
            print("Recovered:",rendered,flush=True)
            assert "EXACT original" in rendered
            filename=await page.locator("#download").get_attribute("download")
            assert filename==MP3.name,(filename,MP3.name)
            restored=await page.evaluate("""async() => {
              const response=await fetch(document.querySelector('#audio').src);
              const bytes=new Uint8Array(await response.arrayBuffer());
              const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
              return {size:bytes.length,sha:[...digest].map(n=>n.toString(16).padStart(2,'0')).join('')};
            }""")
            print("Recovered file:",restored,flush=True)
            assert restored["size"]==len(original)
            assert restored["sha"]==original_hash
            print("PASS: original MP3 bytes match SHA256 exactly after PDF scanning.",flush=True)
        except Exception:
            await page.screenshot(path=str(HERE/"exact_browser_failure.png"),full_page=True)
            print("Create status:",await page.locator("#create-status").inner_text(),flush=True)
            print("Decode status:",await page.locator("#status").inner_text(),flush=True)
            print("Progress:",await page.locator("#progress").inner_text(),flush=True)
            print("Errors:",errors[-20:],flush=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())
