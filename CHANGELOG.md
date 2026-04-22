# Changelog

## 1.0.1 — 2026-04-22

### Security

* Fix **CVE-2026-5752** (CVSS 9.3, critical): sandbox escape via JavaScript
  prototype chain traversal in `src/services/python-interpreter/service.ts`.
  Mock `document` / `ImageData` / DOM stub objects exposed to Pyodide via
  `jsglobals` were plain object literals that inherited from
  `Object.prototype`, allowing sandboxed Python to walk
  `.constructor.constructor` to the host `Function` constructor, obtain
  host `globalThis`, and reach `require` for arbitrary code execution as
  root. Every exposed object is now built with `Object.create(null)`;
  read-only mocks are additionally frozen. See `SECURITY.md` and
  [VU#414811](https://kb.cert.org/vuls/id/414811).
* Add regression test
  `tests/security/cve_2026_5752_proto_escape.py`.

### Notes

This project remains unmaintained beyond this security release. Users are
encouraged to migrate to a maintained sandbox.
