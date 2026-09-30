# Aureal Watermark — Commercial Licensing & Enterprise SLA

Aureal Watermark provides audio watermarking software for embedding and detecting keyed identifiers in supported audio workflows. 

While personal, hobby, and academic research use is completely free under the **PolyForm Noncommercial License 1.0.0**, commercial software integrations, commercial music releases, SaaS render loops, and enterprise platforms require a **Commercial Production License**.

---

## Commercial Licensing Matrix

| License Tier | Target Audience | Key Features Included | Price |
| :--- | :--- | :--- | :--- |
| **Solo Creator / Indie Studio** | Independent producers, artists, mixing engineers | • Unrestricted commercial rights on all personal releases & beats<br>• Full access to Universal CLI (`aureal-watermark.cjs`)<br>• Offline Web Studio with 60 FPS Web Worker engine<br>• Lifetime updates on major v0.x releases | **$249** *(one-time / perpetual)* |
| **Boutique Label & A&R Desk** | Record labels, artist managers, DJ promo pools | • Everything in Indie Studio tier<br>• Automated Promo Leak Batch Generator (`batch_distribute.js`)<br>• One-Click Forensic Leak Audit Inspector (`audit_leak.js`)<br>• Tamper-proof `recipients.json` cryptographic manifest<br>• Priority email support for leak disputes | **$499** *(one-time / seat)* |
| **B2B Audio Marketplace** | Beat marketplaces, stem distribution, stock libraries | • Headless Node.js backend integration rights<br>• Commercial export hook SLA<br>• Unlimited automated watermarking loops<br>• Dual-band heavy lossy compression resilience | **$2,900 / yr** *(<50k tracks/mo)*<br>**$5,900 / yr** *(Unlimited)* |
| **Voice AI & Speech Platform** | Text-to-Speech (TTS), AI voice cloning, AI podcasting | • Custom technical integration support<br>• Audio watermark embedding and detection workflows<br>• No regulatory or C2PA certification is included | **From $4,900 / yr** *(Growth)*<br>Custom Foundation Model scaling |
| **Audio Forensics & Legal Lab** | Digital forensic labs, copyright lawyers, expert witnesses | • Client-side offline forensic audit suite (`verifier.html`)<br>• Raw $E_b/N_0$ and SQNR signal-to-noise ratio reports<br>• Custom branding & white-label verification inspector<br>• Detection reports for independent review; no court-admissibility claim | **$1,499** *(perpetual license)* |

---

## Regulatory and C2PA Context (No Compliance Certification)

### 1. EU AI Act Article 50 Machine-Readable Compliance
Article 50 of the European Union AI Act establishes transparency obligations for certain providers and deployers. This software does not provide legal advice or certify that an implementation complies with the Act.
* **The Vulnerability of Metadata:** Traditional metadata (ID3 tags, WAV RIFF chunks, C2PA manifest envelopes) is routinely stripped when audio is uploaded to TikTok, Instagram Reels, YouTube Shorts, WhatsApp, or compressed via lossy codecs.
* **Aureal's role:** Aureal embeds a keyed identifier in audio. Detection depends on the source audio, codec, and processing; this is not a compliance determination.

### 2. The C2PA Content Credentials Persistence Bridge
Aureal does not create, validate, or recover C2PA manifests. Its ID may be used as an application-level lookup value alongside independently maintained provenance records; the repository example is illustrative, not a certified C2PA implementation.

---

## License Enforcement & Air-Gapped Operation

Commercial licenses do not require continuous internet connectivity or intrusive DRM phone-home servers. Enterprise clients operating in secure, air-gapped mastering facilities can run Aureal completely offline.

---

## Purchasing & Commercial Inquiry

To purchase a commercial license, activate an enterprise SLA, or request a custom integration pilot:

1. **Email:** Licensing inquiries can be submitted directly to **[business@kellersystems.dev](mailto:business@kellersystems.dev)** (Founder / Licensing Desk).
2. **Instant Checkout:** Solo and Label tiers can be purchased directly with card via Polar.sh on the [Pricing Page](https://aureal.kellersystems.dev/pricing).
3. **Invoicing:** Wire transfer, Stripe invoice, and corporate purchase orders (PO) are accepted with same-day digital license certificate issuance.
