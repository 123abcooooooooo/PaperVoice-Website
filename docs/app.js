"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const picker = $("picker"), drop = $("drop"), list = $("files"), decodeButton = $("decode");
  const clearButton = $("clear"), status = $("status"), output = $("output"), audio = $("audio");
  const download = $("download"), info = $("info"), progress = $("progress");
  const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  const B45_INDEX = Object.fromEntries([...B45].map((ch, i) => [ch, i]));
  const QR_PATTERN = /^PV1:([TO]):([0-9A-F]{12}):([0-9]{3}):([0-9]{3}):([0-9A-Z $%*+\-./:]*)$/;
  let files = [];
  let resultURL = null;
  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.className = error ? "status error" : "status";
  };
  const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));

  const formatSize = bytes => bytes < 1048576
    ? Math.ceil(bytes / 1024) + " KB" : (bytes / 1048576).toFixed(1) + " MB";

  function refreshFiles() {
    list.replaceChildren();
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const row = document.createElement("div");
      row.className = "file";
      const title = document.createElement("span");
      title.className = "filename";
      title.textContent = file.name;
      const size = document.createElement("small");
      size.textContent = formatSize(file.size);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.addEventListener("click", () => {
        files.splice(i, 1);
        resetOutput();
        refreshFiles();
      });
      row.append(title, size, remove);
      list.appendChild(row);
    }
    decodeButton.disabled = files.length === 0;
    clearButton.hidden = files.length === 0;
  }

  function resetOutput() {
    if (resultURL) URL.revokeObjectURL(resultURL);
    resultURL = null;
    audio.removeAttribute("src");
    audio.load();
    download.removeAttribute("href");
    output.hidden = true;
    setStatus("");
    progress.textContent = "";
  }

  function addFiles(incoming) {
    let rejected = 0;
    for (const file of incoming) {
      if (!/\.(png|jpe?g|webp|pdf)$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
        rejected++;
        continue;
      }
      if (files.length >= 24) { rejected++; continue; }
      if (!files.some(f => f.name === file.name && f.size === file.size &&
                            f.lastModified === file.lastModified)) files.push(file);
    }
    resetOutput();
    refreshFiles();
    if (rejected) setStatus("Some files were skipped. Use JPG, PNG, WebP or PDF (up to 25 MB each, 24 files total).", true);
  }

  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", () => {
    addFiles(Array.from(picker.files || []));
    picker.value = "";
  });
  for (const name of ["dragenter", "dragover"])
    drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add("dragging"); });
  for (const name of ["dragleave", "drop"])
    drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove("dragging"); });
  drop.addEventListener("drop", event => addFiles(Array.from(event.dataTransfer.files || [])));
  clearButton.addEventListener("click", () => { files = []; resetOutput(); refreshFiles(); });

  function b45decode(input) {
    if (input.length % 3 === 1) throw new Error("A QR code contains damaged Base45 data.");
    const decoded = new Uint8Array(Math.ceil(input.length * 2 / 3));
    let dest = 0;
    for (let i = 0; i < input.length;) {
      let value;
      if (i + 2 < input.length) {
        value = B45_INDEX[input[i]] + 45 * B45_INDEX[input[i+1]] + 2025 * B45_INDEX[input[i+2]];
        if (!Number.isInteger(value) || value > 65535) throw new Error("Corrupt QR payload.");
        decoded[dest++] = value >> 8;
        decoded[dest++] = value & 255;
        i += 3;
      } else {
        value = B45_INDEX[input[i]] + 45 * B45_INDEX[input[i+1]];
        if (!Number.isInteger(value) || value > 255) throw new Error("Corrupt QR payload.");
        decoded[dest++] = value;
        i += 2;
      }
    }
    return decoded.slice(0, dest);
  }

  async function rebuild(codes) {
    const parts = new Map();
    let group = null, kind = null, count = null;
    for (const code of codes) {
      const parsed = QR_PATTERN.exec(code);
      if (!parsed) continue;
      const [, mode, id, indexText, totalText, payload] = parsed;
      const index = Number(indexText), total = Number(totalText);
      if (!total || index < 1 || index > total) throw new Error("Invalid QR sequence number.");
      if (!group) { group = id; kind = mode; count = total; }
      if (id !== group || kind !== mode || count !== total)
        throw new Error("These codes belong to different recordings. Upload only one recording.");
      const bytes = b45decode(payload);
      if (parts.has(index)) {
        const prior = parts.get(index);
        if (prior.length !== bytes.length || prior.some((v,i) => v !== bytes[i]))
          throw new Error("QR " + index + " has conflicting copies.");
      } else parts.set(index, bytes);
    }
    if (!group) throw new Error("No PaperVoice QR codes found. Try sharper photos or the original PDF.");
    const missing = [];
    for (let i = 1; i <= count; i++) if (!parts.has(i)) missing.push(i);
    if (missing.length) throw new Error("Found " + parts.size + "/" + count +
      " codes. Missing QR number(s): " + missing.join(", ") + ".");
    const size = Array.from(parts.values()).reduce((n, a) => n + a.length, 0);
    if (size > 3 * 1024 * 1024) throw new Error("Audio payload too large for this browser.");
    const bytes = new Uint8Array(size);
    let position = 0;
    for (let i = 1; i <= count; i++) {
      const chunk = parts.get(i);
      bytes.set(chunk, position);
      position += chunk.length;
    }
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    const actual = Array.from(new Uint8Array(hash).slice(0,6), b => b.toString(16).padStart(2,"0")).join("").toUpperCase();
    if (actual !== group) throw new Error("Audio checksum failed. Please rescan the blurry QR code.");
    return { kind, id: group, count, bytes };
  }

  // ZXing reads one QR at a time. For full-page PDFs we crop into overlapping
  // cells so all 2x3 codes can be decoded without a server or camera permissions.
  function tryZxing(canvas) {
    if (!window.ZXing) return null;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const source = new ZXing.RGBLuminanceSource(image.data, canvas.width, canvas.height);
    const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
    const hints = new Map();
    hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
    try {
      return new ZXing.QRCodeReader().decode(bitmap, hints).getText();
    } catch (_) {
      return null;
    }
  }

  function crop(source, x, y, w, h) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(source.width * w);
    c.height = Math.ceil(source.height * h);
    c.getContext("2d", { willReadFrequently: true }).drawImage(
      source, Math.floor(source.width * x), Math.floor(source.height * y),
      Math.ceil(source.width * w), Math.ceil(source.height * h),
      0, 0, c.width, c.height
    );
    return c;
  }

  async function readCanvas(canvas) {
    const seen = new Set();
    if ("BarcodeDetector" in window) {
      try {
        const detector = new BarcodeDetector({formats: ["qr_code"]});
        for (const result of await detector.detect(canvas))
          if (result.rawValue?.startsWith("PV1:")) seen.add(result.rawValue);
      } catch (_) { /* fallback below */ }
    }
    const full = tryZxing(canvas);
    if (full?.startsWith("PV1:")) seen.add(full);
    // Overlapping regions support the original PaperVoice 2-column / 3-row page.
    const columns = [[0, .54], [.46, .54]];
    const rows = [[0, .40], [.28, .44], [.60, .40]];
    for (const [y, h] of rows) for (const [x, w] of columns) {
      const code = tryZxing(crop(canvas, x, y, w, h));
      if (code?.startsWith("PV1:")) seen.add(code);
    }
    return [...seen];
  }

  async function imageCanvas(file) {
    const blobURL = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = blobURL;
      await img.decode();
      const scale = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally { URL.revokeObjectURL(blobURL); }
  }

  async function scanFile(file) {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      if (!window.pdfjsLib) throw new Error("The PDF reader failed to load; check your internet connection.");
      const documentTask = pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer())});
      const pdf = await documentTask.promise;
      if (pdf.numPages > 12) throw new Error("PDF too long: 12 pages maximum.");
      let found = [];
      try {
        for (let i = 1; i <= pdf.numPages; i++) {
          progress.textContent = "Scanning PDF page " + i + " of " + pdf.numPages + "…";
          await yieldUI();
          const page = await pdf.getPage(i);
          const dimensions = page.getViewport({ scale: 1 });
          const scale = Math.min(2.9, 2400 / Math.max(dimensions.width, dimensions.height));
          const viewport = page.getViewport({scale});
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({canvasContext: canvas.getContext("2d"), viewport}).promise;
          found.push(...await readCanvas(canvas));
          canvas.width = canvas.height = 0;
          page.cleanup();
        }
      } finally { await pdf.destroy(); }
      return found;
    }
    const canvas = await imageCanvas(file);
    try { return await readCanvas(canvas); }
    finally { canvas.width = canvas.height = 0; }
  }

  function rawPcmToFloat(bytes) {
    const frames = Math.floor(bytes.length / 2);
    if (!frames) throw new Error("The speech decoder returned no audio.");
    const output = new Float32Array(frames);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i=0; i<frames; i++) output[i] = view.getInt16(i*2, true) / 32768;
    return output;
  }

  async function decodeTiny(bytes) {
    if (typeof window.createC2Dec !== "function")
      throw new Error("Codec 2 decoder did not load. Check your internet connection.");
    if (bytes.length < 8 || bytes[0] !== 0xc0 || bytes[1] !== 0xde || bytes[2] !== 0xc2)
      throw new Error("Invalid Tiny Codec 2 header.");
    // FFmpeg .c2 file header: magic C0 DE C2 and 4 metadata bytes.
    const data = bytes.slice(7);
    if (!data.length || data.length % 7 !== 0)
      throw new Error("The Codec 2 data is incomplete or has an unfamiliar frame size.");
    const raw = await new Promise((resolve, reject) => {
      let produced = false;
      const module = {
        arguments: ["1300", "input.bit", "output.raw"],
        locateFile: name => "https://cdn.jsdelivr.net/gh/rameshvarun/codec2-emscripten@main/build/" + name,
        preRun: () => module.FS.writeFile("input.bit", data),
        postRun: () => {
          try { produced = true; resolve(module.FS.readFile("output.raw").slice()); }
          catch (error) { reject(error); }
        },
        printErr: message => console.warn("Codec2:", message)
      };
      try {
        Promise.resolve(window.createC2Dec(module)).then(() => {
          if (!produced) reject(new Error("The Codec 2 decoder produced no audio."));
        }).catch(reject);
      } catch (error) { reject(error); }
    });
    return {samples: rawPcmToFloat(raw), rate: 8000};
  }

  async function decodeClear(bytes) {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    try {
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = await context.decodeAudioData(copy);
      const samples = new Float32Array(decoded.length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
        const part = decoded.getChannelData(channel);
        for (let i = 0; i < decoded.length; i++) samples[i] += part[i] / decoded.numberOfChannels;
      }
      return { samples, rate: decoded.sampleRate };
    } catch (_) {
      throw new Error("This browser cannot decode the Clear (Ogg/Opus) file. Try current Safari, Chrome or Firefox.");
    } finally { await context.close(); }
  }

  function resample(samples, inRate, outRate = 24000) {
    if (inRate === outRate) return samples;
    const length = Math.max(1, Math.round(samples.length * outRate / inRate));
    const next = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const pos = i * inRate / outRate;
      const left = Math.min(samples.length - 1, Math.floor(pos));
      const right = Math.min(samples.length - 1, left + 1);
      const factor = pos - left;
      next[i] = samples[left] * (1-factor) + samples[right] * factor;
    }
    return next;
  }

  async function encodeMp3(input) {
    if (!window.lamejs) throw new Error("MP3 encoder did not load. Check your internet connection.");
    const samples = resample(input.samples, input.rate);
    if (samples.length > 24000 * 360) throw new Error("Audio is too long for in-browser encoding.");
    const encoder = new lamejs.Mp3Encoder(1, 24000, 64);
    const pieces = [];
    for (let start = 0; start < samples.length; start += 1152) {
      const end = Math.min(samples.length, start + 1152);
      const pcm = new Int16Array(end - start);
      for (let j = start; j < end; j++) {
        const v = Math.max(-1, Math.min(1, samples[j]));
        pcm[j-start] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767);
      }
      const chunk = encoder.encodeBuffer(pcm);
      if (chunk.length) pieces.push(new Uint8Array(chunk));
      if (start % (1152*120) === 0) {
        progress.textContent = "Encoding MP3: " + Math.round(start*100/samples.length) + "%";
        await yieldUI();
      }
    }
    const tail = encoder.flush();
    if (tail.length) pieces.push(new Uint8Array(tail));
    const size = pieces.reduce((total, p) => total+p.length, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const p of pieces) { bytes.set(p, offset); offset += p.length; }
    if (size < 100) throw new Error("The MP3 encoder did not produce a valid file.");
    return new Blob([bytes], {type: "audio/mpeg"});
  }

  decodeButton.addEventListener("click", async () => {
    if (!files.length) return;
    resetOutput();
    decodeButton.disabled = true;
    decodeButton.textContent = "Converting…";
    try {
      if (!window.ZXing) throw new Error("The QR scanning library did not load. Check your connection.");
      if (!crypto?.subtle) throw new Error("Open this page over HTTPS so checksum verification works.");
      let codes = [];
      for (let i = 0; i < files.length; i++) {
        progress.textContent = "Reading file " + (i+1) + "/" + files.length + ": " + files[i].name;
        await yieldUI();
        try { codes.push(...await scanFile(files[i])); }
        catch (error) { throw new Error(files[i].name + ": " + error.message); }
      }
      const message = await rebuild([...new Set(codes)]);
      progress.textContent = "Audio recovered from " + message.count + " QR codes. Decoding speech…";
      await yieldUI();
      const pcm = message.kind === "T" ? await decodeTiny(message.bytes) : await decodeClear(message.bytes);
      progress.textContent = "Making MP3…";
      await yieldUI();
      const mp3 = await encodeMp3(pcm);
      resultURL = URL.createObjectURL(mp3);
      audio.src = resultURL;
      download.href = resultURL;
      download.download = "PaperVoice_" + message.id + ".mp3";
      info.textContent = message.count + " QR codes • " + (pcm.samples.length / pcm.rate).toFixed(1) +
        " seconds • " + formatSize(mp3.size);
      output.hidden = false;
      setStatus("Success — your recording was reconstructed locally on this device.");
      progress.textContent = "";
    } catch (error) {
      console.error(error);
      setStatus(error?.message || "Something went wrong decoding the message.", true);
      progress.textContent = "";
    } finally {
      decodeButton.disabled = !files.length;
      decodeButton.textContent = "Decode & make MP3";
    }
  });
  refreshFiles();
})();