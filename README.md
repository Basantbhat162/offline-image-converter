# Offline Image Converter

A privacy-first image converter that runs in the browser. The current baseline processes images locally and does not upload them to a conversion server.

## Current status

This repository is an incomplete open-source baseline. The implemented path is:

- PNG to JPEG
- one image at a time
- file picker and drag-and-drop input
- in-browser decoding, conversion and download
- PNG validation, orientation handling and transparency flattening for JPEG

The planned PNG to WebP, JPEG to PNG, JPEG to WebP, WebP to PNG and WebP to JPEG routes are not implemented yet. The launcher, broader browser acceptance, and full first-release checks are also still pending.

The PNG-to-JPEG acceptance record is partial; see [docs/acceptance/png-to-jpeg.md](docs/acceptance/png-to-jpeg.md). Browser compatibility is user-reported only, and offline, privacy/network, drag-and-drop and full keyboard acceptance checks remain pending.

## Privacy and offline use

The conversion path is browser-local: selected image bytes stay in the browser while the image is decoded and converted. The app is a static frontend with no runtime CDN or conversion API dependency, so it can be served from a local folder for offline use. The complete offline and cross-browser acceptance review remains incomplete.

## Run locally

No dependency installation is required for this baseline.

```text
python -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/index.html` in a browser, then select or drop a PNG and convert it to JPEG.

Run the automated checks with:

```text
npm test
```

There is no build step configured.

## Project layout

- `index.html`, `app.js`, `styles.css`: the static application.
- `tests/`: application and fixture-integrity tests.
- `tests/fixtures/`: small committed inputs used by the tests.
- `package.json`: the test command; the project has no runtime package dependencies.

## Contributions

The project is not feature-complete. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and keep proposed changes within the documented product scope.

## License

Original project files are released under the MIT License. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the dependency and attribution policy.
