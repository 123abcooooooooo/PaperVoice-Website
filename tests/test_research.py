"""SHEET/7 browser test: 60-second MP3, adaptive-density paper archive,
PDF self-verification and original file recovery with SHA-256 identity."""
import asyncio
import hashlib
import os
import re
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright

HERE=Path(__file__).parent
AUDIO=HERE/"research_60s_128k.mp3"
PDF=HERE/"research_60s_archive.pdf"

async def main():
    seconds=float(os.getenv("RESEARCH_SECONDS","60"))
    bitrate=os.getenv("RESEARCH_BITRATE","128k")
    printer=os.getenv("RESEARCH_PRINTER","600")
    subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
        "-f","lavfi","-i",f"anoisesrc=color=pink:sample_rate=44100:duration={seconds}",
        "-ac","1","-c:a","libmp3lame","-b:a",bitrate,str(AUDIO)],check=True)
    raw=AUDIO.read_bytes();initial_hash=hashlib.sha256(raw).hexdigest()
    print("Original:",len(raw),"bytes, duration",seconds,"bitrate",bitrate,"sha",initial_hash,flush=True)
    events=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page(accept_downloads=True)
        page.on("pageerror",lambda err:events.append("JS ERROR: "+str(err)))
        page.on("requestfailed",lambda r:events.append("FAILED: "+r.url+" "+str(r.failure)))
        try:
            await page.goto("http://127.0.0.1:8000/research/",wait_until="load",timeout=60000)
            assert await page.title()=="SHEET/7 | PaperVoice Optical Research"
            await page.locator("#source-file").set_input_files(str(AUDIO))
            await page.locator("#printer").select_option(printer)
            await page.locator("#target").select_option("7")
            await page.locator("#run").click()
            await page.locator("#created").wait_for(state="visible",timeout=180000)
            pages=int(await page.locator("#page-number").inner_text())
            density=await page.locator("#dot-number").inner_text()
            reason=await page.locator("#result-head").inner_text()
            print("Experiment:",reason,pages,"pages at",density,flush=True)
            assert pages<=15,(pages,density)
            assert await page.locator("#hash-label").inner_text()=="MATCH ✓"
            print("Trial log:",repr(await page.locator("#trial-list").inner_text()),flush=True)
            async with page.expect_download() as capture:
                await page.locator("#pdf-link").click()
            await (await capture.value).save_as(str(PDF))
            print("Generated PDF:",PDF.stat().st_size,"bytes",flush=True)
            assert PDF.stat().st_size>5000
            await page.locator("#tab-restore").click()
            await page.locator("#scans").set_input_files(str(PDF))
            await page.locator("#restore").click()
            await page.locator("#restored").wait_for(state="visible",timeout=180000)
            recovered=await page.evaluate("""async() => {
              const url=document.querySelector('#restored-link').href;
              const buffer=new Uint8Array(await (await fetch(url)).arrayBuffer());
              const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',buffer));
              return {length:buffer.length,sha:Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')};
            }""")
            print("Restored:",recovered,flush=True)
            assert recovered["length"]==len(raw)
            assert recovered["sha"]==initial_hash
            assert "MATCHES ORIGINAL" in await page.locator("#restored-sha").inner_text()
            print("PASS: 60-second MP3 -> adaptive PDF -> SHA-matched original.",flush=True)
            return pages,density
        except Exception:
            print("Create status:",await page.locator("#create-status").inner_text(),flush=True)
            print("Recovery status:",await page.locator("#restore-status").inner_text(),flush=True)
            print("Trials:",await page.locator("#trial-list").inner_text(),flush=True)
            print("Browser errors:",events[-15:],flush=True)
            await page.screenshot(path=str(HERE/"research_failure.png"),full_page=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())
