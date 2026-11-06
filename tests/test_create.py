"""Generate an audio file, print it as PaperVoice QR codes in Chrome,
scan that generated PDF and verify the reconstructed MP3."""
import asyncio
import math
import struct
import wave
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parent
WAV=ROOT/"voice_input.wav"
PDF=ROOT/"generated_voice.pdf"

def generate_audio():
    rate=8000
    with wave.open(str(WAV),"wb") as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate)
        # 19.3 seconds gives four QR codes at 1300bps.
        frames=[]
        for index in range(int(rate*19.3)):
            t=index/rate
            value=int(11000 * math.sin(2*math.pi*(330 if t<9 else 440)*t))
            frames.append(struct.pack("<h",value))
        w.writeframes(b"".join(frames))

async def main():
    generate_audio()
    errors=[]
    async with async_playwright() as playwright:
        browser=await playwright.chromium.launch(headless=True,args=["--no-sandbox"])
        page=await browser.new_page(accept_downloads=True)
        page.on("pageerror",lambda error:errors.append("Page JS: "+str(error)))
        page.on("requestfailed",lambda request:errors.append("Asset: "+request.url+" "+str(request.failure)))
        try:
            await page.goto("http://127.0.0.1:8000/",wait_until="load",timeout=60000)
            modules=await page.evaluate("""() => ({
                qrcode:typeof window.qrcode,
                c2enc:typeof window.createC2Enc,
                jspdf:typeof window.jspdf?.jsPDF,
                c2dec:typeof window.createC2Dec
            })""")
            print("Create dependencies:",modules,flush=True)
            assert all(v=="function" for v in modules.values()),modules
            await page.locator("#tab-create").click()
            assert await page.locator("#create-panel").is_visible()
            await page.locator("#encoding-mode").select_option("tiny")
            await page.locator("#source-audio").set_input_files(str(WAV))
            await page.locator("#make-qr").click()
            await page.locator("#create-preview").wait_for(state="visible",timeout=120000)
            summary=await page.locator("#qr-summary").inner_text()
            print("QR creation:",summary,flush=True)
            assert "19.3" in summary,summary
            assert "4 QR codes" in summary,summary
            preview_result=await page.evaluate("""async ()=>{
              const canvas=document.querySelector('#qr-list canvas');
              const image=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height);
              const codes=await zbarWasm.scanImageData(image);
              return codes.map(code=>code.decode().slice(0,24));
            }""")
            print("Preview QR scan:",preview_result,flush=True)
            assert preview_result and preview_result[0].startswith("PV1:T:"), preview_result
            async with page.expect_download(timeout=120000) as download_info:
                await page.locator("#download-sheet").click()
            artifact=await download_info.value
            await artifact.save_as(str(PDF))
            print("Printable PDF:",PDF.stat().st_size,"bytes",flush=True)
            assert PDF.stat().st_size>20000
            await page.locator("#tab-decode").click()
            assert await page.locator("#decode-panel").is_visible()
            await page.locator("#picker").set_input_files(str(PDF))
            await page.locator("#decode").click()
            await page.wait_for_timeout(5000)
            current=await page.locator("#status").inner_text()
            if "No PaperVoice QR codes" in current or "Missing QR" in current:
                raise RuntimeError("Generated PDF did not decode: "+current)
            await page.locator("#output").wait_for(state="visible",timeout=25000)
            restored=await page.locator("#info").inner_text()
            print("Recovered recording:",restored,flush=True)
            assert "4 QR codes" in restored and "19.3 seconds" in restored,restored
            result=await page.evaluate("""async ()=>{
              const res=await fetch(document.querySelector('#audio').src);
              const bytes=new Uint8Array(await res.arrayBuffer());
              return {len:bytes.length,head:[...bytes.slice(0,3)]};
            }""")
            print("Recovered MP3:",result,flush=True)
            assert result["len"] > 10000
            assert result["head"][0]==255 or result["head"]==[73,68,51]
            print("PASS: WAV -> Codec2 -> printable QR PDF -> scan -> playable MP3",flush=True)
        except Exception:
            await page.screenshot(path=str(ROOT/"create_browser_failure.png"),full_page=True)
            print("Create state:",await page.locator("#create-status").inner_text(),flush=True)
            print("Decode state:",await page.locator("#status").inner_text(),flush=True)
            print("Errors:",errors[-25:],flush=True)
            raise
        finally:
            await browser.close()

if __name__=="__main__":
    asyncio.run(main())
