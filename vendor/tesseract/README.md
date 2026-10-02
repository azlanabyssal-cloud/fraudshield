Bundled locally so screenshot OCR never fetches code or models from a third-party CDN.

- tesseract.js 5.1.1 and tesseract.js-core 5.1.1 (Apache-2.0; see the LICENSE files here)
- lang/eng.traineddata.gz, lang/hin.traineddata.gz from tesseract-ocr/tessdata_fast (Apache-2.0)

Only the LSTM core variants (plain and SIMD) are included; the default engine mode uses these.
