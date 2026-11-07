# PaperVoice / PaperBack Lab — Credits & Licensing

This experimental page at `/paperback/` uses the **real PaperBack encoding
and decoding format**, via the third-party WebAssembly port **paperback.rs 1.3.2**
and the `paperback-homepage` browser adapter.

- Original PaperBack (2007) by **Oleh Yuschuk**, GPL-3.0:
  https://ollydbg.org/Paperbak/
- PaperBack version 1.10 changes by **Michael Mohr**.
- paperback.rs 1.3.2 by **Josef H.B. Schneider**, GPL-3.0-or-later:
  https://github.com/J0s3f/paperback.rs
- Browser binding and build artifacts (including wasm) from:
  https://github.com/J0s3f/paperback-homepage
- Reed–Solomon implementation credit: **Phil Karn**.
- The actual version used is pinned to Git commit
  `c26a0e05070fe8bb1664b6700c0f67ff7cf64af3` of
  `J0s3f/paperback-homepage` and loaded from jsDelivr.
- Full upstream license: https://github.com/J0s3f/paperback-homepage/blob/main/LICENSE
- Upstream notices: https://github.com/J0s3f/paperback-homepage/blob/main/NOTICE.md

**License:** The PaperBack Lab integration code in `docs/paperback` is
distributed under GPL-3.0-or-later in conjunction with the GPL-licensed
PaperBack engine. Modifications and source code remain available in the public
PaperVoice GitHub repository.

**Not encrypted.** Anyone who possesses complete printouts can restore the
audio. WebAssembly and JS modules are downloaded by the browser over HTTPS.
Audio files and photo data stay locally on the device, and are not uploaded.

The default **Phone-first test** preset prioritizes camera recovery over
maximum density. "Maximum density" needs a laser printer and high-resolution
scanner for practical results. SHA-256 and Reed–Solomon protections are handled
by the upstream paperback.rs `modern` preset. Always test real paper scans
before discarding original digital media.

The classic PaperVoice `/` app is independent and is not modified by this lab.
