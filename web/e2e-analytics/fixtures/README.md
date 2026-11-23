# Kakao SDK fixture

`kakao-2.8.4.min.js.txt` is the unmodified SDK response from
https://t1.kakaocdn.net/kakao_js_sdk/2.8.4/kakao.min.js (retrieved 2026-11-24).
The `.txt` suffix keeps formatters from changing the bytes; Playwright serves it as JavaScript.

- Version: 2.8.4, 88,359 bytes.
- SHA-384 / production SRI: `sha384-BGX7Wb16GmRFagri4bLJV2DgipVZaU2AI812GZtHtHzzDQJnfHasDXN5houxv45w`.
- The test checks the fixture against `KAKAO_SDK.integrity` before serving it. The browser also checks the production script element's SRI.
- Copyright and third-party notices remain in the original header. The SDK is Apache-2.0 licensed; see `KAKAO-LICENSE.txt` and the embedded notices.

When the production SDK pin changes, download its exact response, review its notices, and update this fixture and the SRI together. Tests never fetch the CDN.
