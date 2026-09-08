import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  maskKey,
  getLicenseStoragePath,
  saveLocalLicense,
  loadLocalLicense,
  clearLocalLicense,
  getLicenseStatus,
  validatePolarKey,
  POLAR_ORGANIZATION_ID
} from "../src/license.js";

test("license: maskKey properly obfuscates sensitive parts", () => {
  assert.equal(maskKey("44BC1AAD-F724-47CD-AAB7-D7CDF7E976D5"), "****-F7E976D5");
  assert.equal(maskKey("SHORT"), "****");
  assert.equal(maskKey(""), "****");
});

test("license: offline credential storage round-trip", () => {
  const orig = loadLocalLicense();
  try {
    const testRecord = {
      key: "TEST-KEY-XYZ-12345678",
      displayKey: "****-12345678",
      status: "granted",
      customerEmail: "producer@studio.test",
      activatedAt: new Date().toISOString(),
      expiresAt: null,
      organizationId: POLAR_ORGANIZATION_ID
    };

    saveLocalLicense(testRecord);
    const loaded = loadLocalLicense();
    assert.ok(loaded);
    assert.equal(loaded.key, testRecord.key);
    assert.equal(loaded.status, "granted");
    assert.equal(loaded.customerEmail, "producer@studio.test");

    const st = getLicenseStatus();
    assert.equal(st.isLicensed, true);
    assert.equal(st.customer, "producer@studio.test");

    clearLocalLicense();
    assert.equal(loadLocalLicense(), null);
    assert.equal(getLicenseStatus().isLicensed, false);
  } finally {
    if (orig) {
      saveLocalLicense(orig);
    }
  }
});

test("license: validatePolarKey rejects blank key", async () => {
  const res = await validatePolarKey("");
  assert.equal(res.valid, false);
  assert.match(res.error, /empty/i);
});

test("license: validatePolarKey rejects bogus key", async () => {
  const res = await validatePolarKey("BOGUS-KEY-00000000");
  assert.equal(res.valid, false);
});
