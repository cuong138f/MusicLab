import { useState, useRef, useEffect, useMemo, Fragment } from "react";
import { motion, AnimatePresence } from "framer-motion";
import WaveSurfer from "wavesurfer.js";
import { Music, Image, Play, Pause, Wand2, SkipBack, Upload, Loader2, Sparkles, Pencil, Check, X, Download, Scissors, Trash2, ChevronDown } from "lucide-react";

interface LyricLine {
  text: string;
  start: number;
  end: number;
  isMarker?: boolean;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatTimeD(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, "0")}`;
}

function formatTimeFull(s: number) {
  const m = Math.floor(s / 60);
  const secStr = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${secStr}`;
}

// Returns true for section header lines like [Verse 1], [Điệp khúc], [Chorus], etc.
// These should not be sent to Gemini as lyric lines to timestamp.
/** Parse "2:30" or "150" → seconds */
function parseCutPoint(s: string): number {
  const t = s.trim();
  if (t.includes(":")) {
    const [m, sec] = t.split(":").map(Number);
    return (m || 0) * 60 + (sec || 0);
  }
  return parseFloat(t) || 0;
}
/** Seconds → "M:SS" */
function fmtCutSecs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isSectionMarker(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Bracketed labels: [anything], [[anything]], (anything)
  if (/^\[.{1,60}\]$/.test(t) || /^\(.{1,60}\)$/.test(t)) return true;
  // Bare section names (optionally followed by a number)
  if (/^(verse|chorus|bridge|intro|outro|pre-chorus|pre chorus|hook|rap|drop|interlude|coda|refrain|tag|break|instrumental|solo|ad[- ]?lib|build|skit|điệp khúc|phiên khúc|đoạn|lời|cầu nối)\s*[\d]*$/i.test(t)) return true;
  return false;
}

const EXPORT_QUALITY = {
  fast:   { W: 854,  H: 480,  vbr: 2_000_000, abr:  96_000 },
  normal: { W: 1280, H: 720,  vbr: 5_000_000, abr: 128_000 },
  high:   { W: 1920, H: 1080, vbr: 8_000_000, abr: 192_000 },
} as const;
type ExportQuality = keyof typeof EXPORT_QUALITY;

function fmtEta(secs: number): string {
  if (secs < 4) return "";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `~${m}m${s}s` : `~${s}s`;
}

const DEFAULT_PROMPT = `You are an expert music lyrics transcription assistant.

Your task is to listen to the ENTIRE audio file continuously from 0:00 until the final second and produce a complete timestamped transcript of ALL sung vocals.

OUTPUT FORMAT:
Return ONLY a valid JSON array.
No markdown.
No explanations.
No comments.

Each item:
{
"text": "<exact sung lyric>",
"start": <seconds>,
"end": <seconds>
}

TIMESTAMP RULES:

* Use seconds with 1 decimal precision
* "start" = exact moment the vocal begins
* "end" = exact moment the vocal fully stops
* NEVER use the next line's timestamp as the previous line's end
* Every line duration should usually be between 1.0 and 7.0 seconds
* NEVER exceed 10 seconds for one line
* Split long phrases naturally at breaths

CRITICAL AUDIO SCANNING RULES:

1. PROCESS AUDIO SEQUENTIALLY
   You MUST scan the audio in chronological order without skipping ahead.
   Move second-by-second through the song from beginning to end.

2. NEVER JUMP ACROSS INSTRUMENTALS
   If there is an instrumental section:

* DO NOT skip forward blindly
* Continue monitoring the audio during the instrumental
* Detect the EXACT timestamp where vocals return
* Resume transcription immediately when singing starts again

3. FORBIDDEN BEHAVIOR
   DO NOT:

* jump from one vocal section to another
* assume the song ended
* skip silent gaps
* skip musical breaks
* stop after finding repeated choruses

4. VOCAL RE-ENTRY DETECTION
   During instrumental sections:

* continuously listen for re-entry of vocals
* detect humming, soft vocals, adlibs, harmonies, layered vocals
* the moment vocals return, create a new lyric entry immediately

5. REPEATED LYRICS
   If lyrics repeat later:

* include them AGAIN with completely new timestamps
* NEVER reuse timestamps from earlier choruses

6. MONOTONIC TIMESTAMPS
   Every new line must satisfy:
   new.start > previous.end

No overlaps.
No duplicate timestamps.

7. DO NOT TRUNCATE
   The transcript must continue until the actual end of the audio file.
   Do not stop early even if structure repeats.

8. FINAL VALIDATION BEFORE OUTPUT
   Before generating JSON:

* confirm the last lyric timestamp occurs near the actual end of the song
* confirm no large unexplained timestamp gaps exist
* if a gap exceeds 20 seconds, verify it is truly instrumental
* verify repeated choruses are all included
* verify timestamps remain chronological

9. UNCLEAR VOCALS
   If a lyric is difficult to hear:

* transcribe the closest phonetic approximation
* NEVER leave text empty
* NEVER omit a vocal line

REFERENCE LYRICS (for alignment only — actual audio takes priority):
[PASTE OFFICIAL LYRICS HERE]`.trim();

// ── Word-by-word coloring helpers ─────────────────────────────────────────────
// CSS mask-image gradients bleed across wrapped lines because they apply to the
// element bounding box, not per text row. Word-by-word span coloring avoids this.

function getWordLitStyle(s: { dot: string; current: React.CSSProperties }): React.CSSProperties {
  // Fire/gradient styles use background-clip which breaks per-span; fall back to dot color
  if ("background" in s.current || "WebkitBackgroundClip" in s.current) {
    return {
      color: s.dot,
      textShadow: `0 0 18px ${s.dot}cc,0 0 36px ${s.dot}66,0 2px 0 rgba(0,0,0,0.55)`,
    };
  }
  return s.current;
}

function KaraokeText({ text, progress, style, fontSize }: {
  text: string;
  progress: number;
  style: { dot: string; current: React.CSSProperties };
  fontSize: string;
}) {
  const litStyle = getWordLitStyle(style);
  const segs = text.split(/(\s+)/);
  const total = segs.filter(s => s.trim()).reduce((n, w) => n + w.length, 0);
  let soFar = 0;
  return (
    <p style={{ fontSize, fontWeight: 700, letterSpacing: "0.015em", lineHeight: 1.35, textAlign: "center" }}>
      {segs.map((seg, i) => {
        if (!seg.trim()) return <span key={i}>{seg}</span>;
        const mid = (soFar + seg.length / 2) / total;
        soFar += seg.length;
        return (
          <span key={i} style={progress >= mid ? litStyle : { color: "rgba(255,255,255,0.28)" }}>
            {seg}
          </span>
        );
      })}
    </p>
  );
}

function WipeText({ text, wipeProgress, style, fontSize }: {
  text: string;
  wipeProgress: number;
  style: { dot: string; current: React.CSSProperties };
  fontSize: string;
}) {
  const litStyle = getWordLitStyle(style);
  const segs = text.split(/(\s+)/);
  const total = segs.filter(s => s.trim()).reduce((n, w) => n + w.length, 0);
  let soFar = 0;
  return (
    <p style={{ fontSize, fontWeight: 700, letterSpacing: "0.015em", lineHeight: 1.35, textAlign: "center" }}>
      {segs.map((seg, i) => {
        if (!seg.trim()) return <span key={i}>{seg}</span>;
        const mid = (soFar + seg.length / 2) / total;
        soFar += seg.length;
        return (
          <span
            key={i}
            style={wipeProgress >= mid
              ? { color: "transparent", textShadow: "none" }
              : litStyle}
          >
            {seg}
          </span>
        );
      })}
    </p>
  );
}

/** Shared canvas draw helper — called by both WebM and MP4 export */
function drawLyricFrame(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  time: number,
  lines: LyricLine[],
  coverImg: HTMLImageElement | null,
  styleColors: { fill: string; glow: string },
  effect: string,
  fontSizePct: number,
  prerollSec = 0,
  ep: EffectParams = DEFAULT_EFFECT_PARAMS,
) {
  const WIPE_HOLD = ep.wipeHold;
  ctx.clearRect(0, 0, W, H);

  // ── Background ──────────────────────────────────────────────
  if (coverImg) {
    const bgPad = Math.round(60 * H / 720);
    ctx.save();
    ctx.filter = `blur(${Math.round(22 * H / 720)}px) brightness(0.3) saturate(1.5)`;
    ctx.drawImage(coverImg, -bgPad, -bgPad, W + bgPad * 2, H + bgPad * 2);
    ctx.filter = "none";
    ctx.restore();
    const sc = Math.min(W / coverImg.naturalWidth, H / coverImg.naturalHeight);
    const cw = coverImg.naturalWidth * sc, ch = coverImg.naturalHeight * sc;
    ctx.drawImage(coverImg, (W - cw) / 2, (H - ch) / 2, cw, ch);
  } else {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#1a0533"); bg.addColorStop(0.5, "#0d1b3e"); bg.addColorStop(1, "#050d1a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  }
  const ov = ctx.createLinearGradient(0, H * 0.45, 0, H);
  ov.addColorStop(0, "rgba(0,0,0,0)"); ov.addColorStop(1, "rgba(0,0,0,0.9)");
  ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H);

  // ── Find active line (with optional pre-roll look-ahead) ─────
  const lookAhead = time + prerollSec;
  let curIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lookAhead >= lines[i].start) {
      curIdx = i;
      if (lookAhead < lines[i].end) break;
    }
  }
  if (curIdx < 0) return;

  const cLine = lines[curIdx];
  const lineDur = Math.max(0.001, cLine.end - cLine.start);
  // lineElapsed is always from actual start — so during pre-roll period lp = 0 (dim/static)
  const lineElapsed = Math.max(0, time - cLine.start);
  const lp = Math.min(1, lineElapsed / lineDur);
  const wp = lineDur > WIPE_HOLD
    ? Math.max(0, Math.min(1, (lineElapsed - WIPE_HOLD) / (lineDur - WIPE_HOLD)))
    : lp;

  // Scale factor — keeps all pixel values proportional across 480p/720p/1080p
  const S = H / 720;
  const baseFontPx = Math.round(54 * S * fontSizePct / 100);
  const textY = H - Math.round(40 * S);
  const shadowBlur = Math.round(28 * S);
  ctx.save();
  ctx.font = `bold ${baseFontPx}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  if (effect === "karaoke") {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, lp * W, H); ctx.clip();
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = Math.round(30 * S);
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.restore();
  } else if (effect === "fade") {
    ctx.globalAlpha = Math.max(0, 1 - wp * ep.fadeSpeed);
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
  } else if (effect === "blur") {
    const blurPx = (wp * ep.blurAmount * S).toFixed(1);
    ctx.filter = `blur(${blurPx}px)`;
    ctx.globalAlpha = Math.max(0, 1 - wp * 0.85);
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.filter = "none";
  } else if (effect === "wave") {
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    const wW = W * 0.72, wX0 = (W - W * 0.72) / 2;
    const wY = textY + Math.round(18 * S), amp = ep.waveAmp * S, cycles = ep.waveCycles;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, wX0 + wW * lp, H); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(wX0, wY);
    for (let x = 0; x <= wW; x++) {
      ctx.lineTo(wX0 + x, wY + Math.sin((x / wW) * Math.PI * 2 * cycles) * amp);
    }
    ctx.strokeStyle = styleColors.fill; ctx.shadowColor = styleColors.glow; ctx.shadowBlur = Math.round(14 * S);
    ctx.lineWidth = Math.max(1.5, 3.5 * S); ctx.lineCap = "round"; ctx.stroke();
    ctx.restore();
  } else {
    // wipe: clip right portion, hold 1.5 s first
    ctx.save();
    ctx.beginPath(); ctx.rect(wp * W, 0, W * (1 - wp), H); ctx.clip();
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = shadowBlur;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Analyze audio file and return N best cut points (in seconds):
 *   cuts[0]       = intro end   → first lyric starts here
 *   cuts[1..N-1]  = inter-lyric boundaries
 *
 * This ensures lyrics never appear before the intro ends.
 */
async function findBestCutPoints(file: File, numCuts: number): Promise<number[]> {
  if (numCuts <= 0) return [];

  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  let buffer: AudioBuffer;
  try {
    buffer = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    audioCtx.close();
  }

  const data = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const totalDuration = buffer.duration;
  const hopMs = 50; // 50ms frames
  const hopSamples = Math.floor((sr * hopMs) / 1000);
  const frames = Math.floor(data.length / hopSamples);

  // 1. Compute RMS energy per frame
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hopSamples;
    const end = Math.min(start + hopSamples, data.length);
    for (let i = start; i < end; i++) sum += data[i] * data[i];
    energy[f] = Math.sqrt(sum / (end - start));
  }

  // 2. Smooth with a 300ms moving average
  const smoothWin = Math.max(1, Math.round(300 / hopMs));
  const smoothed = new Float32Array(frames);
  let runSum = 0;
  for (let i = 0; i < Math.min(smoothWin, frames); i++) runSum += energy[i];
  for (let f = 0; f < frames; f++) {
    const lo = f - Math.floor(smoothWin / 2);
    const hi = lo + smoothWin;
    if (f > 0) {
      if (lo - 1 >= 0) runSum -= energy[lo - 1];
      if (hi - 1 < frames) runSum += energy[hi - 1];
    }
    smoothed[f] = runSum / smoothWin;
  }

  // 3. Find local minima — no guard at the start so we can detect the intro end
  //    (allow from frame 1 so even an early dip counts as intro boundary)
  const contextFrames = Math.max(3, Math.round(400 / hopMs)); // 400ms context
  const endGuard = Math.floor(frames * 0.03);

  const minima: { frame: number; score: number }[] = [];
  for (let f = contextFrames; f < frames - endGuard - contextFrames; f++) {
    let isMin = true;
    for (let d = 1; d <= contextFrames; d++) {
      if (smoothed[f] > smoothed[f - d] || smoothed[f] > smoothed[f + d]) {
        isMin = false;
        break;
      }
    }
    if (!isMin) continue;

    const leftPeak = Math.max(...Array.from(smoothed.slice(Math.max(0, f - contextFrames * 3), f)));
    const rightPeak = Math.max(...Array.from(smoothed.slice(f + 1, Math.min(frames, f + contextFrames * 3 + 1))));
    const surroundPeak = Math.max(leftPeak, rightPeak);
    if (surroundPeak === 0) continue;

    const score = 1 - smoothed[f] / surroundPeak;
    if (score > 0.05) minima.push({ frame: f, score });
  }

  // 4. Also detect the audio onset — the first frame where sustained energy rises
  //    above the noise floor. This anchors the intro-end search.
  const sorted10 = Array.from(smoothed).sort((a, b) => a - b);
  const noiseFloor = sorted10[Math.floor(frames * 0.1)];
  const maxE = sorted10[frames - 1];
  const onsetThresh = noiseFloor + (maxE - noiseFloor) * 0.15;
  const sustainFrames = Math.round(400 / hopMs);
  let audioOnsetFrame = 0;
  for (let f = 0; f < frames - sustainFrames; f++) {
    if (smoothed[f] >= onsetThresh) {
      let ok = true;
      for (let d = 1; d < sustainFrames; d++) {
        if (smoothed[f + d] < onsetThresh * 0.4) { ok = false; break; }
      }
      if (ok) { audioOnsetFrame = f; break; }
    }
  }

  // 5. Cluster-aware selection
  minima.sort((a, b) => b.score - a.score);
  const minGapFrames = Math.round(1000 / hopMs); // min 1s between cuts

  const selected: { frame: number; score: number }[] = [];
  for (const m of minima) {
    if (selected.length >= numCuts) break;
    const tooClose = selected.some((s) => Math.abs(s.frame - m.frame) < minGapFrames);
    if (!tooClose) selected.push(m);
  }

  // 6. Fill missing cuts with even spacing
  if (selected.length < numCuts) {
    const evenStep = totalDuration / (numCuts + 1);
    for (let i = 1; selected.length < numCuts; i++) {
      const t = i * evenStep;
      const frame = Math.round((t / totalDuration) * frames);
      const tooClose = selected.some(
        (s) => Math.abs((s.frame / frames) * totalDuration - t) < 1.0
      );
      if (!tooClose) selected.push({ frame, score: 0 });
    }
  }

  selected.sort((a, b) => a.frame - b.frame);
  const times = selected.map((s) => (s.frame / frames) * totalDuration);

  // 7. Ensure cuts[0] (intro end) is at or after the audio onset.
  //    If the first detected cut is before the onset, replace it with the onset time.
  const onsetTime = (audioOnsetFrame / frames) * totalDuration;
  if (times.length > 0 && times[0] < onsetTime) {
    times[0] = onsetTime;
    // Re-sort in case this pushed it past times[1]
    times.sort((a, b) => a - b);
  }

  return times;
}

// ─── Lyric effect presets ───────────────────────────────────────────────────
const LYRIC_EFFECTS = [
  { id: "wipe",     label: "Xóa trái→phải" },
  { id: "fade",     label: "Mờ dần"        },
  { id: "blur",     label: "Nhòe dần"      },
  { id: "karaoke",  label: "Karaoke"       },
  { id: "wave",     label: "Gạch sóng"    },
] as const;
type LyricEffectId = (typeof LYRIC_EFFECTS)[number]["id"];

type EffectParams = {
  wipeHold: number;    // wipe: seconds to hold before sweeping (0–3, default 1.5)
  fadeSpeed: number;   // fade: multiplier on fade rate (0.5–3, default 1.0)
  blurAmount: number;  // blur: max blur px (4–30, default 14)
  waveAmp: number;     // wave: amplitude px (3–20, default 9)
  waveCycles: number;  // wave: number of cycles (2–12, default 6)
};
const DEFAULT_EFFECT_PARAMS: EffectParams = {
  wipeHold: 1.5,
  fadeSpeed: 1.0,
  blurAmount: 14,
  waveAmp: 9,
  waveCycles: 6,
};

function generateWaveSVGPath(cycles: number, amp: number): string {
  const W = 400; const midY = 25;
  let d = `M 0 ${midY}`;
  for (let i = 1; i <= 120; i++) {
    const x = (i / 120) * W;
    const y = midY + Math.sin((i / 120) * Math.PI * 2 * cycles) * amp;
    d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

// ─── Lyric style presets ────────────────────────────────────────────────────
const LYRIC_STYLES = [
  {
    id: "purple",
    label: "Tím sáng",
    dot: "#c4b5fd",
    current: {
      color: "#F2EEFF",
      textShadow:
        "0 2px 0 rgba(0,0,0,0.55),-1px -1px 0 rgba(0,0,0,0.4),1px -1px 0 rgba(0,0,0,0.4),-1px 1px 0 rgba(0,0,0,0.4),1px 1px 0 rgba(0,0,0,0.4),0 0 35px rgba(150,110,255,0.75),0 0 65px rgba(150,110,255,0.35)",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(210,198,255,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(150,110,255,${(g * 0.55).toFixed(2)})`,
    }),
  },
  {
    id: "gold",
    label: "Vàng kim",
    dot: "#FFD700",
    current: {
      color: "#FFD700",
      textShadow:
        "0 2px 0 rgba(0,0,0,0.55),-1px -1px 0 rgba(0,0,0,0.4),1px -1px 0 rgba(0,0,0,0.4),-1px 1px 0 rgba(0,0,0,0.4),1px 1px 0 rgba(0,0,0,0.4),0 0 30px rgba(255,180,0,0.9),0 0 60px rgba(255,120,0,0.4)",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(255,220,120,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(255,180,0,${(g * 0.6).toFixed(2)})`,
    }),
  },
  {
    id: "fire",
    label: "Lửa đỏ",
    dot: "#FF6B35",
    current: {
      background: "linear-gradient(to right, #FF4500, #FF8C00, #FFD700)",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent",
      backgroundClip: "text",
      filter: "drop-shadow(0 0 12px rgba(255,80,0,0.8)) drop-shadow(0 2px 4px rgba(0,0,0,0.6))",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(255,160,50,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(255,80,0,${(g * 0.7).toFixed(2)})`,
    }),
  },
  {
    id: "ice",
    label: "Băng xanh",
    dot: "#7DF9FF",
    current: {
      color: "#7DF9FF",
      textShadow:
        "0 2px 0 rgba(0,0,0,0.55),-1px -1px 0 rgba(0,0,0,0.4),1px -1px 0 rgba(0,0,0,0.4),-1px 1px 0 rgba(0,0,0,0.4),1px 1px 0 rgba(0,0,0,0.4),0 0 30px rgba(100,240,255,0.9),0 0 60px rgba(50,180,255,0.5)",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(100,230,255,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(0,200,255,${(g * 0.65).toFixed(2)})`,
    }),
  },
  {
    id: "rose",
    label: "Hồng đào",
    dot: "#FF80B5",
    current: {
      color: "#FF80B5",
      textShadow:
        "0 2px 0 rgba(0,0,0,0.55),-1px -1px 0 rgba(0,0,0,0.4),1px -1px 0 rgba(0,0,0,0.4),-1px 1px 0 rgba(0,0,0,0.4),1px 1px 0 rgba(0,0,0,0.4),0 0 30px rgba(255,80,150,0.9),0 0 60px rgba(255,0,100,0.4)",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(255,160,190,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(255,80,150,${(g * 0.65).toFixed(2)})`,
    }),
  },
  {
    id: "green",
    label: "Xanh neon",
    dot: "#69FF47",
    current: {
      color: "#69FF47",
      textShadow:
        "0 2px 0 rgba(0,0,0,0.55),-1px -1px 0 rgba(0,0,0,0.4),1px -1px 0 rgba(0,0,0,0.4),-1px 1px 0 rgba(0,0,0,0.4),1px 1px 0 rgba(0,0,0,0.4),0 0 30px rgba(80,255,50,0.9),0 0 60px rgba(50,200,0,0.5)",
    } as React.CSSProperties,
    next: (g: number): React.CSSProperties => ({
      color: "rgba(130,255,100,1)",
      textShadow: `0 1px 10px rgba(0,0,0,0.85),0 0 ${Math.round(g * 28)}px rgba(80,255,50,${(g * 0.65).toFixed(2)})`,
    }),
  },
] as const;
type LyricStyleId = (typeof LYRIC_STYLES)[number]["id"];

export default function App() {
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState<string>(() => {
    try { return localStorage.getItem("lv_songTitle") ?? ""; } catch { return ""; }
  });
  const [editingTitle, setEditingTitle] = useState(false);
  const [lyricsText, setLyricsText] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem("lv_lyricsText") ?? '""') as string; } catch { return ""; }
  });
  const [lyricsLines, setLyricsLines] = useState<LyricLine[]>(() => {
    try { return JSON.parse(localStorage.getItem("lv_lyricsLines") ?? "[]") as LyricLine[]; } catch { return []; }
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [transcribeFromCache, setTranscribeFromCache] = useState(false);
  const [cacheClearedFlash, setCacheClearedFlash] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showLyrics, setShowLyrics] = useState(true);
  const [fixRequest, setFixRequest] = useState("");
  const [isFixing, setIsFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [splitParts, setSplitParts] = useState<1 | 2 | 3>(1);
  const [splitCutInputs, setSplitCutInputs] = useState<string[]>([]);
  const [splitProgress, setSplitProgress] = useState<{ current: number; total: number } | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>(() =>
    localStorage.getItem("lv_customPrompt") ?? DEFAULT_PROMPT
  );
  const [lyricEffect, setLyricEffect] = useState<LyricEffectId>(() => {
    const saved = localStorage.getItem("lv_lyricEffect");
    return (saved && ["fade", "slide", "pop", "wipe", "karaoke", "wave"].includes(saved) ? saved : "wipe") as LyricEffectId;
  });
  const [effectParams, setEffectParams] = useState<EffectParams>(() => {
    try {
      return { ...DEFAULT_EFFECT_PARAMS, ...JSON.parse(localStorage.getItem("lv_effectParams") ?? "{}") } as EffectParams;
    } catch { return DEFAULT_EFFECT_PARAMS; }
  });
  const setEp = (key: keyof EffectParams, val: number) =>
    setEffectParams((prev) => ({ ...prev, [key]: val }));
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null);
  const [editingTimeVal, setEditingTimeVal] = useState("");
  const [editingTimeSide, setEditingTimeSide] = useState<"start" | "end">("start");
  const [editingDurIdx, setEditingDurIdx] = useState<number | null>(null);
  const [editingDurVal, setEditingDurVal] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"webm" | "mkv" | "mov">("webm");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportQuality, setExportQuality] = useState<ExportQuality>(() => {
    return (localStorage.getItem("lv_exportQuality") as ExportQuality | null) ?? "normal";
  });
  const [exportEta, setExportEta] = useState("");
  const exportStartRef = useRef<number>(0);
  const [lyricStyleId, setLyricStyleId] = useState<LyricStyleId>(() => {
    const saved = localStorage.getItem("lv_lyricStyleId");
    return (saved && ["purple", "gold", "cyan", "rose", "green", "white"].includes(saved) ? saved : "purple") as LyricStyleId;
  });
  const [lyricFontSize, setLyricFontSize] = useState<number>(() => {
    const saved = parseInt(localStorage.getItem("lv_lyricFontSize") ?? "", 10);
    return isNaN(saved) ? 100 : Math.min(180, Math.max(60, saved));
  });
  const [prerollSeconds, setPrerollSeconds] = useState<number>(() => {
    const saved = parseFloat(localStorage.getItem("lv_prerollSeconds") ?? "");
    return isNaN(saved) ? 1.0 : Math.min(3, Math.max(0, saved));
  });

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const lyricsViewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!waveformRef.current || !audioUrl) return;

    if (wavesurferRef.current) {
      wavesurferRef.current.destroy();
      wavesurferRef.current = null;
    }

    setIsReady(false);
    setCurrentTime(0);
    setIsPlaying(false);

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: "rgba(255,255,255,0.15)",
      progressColor: "rgba(168,85,247,0.8)",
      cursorColor: "rgba(255,255,255,0.6)",
      cursorWidth: 2,
      height: 56,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
    });

    ws.load(audioUrl);

    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsReady(true);
    });

    ws.on("timeupdate", (time: number) => {
      setCurrentTime(time);
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("finish", () => setIsPlaying(false));

    wavesurferRef.current = ws;
    return () => { ws.destroy(); };
  }, [audioUrl]);

  // Derived value — computed synchronously during render, no setState loop possible.
  const currentLineIndex = useMemo(() => {
    if (!lyricsLines.length) return -1;
    const lookAhead = currentTime + prerollSeconds;
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (lyricsLines[i].isMarker) continue; // section headers never become active
      if (lookAhead >= lyricsLines[i].start) {
        idx = i;
        if (lookAhead < lyricsLines[i].end) break;
      }
    }
    if (idx >= 0 && currentTime > lyricsLines[idx].end) {
      // Look for the next non-marker line
      let nextStart = Infinity;
      for (let j = idx + 1; j < lyricsLines.length; j++) {
        if (!lyricsLines[j].isMarker) { nextStart = lyricsLines[j].start - prerollSeconds; break; }
      }
      if (nextStart - currentTime > 4.0) idx = -1;
    }
    return idx;
  }, [currentTime, lyricsLines, prerollSeconds]);

  useEffect(() => {
    if (!lyricsViewRef.current || currentLineIndex < 0) return;
    const el = lyricsViewRef.current.querySelector<HTMLElement>(`[data-line="${currentLineIndex}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentLineIndex]);

  // ── Auto-save session to localStorage ────────────────────────────────
  useEffect(() => { localStorage.setItem("lv_lyricsText", JSON.stringify(lyricsText)); }, [lyricsText]);
  useEffect(() => { localStorage.setItem("lv_lyricsLines", JSON.stringify(lyricsLines)); }, [lyricsLines]);
  useEffect(() => { localStorage.setItem("lv_lyricEffect", lyricEffect); }, [lyricEffect]);
  useEffect(() => { localStorage.setItem("lv_effectParams", JSON.stringify(effectParams)); }, [effectParams]);
  useEffect(() => { localStorage.setItem("lv_lyricStyleId", lyricStyleId); }, [lyricStyleId]);
  useEffect(() => { localStorage.setItem("lv_lyricFontSize", String(lyricFontSize)); }, [lyricFontSize]);
  useEffect(() => { localStorage.setItem("lv_prerollSeconds", String(prerollSeconds)); }, [prerollSeconds]);
  useEffect(() => { localStorage.setItem("lv_customPrompt", customPrompt); }, [customPrompt]);
  // Auto-populate cut inputs when splitParts or duration changes
  useEffect(() => {
    if (splitParts <= 1) { setSplitCutInputs([]); return; }
    const n = splitParts;
    setSplitCutInputs(
      Array.from({ length: n - 1 }, (_, i) =>
        duration > 0 ? fmtCutSecs(duration * (i + 1) / n) : ""
      )
    );
  }, [splitParts, duration]);

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (coverImage) URL.revokeObjectURL(coverImage);
    setCoverImage(URL.createObjectURL(file));
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setLyricsLines([]);
    const derived = file.name.replace(/\.[^/.]+$/, "");
    setSongTitle(derived);
    try { localStorage.setItem("lv_songTitle", derived); } catch { /* ignore */ }
  };

  // Re-insert section markers into a timed lyric array at their original positions.
  // timedLyrics must have exactly allInputLines.filter(!isSectionMarker).length entries.
  const reinsertMarkers = (allInputLines: string[], timedLyrics: { text: string; start: number; end: number }[]): LyricLine[] => {
    const result: LyricLine[] = [];
    let lyricIdx = 0;
    for (const text of allInputLines) {
      if (isSectionMarker(text)) {
        // Borrow time from the NEXT real lyric (or the last one we've placed)
        const t = timedLyrics[lyricIdx]?.start ?? timedLyrics[lyricIdx - 1]?.end ?? 0;
        result.push({ text, start: t, end: t, isMarker: true });
      } else {
        if (lyricIdx < timedLyrics.length) {
          result.push({ ...timedLyrics[lyricIdx], isMarker: false });
          lyricIdx++;
        }
      }
    }
    return result;
  };

  const handleAutoTimeline = async () => {
    if (!audioFile || !duration || !lyricsText.trim()) return;

    const allInputLines = lyricsText.split("\n").map((l) => l.trim()).filter(Boolean);
    const lines = allInputLines.filter((l) => !isSectionMarker(l));
    if (!lines.length) return;

    setIsAnalyzing(true);
    setLyricsLines([]);

    try {
      const cuts = await findBestCutPoints(audioFile, lines.length);
      const boundaries = [...cuts, duration];
      const timedLyrics = lines.map((text, i) => ({
        text,
        start: boundaries[i],
        end: boundaries[i + 1] ?? duration,
      }));
      setLyricsLines(reinsertMarkers(allInputLines, timedLyrics));
    } catch {
      const introEnd = duration * 0.1;
      const step = (duration - introEnd) / lines.length;
      const timedLyrics = lines.map((text, i) => ({
        text,
        start: introEnd + i * step,
        end: introEnd + (i + 1) * step,
      }));
      setLyricsLines(reinsertMarkers(allInputLines, timedLyrics));
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Downsample WAV to 16 kHz mono before sending to AI.
  // 16 kHz mono is the standard for speech/lyrics recognition — perfectly sufficient
  // for Gemini. A 44.1 kHz stereo WAV shrinks ~90% this way.
  const downsampleWavFile = async (file: File): Promise<File> => {
    const TARGET_SR = 16_000;
    const arrayBuf = await file.arrayBuffer();
    const ctx = new AudioContext();
    let audioBuf: AudioBuffer;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf);
    } finally {
      await ctx.close();
    }
    // Already small enough — skip
    if (audioBuf.sampleRate <= TARGET_SR && audioBuf.numberOfChannels === 1) return file;

    // Resample + mix down to mono via OfflineAudioContext
    const targetLen = Math.ceil(audioBuf.duration * TARGET_SR);
    const offCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(offCtx.destination);
    src.start();
    const resampled = await offCtx.startRendering();
    const pcm = resampled.getChannelData(0);

    // Encode as minimal 16-bit PCM WAV
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true);
    w(8, "WAVE"); w(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, TARGET_SR, true); v.setUint32(28, TARGET_SR * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    w(36, "data"); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++)
      v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);

    const compressed = new File([buf], file.name.replace(/\.wav$/i, "_16k.wav"), { type: "audio/wav" });
    return compressed;
  };

  // Decode audio → 16 kHz mono, slice into numParts equal PCM segments, encode each as WAV.
  // Returns [{file, offset}] where offset is the start time (seconds) of each part.
  // cutPointsSecs: sorted list of cut times in seconds, e.g. [90, 180] → 3 segments
  const splitDecodeAudio = async (
    file: File,
    cutPointsSecs: number[]
  ): Promise<Array<{ file: File; offset: number }>> => {
    const TARGET_SR = 16_000;
    const arrayBuf = await file.arrayBuffer();
    const ctx = new AudioContext();
    let audioBuf: AudioBuffer;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf);
    } finally {
      await ctx.close();
    }
    const totalSamples = Math.ceil(audioBuf.duration * TARGET_SR);
    const offCtx = new OfflineAudioContext(1, totalSamples, TARGET_SR);
    const src = offCtx.createBufferSource();
    src.buffer = audioBuf;
    src.connect(offCtx.destination);
    src.start();
    const resampled = await offCtx.startRendering();
    const pcmFull = resampled.getChannelData(0);

    // Encode PCM slice as WebM/Opus — Gemini reads timestamps reliably from WebM (WAV causes near-zero collapse)
    const encodeWebM = async (pcm: Float32Array): Promise<ArrayBuffer> => {
      const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        audio: { codec: "A_OPUS", sampleRate: TARGET_SR, numberOfChannels: 1 },
        type: "webm",
      });
      let encodeError: Error | null = null;
      const encoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta!),
        error: (e) => { encodeError = e; },
      });
      encoder.configure({ codec: "opus", sampleRate: TARGET_SR, numberOfChannels: 1, bitrate: 64_000 });
      const FRAME = 320; // 20 ms at 16 kHz
      for (let s = 0; s < pcm.length; s += FRAME) {
        const n = Math.min(FRAME, pcm.length - s);
        const ad = new AudioData({
          format: "f32-planar",
          sampleRate: TARGET_SR,
          numberOfFrames: n,
          numberOfChannels: 1,
          timestamp: Math.round(s / TARGET_SR * 1_000_000),
          data: pcm.slice(s, s + n),
        });
        encoder.encode(ad);
        ad.close();
      }
      await encoder.flush();
      if (encodeError) throw encodeError;
      muxer.finalize();
      return target.buffer;
    };

    // Build sample boundaries: [0, cut1, cut2, ..., totalSamples]
    const boundaries = [
      0,
      ...cutPointsSecs.map((t) => Math.min(Math.round(t * TARGET_SR), totalSamples - 1)),
      totalSamples,
    ];
    const numParts = boundaries.length - 1;
    const parts: Array<{ file: File; offset: number }> = [];
    for (let i = 0; i < numParts; i++) {
      const startSample = boundaries[i];
      const endSample = boundaries[i + 1];
      const pcm = pcmFull.slice(startSample, endSample);
      const webmBuf = await encodeWebM(pcm);
      const partFile = new File([webmBuf], `part_${i + 1}of${numParts}.webm`, { type: "audio/webm" });
      parts.push({ file: partFile, offset: startSample / TARGET_SR });
    }
    return parts;
  };

  const getAudioCacheKey = (file: File) =>
    `lvg_transcribe_${file.name}_${file.size}_${file.lastModified}`;

  // Clamp all timestamps so nothing exceeds the actual audio duration.
  const clampLines = (lines: LyricLine[]): LyricLine[] => {
    if (!duration) return lines;
    return lines.map((l) => ({
      ...l,
      start: Math.min(l.start, duration),
      end:   Math.min(l.end,   duration),
    }));
  };

  const applyTranscribeResult = (
    geminiLines: { text: string; start: number; end: number }[],
    keepManual = false,
  ) => {
    if (keepManual) {
      const allInputLines = lyricsText.split("\n").map((l) => l.trim()).filter(Boolean);
      const lyricOnly = allInputLines.filter((l) => !isSectionMarker(l));

      // Best case: Gemini returned exactly one timestamp per lyric line (markers excluded)
      if (lyricOnly.length > 0 && geminiLines.length === lyricOnly.length) {
        const timedLyrics = lyricOnly.map((text, i) => ({
          text,
          start: geminiLines[i].start,
          end:   geminiLines[i].end,
        }));
        setLyricsLines(clampLines(reinsertMarkers(allInputLines, timedLyrics)));
        return;
      }

      // Fallback: distribute Gemini's time range proportionally across lyric lines
      if (lyricOnly.length > 0 && geminiLines.length > 0) {
        const rangeStart = geminiLines[0].start;
        const rangeEnd   = Math.min(geminiLines[geminiLines.length - 1].end, duration || Infinity);
        const totalDur   = Math.max(rangeEnd - rangeStart, lyricOnly.length * 2);
        const charLens   = lyricOnly.map((l) => Math.max(l.length, 1));
        const totalChars = charLens.reduce((a, b) => a + b, 0);
        let cumulative = 0;
        const timedLyrics = lyricOnly.map((text, i) => {
          const startFrac = cumulative / totalChars;
          cumulative += charLens[i];
          const endFrac = cumulative / totalChars;
          return {
            text,
            start: Math.round((rangeStart + startFrac * totalDur) * 10) / 10,
            end:   Math.round((rangeStart + endFrac   * totalDur) * 10) / 10,
          };
        });
        setLyricsLines(clampLines(reinsertMarkers(allInputLines, timedLyrics)));
        return;
      }
    }

    // "Nhận diện AI" mode: clamp Gemini timestamps to actual audio duration
    setLyricsText(geminiLines.map((l) => l.text).join("\n"));
    setLyricsLines(clampLines(geminiLines));
  };

  const handleAiTranscribe = async (forceRefresh = false, keepManual = false) => {
    if (!audioFile) return;
    keepManual ? setIsSyncing(true) : setIsTranscribing(true);
    setTranscribeError(null);
    setTranscribeFromCache(false);

    const cacheKey = getAudioCacheKey(audioFile);

    // Sync mode always calls the API fresh (lyrics-specific, can't reuse free-form cache)
    // Strip section markers — Gemini should only see singable lines
    const allInputLines = lyricsText.split("\n").map((l) => l.trim()).filter(Boolean);
    const lyricOnlyLines = allInputLines.filter((l) => !isSectionMarker(l));
    const useSyncMode = keepManual && lyricOnlyLines.length > 0;

    try {
      // Check cache first (unless force refresh or sync mode)
      if (!forceRefresh && !useSyncMode) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const lines = JSON.parse(cached) as { text: string; start: number; end: number }[];
          // Validate cached timestamps — if all near-zero, the cache is stale/corrupt; clear it
          const maxStart = lines.length > 0 ? Math.max(...lines.map((l) => l.start)) : 0;
          if (lines.length > 3 && maxStart < 1) {
            localStorage.removeItem(cacheKey);
            // Fall through to re-fetch
          } else {
            applyTranscribeResult(lines, keepManual);
            setTranscribeFromCache(true);
            return;
          }
        }
      }

      // ── Split mode: decode once → slice N parts → send sequentially → offset & merge ──
      if (splitParts > 1 && !useSyncMode) {
        const parsedCuts = splitCutInputs
          .map(parseCutPoint)
          .filter((t) => t > 0 && (!duration || t < duration))
          .sort((a, b) => a - b);
        const parts = await splitDecodeAudio(audioFile, parsedCuts);
        const allLines: { text: string; start: number; end: number }[] = [];
        for (let pi = 0; pi < parts.length; pi++) {
          setSplitProgress({ current: pi + 1, total: parts.length });
          const { file: partFile, offset } = parts[pi];
          const form = new FormData();
          form.append("audio", partFile, partFile.name);
          if (customPrompt.trim() !== DEFAULT_PROMPT.trim()) {
            form.append("customPrompt", customPrompt.trim());
          }
          const res = await fetch("/api/transcribe-audio", { method: "POST", body: form });
          if (!res.ok) {
            const errData = await res.json().catch(() => ({})) as { error?: string };
            throw new Error(errData.error ?? `HTTP ${res.status}`);
          }
          const data = await res.json() as { lines: { text: string; start: number; end: number }[] };
          const offsetLines = (data.lines ?? []).map((l) => ({
            text: l.text,
            start: +(l.start + offset).toFixed(1),
            end:   +(l.end   + offset).toFixed(1),
          }));
          allLines.push(...offsetLines);
        }
        setSplitProgress(null);
        if (!allLines.length) {
          setTranscribeError("AI không tìm thấy lời bài hát trong file này.");
          return;
        }
        allLines.sort((a, b) => a.start - b.start);
        applyTranscribeResult(allLines, keepManual);
        return;
      }

      // Compress WAV before upload: downsample to 16 kHz mono (~90% size reduction)
      const fileToSend = /\.wav$/i.test(audioFile.name) || audioFile.type === "audio/wav"
        ? await downsampleWavFile(audioFile)
        : audioFile;

      // Send audio as multipart/form-data (binary — smaller than base64, avoids proxy 413)
      const form = new FormData();
      form.append("audio", fileToSend, fileToSend.name);
      if (useSyncMode) {
        form.append("knownLyrics", JSON.stringify(lyricOnlyLines));
      } else {
        if (customPrompt.trim() !== DEFAULT_PROMPT.trim()) {
          form.append("customPrompt", customPrompt.trim());
        }
        // Always attach lyrics as hint so Gemini knows the expected words/spelling
        if (lyricOnlyLines.length > 0) {
          form.append("hintLyrics", JSON.stringify(lyricOnlyLines));
        }
      }

      const res = await fetch("/api/transcribe-audio", {
        method: "POST",
        body: form,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { lines: { text: string; start: number; end: number }[] };
      const lines = data.lines ?? [];

      if (!lines.length) {
        setTranscribeError("AI không tìm thấy lời bài hát trong file này.");
        return;
      }

      // Only cache if timestamps look valid (avoid persisting Gemini near-zero collapses)
      const maxStart = lines.length > 0 ? Math.max(...lines.map((l) => l.start)) : 0;
      if (!(lines.length > 3 && maxStart < 2)) {
        try { localStorage.setItem(cacheKey, JSON.stringify(lines)); } catch { /* quota exceeded — ignore */ }
      }
      applyTranscribeResult(lines, keepManual);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsTranscribing(false);
      setIsSyncing(false);
      setSplitProgress(null);
    }
  };

  const handleFixRequest = async () => {
    if (!audioFile || !fixRequest.trim() || lyricsLines.length === 0) return;
    setIsFixing(true);
    setFixError(null);
    try {
      const fileToSend = /\.wav$/i.test(audioFile.name) || audioFile.type === "audio/wav"
        ? await downsampleWavFile(audioFile)
        : audioFile;
      const currentLines = lyricsLines
        .filter((l) => !l.isMarker)
        .map((l) => ({ text: l.text, start: l.start, end: l.end }));
      const form = new FormData();
      form.append("audio", fileToSend, fileToSend.name);
      form.append("currentLyrics", JSON.stringify(currentLines));
      form.append("fixRequest", fixRequest.trim());
      const res = await fetch("/api/transcribe-audio", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { lines: { text: string; start: number; end: number }[] };
      applyTranscribeResult(data.lines, false);
      setFixRequest("");
    } catch (e) {
      setFixError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsFixing(false);
    }
  };

  const startEditLine = (i: number) => {
    setEditingLineIndex(i);
    setEditingText(lyricsLines[i].text);
  };

  const saveEditLine = () => {
    if (editingLineIndex === null) return;
    const updated = lyricsLines.map((l, i) =>
      i === editingLineIndex ? { ...l, text: editingText.trim() || l.text } : l
    );
    setLyricsLines(updated);
    setLyricsText(updated.map((l) => l.text).join("\n"));
    setEditingLineIndex(null);
  };

  const cancelEditLine = () => setEditingLineIndex(null);

  // ── Time editing: clicking start or end badge makes it an inline input ──────
  const startEditTime = (i: number, side: "start" | "end" = "start") => {
    setEditingTimeSide(side);
    setEditingTimeIdx(i);
    setEditingTimeVal(
      side === "start" ? lyricsLines[i].start.toFixed(2) : lyricsLines[i].end.toFixed(2)
    );
  };

  const saveEditTime = () => {
    if (editingTimeIdx === null) return;
    const newVal = parseFloat(editingTimeVal);
    if (!isNaN(newVal) && newVal >= 0) {
      setLyricsLines((prev) =>
        prev.map((l, i) => {
          if (editingTimeSide === "start") {
            if (i === editingTimeIdx) return { ...l, start: newVal };
            if (i === editingTimeIdx - 1) return { ...l, end: newVal }; // prev line's end adjusts
          } else {
            if (i === editingTimeIdx) return { ...l, end: newVal };
            if (i === editingTimeIdx + 1) return { ...l, start: newVal }; // next line's start adjusts
          }
          return l;
        })
      );
    }
    setEditingTimeIdx(null);
  };

  // Split a line into two halves at the nearest word boundary to the middle
  const splitLine = (i: number) => {
    const line = lyricsLines[i];
    const words = line.text.trim().split(/\s+/);
    if (words.length < 2) return; // nothing to split
    const mid = Math.ceil(words.length / 2);
    const firstHalf = words.slice(0, mid).join(" ");
    const secondHalf = words.slice(mid).join(" ");
    const midTime = (line.start + line.end) / 2;
    const newLines = [
      ...lyricsLines.slice(0, i),
      { ...line, text: firstHalf, end: midTime },
      { ...line, text: secondHalf, start: midTime },
      ...lyricsLines.slice(i + 1),
    ];
    setLyricsLines(newLines);
    setLyricsText(newLines.map((l) => l.text).join("\n"));
  };

  const deleteLine = (i: number) => {
    const newLines = lyricsLines.filter((_, idx) => idx !== i);
    setLyricsLines(newLines);
    setLyricsText(newLines.map((l) => l.text).join("\n"));
  };

  const handleClearCache = () => {
    const toDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("lvg_transcribe_")) toDelete.push(key);
    }
    toDelete.forEach((k) => localStorage.removeItem(k));
    setTranscribeFromCache(false);
    setCacheClearedFlash(true);
    setTimeout(() => setCacheClearedFlash(false), 2000);
  };

  // Canvas color map — one entry per lyric style id
  const CANVAS_COLORS: Record<LyricStyleId, { fill: string; glow: string }> = {
    purple: { fill: "#F2EEFF", glow: "rgba(150,110,255,0.85)" },
    gold:   { fill: "#FFD700", glow: "rgba(255,180,0,0.90)"  },
    fire:   { fill: "#FF7030", glow: "rgba(255,80,0,0.85)"   },
    ice:    { fill: "#7DF9FF", glow: "rgba(100,240,255,0.90)" },
    rose:   { fill: "#FF80B5", glow: "rgba(255,80,150,0.90)" },
    green:  { fill: "#69FF47", glow: "rgba(80,255,50,0.90)"  },
  };

  const handleExportTimeline = () => {
    if (!lyricsLines.length) return;
    const songName = audioFile?.name.replace(/\.[^.]+$/, "") ?? "timeline";
    const rows = lyricsLines.map(
      (l) => `${formatTimeFull(l.start)}\t${formatTimeFull(l.end)}\t${l.text}`
    );
    const header = [
      "# Lyrics Timeline Export",
      `# Bài: ${songName}`,
      "# Định dạng: bắt_đầu  kết_thúc  lời_ca",
      "# Thời gian: m:ss.s (vd: 0:43.0 = 43 giây)",
      "# Có thể sửa lời và thời gian, rồi Import lại.",
      "",
    ].join("\n");
    const content = header + rows.join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${songName}_timeline.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTimeline = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines: LyricLine[] = [];
      for (const raw of text.split("\n")) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const parts = line.split("\t");
        if (parts.length < 3) continue;
        const parseT = (s: string) => {
          const [min, sec] = s.trim().split(":").map(Number);
          return (min ?? 0) * 60 + (sec ?? 0);
        };
        const start = parseT(parts[0]);
        const end = parseT(parts[1]);
        const text2 = parts.slice(2).join("\t").trim();
        if (isNaN(start) || isNaN(end) || !text2) continue;
        lines.push({ start, end, text: text2 });
      }
      if (!lines.length) return;
      lines.sort((a, b) => a.start - b.start);
      setLyricsLines(lines);
      setLyricsText(lines.map((l) => l.text).join("\n"));
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  };

  // ── WebM / MKV export: offline rendering via WebCodecs + webm-muxer (VP9+Opus) ──
  const handleExportVideoWebm = async (fmt: "webm" | "mkv") => {
    if (!isReady || lyricsLines.length === 0) return;
    setExportError(null);

    if (typeof VideoEncoder === "undefined") {
      setExportError("Cần Chrome 94+ / Edge 94+ để xuất video.");
      return;
    }

    setExportingFormat(fmt);
    setIsExporting(true);
    setExportProgress(0);
    setExportEta("");
    exportStartRef.current = Date.now();

    try {
      const { W, H, vbr, abr } = EXPORT_QUALITY[exportQuality];
      const FPS = 30;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      const styleColors = CANVAS_COLORS[lyricStyleId] ?? CANVAS_COLORS.purple;
      const effect = lyricEffect;
      const fontPct = lyricFontSize;
      const preroll = prerollSeconds;
      const lines = lyricsLines.filter((l) => !l.isMarker);
      const totalDur = duration || (lines.length > 0 ? lines[lines.length - 1].end + 2 : 60);
      const totalFrames = Math.ceil(totalDur * FPS);

      let coverImg: HTMLImageElement | null = null;
      if (coverImage) {
        coverImg = new window.Image();
        coverImg.src = coverImage;
        await new Promise<void>((r) => { coverImg!.onload = () => r(); coverImg!.onerror = () => r(); });
      }

      const { Muxer, ArrayBufferTarget } = await import("webm-muxer");
      const target = new ArrayBufferTarget();
      const hasAudio = !!audioFile && typeof AudioEncoder !== "undefined";
      const muxer = new Muxer({
        target,
        video: { codec: "V_VP8", width: W, height: H, frameRate: FPS },
        ...(hasAudio ? { audio: { codec: "A_OPUS", sampleRate: 44100, numberOfChannels: 2 } } : {}),
        type: fmt === "mkv" ? "matroska" : "webm",
      });

      const hwCheckVP8 = await VideoEncoder.isConfigSupported({
        codec: "vp8", width: W, height: H, bitrate: vbr, framerate: FPS,
        hardwareAcceleration: "prefer-hardware",
      });
      const hwAccel: HardwareAcceleration = hwCheckVP8.supported ? "prefer-hardware" : "prefer-software";

      let videoEncoderError: Error | null = null;
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta!),
        error: (e) => { videoEncoderError = e; },
      });
      videoEncoder.configure({
        codec: "vp8",
        width: W, height: H,
        bitrate: vbr,
        framerate: FPS,
        latencyMode: "quality",
        hardwareAcceleration: hwAccel,
      });

      if (hasAudio && audioFile) {
        let audioEncoderError: Error | null = null;
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta!),
          error: (e) => { audioEncoderError = e; },
        });
        audioEncoder.configure({ codec: "opus", sampleRate: 44100, numberOfChannels: 2, bitrate: abr });

        const arrayBuf = await audioFile.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 44100 });
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        await audioCtx.close();

        const CHUNK = 4096;
        const numCh = Math.min(decoded.numberOfChannels, 2);
        for (let i = 0; i < decoded.length; i += CHUNK) {
          const n = Math.min(CHUNK, decoded.length - i);
          const data = new Float32Array(numCh * n);
          for (let ch = 0; ch < numCh; ch++) {
            const src = decoded.getChannelData(ch);
            for (let j = 0; j < n; j++) data[ch * n + j] = src[i + j];
          }
          const ad = new AudioData({
            format: "f32-planar", sampleRate: 44100,
            numberOfFrames: n, numberOfChannels: numCh,
            timestamp: Math.round(i / decoded.sampleRate * 1_000_000), data,
          });
          audioEncoder.encode(ad);
          ad.close();
        }
        await audioEncoder.flush();
        if (audioEncoderError) throw audioEncoderError;
      }

      for (let fi = 0; fi < totalFrames; fi++) {
        if (videoEncoderError) throw videoEncoderError;
        drawLyricFrame(ctx, W, H, fi / FPS, lines, coverImg, styleColors, effect, fontPct, preroll, effectParams);
        const vf = new VideoFrame(canvas, {
          timestamp: Math.round(fi / FPS * 1_000_000),
          duration: Math.round(1_000_000 / FPS),
        });
        videoEncoder.encode(vf, { keyFrame: fi % 90 === 0 });
        vf.close();
        if (fi % 30 === 0) {
          const prog = fi / totalFrames * 0.90;
          setExportProgress(prog);
          if (prog > 0.02) {
            const elapsed = (Date.now() - exportStartRef.current) / 1000;
            const remaining = elapsed / prog * (1 - prog);
            setExportEta(fmtEta(remaining));
          }
          await new Promise((r) => setTimeout(r, 0));
          if (videoEncoderError) throw videoEncoderError;
        }
      }

      setExportProgress(0.93);
      setExportEta("Đang flush...");
      await videoEncoder.flush();
      if (videoEncoderError) throw videoEncoderError;
      setExportProgress(0.99);
      setExportEta("Đang đóng gói...");
      muxer.finalize();
      setExportProgress(1.0);
      setExportEta("");
      await new Promise((r) => setTimeout(r, 200));

      const mimeType = fmt === "mkv" ? "video/x-matroska" : "video/webm";
      const blob = new Blob([target.buffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (audioFile?.name.replace(/\.[^/.]+$/, "") ?? "lyrics-video") + "." + fmt;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(`Xuất ${fmt.toUpperCase()} thất bại: ${msg.slice(0, 120)}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  // ── MOV export: offline rendering via WebCodecs + mp4-muxer (H.264+AAC) ──
  const handleExportVideoMov = async () => {
    if (!isReady || lyricsLines.length === 0) return;
    setExportError(null);

    if (typeof VideoEncoder === "undefined") {
      setExportError("Cần Chrome 94+ / Edge 94+ để xuất video.");
      return;
    }

    const CODEC_VIDEO = "avc1.42E01E"; // H.264 Baseline 3.0

    setExportingFormat("mov");
    setIsExporting(true);
    setExportProgress(0);
    setExportEta("");
    exportStartRef.current = Date.now();

    try {
      const { W, H, vbr, abr } = EXPORT_QUALITY[exportQuality];
      const FPS = 30;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;

      const styleColors = CANVAS_COLORS[lyricStyleId] ?? CANVAS_COLORS.purple;
      const effect = lyricEffect;
      const fontPct = lyricFontSize;
      const preroll = prerollSeconds;
      const lines = lyricsLines.filter((l) => !l.isMarker);
      const totalDur = duration || (lines.length > 0 ? lines[lines.length - 1].end + 2 : 60);
      const totalFrames = Math.ceil(totalDur * FPS);

      // Preload cover image
      let coverImg: HTMLImageElement | null = null;
      if (coverImage) {
        coverImg = new window.Image();
        coverImg.src = coverImage;
        await new Promise<void>((r) => { coverImg!.onload = () => r(); coverImg!.onerror = () => r(); });
      }

      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      const target = new ArrayBufferTarget();
      const hasAudio = !!audioFile && typeof AudioEncoder !== "undefined";
      const muxer = new Muxer({
        target,
        video: { codec: "avc", width: W, height: H },
        ...(hasAudio ? { audio: { codec: "aac", sampleRate: 44100, numberOfChannels: 2 } } : {}),
        fastStart: "in-memory",
      });

      const hwCheckH264 = await VideoEncoder.isConfigSupported({
        codec: CODEC_VIDEO, width: W, height: H, bitrate: vbr, framerate: FPS,
        hardwareAcceleration: "prefer-hardware",
      });
      const hwAccel: HardwareAcceleration = hwCheckH264.supported ? "prefer-hardware" : "prefer-software";

      // VideoEncoder
      let videoEncoderError: Error | null = null;
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta!),
        error: (e) => { videoEncoderError = e; },
      });
      videoEncoder.configure({
        codec: CODEC_VIDEO,
        width: W, height: H,
        bitrate: vbr,
        framerate: FPS,
        latencyMode: "quality",
        hardwareAcceleration: hwAccel,
      });

      // Audio: decode + encode before video frames
      if (hasAudio && audioFile) {
        let audioEncoderError: Error | null = null;
        const audioEncoder = new AudioEncoder({
          output: (chunk, meta) => muxer.addAudioChunk(chunk, meta!),
          error: (e) => { audioEncoderError = e; },
        });
        audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate: abr });

        const arrayBuf = await audioFile.arrayBuffer();
        const audioCtx = new AudioContext({ sampleRate: 44100 });
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        await audioCtx.close();

        const CHUNK = 4096;
        const numCh = Math.min(decoded.numberOfChannels, 2);
        for (let i = 0; i < decoded.length; i += CHUNK) {
          const n = Math.min(CHUNK, decoded.length - i);
          const data = new Float32Array(numCh * n);
          for (let ch = 0; ch < numCh; ch++) {
            const src = decoded.getChannelData(ch);
            for (let j = 0; j < n; j++) data[ch * n + j] = src[i + j];
          }
          const ad = new AudioData({
            format: "f32-planar", sampleRate: 44100,
            numberOfFrames: n, numberOfChannels: numCh,
            timestamp: Math.round(i / decoded.sampleRate * 1_000_000), data,
          });
          audioEncoder.encode(ad);
          ad.close();
        }
        await audioEncoder.flush();
        if (audioEncoderError) throw audioEncoderError;
      }

      // Render all video frames offline (fast, no real-time dependency)
      for (let fi = 0; fi < totalFrames; fi++) {
        if (videoEncoderError) throw videoEncoderError;
        drawLyricFrame(ctx, W, H, fi / FPS, lines, coverImg, styleColors, effect, fontPct, preroll, effectParams);
        const vf = new VideoFrame(canvas, {
          timestamp: Math.round(fi / FPS * 1_000_000),
          duration: Math.round(1_000_000 / FPS),
        });
        videoEncoder.encode(vf, { keyFrame: fi % 90 === 0 });
        vf.close();
        if (fi % 30 === 0) {
          const prog = fi / totalFrames * 0.90;
          setExportProgress(prog);
          if (prog > 0.02) {
            const elapsed = (Date.now() - exportStartRef.current) / 1000;
            const remaining = elapsed / prog * (1 - prog);
            setExportEta(fmtEta(remaining));
          }
          await new Promise((r) => setTimeout(r, 0));
          if (videoEncoderError) throw videoEncoderError;
        }
      }

      setExportProgress(0.93);
      setExportEta("Đang flush...");
      await videoEncoder.flush();
      if (videoEncoderError) throw videoEncoderError;
      setExportProgress(0.99);
      setExportEta("Đang đóng gói...");
      muxer.finalize();
      setExportProgress(1.0);
      setExportEta("");
      await new Promise((r) => setTimeout(r, 200));

      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (audioFile?.name.replace(/\.[^/.]+$/, "") ?? "lyrics-video") + ".mov";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportError(`Xuất MOV thất bại: ${msg.slice(0, 120)}`);
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handlePlayPause = () => wavesurferRef.current?.playPause();
  const handleRestart = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.seekTo(0);
    wavesurferRef.current.play();
  };

  const lineCount = lyricsText.split("\n").filter((l) => l.trim() && !isSectionMarker(l.trim())).length;

  // 2-line display data
  const currentLine = currentLineIndex >= 0 ? lyricsLines[currentLineIndex] : null;
  const nextLine =
    currentLineIndex >= 0 && currentLineIndex < lyricsLines.length - 1
      ? lyricsLines[currentLineIndex + 1]
      : null;

  // Progress within the current line (0 → 1)
  const lineProgress = currentLine
    ? Math.max(0, Math.min(1,
        (currentTime - currentLine.start) /
        Math.max(0.001, currentLine.end - currentLine.start)
      ))
    : 0;

  // Wipe: hold fully-visible for wipeHold s, then sweep the remaining duration
  const lineDuration = currentLine ? Math.max(0.001, currentLine.end - currentLine.start) : 1;
  const wipeProgress = lineDuration > effectParams.wipeHold
    ? Math.max(0, Math.min(1,
        (lineProgress * lineDuration - effectParams.wipeHold) / (lineDuration - effectParams.wipeHold)
      ))
    : lineProgress;

  // Per-effect opacity target (goes into Framer Motion animate so it wins)
  const effectOpacity =
    lyricEffect === "fade" ? Math.max(0, 1 - wipeProgress * effectParams.fadeSpeed)
    : lyricEffect === "wave" ? 1
    : lyricEffect === "blur" ? Math.max(0, 1 - wipeProgress * 0.85)
    : 1;

  // Per-effect CSS filter (safe in style — not in animate, so no conflict)
  const effectFilter =
    lyricEffect === "blur"
      ? `blur(${(wipeProgress * effectParams.blurAmount).toFixed(1)}px) saturate(${Math.max(0, 1 - wipeProgress * 0.6).toFixed(2)})`
      : undefined;

  // Next line grows from small/dim → big/bright during the last 28% of the current line
  const growFactor = Math.max(0, Math.min(1, (lineProgress - 0.72) / 0.28));

  // Active lyric style preset
  const activeStyle = LYRIC_STYLES.find((s) => s.id === lyricStyleId) ?? LYRIC_STYLES[0];

  return (
    <div className="min-h-screen bg-[#080808] text-white flex flex-col select-none">
      {/* Header */}
      <header className="shrink-0 h-14 flex items-center gap-3 px-6 border-b border-white/[0.06] bg-[#111]/80 backdrop-blur-xl">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/30">
          <Music className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-base tracking-tight">Lyrics Video Generator</span>
      </header>

      {/* ── TOOLBAR ─────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d0d] px-4 py-2.5 flex items-center gap-2.5 overflow-x-auto">
        {/* Lyrics toggle — far left */}
        <button
          onClick={() => setShowLyrics((v) => !v)}
          className={`flex items-center gap-1 text-[10px] transition-colors shrink-0 ${showLyrics ? "text-violet-400" : "text-white/20 hover:text-violet-400"}`}
          title="Nhập lời bài hát"
        >
          <ChevronDown
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: showLyrics ? "rotate(180deg)" : "rotate(0deg)" }}
          />
          <span>Lyrics</span>
          {lyricsText.trim() && (
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 ml-0.5" />
          )}
        </button>

        {/* Prompt toggle */}
        <button
          onClick={() => setShowPrompt((v) => !v)}
          className={`flex items-center gap-1 text-[10px] transition-colors shrink-0 ${showPrompt ? "text-violet-400" : "text-white/20 hover:text-violet-400"}`}
          title="Tuỳ chỉnh prompt gửi Gemini"
        >
          <ChevronDown
            className="w-3 h-3 transition-transform duration-200"
            style={{ transform: showPrompt ? "rotate(180deg)" : "rotate(0deg)" }}
          />
          <span>Prompt</span>
          {customPrompt.trim() !== DEFAULT_PROMPT.trim() && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 ml-0.5" />
          )}
        </button>

        <div className="h-5 w-px bg-white/[0.08] shrink-0" />

        {/* Cover — compact 16:9 thumbnail */}
        <label className="cursor-pointer group shrink-0">
          <input type="file" accept="image/*" className="sr-only" onChange={handleCoverUpload} />
          <div className="w-[68px] h-[38px] rounded-lg overflow-hidden border border-white/[0.08] group-hover:border-violet-500/40 transition-colors relative bg-white/[0.03] flex items-center justify-center">
            {coverImage ? (
              <>
                <img src={coverImage} className="absolute inset-0 w-full h-full object-cover" alt="cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                  <Upload className="w-3 h-3 text-white" />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-0.5">
                <Image className="w-3.5 h-3.5 text-white/20 group-hover:text-violet-400 transition-colors" />
                <span className="text-[8px] text-white/20 group-hover:text-violet-400 transition-colors leading-none">Cover</span>
              </div>
            )}
          </div>
        </label>

        {/* Audio upload + editable title */}
        <div className="flex items-center gap-0 shrink-0">
          <label className="cursor-pointer group">
            <input type="file" accept="audio/*" className="sr-only" onChange={handleAudioUpload} />
            <div className={`h-[38px] px-2.5 rounded-l-lg border-y border-l transition-all flex items-center ${
              audioFile
                ? "border-violet-500/30 bg-violet-500/[0.06]"
                : "border-white/[0.08] bg-white/[0.03] group-hover:border-violet-500/30 group-hover:bg-violet-500/[0.04]"
            }`}>
              <Music className={`w-3.5 h-3.5 shrink-0 ${audioFile ? "text-violet-400" : "text-white/25 group-hover:text-violet-400 transition-colors"}`} />
            </div>
          </label>
          {audioFile ? (
            editingTitle ? (
              <input
                autoFocus
                value={songTitle}
                onChange={(e) => setSongTitle(e.target.value)}
                onBlur={() => {
                  setEditingTitle(false);
                  try { localStorage.setItem("lv_songTitle", songTitle); } catch { /* ignore */ }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    setEditingTitle(false);
                    try { localStorage.setItem("lv_songTitle", songTitle); } catch { /* ignore */ }
                  }
                }}
                className="h-[38px] px-2 text-xs font-medium text-white/90 bg-violet-500/[0.06] border-y border-r border-violet-500/50 rounded-r-lg outline-none w-[120px] truncate"
              />
            ) : (
              <button
                title="Nhấn để sửa tên bài"
                onClick={() => setEditingTitle(true)}
                className="h-[38px] px-2.5 text-xs font-medium text-white/70 bg-violet-500/[0.06] border-y border-r border-violet-500/30 rounded-r-lg hover:text-white/90 hover:border-violet-500/50 transition-all max-w-[120px] truncate"
              >
                {songTitle || audioFile.name.replace(/\.[^/.]+$/, "")}
              </button>
            )
          ) : (
            <label className="cursor-pointer group">
              <input type="file" accept="audio/*" className="sr-only" onChange={handleAudioUpload} />
              <div className="h-[38px] px-2.5 rounded-r-lg border-y border-r border-white/[0.08] bg-white/[0.03] group-hover:border-violet-500/30 group-hover:bg-violet-500/[0.04] transition-all flex items-center">
                <span className="text-xs font-medium text-white/30 group-hover:text-white/50 transition-colors">Upload nhạc</span>
              </div>
            </label>
          )}
        </div>

        <div className="h-5 w-px bg-white/[0.08] shrink-0 mx-0.5" />

        {/* AI transcribe */}
        <button
          onClick={() => handleAiTranscribe(false)}
          disabled={!audioFile || isTranscribing || isSyncing || isAnalyzing}
          className="h-[38px] px-4 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all shrink-0
            bg-gradient-to-r from-emerald-600 to-teal-600
            hover:from-emerald-500 hover:to-teal-500
            shadow-md shadow-emerald-500/20
            disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
        >
          {isTranscribing && !isSyncing ? (
            splitProgress
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Phần {splitProgress.current}/{splitProgress.total}...</>
              : <><Loader2 className="w-3.5 h-3.5 animate-spin" />Đang nhận diện...</>
          ) : (
            <><Sparkles className="w-3.5 h-3.5" />Nhận diện AI</>
          )}
        </button>

        {/* Sync timestamps */}
        <button
          onClick={() => handleAiTranscribe(false, true)}
          disabled={!audioFile || isTranscribing || isSyncing || isAnalyzing}
          className="h-[38px] px-3 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all shrink-0
            border border-violet-500/30 text-violet-300/80
            hover:bg-violet-500/10 hover:border-violet-500/60 hover:text-violet-200
            disabled:opacity-30 disabled:cursor-not-allowed"
          title="Giữ nguyên lời nhập tay, chỉ lấy timestamps từ Gemini"
        >
          {isSyncing ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" />Đang đồng bộ...</>
          ) : (
            <><span className="text-base leading-none">⇌</span>Đồng bộ</>
          )}
        </button>

        {/* Status indicators */}
        {/* Split parts selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-lg p-0.5 border border-white/[0.06]">
            {([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                onClick={() => setSplitParts(n)}
                disabled={isTranscribing || isSyncing}
                className={`px-2 py-1 rounded-md text-[10px] font-semibold transition-all disabled:opacity-40 ${
                  splitParts === n ? "bg-white/15 text-white" : "text-white/30 hover:text-white/60"
                }`}
                title={n === 1 ? "Gửi nguyên bài (mặc định)" : `Chia thành ${n} phần, gửi tuần tự`}
              >
                {n === 1 ? "1×" : `${n} phần`}
              </button>
            ))}
          </div>
          {/* Editable cut points */}
          {splitParts > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-white/25">cắt:</span>
              {splitCutInputs.map((val, idx) => (
                <input
                  key={idx}
                  type="text"
                  value={val}
                  onChange={(e) => {
                    const next = [...splitCutInputs];
                    next[idx] = e.target.value;
                    setSplitCutInputs(next);
                  }}
                  placeholder="2:30"
                  disabled={isTranscribing || isSyncing}
                  className="w-14 bg-white/[0.06] border border-white/[0.10] focus:border-violet-500/50 rounded-md px-1.5 py-1 text-[10px] text-white/70 font-mono text-center outline-none transition-all disabled:opacity-40"
                  title={`Điểm cắt ${idx + 1} — nhập M:SS hoặc giây (ví dụ: 2:30 hoặc 150)`}
                />
              ))}
            </div>
          )}
        </div>

        {transcribeFromCache && !isTranscribing && (
          <span className="text-[10px] text-emerald-400/80 flex items-center gap-1 shrink-0">
            <span>⚡</span>Đã lưu cache
          </span>
        )}
        {transcribeError && (
          <span className="text-[10px] text-red-400/80 max-w-[180px] truncate shrink-0">{transcribeError}</span>
        )}
        {audioFile && (lyricsLines.length > 0 || transcribeFromCache) && (
          <button
            onClick={() => handleAiTranscribe(true)}
            disabled={isTranscribing || isSyncing}
            className="text-[10px] text-white/25 hover:text-violet-400 underline underline-offset-2 transition-colors shrink-0 disabled:opacity-30"
          >
            Nhận diện lại
          </button>
        )}

        <div className="flex-1" />

        {/* Export error */}
        {exportError && (
          <span className="text-[10px] text-red-400/90 max-w-[200px] truncate shrink-0 flex items-center gap-1">
            <span>⚠</span>{exportError}
          </span>
        )}

        {/* Quality selector */}
        <div className="flex items-center gap-0.5 bg-white/5 rounded-lg p-0.5 border border-white/10 shrink-0">
          {(["fast", "normal", "high"] as ExportQuality[]).map((q) => (
            <button
              key={q}
              onClick={() => { setExportQuality(q); localStorage.setItem("lv_exportQuality", q); }}
              disabled={isExporting}
              title={q === "fast" ? "480p · 2Mbps · nhanh" : q === "normal" ? "720p · 5Mbps · cân bằng" : "1080p · 8Mbps · chất lượng cao"}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-all disabled:cursor-not-allowed
                ${exportQuality === q ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"}`}
            >
              {q === "fast" ? "Nhanh" : q === "normal" ? "Chuẩn" : "Cao"}
            </button>
          ))}
        </div>

        {/* Export buttons */}
        {/* WebM */}
        <button
          onClick={() => { setExportError(null); handleExportVideoWebm("webm"); }}
          disabled={!isReady || lyricsLines.length === 0 || isExporting}
          title="Xuất WebM — VP8+Opus, offline rendering, phát được trong Chrome/Firefox/VLC"
          className="relative h-[38px] px-4 rounded-lg flex items-center gap-1.5 font-semibold text-xs transition-all shrink-0
            border border-violet-500/40 text-violet-300
            hover:bg-violet-500/10 hover:border-violet-400/60
            disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
        >
          {isExporting && exportingFormat === "webm" ? (
            <>
              <span className="absolute inset-0 bg-violet-500/20 origin-left" style={{ transform: `scaleX(${exportProgress})`, transition: "transform 0.4s linear" }} />
              <Loader2 className="w-3 h-3 animate-spin relative z-10" />
              <span className="relative z-10">{Math.round(exportProgress * 100)}%{exportEta ? ` ${exportEta}` : ""}</span>
            </>
          ) : (
            <><Download className="w-3 h-3" />WebM</>
          )}
        </button>
        {/* MKV */}
        <button
          onClick={() => { setExportError(null); handleExportVideoWebm("mkv"); }}
          disabled={!isReady || lyricsLines.length === 0 || isExporting}
          title="Xuất MKV — VP8+Opus, Matroska container, tương thích VLC/DaVinci/Premiere"
          className="relative h-[38px] px-4 rounded-lg flex items-center gap-1.5 font-semibold text-xs transition-all shrink-0
            border border-sky-500/40 text-sky-300
            hover:bg-sky-500/10 hover:border-sky-400/60
            disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
        >
          {isExporting && exportingFormat === "mkv" ? (
            <>
              <span className="absolute inset-0 bg-sky-500/20 origin-left" style={{ transform: `scaleX(${exportProgress})`, transition: "transform 0.4s linear" }} />
              <Loader2 className="w-3 h-3 animate-spin relative z-10" />
              <span className="relative z-10">{Math.round(exportProgress * 100)}%{exportEta ? ` ${exportEta}` : ""}</span>
            </>
          ) : (
            <><Download className="w-3 h-3" />MKV</>
          )}
        </button>
        {/* MOV */}
        <button
          onClick={() => { setExportError(null); handleExportVideoMov(); }}
          disabled={!isReady || lyricsLines.length === 0 || isExporting}
          title="Xuất MOV — H.264+AAC, QuickTime, tốt cho macOS/Final Cut/iMovie"
          className="relative h-[38px] px-4 rounded-lg flex items-center gap-1.5 font-semibold text-xs transition-all shrink-0
            bg-gradient-to-r from-fuchsia-600 to-violet-600
            hover:from-fuchsia-500 hover:to-violet-500
            shadow-md shadow-violet-500/25
            disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
        >
          {isExporting && exportingFormat === "mov" ? (
            <>
              <span className="absolute inset-0 bg-white/15 origin-left" style={{ transform: `scaleX(${exportProgress})`, transition: "transform 0.4s linear" }} />
              <Loader2 className="w-3 h-3 animate-spin relative z-10" />
              <span className="relative z-10">{Math.round(exportProgress * 100)}%{exportEta ? ` ${exportEta}` : ""}</span>
            </>
          ) : (
            <><Download className="w-3 h-3" />MOV</>
          )}
        </button>
      </div>

      {/* Collapsible panels — Lyrics and/or Prompt */}
      {(showLyrics || showPrompt) && (
        <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d0d] px-5 py-3 flex gap-4 items-start">
          {showLyrics && (
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">Lyrics</span>
                {lyricsText.trim() && <span className="text-[10px] text-white/30">{lyricsText.split("\n").filter((l) => l.trim()).length} dòng</span>}
              </div>
              <textarea
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                rows={6}
                placeholder={"Nhập lyrics ở đây...\nMỗi dòng là một câu\nDùng Nhận diện AI để gán thời gian"}
                className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-violet-500/40 rounded-xl p-3 text-[11px] text-white/60 placeholder-white/20 resize-none outline-none transition-all font-mono leading-relaxed"
              />
            </div>
          )}
          {showPrompt && (
            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">Prompt AI</span>
                <button
                  onClick={() => setCustomPrompt(DEFAULT_PROMPT)}
                  className="text-[10px] text-white/25 hover:text-white/50 transition-colors underline underline-offset-2 shrink-0"
                >
                  Khôi phục mặc định
                </button>
              </div>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                rows={6}
                spellCheck={false}
                className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-violet-500/40 rounded-xl p-3 text-[11px] text-white/60 resize-none outline-none transition-all font-mono leading-relaxed"
              />

              {/* ── Fix / correction request ── */}
              {audioFile && lyricsLines.length > 0 && (
                <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-3 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-amber-400/60">
                      Yêu cầu sửa kết quả
                    </span>
                    <span className="text-[10px] text-white/20">{lyricsLines.filter(l => !l.isMarker).length} dòng hiện tại</span>
                  </div>
                  <textarea
                    value={fixRequest}
                    onChange={(e) => setFixRequest(e.target.value)}
                    rows={3}
                    spellCheck={false}
                    placeholder={"Ví dụ: Bổ sung đoạn lời từ 2:22 đến 3:25 bị thiếu\nHoặc: Sửa timestamp từ dòng 10 trở đi bị lệch\nHoặc: Tách dòng 5 thành 2 dòng ngắn hơn"}
                    className="w-full bg-white/[0.03] border border-white/[0.08] focus:border-amber-500/40 rounded-xl p-3 text-[11px] text-white/60 resize-none outline-none transition-all leading-relaxed placeholder:text-white/15"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleFixRequest();
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleFixRequest}
                      disabled={!fixRequest.trim() || isFixing}
                      className="h-8 px-4 rounded-lg font-semibold text-xs flex items-center gap-1.5 transition-all
                        bg-gradient-to-r from-amber-600 to-orange-600
                        hover:from-amber-500 hover:to-orange-500
                        shadow-md shadow-amber-500/20
                        disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      {isFixing ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" />Đang xử lý...</>
                      ) : (
                        <><Wand2 className="w-3.5 h-3.5" />Gửi yêu cầu</>
                      )}
                    </button>
                    <span className="text-[10px] text-white/20">Ctrl+Enter để gửi</span>
                    {fixError && (
                      <span className="text-[10px] text-red-400/80 flex-1 truncate">{fixError}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL ─────────────────────────────────────── */}
        <aside className="w-[300px] shrink-0 border-r border-white/[0.06] flex flex-col bg-[#0d0d0d] overflow-hidden">
          <div className="flex flex-col h-full p-4 gap-3">

            {/* Timeline list */}
            {lyricsLines.length > 0 && (
              <div className="flex flex-col min-h-0 shrink-0 max-h-[45%]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">
                    Timeline — {lyricsLines.filter(l => !l.isMarker).length} dòng
                  </p>
                  <div className="flex items-center gap-1">
                    {/* Import */}
                    <label
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-violet-400 transition-colors cursor-pointer px-2 py-1 rounded-lg hover:bg-white/[0.04]"
                      title="Import timeline từ file .txt"
                    >
                      <Upload className="w-3 h-3" />
                      <span>Import</span>
                      <input
                        type="file"
                        accept=".txt,text/plain"
                        className="sr-only"
                        onChange={handleImportTimeline}
                      />
                    </label>
                    {/* Export */}
                    <button
                      onClick={handleExportTimeline}
                      className="flex items-center gap-1 text-[10px] text-white/30 hover:text-emerald-400 transition-colors px-2 py-1 rounded-lg hover:bg-white/[0.04]"
                      title="Export timeline ra file .txt để sửa tay"
                    >
                      <Download className="w-3 h-3" />
                      <span>Export</span>
                    </button>
                  </div>
                </div>
                <div className="space-y-0.5 max-h-52 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                  {lyricsLines.map((line, i) => {
                    let prevNonMarker: (typeof lyricsLines)[0] | null = null;
                    for (let j = i - 1; j >= 0; j--) {
                      if (!lyricsLines[j].isMarker) { prevNonMarker = lyricsLines[j]; break; }
                    }
                    const gapSecs = (!line.isMarker && prevNonMarker) ? line.start - prevNonMarker.end : 0;
                    return (
                    <Fragment key={i}>
                      {gapSecs > 20 && (
                        <div className="flex items-center gap-1.5 px-2 py-1">
                          <div className="flex-1 h-px bg-amber-500/25" />
                          <span className="text-[9px] font-semibold text-amber-400/70 px-1 shrink-0 flex items-center gap-1">
                            ⚠ Khoảng trống {gapSecs.toFixed(0)}s — có thể thiếu lời
                          </span>
                          <div className="flex-1 h-px bg-amber-500/25" />
                        </div>
                      )}
                      {line.isMarker ? (
                    /* ── Section marker row ── */
                    <div className="flex items-center gap-1.5 px-2 py-1 mt-1 first:mt-0">
                      <div className="flex-1 h-px bg-violet-500/20" />
                      <span className="text-[9px] font-semibold tracking-widest uppercase text-violet-400/60 px-1 shrink-0">
                        {line.text.replace(/^\[|\]$/g, "")}
                      </span>
                      <div className="flex-1 h-px bg-violet-500/20" />
                    </div>
                  ) : (
                    <div
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors group ${
                        i === currentLineIndex
                          ? "bg-violet-500/15 text-white"
                          : "text-white/50 hover:bg-white/[0.04]"
                      }`}
                    >
                      {/* ── Start-time badge (editable) ── */}
                      {editingTimeIdx === i && editingTimeSide === "start" ? (
                        <input
                          autoFocus
                          type="number"
                          step="0.01"
                          min="0"
                          value={editingTimeVal}
                          onChange={(e) => setEditingTimeVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEditTime();
                            if (e.key === "Escape") setEditingTimeIdx(null);
                          }}
                          onBlur={saveEditTime}
                          className="w-14 bg-white/[0.08] border border-amber-500/40 rounded px-1 py-0.5 text-amber-300 outline-none text-[10px] font-mono text-center shrink-0"
                        />
                      ) : (
                        <button
                          onClick={() => startEditTime(i, "start")}
                          className="font-mono text-violet-400/70 shrink-0 tabular-nums text-[10px] hover:text-amber-400 transition-colors cursor-text"
                          title="Nhấn để chỉnh thời điểm bắt đầu"
                        >
                          {formatTimeD(line.start)}
                        </button>
                      )}

                      {editingLineIndex === i ? (
                        /* ── Inline text-edit mode ── */
                        <>
                          <input
                            autoFocus
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditLine();
                              if (e.key === "Escape") cancelEditLine();
                            }}
                            className="flex-1 bg-white/[0.08] border border-violet-500/40 rounded px-2 py-0.5 text-white outline-none text-xs min-w-0"
                          />
                          <button onClick={saveEditLine} className="shrink-0 text-emerald-400 hover:text-emerald-300 transition-colors">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={cancelEditLine} className="shrink-0 text-white/30 hover:text-white/60 transition-colors">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        /* ── Display mode ── */
                        <>
                          <span className="flex-1 truncate min-w-0">{line.text}</span>
                          <button
                            onClick={() => startEditLine(i)}
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-white/30 hover:text-violet-400 transition-all"
                            title="Sửa lời"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {line.text.trim().split(/\s+/).length >= 2 && (
                            <button
                              onClick={() => splitLine(i)}
                              className="shrink-0 opacity-0 group-hover:opacity-100 text-white/30 hover:text-amber-400 transition-all"
                              title="Cắt đôi dòng này"
                            >
                              <Scissors className="w-3 h-3" />
                            </button>
                          )}
                          {/* Duration badge — editable */}
                          {editingDurIdx === i ? (
                            <input
                              autoFocus
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={editingDurVal}
                              onChange={(e) => setEditingDurVal(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  const d = parseFloat(editingDurVal);
                                  if (!isNaN(d) && d > 0) {
                                    setLyricsLines((prev) => prev.map((l, idx) =>
                                      idx === i ? { ...l, end: l.start + d }
                                      : idx === i + 1 ? { ...l, start: lyricsLines[i].start + d }
                                      : l
                                    ));
                                  }
                                  setEditingDurIdx(null);
                                }
                                if (e.key === "Escape") setEditingDurIdx(null);
                              }}
                              onBlur={() => {
                                const d = parseFloat(editingDurVal);
                                if (!isNaN(d) && d > 0) {
                                  setLyricsLines((prev) => prev.map((l, idx) =>
                                    idx === i ? { ...l, end: l.start + d }
                                    : idx === i + 1 ? { ...l, start: lyricsLines[i].start + d }
                                    : l
                                  ));
                                }
                                setEditingDurIdx(null);
                              }}
                              className="w-12 bg-white/[0.08] border border-emerald-500/40 rounded px-1 py-0.5 text-emerald-300 outline-none text-[10px] font-mono text-center shrink-0"
                            />
                          ) : (
                            <button
                              onClick={() => { setEditingDurIdx(i); setEditingDurVal((line.end - line.start).toFixed(1)); }}
                              className="font-mono text-white/25 shrink-0 tabular-nums text-[10px] hover:text-emerald-400 transition-colors cursor-text"
                              title="Nhấn để chỉnh độ dài (giây)"
                            >
                              {(line.end - line.start).toFixed(1)}s
                            </button>
                          )}
                        </>
                      )}

                      {/* ── End-time badge (editable) — always visible ── */}
                      {editingLineIndex !== i && (
                        editingTimeIdx === i && editingTimeSide === "end" ? (
                          <input
                            autoFocus
                            type="number"
                            step="0.01"
                            min="0"
                            value={editingTimeVal}
                            onChange={(e) => setEditingTimeVal(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveEditTime();
                              if (e.key === "Escape") setEditingTimeIdx(null);
                            }}
                            onBlur={saveEditTime}
                            className="w-14 bg-white/[0.08] border border-teal-500/40 rounded px-1 py-0.5 text-teal-300 outline-none text-[10px] font-mono text-center shrink-0"
                          />
                        ) : (
                          <button
                            onClick={() => startEditTime(i, "end")}
                            className="font-mono text-teal-400/50 shrink-0 tabular-nums text-[10px] hover:text-teal-300 transition-colors cursor-text"
                            title="Nhấn để chỉnh thời điểm kết thúc"
                          >
                            {formatTimeD(line.end)}
                          </button>
                        )
                      )}

                      {/* ── Delete button ── */}
                      {editingLineIndex !== i && (
                        <button
                          onClick={() => deleteLine(i)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-white/20 hover:text-red-400 transition-all ml-0.5"
                          title="Xoá dòng này"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                      )}
                    </Fragment>
                    );
                  })}
                </div>
                <p className="text-[10px] text-white/20 mt-1.5 text-center">
                  <span className="text-violet-400/50">start</span> ·{" "}
                  <span className="text-emerald-400/50">giây</span> ·{" "}
                  <span className="text-teal-400/50">end</span> nhấn để sửa · ✏ lời · ✂ cắt · 🗑 xoá · Enter lưu · Esc huỷ
                </p>
              </div>
            )}

            {/* Clear transcription cache */}
            {audioFile && (
              <div className="mt-auto pt-2 border-t border-white/[0.05]">
                <button
                  onClick={handleClearCache}
                  disabled={cacheClearedFlash}
                  className={`w-full flex items-center justify-center gap-1.5 text-[10px] transition-colors py-1.5 rounded-lg ${
                    cacheClearedFlash
                      ? "text-green-400/80 bg-green-500/[0.08] border border-green-500/20 cursor-default"
                      : "text-white/25 hover:text-red-400/70 hover:bg-red-500/[0.06]"
                  }`}
                  title="Xóa cache nhận diện AI để gọi lại API khi bấm Nhận diện AI"
                >
                  <Trash2 className="w-3 h-3" />
                  {cacheClearedFlash ? "Đã xóa cache!" : "Xóa Cache AI"}
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* ── RIGHT PANEL ────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden bg-[#080808]">

          {/* 16:9 Video Preview — flex-1, height-driven */}
          <div className="flex-1 flex items-center justify-center px-4 pt-3 pb-1 min-h-0 overflow-hidden">
          <div className="h-full aspect-video max-w-[900px] min-w-0">
            <div className="w-full h-full rounded-2xl overflow-hidden relative shadow-2xl shadow-black/70 ring-1 ring-white/[0.06]" style={{ containerType: "inline-size" }}>
              {coverImage ? (
                <>
                  <img
                    src={coverImage}
                    className="absolute inset-0 w-full h-full object-cover scale-110"
                    style={{ filter: "blur(24px) brightness(0.35) saturate(1.4)" }}
                    alt=""
                  />
                  <img src={coverImage} className="absolute inset-0 w-full h-full object-contain" alt="cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#050d1a]" />
              )}

              {/* Analyzing overlay */}
              {isAnalyzing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-sm z-10">
                  <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                  <p className="text-sm text-white/70">Đang phân tích âm thanh...</p>
                  <p className="text-xs text-white/30">Tìm điểm dừng tự nhiên trong bài nhạc</p>
                </div>
              )}

              {/* Lyrics overlay */}
              <div
                ref={lyricsViewRef}
                className="absolute inset-0 overflow-hidden px-8"
              >
                {lyricsLines.length > 0 ? (
                  currentLineIndex >= 0 ? (
                    /* Current line — absolutely positioned so enter/exit animations never shift layout */
                    <div className="absolute inset-0">
                      <AnimatePresence mode="sync">
                        <motion.div
                          key={`cur-${currentLineIndex}`}
                          className="text-center"
                          initial={{ opacity: 0, scale: 0.96 }}
                          animate={{ opacity: effectOpacity, scale: 1 }}
                          exit={{ opacity: 0, transition: { duration: 0.18 } }}
                          transition={{
                            scale: { type: "spring", stiffness: 340, damping: 30 },
                            opacity: { duration: 0.08 },
                          }}
                          style={{
                            position: "absolute",
                            bottom: "2.5rem",
                            left: "2rem",
                            right: "2rem",
                            ...(effectFilter && { filter: effectFilter }),
                          }}
                        >
                          {lyricEffect === "wave" ? (
                            /* Wave: static text + animated swoosh underline draws L→R */
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <p style={{
                                fontSize: `calc(clamp(1.1rem, 4.2cqw, 2.5rem) * ${lyricFontSize / 100})`,
                                fontWeight: 700,
                                letterSpacing: "0.015em",
                                lineHeight: 1.35,
                                textAlign: "center",
                                ...activeStyle.current,
                              }}>
                                {currentLine?.text}
                              </p>
                              {/* SVG wave that draws left→right with lineProgress */}
                              <svg
                                viewBox={`0 0 400 ${(effectParams.waveAmp * 2) + 10}`}
                                style={{ width: "88%", height: `${Math.max(22, effectParams.waveAmp * 2 + 10)}px`, overflow: "visible", display: "block" }}
                                preserveAspectRatio="none"
                              >
                                <motion.path
                                  key={`wave-${currentLineIndex}-${effectParams.waveAmp}-${effectParams.waveCycles}`}
                                  d={generateWaveSVGPath(effectParams.waveCycles, effectParams.waveAmp)}
                                  fill="none"
                                  stroke={activeStyle.dot}
                                  strokeWidth="3.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  initial={{ pathLength: 0, opacity: 0 }}
                                  animate={{ pathLength: lineProgress, opacity: lineProgress > 0.01 ? 1 : 0 }}
                                  transition={{ duration: 0.04, ease: "linear" }}
                                  style={{ filter: `drop-shadow(0 0 5px ${activeStyle.dot}) drop-shadow(0 0 10px ${activeStyle.dot}80)` }}
                                />
                              </svg>
                            </div>
                          ) : lyricEffect === "karaoke" ? (
                            /* Karaoke: word-by-word lit left→right (mask avoided — bleeds on wrapped lines) */
                            <KaraokeText
                              text={currentLine?.text ?? ""}
                              progress={lineProgress}
                              style={activeStyle}
                              fontSize={`calc(clamp(1.1rem, 4.2cqw, 2.5rem) * ${lyricFontSize / 100})`}
                            />
                          ) : lyricEffect === "wipe" ? (
                            /* Wipe: word-by-word erase left→right after 1.5 s hold */
                            <WipeText
                              text={currentLine?.text ?? ""}
                              wipeProgress={wipeProgress}
                              style={activeStyle}
                              fontSize={`calc(clamp(1.1rem, 4.2cqw, 2.5rem) * ${lyricFontSize / 100})`}
                            />
                          ) : (
                            <p style={{
                              fontSize: `calc(clamp(1.1rem, 4.2cqw, 2.5rem) * ${lyricFontSize / 100})`,
                              fontWeight: 700,
                              letterSpacing: "0.015em",
                              lineHeight: 1.35,
                              ...activeStyle.current,
                            }}>
                              {currentLine?.text}
                            </p>
                          )}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  ) : (
                    /* ── Intro: timeline set but not reached first lyric yet ── */
                    <div />
                  )
                ) : (
                  !isAnalyzing && (
                    <div className="text-center space-y-3">
                      <div className="w-14 h-14 rounded-full bg-white/[0.06] flex items-center justify-center mx-auto">
                        <Music className="w-7 h-7 text-white/15" />
                      </div>
                      <p className="text-white/20 text-sm">
                        {!audioFile
                          ? "Upload nhạc và nhập lyrics để bắt đầu"
                          : !lyricsText.trim()
                            ? "Nhập lyrics vào ô bên trái"
                            : !isReady
                              ? "Đang tải audio..."
                              : "Nhấn Auto Timeline để đồng bộ"}
                      </p>
                    </div>
                  )
                )}
              </div>

              {isReady && (
                <div className="absolute bottom-3 right-3 text-[10px] font-mono text-white/30 bg-black/40 px-2 py-1 rounded-md backdrop-blur-sm">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
              )}
            </div>
          </div>
          </div>

          {/* Audio Player */}
          <div className="px-6 pb-2 shrink-0">
          <div className="max-w-[900px] mx-auto bg-white/[0.04] border border-white/[0.07] rounded-2xl p-5">
            {audioUrl ? (
              <div className="space-y-4">
                <div ref={waveformRef} className="w-full rounded-lg overflow-hidden cursor-pointer" />
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleRestart}
                    disabled={!isReady}
                    className="w-9 h-9 rounded-full bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center transition-colors disabled:opacity-25"
                  >
                    <SkipBack className="w-4 h-4 text-white/70" />
                  </button>
                  <button
                    onClick={handlePlayPause}
                    disabled={!isReady}
                    className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-black/30 disabled:opacity-25"
                  >
                    {isPlaying
                      ? <Pause className="w-5 h-5 text-black" />
                      : <Play className="w-5 h-5 text-black ml-0.5" />
                    }
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">
                      {songTitle || audioFile?.name.replace(/\.[^/.]+$/, "")}
                    </p>
                    <p className="text-xs text-white/35 mt-0.5 font-mono">
                      {formatTime(currentTime)}
                      <span className="text-white/20"> / {formatTime(duration)}</span>
                      {lyricsLines.length > 0 && currentLineIndex >= 0 && (
                        <span className="ml-2 text-violet-400/70 font-sans">
                          · dòng {currentLineIndex + 1}/{lyricsLines.length}
                        </span>
                      )}
                    </p>
                  </div>
                  {lyricsLines.length > 0 && (
                    <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
                      <div className={`w-1.5 h-1.5 rounded-full ${isPlaying ? "bg-violet-400 animate-pulse" : "bg-violet-500/40"}`} />
                      <span className="text-[11px] font-medium text-violet-300">
                        {isPlaying ? "Syncing" : `${lyricsLines.length} lines`}
                      </span>
                    </div>
                  )}

                </div>
              </div>
            ) : (
              <div className="py-6 flex flex-col items-center gap-3 text-white/20">
                <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-sm">Upload file nhạc để xem audio player</p>
              </div>
            )}
          </div>
          </div>

          {/* ── STYLE BAR ─────────────────────────────────────── */}
          <div className="px-6 pb-4 shrink-0">
            <div className="max-w-[900px] mx-auto bg-white/[0.03] border border-white/[0.06] rounded-2xl px-5 py-3 flex items-center gap-x-4 gap-y-2.5 flex-wrap">

              {/* ── ROW 1: Colors | Effects ── */}
              <div className="flex items-center gap-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Màu</p>
                <div className="flex flex-wrap gap-1">
                  {LYRIC_STYLES.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => setLyricStyleId(s.id)}
                      title={s.label}
                      className={`flex items-center gap-1 px-1.5 py-1 rounded-lg text-[9px] font-medium transition-all border ${
                        lyricStyleId === s.id
                          ? "border-white/30 bg-white/[0.1] text-white"
                          : "border-white/[0.06] bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/15"
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.dot }} />
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="h-5 w-px bg-white/[0.06] shrink-0" />

              {/* Effects */}
              <div className="flex items-center gap-2.5">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Hiệu ứng</p>
                <div className="flex flex-wrap gap-1">
                  {LYRIC_EFFECTS.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setLyricEffect(e.id)}
                      className={`px-2 py-1 rounded-lg text-[9px] font-medium transition-all border ${
                        lyricEffect === e.id
                          ? "border-white/30 bg-white/[0.1] text-white"
                          : "border-white/[0.06] bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/15"
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Force line break before row 2 */}
              <div className="basis-full h-0" />

              {/* ── ROW 2: Pre-roll | Effect params | Font size ── */}

              {/* Pre-roll */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Hiện trước</p>
                <input
                  type="range" min={0} max={3} step={0.1} value={prerollSeconds}
                  onChange={(e) => setPrerollSeconds(Number(e.target.value))}
                  className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#F59E0B" }}
                />
                <span className="text-[9px] font-mono text-amber-400/70 w-8 shrink-0">
                  {prerollSeconds === 0 ? "tắt" : `${prerollSeconds.toFixed(1)}s`}
                </span>
              </div>

              {/* Effect-specific params */}
              {lyricEffect === "wipe" && (
                <>
                  <div className="h-5 w-px bg-white/[0.06] shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Giữ</p>
                    <input type="range" min={0} max={3} step={0.1} value={effectParams.wipeHold}
                      onChange={(e) => setEp("wipeHold", Number(e.target.value))}
                      className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#8B5CF6" }}
                    />
                    <span className="text-[9px] font-mono text-violet-400/70 w-8 shrink-0">{effectParams.wipeHold.toFixed(1)}s</span>
                  </div>
                </>
              )}
              {lyricEffect === "fade" && (
                <>
                  <div className="h-5 w-px bg-white/[0.06] shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Tốc độ mờ</p>
                    <input type="range" min={0.3} max={3} step={0.1} value={effectParams.fadeSpeed}
                      onChange={(e) => setEp("fadeSpeed", Number(e.target.value))}
                      className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#8B5CF6" }}
                    />
                    <span className="text-[9px] font-mono text-violet-400/70 w-8 shrink-0">{effectParams.fadeSpeed.toFixed(1)}×</span>
                  </div>
                </>
              )}
              {lyricEffect === "blur" && (
                <>
                  <div className="h-5 w-px bg-white/[0.06] shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Mờ tối đa</p>
                    <input type="range" min={4} max={30} step={1} value={effectParams.blurAmount}
                      onChange={(e) => setEp("blurAmount", Number(e.target.value))}
                      className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#8B5CF6" }}
                    />
                    <span className="text-[9px] font-mono text-violet-400/70 w-8 shrink-0">{effectParams.blurAmount}px</span>
                  </div>
                </>
              )}
              {lyricEffect === "wave" && (
                <>
                  <div className="h-5 w-px bg-white/[0.06] shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Biên độ</p>
                    <input type="range" min={3} max={20} step={1} value={effectParams.waveAmp}
                      onChange={(e) => setEp("waveAmp", Number(e.target.value))}
                      className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#8B5CF6" }}
                    />
                    <span className="text-[9px] font-mono text-violet-400/70 w-6 shrink-0">{effectParams.waveAmp}</span>
                  </div>
                  <div className="h-5 w-px bg-white/[0.06] shrink-0" />
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Chu kỳ</p>
                    <input type="range" min={2} max={12} step={1} value={effectParams.waveCycles}
                      onChange={(e) => setEp("waveCycles", Number(e.target.value))}
                      className="w-20 h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{ accentColor: "#8B5CF6" }}
                    />
                    <span className="text-[9px] font-mono text-violet-400/70 w-6 shrink-0">{effectParams.waveCycles}</span>
                  </div>
                </>
              )}

              <div className="h-5 w-px bg-white/[0.06] shrink-0" />

              {/* Font size */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Cỡ chữ</p>
                <input
                  type="range" min={60} max={180} step={5} value={lyricFontSize}
                  onChange={(e) => setLyricFontSize(Number(e.target.value))}
                  className="w-24 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: "#8B5CF6" }}
                />
                <span className="text-[9px] font-mono text-violet-400/70 w-8 shrink-0">{lyricFontSize}%</span>
              </div>

            </div>
          </div>

        </main>
      </div>
    </div>
  );
}
