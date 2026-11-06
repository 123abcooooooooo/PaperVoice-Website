"""End-to-end PaperVoice PDF -> QR -> Codec2 -> MP3 test in Chromium."""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

HERE=Path(__file__).parent
PDF=HERE/"test_sheet.pdf"

async def run():
    logs=[]
    async with async_playwright() as browser_tools:
        browser=await browser_tools.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page(accept_downloads=True)
        page.on("pageerror", lambda err: logs.append("JS error: "+str(err)))
        page.on("console", lambda msg: logs.append("console "+msg.type+": "+msg.text) if msg.type=="error" else None)
        page.on("requestfailed",lambda request:logs.append("request failed: "+request.url+" "+str(request.failure)))
        try:
            await page.goto("http://127.0.0.1:8000/",wait_until="load",timeout=60000)
            libraries=await page.evaluate("""() => ({
              zbar:!!window.zbarWasm?.scanImageData,
              zxing:!!window.ZXing,
              pdfjs:!!window.pdfjsLib,
              lame:!!window.lamejs,
              codec:!!window.createC2Dec
            })""")
            print("Libraries:",libraries,flush=True)
            if not libraries["zbar"] or not libraries["pdfjs"] or not libraries["lame"] or not libraries["codec"]:
                raise RuntimeError("Required browser libraries missing: "+str(libraries))
            await page.locator("#picker").set_input_files(str(PDF))
            await page.locator("#decode").click()
            await page.locator("#output").wait_for(state="visible",timeout=120000)
            text=await page.locator("#info").inner_text()
            print("Output:",text,flush=True)
            assert "4 QR codes" in text, text
            src=await page.locator("#audio").get_attribute("src")
            assert src and src.startswith("blob:"),src
            data=await page.evaluate("""async () => {
              const response = await fetch(document.querySelector('#audio').src);
              const buffer = new Uint8Array(await response.arrayBuffer());
              return {size:buffer.length,first:Array.from(buffer.slice(0,4))};
            }""")
            print("MP3:",data,flush=True)
            assert data["size"]>1000,data
            assert data["first"][0]==255 or data["first"][:3]==[73,68,51],data
            print("PASS: PDF -> four QRs -> Codec2 -> MP3",flush=True)
        except Exception:
            await page.screenshot(path=str(HERE/"browser_failure.png"),full_page=True)
            print("Page status:",await page.locator("#status").inner_text(),flush=True)
            print("Browser logs:",logs[-30:],flush=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(run())
