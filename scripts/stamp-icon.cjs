// scripts/stamp-icon.cjs — stamp the Windows icon and PE metadata into the SEA binary.
//
// rcedit is a build-time-only dependency. It is declared in devDependencies so the
// release workflow (which runs `npm install`) has it; when it is missing (for example a
// source checkout without node_modules) this script warns and exits 0 instead of
// breaking the whole build. Everything before this step has already produced a working
// executable — only the icon/metadata would be missing.
const path = require("node:path");

async function main() {
  const pkgVersion = require("../package.json").version;
  const exe = path.join("dist", "aureal-watermark.exe");

  let rcedit;
  try {
    ({ rcedit } = require("rcedit"));
  } catch {
    console.warn(
      "rcedit is not installed - skipping icon/metadata stamping.\n" +
        "  Run `npm install` (devDependencies) before building a release.\n" +
        "  The executable in dist/ is still functional, just without the custom icon."
    );
    return;
  }

  console.log("Stamping Aureal icon and metadata into " + exe + " ...");
  await rcedit(exe, {
    icon: "assets/icon.ico",
    "file-version": pkgVersion,
    "product-version": pkgVersion,
    "version-string": {
      CompanyName: "Keller Systems",
      FileDescription: "Aureal Watermark - Desktop Audio Provenance Studio",
      ProductName: "Aureal Watermark",
      LegalCopyright: "Copyright (c) 2026 Keller Systems. All rights reserved."
    }
  });
  console.log("Successfully stamped Aureal icon and metadata into PE binary!");
}

main().catch((err) => {
  console.error("Failed to stamp icon:", err);
  process.exitCode = 1;
});
