// src/license.js — Aureal Polar.sh Commercial License Validator & Offline Manager
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const POLAR_ORGANIZATION_ID = "6898f4c5-7bc8-4ec5-bc97-a16b69b0498c";
export const POLAR_VALIDATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
export const POLAR_ACTIVATE_URL = "https://api.polar.sh/v1/customer-portal/license-keys/activate";

/**
 * Returns the path to the local offline license storage file.
 */
export function getLicenseStoragePath() {
  const dir = path.join(os.homedir(), ".aureal");
  return path.join(dir, "license.json");
}

/**
 * Generates a default device label for activation.
 */
export function getDeviceLabel() {
  try {
    return `${os.hostname()} (${os.platform()} ${os.arch()})`;
  } catch {
    return "Aureal Workstation";
  }
}

/**
 * Validates a Polar license key without activating a new machine seat.
 * Zero audio data is transmitted; only the key string is sent to Polar.
 *
 * @param {string} key
 * @returns {Promise<{ valid: boolean, data?: object, error?: string }>}
 */
export async function validatePolarKey(key) {
  const cleanKey = String(key || "").trim().toUpperCase();
  if (!cleanKey) {
    return { valid: false, error: "Empty license key." };
  }

  try {
    const res = await fetch(POLAR_VALIDATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: cleanKey,
        organization_id: POLAR_ORGANIZATION_ID
      })
    });

    const body = await res.json().catch(() => null);

    if (res.ok && body && (body.status === "granted" || body.status === "active")) {
      return { valid: true, data: body };
    }

    const detail = body && (body.detail || body.error) ? (body.detail || body.error) : `HTTP ${res.status}`;
    return { valid: false, error: `License invalid: ${detail}` };
  } catch (err) {
    return { valid: false, error: `Network error validating license: ${err.message || err}` };
  }
}

/**
 * Activates a Polar license key and persists credentials locally.
 *
 * @param {string} key
 * @param {string} [label]
 * @returns {Promise<{ success: boolean, license?: object, error?: string }>}
 */
export async function activatePolarKey(key, label) {
  const cleanKey = String(key || "").trim().toUpperCase();
  if (!cleanKey) {
    return { success: false, error: "Empty license key." };
  }

  const deviceLabel = label || getDeviceLabel();

  try {
    const res = await fetch(POLAR_ACTIVATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: cleanKey,
        organization_id: POLAR_ORGANIZATION_ID,
        label: deviceLabel
      })
    });

    const body = await res.json().catch(() => null);

    if (res.ok && body && (body.status === "granted" || body.status === "active")) {
      const record = {
        key: cleanKey,
        displayKey: body.display_key || maskKey(cleanKey),
        status: body.status,
        customerEmail: body.customer?.email || body.user?.email || null,
        customerName: body.customer?.name || body.user?.public_name || null,
        benefitId: body.benefit_id || null,
        activatedAt: new Date().toISOString(),
        expiresAt: body.expires_at || null,
        deviceLabel: deviceLabel,
        organizationId: POLAR_ORGANIZATION_ID
      };

      saveLocalLicense(record);
      return { success: true, license: record };
    }

    // Fallback: If activation endpoint is restricted or unneeded, validate directly
    const validateRes = await validatePolarKey(cleanKey);
    if (validateRes.valid && validateRes.data) {
      const b = validateRes.data;
      const record = {
        key: cleanKey,
        displayKey: b.display_key || maskKey(cleanKey),
        status: b.status,
        customerEmail: b.customer?.email || b.user?.email || null,
        customerName: b.customer?.name || b.user?.public_name || null,
        benefitId: b.benefit_id || null,
        activatedAt: new Date().toISOString(),
        expiresAt: b.expires_at || null,
        deviceLabel: deviceLabel,
        organizationId: POLAR_ORGANIZATION_ID
      };

      saveLocalLicense(record);
      return { success: true, license: record };
    }

    const detail = body && (body.detail || body.error) ? (body.detail || body.error) : `HTTP ${res.status}`;
    return { success: false, error: `Activation failed: ${detail}` };
  } catch (err) {
    return { success: false, error: `Activation error: ${err.message || err}` };
  }
}

/**
 * Saves a license record to local offline storage.
 * @param {object} record
 */
export function saveLocalLicense(record) {
  try {
    const filePath = getLicenseStoragePath();
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), "utf8");
  } catch (err) {
    console.warn(`[Aureal License] Could not write offline license file: ${err.message}`);
  }
}

/**
 * Reads local license record from storage.
 * @returns {object|null}
 */
export function loadLocalLicense() {
  try {
    const filePath = getLicenseStoragePath();
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.key && (parsed.status === "granted" || parsed.status === "active")) {
      if (parsed.expiresAt) {
        const exp = new Date(parsed.expiresAt).getTime();
        if (Date.now() > exp) return null;
      }
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deletes local offline license file.
 */
export function clearLocalLicense() {
  try {
    const filePath = getLicenseStoragePath();
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Masks a license key string for safe UI / log display.
 */
export function maskKey(key) {
  const str = String(key || "").trim();
  if (str.length <= 8) return "****";
  return `****-${str.slice(-8)}`;
}

/**
 * Returns overall license status for current execution context.
 */
export function getLicenseStatus() {
  const lic = loadLocalLicense();
  if (lic) {
    return {
      isLicensed: true,
      tier: "commercial_pro",
      tierLabel: "Commercial Pro License (Active)",
      customer: lic.customerEmail || lic.customerName || "Verified Customer",
      displayKey: lic.displayKey || maskKey(lic.key),
      activatedAt: lic.activatedAt,
      expiresAt: lic.expiresAt || "Perpetual / No Expiry"
    };
  }
  return {
    isLicensed: false,
    tier: "community_noncommercial",
    tierLabel: "Community Evaluation (PolyForm Noncommercial 1.0.0)",
    customer: null,
    displayKey: null,
    activatedAt: null,
    expiresAt: null
  };
}
