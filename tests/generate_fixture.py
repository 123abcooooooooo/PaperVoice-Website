"""Generate a realistic four-QR PaperVoice v1 sample PDF for browser CI."""
import hashlib
import math
import subprocess
import sys
from pathlib import Path

import qrcode
from reportlab.pdfgen import canvas

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"

def b45(data):
    out = []
    for i in range(0, len(data), 2):
        if i+1 < len(data):
            v = 256*data[i]+data[i+1]
            out.extend((ALPHABET[v%45], ALPHABET[(v//45)%45], ALPHABET[v//2025]))
        else:
            v = data[i]
            out.extend((ALPHABET[v%45], ALPHABET[v//45]))
    return "".join(out)

def main():
    output = Path(sys.argv[1])
    tone = output.with_suffix(".c2")
    subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y",
        "-f","lavfi","-i","sine=frequency=440:sample_rate=8000:duration=19.3",
        "-c:a","libcodec2","-mode","1300","-f","codec2",str(tone)],check=True)
    data=tone.read_bytes()
    checksum=hashlib.sha256(data).hexdigest().upper()[:12]
    pieces=[data[i:i+850] for i in range(0,len(data),850)]
    assert len(pieces)==4, (len(pieces),len(data))
    pdf=canvas.Canvas(str(output),pagesize=(612,792))
    for idx,part in enumerate(pieces):
        message=f"PV1:T:{checksum}:{idx+1:03d}:{len(pieces):03d}:{b45(part)}"
        qr=qrcode.QRCode(version=None,error_correction=qrcode.constants.ERROR_CORRECT_M,box_size=4,border=4)
        qr.add_data(message,optimize=0); qr.make(fit=True)
        assert qr.version<=25,qr.version
        matrix=qr.get_matrix()
        width=210
        scale=width/len(matrix)
        x=(72,330)[idx%2]
        y=(714,482)[idx//2]-width
        for row,values in enumerate(matrix):
            start=None
            for col,black in enumerate([*values,False]):
                if black and start is None:start=col
                if not black and start is not None:
                    pdf.rect(x+start*scale,y+(len(matrix)-1-row)*scale,(col-start)*scale+0.005,scale+0.005,stroke=0,fill=1)
                    start=None
    pdf.save()
    print("Fixture:",output,"bytes",len(data),"codes",len(pieces),"sha",checksum)

if __name__=="__main__":main()
