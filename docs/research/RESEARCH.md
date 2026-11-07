# SHEET/7: adaptive optical storage research (2026-11-07)

## Goal

Store **60 seconds of voice in at most seven printed sheets** if physically
possible, with fifteen sheets as a fallback, while retaining **the exact bytes
of the originally recorded or uploaded audio file**. This is an experimental
configuration of the established paperback.rs PaperBack optical file format,
not a novel codec claimed to be unknown to humanity.

## Measured digital proof of concept

Test:
- Test audio: ffmpeg 60-second pink-noise MP3 encoded at 128 kbps
- Original MP3: **960,932 bytes**
- Original SHA-256:
  `a6f7a70d73b0ccf0e4f323bc0da8e6018821f3ab0aaca4d2323cb327810d80b7`
- Print profile: 600 DPI printer, 80% dots, Letter paper, 0.5-inch margins,
  max bzip2 preprocessing, 20% parity, modern PaperBack format.
- Density search results:
  - 150 optical dots/inch: **11 sheets**
  - 180 optical dots/inch: **6 sheets**
  - 220 optical dots/inch: **3 sheets**
- Chosen: **180 data dots/inch, 6 PDF pages** (the least dense of the
  tested profiles meeting the seven-page target).
- Digital recovery: rendered PDF reread by the WebAssembly decoder;
  resulting **960,932 bytes matched SHA-256** exactly.
- Browser: Chromium in GitHub Actions CI, run
  https://github.com/123abcooooooooo/PaperVoice-Website/actions/runs/42394243040

**This validates storage density and digital recovery ONLY.** It does not
validate printing on a physical printer or photographing the resulting page
with an iPhone. Paper, toner, focusing, lighting, camera processing, cropping
and PDF print scaling can destroy microscopic dots. Keep the digital original
until the real paper and camera test passes. The new optimized-density search
also has its own regression run.

## Why adapting the optical carrier is better than Codec 2 for this goal

A 128 kbps 60-second MP3 is roughly 960 KB. Compressing an existing lossy
MP3 further without losing information typically yields little improvement.
Codec 2 shrinks the recording by making drastic **lossy** changes to the
sound. By contrast, density tuning leaves the MP3 alone and packs its bytes
more efficiently on the *paper*.

Even the most dense paper cannot guarantee a fixed number of pages for an
arbitrarily large input file. If the file is too large for the selected
budget, the prototype reports an error instead of losing data.

## iPhone 15 Pro Max capture experiment

1. For a first print test choose a **short 5–10 second** sample. Use a true
   high-quality 600 DPI laser print at **actual size / 100%**.
2. In iPhone **Settings → Camera → Formats**, enable **ProRAW & Resolution
   Control** and select **HEIF Max** or **ProRAW Max**, to access 48 MP on
   the main camera.
3. Use 1× main camera, even bright light, no flash, no Night mode, with the
   whole sheet flat and aligned and the entire dot field visible.
4. In the Research Lab's Recover view, upload the original full-resolution
   photo. If it fails, retry in bright indirect daylight without shadows,
   or use a true optical flatbed scan at approximately 600 DPI or more.
5. Do not infer success from recovering the original *digital PDF*:
   the physical test must reconstruct the MP3 and match the checksum.

The underlying library already handles block correction and page rotations;
custom additions here are the page-budget search, format integrity check and
minimal-pixel-density selection for a given recorded file. No claims are made
about patent novelty or guaranteed mobile reading.

## Next experimental idea if phone recovery fails: multi-shot tiles

Instead of requiring one photograph of a whole high-density page, arrange
several independently decodable optical panels on each physical sheet. Take
a full-resolution close-up of **each panel**, giving each pattern many more
camera pixels; reconstruct the original file from all the panels. This
sacrifices convenience (more photos per sheet) in return for higher feasible
printed density. It is a **research proposal**, not an implemented or
verified feature in the current prototype.

## Sources

- [PaperBack original 500 KB/page published claim](https://github.com/timwaters/paperback)
- [paperback.rs Rust port / WebAssembly, Reed–Solomon decoder](https://docs.rs/crate/paperback-rs/latest)
- [Apple ProRAW / 48 MP main camera support](https://support.apple.com/en-us/119916)
- [Mobile capture of high-resolution data-bearing markings](https://library.imaging.org/print4fab/articles/28/1/art00027_2)

## Privacy and license

Everything runs inside the browser with third-party WebAssembly.
No audio files are uploaded. The source `/research/` integrates with
`/paperback/worker.js`, which pins the GPL-3.0-or-later paperback.rs
upstream build. See `/paperback/NOTICE.md`.
