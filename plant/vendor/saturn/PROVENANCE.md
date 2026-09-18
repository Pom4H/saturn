# Saturn target provenance

Pinned upstream: `Pom4H/open-device`, commit
`007ada38d2cce27b37413f38952ca11b919842c1`, `profiles/saturn-fbd/`.

The SCADA integration reuses the actual profile's `builder.ts`, `format.ts`,
`hmi.ts`, `hmi-compile.ts`, `types.ts`, front-panel `view.ts` and runtime wrapper.
The Open Device sources are redistributed under Apache-2.0 (`LICENSE`).
The embedded FBD runtime is MIT, copyright 2014 Alexey Lutovinin
(`RUNTIME-LICENSE`). Both notices are included in the built PWA as
`assets/THIRD-PARTY.txt` and in its offline cache.

`plant/saturn-view.ts` also embeds the matching profile-specific CSS from
`apps/playground/src/style.css`, so SVG texture rendering does not lose terminal
colors and strokes when it runs outside the document stylesheet.

## Modifications

- `view.ts`: export DC, common and RS-485 connector anchors using its existing
  `pinRects` geometry. The original front-panel drawing is preserved.
- `runtime.ts`: use a synchronous pinned WebAssembly host and add `createSync()`;
  retain the original artifact loader and screen-command accessors.
- `runtime/binary.ts`: decode the Emscripten single-file runtime's embedded bytes,
  then store the exact bytes as base64. No WASM instructions were changed.
- `runtime/host.ts`: a deliberately narrow ABI host for the imported module,
  not an emulator or compiler invented for this application. RTC imports throw;
  allocator growth is refused. Only the exported combinational subset is accepted.
- The otherwise unused original single-file JS was not copied into this tree:
  it would duplicate the embedded WASM and introduce an unrelated loader path.

WASM byte length: **37453**.
SHA-256: `a81887ad182cf07bee0566e5d38785f608ee65ea6043362d8545023633a26750`.

This proves provenance of the tested binary, not certification, physical I/O
compatibility or suitability for safety-critical equipment. The source upstream
also explicitly leaves physical-device deployment outside its implemented slice.
