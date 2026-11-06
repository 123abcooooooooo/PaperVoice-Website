"""PaperVoice v1 QR/PDF decoder — recovers audio and downloads MP3."""
from __future__ import annotations

import asyncio
import hashlib
import io
import re
import subprocess
import tempfile
from pathlib import Path

import fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from pyzbar.pyzbar import ZBarSymbol, decode as scan_qr

ROOT = Path(__file__).resolve().parent
MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES = 30, 18 * 1024 * 1024, 90 * 1024 * 1024
MAX_PDF_PAGES, MAX_AUDIO_BYTES = 12, 2 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 38_000_000

B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
B45_MAP = {ch: index for index, ch in enumerate(B45)}
PATTERN = re.compile(r"^PV1:([TO]):([0-9A-F]{12}):([0-9]{3}):([0-9]{3}):(.*)$", re.DOTALL)

app = FastAPI(title="PaperVoice — Paper to MP3", docs_url=None, redoc_url=None)

@app.get("/", include_in_schema=False)
def home():
    return FileResponse(ROOT / "static/index.html", media_type="text/html")

@app.get("/health")
def health():
    return {"ok": True}

app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

def base45_decode(data: str) -> bytes:
    """Decode Base45 QR alphanumeric payload into exact bytes."""
    if len(data) % 3 == 1:
        raise ValueError("Invalid Base45 length")
    out = bytearray()
    i = 0
    while i < len(data):
        if i + 2 < len(data):
            value = B45_MAP[data[i]] + 45 * B45_MAP[data[i+1]] + 2025 * B45_MAP[data[i+2]]
            if value > 65535:
                raise ValueError("Invalid Base45 triple")
            out.extend((value // 256, value % 256))
            i += 3
        else:
            value = B45_MAP[data[i]] + 45 * B45_MAP[data[i+1]]
            if value > 255:
                raise ValueError("Invalid Base45 pair")
            out.append(value)
            i += 2
    return bytes(out)

def find_qrs(image: Image.Image) -> list[str]:
    image = ImageOps.exif_transpose(image).convert("RGB")
    found: list[str] = []
    for attempt in (image, ImageOps.autocontrast(ImageOps.grayscale(image))):
        for code in scan_qr(attempt, symbols=[ZBarSymbol.QRCODE]):
            try:
                value = code.data.decode("ascii")
            except UnicodeDecodeError:
                continue
            if value.startswith("PV1:") and value not in found:
                found.append(value)
    return found

def scan_file(name: str, payload: bytes) -> list[str]:
    if name.lower().endswith(".pdf") or payload.startswith(b"%PDF-"):
        try:
            with fitz.open(stream=payload, filetype="pdf") as pdf:
                if len(pdf) > MAX_PDF_PAGES:
                    raise ValueError(f"PDFs may contain at most {MAX_PDF_PAGES} pages.")
                results: list[str] = []
                for page in pdf:
                    if page.rect.width * page.rect.height > 2_000_000:
                        raise ValueError("A PDF page is too large to scan.")
                    picture = page.get_pixmap(matrix=fitz.Matrix(3.3, 3.3), alpha=False)
                    im = Image.frombytes("RGB", (picture.width, picture.height), picture.samples)
                    for code in find_qrs(im):
                        if code not in results:
                            results.append(code)
                return results
        except (fitz.FileDataError, fitz.EmptyFileError) as exc:
            raise ValueError("That PDF could not be opened.") from exc
    try:
        with Image.open(io.BytesIO(payload)) as im:
            return find_qrs(im)
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError("Use an image (JPG/PNG/WebP) or PDF.") from exc

def assemble(codes: list[str]):
    if not codes:
        raise ValueError("No PaperVoice codes found. Try a clear close-up of each QR code.")
    pieces: dict[int, bytes] = {}
    recording = None
    kind = None
    expected = None
    for raw in codes:
        match = PATTERN.fullmatch(raw)
        if not match:
            continue
        k, token, number_s, total_s, encoded = match.groups()
        number, total = int(number_s), int(total_s)
        if total < 1 or number < 1 or number > total:
            raise ValueError("A QR code has an invalid sequence number.")
        if recording is None:
            recording, kind, expected = token, k, total
        if (token, k, total) != (recording, kind, expected):
            raise ValueError("The images contain QR codes from different messages. Upload one recording at a time.")
        try:
            data = base45_decode(encoded)
        except (KeyError, ValueError) as exc:
            raise ValueError(f"QR code {number} was damaged. Scan it again.") from exc
        if number in pieces and pieces[number] != data:
            raise ValueError(f"Conflicting data in QR code {number}.")
        pieces[number] = data
    if recording is None:
        raise ValueError("No valid PaperVoice v1 codes were found.")
    missing = [i for i in range(1, expected+1) if i not in pieces]
    if missing:
        raise ValueError("Missing QR code(s): " + ", ".join(map(str, missing)) +
                         f". Found {len(pieces)} of {expected}; add photos of the missing codes.")
    compressed = b"".join(pieces[i] for i in range(1, expected+1))
    if len(compressed) > MAX_AUDIO_BYTES:
        raise ValueError("This recording is too large.")
    if hashlib.sha256(compressed).hexdigest()[:12].upper() != recording:
        raise ValueError("Audio checksum did not match; please rescan the QR codes.")
    return recording, kind, compressed, expected

def convert_mp3(kind: str, compressed: bytes) -> bytes:
    with tempfile.TemporaryDirectory(prefix="papervoice-") as location:
        folder = Path(location)
        source = folder / ("recording.c2" if kind == "T" else "recording.ogg")
        mp3 = folder / "recording.mp3"
        source.write_bytes(compressed)
        try:
            completed = subprocess.run(
                ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(source), "-vn", "-ac", "1", "-ar", "24000",
                 "-codec:a", "libmp3lame", "-b:a", "64k", str(mp3)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=50, check=False
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            raise ValueError("Audio conversion failed or timed out.") from exc
        if completed.returncode != 0 or not mp3.exists() or mp3.stat().st_size < 128:
            raise ValueError("Audio was recovered, but FFmpeg could not decode it.")
        return mp3.read_bytes()

def process(inputs: list[tuple[str, bytes]]):
    codes = []
    for name, data in inputs:
        try:
            codes.extend(scan_file(name, data))
        except ValueError as exc:
            raise ValueError(f"{name}: {exc}") from exc
    recording, kind, compressed, count = assemble(codes)
    return recording, kind, count, convert_mp3(kind, compressed)

@app.post("/api/decode")
async def decode(files: list[UploadFile] = File(...)):
    if not 1 <= len(files) <= MAX_FILES:
        raise HTTPException(status_code=413, detail=f"Upload 1 to {MAX_FILES} files.")
    total = 0
    inputs = []
    for item in files:
        data = await item.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail=f"{item.filename}: maximum size is 18 MB.")
        total += len(data)
        if total > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=413, detail="Maximum total size is 90 MB.")
        inputs.append((Path(item.filename or "scan").name, data))
        await item.close()
    try:
        recording, kind, count, mp3 = await asyncio.to_thread(process, inputs)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(mp3, media_type="audio/mpeg", headers={
        "Content-Disposition": f'attachment; filename="PaperVoice_{recording}.mp3"',
        "X-PaperVoice-ID": recording,
        "X-PaperVoice-Codes": str(count),
        "X-PaperVoice-Mode": "tiny" if kind == "T" else "clear",
        "Cache-Control": "no-store",
    })
