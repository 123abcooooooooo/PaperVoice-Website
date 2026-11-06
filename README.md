# PaperVoice — voice messages printed on paper

The static website is at https://123abcooooooooo.github.io/PaperVoice-Website/ (after GitHub Pages is enabled).

The website reads PaperVoice v1 QR-code photos/PDFs and reconstructs the recording into a downloadable MP3 entirely inside the browser. There is no server, user account, audio upload, or usage-based hosting bill.

## Publish for free — one-time setup

1. Go to https://github.com/123abcooooooooo/PaperVoice-Website/settings/pages
2. Under Build and deployment, choose "Deploy from a branch."
3. Select branch "main" and folder "/docs", and press Save.
4. After the Pages deployment succeeds, open https://123abcooooooooo.github.io/PaperVoice-Website/

The original FastAPI and Docker files are legacy: GitHub Pages only serves the static website inside the docs folder.

## Usage

1. Open the published site on your iPhone or computer.
2. Upload the original printable PDF, a photo of the page, or photos of each QR code from one voice message.
3. Press "Decode & make MP3".
4. Listen and download.

## Formats

PaperVoice v1 QR data starts with PV1: and stores Base45 data across numbered QR codes. After collecting and verifying the full set using SHA-256:
- Tiny mode (T) decodes Codec 2 at 1300 bps via a browser WebAssembly decoder, with the FFmpeg .c2 seven-byte container header removed.
- Clear mode (O) decodes Ogg/Opus using Web Audio in compatible browsers.
- Both modes export mono 24 kHz MP3 at 64 kbps with a browser-side JavaScript encoder.

The interface reports missing QR numbers, damaged scans, checksums, and mixed recordings.

## Privacy and limitations

No user media leaves the browser. The application downloads its JavaScript/WASM code from CDNs; these libraries do not receive the QR data or recording. Internet access is needed initially to load the website and libraries. The QR codes are not encrypted, so anyone with all the codes can restore the sound.

Up to 24 images/PDF files, 25 MB each, and 12 pages per PDF. Blurry scans may require closer photos. Older browsers may not decode Ogg/Opus.

GitHub Pages is free for this public repository within GitHub's published usage and acceptable-use policies. No per-conversion cloud compute fees.

Libraries used (downloaded from public CDNs):
- ZXing-JS 0.21.3 (Apache-2.0): https://github.com/zxing-js/library
- PDF.js 3.11.174 (Apache-2.0): https://github.com/mozilla/pdf.js
- lamejs 1.2.1 (LGPL-3.0): https://github.com/zhuker/lamejs
- Codec 2 Emscripten decoder (LGPL-2.1): https://github.com/rameshvarun/codec2-emscripten

## Optional Namecheap domain

After you have verified the GitHub Pages URL, you can use papervoice.123abcooo.me. Add that name in GitHub's Settings → Pages → Custom domain and configure a Namecheap CNAME with Host "papervoice" and Value "123abcooooooooo.github.io". Then verify DNS and enable Enforce HTTPS.

This is an educational/personal prototype.
