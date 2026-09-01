# Aural Watermark Whitepaper

**Version:** 0.2.0 · **Status:** MVP, working code incl. real codec round-trips

> Hörbarer Beweis für Unhörbares: ein steganografisches Wasserzeichen, das
> belegt, dass eine Sprachaufnahme von einem Menschen stammt — nicht von einer
> KI-Stimme. Verifizierbar in Sekunden, im Browser, ohne Infrastruktur.

---

## 1. Abstract

Seit 2024/25 sind Stimmen realistisch klonbar; seit 2026 explodieren die
Rechtsfälle — Podcast-Moderatoren, Sprecher, Politiker sehen ihre Stimme
"geklaut". Der EU AI Act verlangt Provenienz-Transparenz für synthetische
Medien. Was fehlt, ist der einfache Nachweis in die *andere* Richtung:
**Diese Aufnahme ist authentisch menschlich.**

Aural Watermark bettet beim Aufnehmen/Mastern einen 32-Bit-Herkunfts-Identifier
in das Audiosignal ein — als Spread-Spectrum-Signal in Frequenzbändern, die
Sprachwahrnehmung kaum erreicht (16.5–19.5 kHz) bzw. die Codecs überleben
(8–13 kHz). Der Identifier ist mit CRC-16 geschützt, fehlerkorrigierend
(1 Bit), redundant über die gesamte Tracklänge wiederholt und gegen
Verstärkungsänderungen invariant skaliert.

v0.2 belegt mit **echten ffmpeg-Roundtrips**: Das Wasserzeichen überlebt
MP3 128k/320k und AAC 128k in allen Bandmodi und wird nach dem Roundtrip mit
Konfidenz 1.000 korrekt dekodiert; falsche IDs werden abgelehnt.

## 2. Problem & Markt

| Fakt | Konsequenz |
|---|---|
| Klon-Angriffe kosten Minuten statt Wochen | Authentizität wird zum Verkaufsargument für menschliche Produktion |
| EU AI Act: Transparenzpflichten für synthetische Inhalte | Sender/Labels brauchen dokumentierbare Herkunft |
| Bestehende Watermarking-Forschung sitzt in Laboren/Lizenzen | Kein Creator-Werkzeug "ein Klick, offline, kein Konto" |

**Buyer:** Podcast-Netzwerke, Radiohäuser, Labels, Archive/Gerichte
(Audio-Evidenz). **Anker:** SDK-Preis ~0.02 EUR/Minute, keine Serverkosten —
Einbettung einmalig, Verifikation client-seitig.

## 3. Technischer Ansatz

### 3.1 Codewort-Format

```
Payload-ID (uint32) ──► CRC-16/CCITT-FALSE ──► 48 BPSK-Symbole ──► PN-Slots
[32 Datenbits]          [16 Schutzbits]         [1 Symbol je Slot]
```

Jedes der 48 Symbole wird durch seine eigene, vom Schlüssel abgeleitete
±1-Pseudozufallsfolge (PN-Sequenz) getragen (`makeSymbolStream(key,"bit"+b)`).
Der Schlüssel steuert damit die gesamte Signalform: Ohne Schlüssel existiert
keine korrelierbare Vorlage.

### 3.2 Einbettung (Signalform)

Pro Symbol-Slot (24 Chips) wird ein Hann-fensterter Sinus-Carrier am
Bandzentrum mit dem PN-Vorzeichen multipliziert. Alle Energie bleibt im
konfigurierten Band; ein komplettes Codewort füllt exakt einen Frame
(~1 s), der über die ganze Titellänge wiederholt wird → kohärente
Integrationsverstärkung mit jeder Sekunde Material.

**Bandmodi (v0.2):**

| Modus | Band | Charakter |
|---|---|---|
| `high` | 16.5–19.5 kHz | maximal unauffällig; kann an Codecs scheitern, deren Lowpass darunter liegt |
| `mid` | 8–13 kHz | überlebt Codec-Lowpass; bei geringer Stärke auf Sprachmaterial praktisch unhörbar |
| `dual` | beide | gleiches Codewort, gleicher Schlüssel, beide Bänder; Detektor wählt das bessere Ergebnis |

Bei `dual` skaliert der Embedder jede Kopie ×0.7, damit die Summenamplitude
vergleichbar bleibt (gemessen: −22.5 dBFS Peak bei strength 0.5).

Stärke→Amplitude ist linear: `amp = strength × 0.12` (0.12 ≈ −18 dBFS Peak);
Default `strength = 0.5`.

### 3.3 Detektion

1. **Faltung:** alle Frames des Tracks (über alle Kanäle summiert) werden zu
   einem Frame akkumuliert → SNR wächst mit der Länge.
2. **Resync-Gitter:** Dekodier-Pipelines können Sample-Offsets hinterlassen;
   der Detektor probiert Verschiebungen von ±1/16, ±2/16, ±4/16 Framelänge
   und behält die beste Hypothese.
3. **Matched Filter:** Dot-Produkt je Slot gegen die Schlüssel-Vorlage,
   normiert → weiche Bitsymbole.
4. **Fehlerkorrektur:** Hard-Decisions + CRC-Check; bei CRC-Fehler werden
   Bits in Zuverlässigkeits-Reihenfolge geflippt (1-Bit-Korrektur).
5. **Statistik:** z-Wert aus alignierter Amplitude vs. Streuung,
   `confidence = clamp((z−3)/27, 0..1)`. Skaleninvariant — Gain-Änderungen
   verschieben nichts.
6. **Urteil:** `detected ⇔ CRC ok ∧ ID stimmt ∧ confidence ≥ 0.5 ∧ mu > 0`.

`detect --band auto` führt 3.1–6 für `high` und `mid` getrennt aus und meldet
das gewinnende Band (`details.bandUsed`).

### 3.4 Warum kein Deep-Learning?

Watermarking per NN ist Stand der Forschung, aber: nicht auditierbar, nicht
offline-garantierbar, teuer im Training, schwer stabil gegenüber Codecs zu
machen. Spread Spectrum ist 50 Jahre alt, beweisbar charakterisierbar und mit
Float32-Arithmetik überall lauffähig — inklusive Browser ohne Download von
Modellgewichten. Für Evidenz-Zwecke zählt Erklärbarkeit mehr als letzte
Prozent Robustheit.

## 4. Architektur

Zero-dependency Node ≥ 18 ESM; derselbe Code läuft (ohne Node-APIs) im Browser:

```
src/
  signal.js     PRNG (FNV-1a/xorshift128), PN-Streams, Hann, Bandgeometrie
  payload.js    uint32 → 48-Symbol-Codewort, CRC-16/CCITT-FALSE, 1-Bit-Korrektur
  embed.js      Template-Erzeugung, Multi-Band-Einbettung, Metadaten
  detect.js     Faltung, Resync, Matched Filter, Statistik, Band-Auto
  wav.js        RIFF/WAVE Parser+Writer (16/24-bit PCM, mono…8ch)
  synth.js      synthetisches sprachähnliches Testsignal
  browser/
    aural-watermark-verify.js   DataView-basierter WAV-Parser + verifyWav()
demo/verifier.html              fertige Offline-Verifizierungsseite (file://)
bin/auralwatermark.js           CLI: gen / embed / detect
```

Details: [ARCHITECTURE.md](ARCHITECTURE.md) · Payload-Bits: [PAYLOAD-FORMAT.md](PAYLOAD-FORMAT.md)

## 5. Evaluation (gemessen, nicht behauptet)

Suite: 42 Tests (`node --test`), davon **11 echte ffmpeg-Codec-Roundtrips**
(synthetisch, 20 s, 44.1 kHz mono, strength 0.5):

| Embed-Band | MP3 128k | MP3 320k | AAC 128k |
|---|---|---|---|
| high | ✔ erkannt | ✔ | ✔ |
| mid | ✔ | ✔ | ✔ |
| dual | ✔ | ✔ | ✔ |

Weiter demonstriert: Auto-Detection meldet das treffende Band nach MP3 128k;
falsche ID → `detected: NO`, BER 37.5 %; Blind-Dekodierung rekonstruiert die
ID inkl. 1-Bit-Korrektur; falscher Schlüssel/unmarkierte Datei → Konfidenz 0.
Clean-path Roundtrips: Konfidenz 1.000, BER 0 %. Suite-Laufzeit ~65 s.

## 6. Threat Model & Limitationen (ehrlich)

**Was das Wasserzeichen leistet:** unparteiischer, schlüsselgebundener
Nachweis, dass eine Datei aus dem eigenen Produktionsprozess stammt —
robust gegen Alltagsdistribution (Codecs, Gain, Zuschnitt am Frameanfang).

**Was es nicht leistet:**

| Angriff/Ereignis | Überlebensfähigkeit |
|---|---|
| MP3/AAC bis 128 kbps | ja (gemessen) |
| Sehr niedrige Bitraten (<96 kbps) / Telefoncodecs | ungetestet, unwahrscheinlich |
| Time-Stretch / Pitch-Shift | nein (nur grobes Resync-Gitter) |
| DA/AD-Wiederaufnahme | nein |
| Böswilliges Entfernen (Kenntnis des Bandes, aggressive Notch-Filter) | teilweise — Kosten steigen, Sicherheit nicht garantiert |
| Kryptografische Fälschungssicherheit | **nein** — Schlüssel sind Obfuscation-Grade (FNV/xorshift), Payload unsigned |

Für gerichtsfeste Evidenz gehört das Wasserzeichen in eine signaturbasierte
Architektur (Roadmap v0.4: HMAC über Payload + Key-Management). Die
Browser-Verifikation ist bewusst lokal: Audio verlässt den Rechner nicht.

## 7. Roadmap

| Version | Inhalt |
|---|---|
| v0.3 | WASM-Verifizierer (Geschwindigkeit), Perceptual Masking (Stärke folgt Signalhüllkurve), Robustheitstests mit echten Podcasts |
| v0.4 | Signierte Payloads (HMAC/Ed25519 über ID+Metadaten), Key-Registry für Netzwerk-Betreiber |
| v1.0 | Recorder-SDK (Eingabe: Stream, Ausgabe: markiert), Lizenzierung 0.02 EUR/min |

## 8. Business-Modell-Skizze

- **SDK-Lizenz** pro verarbeiteter Minute (~0.02 EUR) — Einbettung im Mastering,
  Verifikation frei für alle (auch Empfänger/Plattformen).
- **Verteidigung:** Verbreitung des *Verifizierers* schafft Nachfrage nach dem
  *Embedder*; der Schlüsselbund bindet Netzwerke an den Service.
