import fs from "node:fs";

const logoSvg = fs.readFileSync("assets/logo.svg", "utf8");

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@600;700;800&family=JetBrains+Mono:wght@500;600&family=Inter:wght@400;500&display=swap');
  
  * { box-sizing: border-box; margin: 0; padding: 0; }
  
  body {
    width: 2400px;
    height: 720px;
    background: #07040d;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Space Grotesk', -apple-system, sans-serif;
    color: #ffffff;
    position: relative;
  }
  
  /* Subtle ambient background glows */
  .glow-left {
    position: absolute;
    width: 900px;
    height: 900px;
    left: 80px;
    top: -90px;
    background: radial-gradient(circle, rgba(139, 92, 246, 0.16) 0%, rgba(56, 189, 248, 0.08) 45%, transparent 70%);
    filter: blur(60px);
    pointer-events: none;
  }
  
  .glow-top {
    position: absolute;
    width: 1400px;
    height: 500px;
    left: 600px;
    top: -250px;
    background: radial-gradient(ellipse, rgba(168, 85, 247, 0.12) 0%, transparent 70%);
    filter: blur(80px);
    pointer-events: none;
  }

  /* Subtle technical background grid */
  .grid-overlay {
    position: absolute;
    inset: 0;
    background-image: 
      linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px);
    background-size: 80px 80px;
    mask-image: radial-gradient(ellipse at center, black 40%, transparent 80%);
    pointer-events: none;
  }

  /* Outer boundary frame */
  .banner-border {
    position: absolute;
    inset: 0;
    border: 1px solid rgba(255, 255, 255, 0.08);
    pointer-events: none;
  }

  .banner-container {
    position: relative;
    z-index: 10;
    width: 2160px;
    display: flex;
    align-items: center;
    gap: 120px;
  }

  .logo-wrapper {
    flex-shrink: 0;
    width: 440px;
    height: 440px;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo-aura {
    position: absolute;
    inset: -30px;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, rgba(139, 92, 246, 0.25) 50%, transparent 75%);
    filter: blur(35px);
    border-radius: 120px;
  }

  .logo-svg {
    position: relative;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 25px 50px rgba(0, 0, 0, 0.85));
  }

  .content {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .eyebrow {
    font-family: 'JetBrains Mono', monospace;
    font-size: 26px;
    font-weight: 600;
    letter-spacing: 5px;
    color: #a78bfa;
    text-transform: uppercase;
    margin-bottom: 24px;
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .eyebrow-line {
    width: 48px;
    height: 2px;
    background: linear-gradient(90deg, #a78bfa, transparent);
  }

  .title {
    font-size: 96px;
    font-weight: 800;
    letter-spacing: -3px;
    line-height: 1.02;
    margin-bottom: 26px;
    background: linear-gradient(180deg, #ffffff 30%, #cbd5e1 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }

  .subtitle {
    font-family: 'Inter', sans-serif;
    font-size: 34px;
    line-height: 1.45;
    color: #94a3b8;
    max-width: 1400px;
    font-weight: 400;
    letter-spacing: -0.5px;
  }
</style>
</head>
<body>
  <div class="glow-left"></div>
  <div class="glow-top"></div>
  <div class="grid-overlay"></div>
  <div class="banner-border"></div>

  <div class="banner-container">
    <div class="logo-wrapper">
      <div class="logo-aura"></div>
      <div class="logo-svg">${logoSvg}</div>
    </div>
    
    <div class="content">
      <div class="eyebrow">
        <span class="eyebrow-line"></span>
        KELLER SYSTEMS
      </div>
      <h1 class="title">AUREAL WATERMARK</h1>
      <p class="subtitle">Forensic acoustic watermarking &amp; leak attribution for major studios and record labels.</p>
    </div>
  </div>
</body>
</html>`;

fs.writeFileSync("temp-banner.html", html, "utf8");
console.log("Written temp-banner.html");
