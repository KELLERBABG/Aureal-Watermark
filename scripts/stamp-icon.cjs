const { rcedit } = require("rcedit");

async function main() {
  console.log("Stamping Aureal icon and metadata into dist/aureal-watermark.exe...");
  await rcedit("dist/aureal-watermark.exe", {
    icon: "assets/icon.ico",
    "file-version": "0.2.4",
    "product-version": "0.2.4",
    "version-string": {
      CompanyName: "Keller Systems",
      FileDescription: "Aureal Watermark — Desktop Audio Provenance Studio",
      ProductName: "Aureal Watermark",
      LegalCopyright: "Copyright (c) 2026 Keller Systems. All rights reserved."
    }
  });
  console.log("Successfully stamped Aureal icon and metadata into PE binary!");
}

main().catch(err => {
  console.error("Failed to stamp icon:", err);
  process.exit(1);
});
