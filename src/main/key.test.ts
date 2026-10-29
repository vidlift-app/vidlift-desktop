import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeKey } from "./key";

test("a well-formed key comes back as it is", () => {
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQR"), "VL-ABCD-EFGH-JKLM-NPQR");
});

test("spaces, lower case and missing dashes are tidied", () => {
  assert.equal(normalizeKey("  vl abcd efgh-jklm npqr "), "VL-ABCD-EFGH-JKLM-NPQR");
  assert.equal(normalizeKey("abcdefghjklmnpqr"), "VL-ABCD-EFGH-JKLM-NPQR");
  assert.equal(normalizeKey("vl-2345-6789-abcd-efgh"), "VL-2345-6789-ABCD-EFGH");
});

test("a key whose own characters start with VL keeps them", () => {
  assert.equal(normalizeKey("VLAB-CDEF-GHJK-LMNP"), "VL-VLAB-CDEF-GHJK-LMNP");
  assert.equal(normalizeKey("VL-VLAB-CDEF-GHJK-LMNP"), "VL-VLAB-CDEF-GHJK-LMNP");
});

test("characters outside the alphabet are refused", () => {
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQ0"), null); // 0
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQO"), null); // O
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQ1"), null); // 1
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQI"), null); // I
});

test("the wrong length is refused", () => {
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM"), null);
  assert.equal(normalizeKey("VL-ABCD-EFGH-JKLM-NPQR-STUV"), null);
  assert.equal(normalizeKey(""), null);
});
