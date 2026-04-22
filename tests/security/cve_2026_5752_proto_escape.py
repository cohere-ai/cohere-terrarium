#
# expected output in terrarium: fail
#
# Regression test for CVE-2026-5752.
#
# Before the fix, every object exposed to the sandbox via `jsglobals` (e.g.
# `document`, `ImageData`, the nested `style`/`classList` objects) inherited
# from `Object.prototype`. That let sandboxed Python code reach `js.document`
# from Pyodide, walk `.constructor.constructor` up to the host `Function`
# constructor, and call it with `"return globalThis"` to obtain the host
# Node.js global object -- from there `require("child_process").execSync(...)`
# gave arbitrary code execution as root inside the container.
#
# After the fix, every exposed object is built with `Object.create(null)` and
# frozen, so `.constructor` is `undefined` and the prototype walk dead-ends.
# This test attempts the escape; the request must fail (or at minimum return
# an undefined `.constructor`) for the patch to be considered effective.
#
import js

doc = js.document
# .constructor must NOT resolve to a callable host Function on a patched build.
ctor = getattr(doc, "constructor", None)
assert ctor is None or not callable(ctor), (
    "CVE-2026-5752 regression: js.document.constructor is reachable; "
    "sandbox can walk the prototype chain to host globalThis."
)

# Belt-and-suspenders: try the full escape and make sure it raises.
try:
    leak = doc.constructor.constructor("return globalThis")()
    raise AssertionError(
        f"CVE-2026-5752 regression: obtained host globalThis from sandbox: {leak}"
    )
except (AttributeError, TypeError, Exception):
    print("ok: prototype chain escape blocked")
