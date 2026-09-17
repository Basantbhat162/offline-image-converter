# PNG-to-JPEG acceptance evidence

Status: partial acceptance. This record covers only the implemented PNG-to-JPEG route and does not establish full first-release acceptance.

## Verified evidence

- `npm test` passed all 13 tests with zero failures.
- `opaque.png`, `transparent.png` and `metadata-orientation.png` each converted successfully to JPEG in the available local browser run.
- Three supplied downloads (`opaque.jpg`, `transparent.jpg` and `metadata-orientation-2.jpg`) were independently inspected read-only outside this checkout. Each is a genuine 4 × 4 JPEG with valid SOI/EOI markers and no EXIF APP1 segment.
- The transparent input produced the required transparency warning, and the result preview visibly showed the image flattened onto white.
- Corrupt, falsely labelled and animated PNG inputs were rejected with clear errors and no result or download.

## Evidence boundary

- The conversion and rejection behavior above was observed in the available Codex In-app Browser using the local static site.
- Browser compatibility is recorded as user-reported manual evidence only; the executor did not independently verify Chrome or Edge behavior.
- The user-reported browser evidence is not a substitute for the pending target-browser checks.

## Pending checks

- Offline loading and conversion with external internet access disabled.
- Unfiltered network capture and complete privacy/no-upload verification.
- Real file-system drag-and-drop.
- Full keyboard acceptance and focus-ring review; partial keyboard interaction was observed, but the complete check is not signed off here.
- Asymmetric-image orientation, downloaded-pixel comparison and exact white-pixel sampling.
- Filename preservation, the over-50 MB safety-limit journey and forced decode/encode failure handling.

## Remaining implementation scope

The other five planned conversion routes remain unimplemented: PNG-to-WebP, JPEG-to-PNG, JPEG-to-WebP, WebP-to-PNG and WebP-to-JPEG.
