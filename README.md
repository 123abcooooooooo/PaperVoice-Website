# PaperVoice — store sound on paper

**Private website:** https://papervoice.123abcooo.me

A browser-only application that stores audio in printable QR patterns, and recovers it when scanned. Cloudflare Workers Static Assets hosts the files. Cloudflare Access protects the site with login. No recording is sent to a server for encoding or decoding.

## Audio quality

**Exact original (PV2) — default:**
- Upload an MP3 to encode its original bytes without decoding or recompressing the MP3.
- The printed QR codes contain every byte of the MP3; SHA-256 validates exact integrity on restoration.
- After scanning **all** QRs, the original file is downloaded in its original file format/name. In the MP3 case it is **bit-for-bit identical** to the uploaded MP3.
- The same applies to M4A, WAV, or other input audio formats: exact mode restores the **same format**, not automatically a different MP3.
- **Major limitation:** MP3 files need many QR codes. PaperVoice packs 850 bytes per QR, with 12 QRs per US Letter page and one extra manifest QR. About 10 KB of audio per page. A 300 KB MP3 requires about 30 printed pages, not one QR code.
- Browser prototype limit: 480 QR codes / 40 pages, corresponding to approximately 407 KB of audio. The site estimates the pages and refuses oversized originals before encoding.

**Tiny Speech (PV1:T) — legacy, optional:**
- Codec 2 at 1300 bps compresses speech extremely heavily. The sound is robotic and far from the original; not recommended for quality.

**PV1:O Clear:** Older Ogg Opus codes are still supported for decoding, and are re-encoded to 64 kbps MP3. This does not preserve exact original bytes.

Microphone recording: the browser creates an M4A or WebM file first; exact mode preserves that newly recorded *file* without additional losses. It cannot recover an uncompressed microphone signal if the browser recorded using a lossy codec.

## Using the website

1. Sign in through Cloudflare Access at https://papervoice.123abcooo.me
2. Select **Create QR message**.
3. Upload your original audio file, or record directly with the microphone.
4. Leave **Exact original — zero additional quality loss** selected. Check the exact page-count estimate.
5. Select **Create QR codes → Download printable PDF**. All QR codes on all pages are required to recover the original.
6. In **Decode paper**, upload the original PDF or full-page photographs. Select **Decode & recover audio**.
7. Play the recovered file and select **Download exact original**. If you uploaded MP3, the downloaded MP3 is bit-identical.

## Technical format

- PV2 manifest: `PV2:M:ID:0000:COUNT:BASE45(JSON)`, where JSON contains the original file name, MIME, size and full SHA-256 digest.
- PV2 data: `PV2:F:ID:INDEX:COUNT:BASE45(DATA)`, with 4-digit sequence numbers. All codes must be present.
- QR code ECC M, max 850 original bytes each, plus ~1 manifest QR. The printable PDF includes 12 codes per Letter page for exact originals. QR code data is **not encrypted**; anyone with the physical pages can recover the file.
- QR reader detects multiple patterns in PDF and images using zbar-wasm and ZXing. SHA-256 verification ensures no partial or damaged audio is released.
- The old PV1:T / PV1:O protocols remain readable, for compatibility with earlier prints.

## Deployment and security

GitHub stores the code at https://github.com/123abcooooooooo/PaperVoice-Website and Cloudflare Workers serves `/docs` using `wrangler.jsonc`. The repository is public, so do not commit secrets, credentials, or personal audio.

GitHub Pages **must remain unpublished and disabled**. If GitHub Pages serves the same source, it creates an alternative public URL outside of Cloudflare Access.

Cloudflare Access must protect all Worker traffic, including custom production domain and previews. Always test in private browsing before sharing your address. Site access login does **not** encrypt the QR codes themselves.

Browser dependencies are fetched from CDNs. No media uploads or per-conversion server fees. Large PDFs can take substantial time/memory on iPhones; for high-quality files, a single QR **link** to a hosted original is more practical but requires internet to play and is not paper-only storage.

## Testing

GitHub Actions performs:
- JavaScript syntax checks
- Legacy paper QR PDF → Codec 2 decoder → MP3
- Tiny audio → QR PDF → restored MP3
- Exact MP3 → QR PDF → byte-for-byte identical MP3 with matching SHA-256

See `.github/workflows/test-browser.yml`. This is a personal educational prototype.
