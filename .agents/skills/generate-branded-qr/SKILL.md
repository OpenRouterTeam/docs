---
name: generate-branded-qr
description: Generate a branded QR as vector SVG and PNG without a browser.
user-invocable: true
---

# Generate a branded QR

Run the headless generator with an absolute HTTP or HTTPS URL, one supported
accent, and a raster size:

```bash
bun scripts/qr-code-generator.ts \
  --url https://openrouter.ai/c/DEVINQR25 \
  --accent '#7624F4' \
  --size 360 \
  --output /tmp/branded-qr
```

The command writes `branded-qr.svg` and `branded-qr.png` to the output
directory. Supported accents are Grape (`#7624F4`), Royal (`#035ADE`), Ink
(`#03080A`), and Volt (`#C8FF00`). The SVG is the source of truth; PNG rasterization uses
`@resvg/resvg-js`.

The script statically imports the shared renderer package
`@openrouter-monorepo/branded-qr`. The package owns the QR dependency and
exports the typed accent list and type guard used by both Mission Control and
the scripts workspace. Keep the SVG renderer isomorphic and leave browser
rasterization in Mission Control.
