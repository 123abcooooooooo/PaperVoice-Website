# PaperVoice Website

Decode printed PaperVoice v1 QR images and PDF pages directly into an MP3 recording.

This app is built with FastAPI, ZBar, PyMuPDF and FFmpeg. It accepts PaperVoice `PV1:T` (Codec2) and `PV1:O` (Ogg/Opus) QR payloads. The QR codes contain the audio data, not a URL.

## Running locally

Install Docker, then run:

```bash
docker build -t papervoice .
docker run -p 8000:10000 papervoice
```

Visit http://localhost:8000. For deployment, use the included `Dockerfile` with a Render Docker Web Service. See `render.yaml` for the free-tier Blueprint configuration.

## Use

Upload all QR code photos from one recording (or the PDF containing them), press **Decode & Download**, listen, and save an MP3. A missing QR image is reported with its sequence number.

The upload is processed temporarily on the server; it is not purposely retained by the application. QR data is not encrypted. Only use scans you are comfortable sending to your own hosting provider.
