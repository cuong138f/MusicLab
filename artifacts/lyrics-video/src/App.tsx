import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import WaveSurfer from "wavesurfer.js";
import { Music, Image, Play, Pause, Wand2, SkipBack, Upload, Loader2, Sparkles, Pencil, Check, X, Download, Scissors, Trash2 } from "lucide-react";

interface LyricLine {
  text: string;
  start: number;
  end: number;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
) {
  const WIPE_HOLD = 1.5;
  ctx.clearRect(0, 0, W, H);

  // ── Background ──────────────────────────────────────────────
  if (coverImg) {
    ctx.save();
    ctx.filter = "blur(22px) brightness(0.3) saturate(1.5)";
    ctx.drawImage(coverImg, -60, -60, W + 120, H + 120);
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

  const baseFontPx = Math.round(54 * fontSizePct / 100);
  const textY = H - 40;
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
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 30;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.restore();
  } else if (effect === "fade") {
    ctx.globalAlpha = Math.max(0, 1 - wp);
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 28;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
  } else if (effect === "blur") {
    const blurPx = (wp * 14).toFixed(1);
    ctx.filter = `blur(${blurPx}px)`;
    ctx.globalAlpha = Math.max(0, 1 - wp * 0.85);
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 28;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    ctx.filter = "none";
  } else if (effect === "wave") {
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 28;
    ctx.fillStyle = styleColors.fill;
    ctx.fillText(cLine.text, W / 2, textY);
    const wW = W * 0.72, wX0 = (W - W * 0.72) / 2;
    const wY = textY + 18, amp = 9, cycles = 6;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, wX0 + wW * lp, H); ctx.clip();
    ctx.beginPath();
    ctx.moveTo(wX0, wY);
    for (let x = 0; x <= wW; x++) {
      ctx.lineTo(wX0 + x, wY + Math.sin((x / wW) * Math.PI * 2 * cycles) * amp);
    }
    ctx.strokeStyle = styleColors.fill; ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 14;
    ctx.lineWidth = 3.5; ctx.lineCap = "round"; ctx.stroke();
    ctx.restore();
  } else {
    // wipe: clip right portion, hold 1.5 s first
    ctx.save();
    ctx.beginPath(); ctx.rect(wp * W, 0, W * (1 - wp), H); ctx.clip();
    ctx.shadowColor = styleColors.glow; ctx.shadowBlur = 28;
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
  const [lyricsText, setLyricsText] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem("lv_lyricsText") ?? '""') as string; } catch { return ""; }
  });
  const [lyricsLines, setLyricsLines] = useState<LyricLine[]>(() => {
    try { return JSON.parse(localStorage.getItem("lv_lyricsLines") ?? "[]") as LyricLine[]; } catch { return []; }
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isReady, setIsReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const [transcribeFromCache, setTranscribeFromCache] = useState(false);
  const [lyricEffect, setLyricEffect] = useState<LyricEffectId>(() => {
    const saved = localStorage.getItem("lv_lyricEffect");
    return (saved && ["fade", "slide", "pop", "wipe", "karaoke", "wave"].includes(saved) ? saved : "wipe") as LyricEffectId;
  });
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingTimeIdx, setEditingTimeIdx] = useState<number | null>(null);
  const [editingTimeVal, setEditingTimeVal] = useState("");
  const [editingTimeSide, setEditingTimeSide] = useState<"start" | "end">("start");
  const [editingDurIdx, setEditingDurIdx] = useState<number | null>(null);
  const [editingDurVal, setEditingDurVal] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<"webm" | "mp4">("webm");
  const [exportProgress, setExportProgress] = useState(0);
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

  useEffect(() => {
    if (!lyricsLines.length) return;

    // Find the active line with pre-roll look-ahead.
    // During gaps, holds the PREVIOUS line so the wipe stays fully complete.
    const lookAhead = currentTime + prerollSeconds;
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (lookAhead >= lyricsLines[i].start) {
        idx = i; // last line whose pre-roll window has opened
        if (lookAhead < lyricsLines[i].end) break; // exact match — stop
      }
    }
    setCurrentLineIndex(idx);
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
  useEffect(() => { localStorage.setItem("lv_lyricStyleId", lyricStyleId); }, [lyricStyleId]);
  useEffect(() => { localStorage.setItem("lv_lyricFontSize", String(lyricFontSize)); }, [lyricFontSize]);
  useEffect(() => { localStorage.setItem("lv_prerollSeconds", String(prerollSeconds)); }, [prerollSeconds]);

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
    setCurrentLineIndex(-1);
  };

  const handleAutoTimeline = async () => {
    if (!audioFile || !duration || !lyricsText.trim()) return;

    const lines = lyricsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;

    setIsAnalyzing(true);
    setLyricsLines([]);

    try {
      // Request `lines.length` cuts: cuts[0] = intro end, cuts[1..] = inter-lyric
      const cuts = await findBestCutPoints(audioFile, lines.length);
      // boundaries: [introEnd, cut1, cut2, ..., totalDuration]
      const boundaries = [...cuts, duration];

      setLyricsLines(
        lines.map((text, i) => ({
          text,
          start: boundaries[i],
          end: boundaries[i + 1] ?? duration,
        }))
      );
      setCurrentLineIndex(-1);
    } catch {
      // Fallback: skip first quarter as intro, distribute rest evenly
      const introEnd = duration * 0.1;
      const step = (duration - introEnd) / lines.length;
      setLyricsLines(
        lines.map((text, i) => ({
          text,
          start: introEnd + i * step,
          end: introEnd + (i + 1) * step,
        }))
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getAudioCacheKey = (file: File) =>
    `lvg_transcribe_${file.name}_${file.size}_${file.lastModified}`;

  const applyTranscribeResult = (
    geminiLines: { text: string; start: number; end: number }[],
    keepManual = false,
  ) => {
    const manualLines = lyricsText.split("\n").map((l) => l.trim()).filter(Boolean);

    if (keepManual && manualLines.length > 0 && geminiLines.length > 0) {
      // Keep user's typed text; assign Gemini timestamps line-by-line
      const avgDur =
        geminiLines.length > 1
          ? (geminiLines[geminiLines.length - 1].end - geminiLines[0].start) / geminiLines.length
          : Math.max(1, geminiLines[0].end - geminiLines[0].start);
      const lastEnd = geminiLines[geminiLines.length - 1].end;

      const synced = manualLines.map((text, i) => {
        if (i < geminiLines.length) {
          return { text, start: geminiLines[i].start, end: geminiLines[i].end };
        }
        // Extra manual lines beyond Gemini count → extend proportionally
        const extra = i - geminiLines.length;
        return { text, start: lastEnd + extra * avgDur, end: lastEnd + (extra + 1) * avgDur };
      });
      setLyricsLines(synced);
    } else {
      setLyricsText(geminiLines.map((l) => l.text).join("\n"));
      setLyricsLines(geminiLines);
    }
    setCurrentLineIndex(-1);
  };

  const handleAiTranscribe = async (forceRefresh = false, keepManual = false) => {
    if (!audioFile) return;
    keepManual ? setIsSyncing(true) : setIsTranscribing(true);
    setTranscribeError(null);
    setTranscribeFromCache(false);

    const cacheKey = getAudioCacheKey(audioFile);

    try {
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const lines = JSON.parse(cached) as { text: string; start: number; end: number }[];
          applyTranscribeResult(lines, keepManual);
          setTranscribeFromCache(true);
          return;
        }
      }

      // Read audio as base64
      const arrayBuffer = await audioFile.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.byteLength; i++) binary += String.fromCharCode(uint8[i]);
      const audioBase64 = btoa(binary);
      const mimeType = audioFile.type || "audio/mpeg";

      const res = await fetch("/api/transcribe-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audioBase64, mimeType }),
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

      // Save to cache then apply
      try { localStorage.setItem(cacheKey, JSON.stringify(lines)); } catch { /* quota exceeded — ignore */ }
      applyTranscribeResult(lines, keepManual);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsTranscribing(false);
      setIsSyncing(false);
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
    if (currentLineIndex >= newLines.length) setCurrentLineIndex(newLines.length - 1);
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

  const handleExportVideo = async () => {
    if (!wavesurferRef.current || !isReady) return;
    setIsExporting(true);
    setExportProgress(0);

    const W = 1280, H = 720;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // Audio stream
    const mediaEl = wavesurferRef.current.getMediaElement() as HTMLMediaElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const audioStream = mediaEl.captureStream?.() ?? mediaEl.mozCaptureStream?.();
    const canvasStream = canvas.captureStream(30);
    const combined = audioStream
      ? new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()])
      : canvasStream;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9" : "video/webm";
    const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (audioFile?.name.replace(/\.[^/.]+$/, "") ?? "lyrics-video") + ".webm";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setIsExporting(false);
      setExportProgress(0);
    };

    // Snapshot style + effect at export time
    const styleColors = CANVAS_COLORS[lyricStyleId] ?? CANVAS_COLORS.purple;
    const effect = lyricEffect;
    const WIPE_HOLD_EXP = 1.5;

    // Preload cover image
    let coverImg: HTMLImageElement | null = null;
    if (coverImage) {
      coverImg = new window.Image();
      coverImg.src = coverImage;
      await new Promise<void>((r) => { coverImg!.onload = r; coverImg!.onerror = r; });
    }

    const lines = lyricsLines;
    const totalDur = wavesurferRef.current.getDuration();
    wavesurferRef.current.seekTo(0);
    await new Promise((r) => setTimeout(r, 100));
    recorder.start(200);
    wavesurferRef.current.play();

    let animId: number;
    let stopped = false;

    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(animId);
      setTimeout(() => recorder.stop(), 400);
    };
    wavesurferRef.current.once("finish", stop);

    const fontPct = lyricFontSize;
    const preroll = prerollSeconds;
    const drawFrame = () => {
      const ws = wavesurferRef.current;
      if (!ws || stopped) return;
      const time = ws.getCurrentTime();
      if (totalDur > 0) setExportProgress(Math.min(1, time / totalDur));
      drawLyricFrame(ctx, W, H, time, lines, coverImg, styleColors, effect, fontPct, preroll);
      if (!stopped) animId = requestAnimationFrame(drawFrame);
    };
    animId = requestAnimationFrame(drawFrame);
  };

  // ── MP4 export: offline rendering via WebCodecs + mp4-muxer ──────────────
  const handleExportVideoMp4 = async () => {
    if (!isReady || lyricsLines.length === 0) return;
    if (typeof VideoEncoder === "undefined") {
      alert("Xuất MP4 cần Chrome 94+ hoặc Edge 94+.\nVui lòng dùng nút WebM nếu trình duyệt không hỗ trợ.");
      return;
    }
    setExportingFormat("mp4");
    setIsExporting(true);
    setExportProgress(0);

    const W = 1280, H = 720, FPS = 30;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    const styleColors = CANVAS_COLORS[lyricStyleId] ?? CANVAS_COLORS.purple;
    const effect = lyricEffect;
    const fontPct = lyricFontSize;
    const preroll = prerollSeconds;
    const lines = lyricsLines;
    const totalDur = duration || (lines.length > 0 ? lines[lines.length - 1].end + 2 : 60);
    const totalFrames = Math.ceil(totalDur * FPS);

    // Preload cover image
    let coverImg: HTMLImageElement | null = null;
    if (coverImage) {
      coverImg = new window.Image();
      coverImg.src = coverImage;
      await new Promise<void>((r) => { coverImg!.onload = r; coverImg!.onerror = r; });
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

    // VideoEncoder
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta ?? {}),
      error: (e) => { throw e; },
    });
    videoEncoder.configure({
      codec: "avc1.42001f",
      width: W, height: H,
      bitrate: 6_000_000,
      framerate: FPS,
      latencyMode: "quality",
    });

    // Audio: decode + encode before video frames
    if (hasAudio && audioFile) {
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta ?? {}),
        error: (e) => { throw e; },
      });
      audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 2, bitrate: 128_000 });

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
        const ad = new AudioData({ format: "f32-planar", sampleRate: 44100, numberOfFrames: n, numberOfChannels: numCh, timestamp: Math.round(i / decoded.sampleRate * 1_000_000), data });
        audioEncoder.encode(ad);
        ad.close();
      }
      await audioEncoder.flush();
    }

    // Render all video frames offline (fast, no real-time dependency)
    for (let fi = 0; fi < totalFrames; fi++) {
      drawLyricFrame(ctx, W, H, fi / FPS, lines, coverImg, styleColors, effect, fontPct, preroll);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(fi / FPS * 1_000_000), duration: Math.round(1_000_000 / FPS) });
      videoEncoder.encode(vf, { keyFrame: fi % 90 === 0 });
      vf.close();
      if (fi % 30 === 0) {
        setExportProgress(fi / totalFrames);
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    setExportProgress(0.95);
    await videoEncoder.flush();
    muxer.finalize();

    const blob = new Blob([target.buffer], { type: "video/mp4" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (audioFile?.name.replace(/\.[^/.]+$/, "") ?? "lyrics-video") + ".mp4";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setIsExporting(false);
    setExportProgress(0);
  };

  const handlePlayPause = () => wavesurferRef.current?.playPause();
  const handleRestart = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.seekTo(0);
    wavesurferRef.current.play();
  };

  const lineCount = lyricsText.split("\n").filter((l) => l.trim()).length;

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

  // Wipe: hold fully-visible for 1.5 s, then sweep the remaining duration
  const WIPE_HOLD = 1.5;
  const lineDuration = currentLine ? Math.max(0.001, currentLine.end - currentLine.start) : 1;
  const wipeProgress = lineDuration > WIPE_HOLD
    ? Math.max(0, Math.min(1,
        (lineProgress * lineDuration - WIPE_HOLD) / (lineDuration - WIPE_HOLD)
      ))
    : lineProgress;

  // Per-effect opacity target (goes into Framer Motion animate so it wins)
  const effectOpacity =
    lyricEffect === "fade" ? Math.max(0, 1 - wipeProgress)
    : lyricEffect === "wave" ? 1
    : lyricEffect === "blur" ? Math.max(0, 1 - wipeProgress * 0.85)
    : 1;

  // Per-effect CSS filter (safe in style — not in animate, so no conflict)
  const effectFilter =
    lyricEffect === "blur"
      ? `blur(${(wipeProgress * 14).toFixed(1)}px) saturate(${Math.max(0, 1 - wipeProgress * 0.6).toFixed(2)})`
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

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT PANEL ─────────────────────────────────────── */}
        <aside className="w-80 shrink-0 border-r border-white/[0.06] flex flex-col overflow-y-auto bg-[#0d0d0d]">
          <div className="p-5 space-y-6">

            {/* Cover Upload */}
            <section>
              <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2">Cover 16:9</p>
              <label className="block cursor-pointer group">
                <input type="file" accept="image/*" className="sr-only" onChange={handleCoverUpload} />
                <div className="aspect-video rounded-xl overflow-hidden border border-white/[0.08] group-hover:border-violet-500/40 transition-colors relative bg-white/[0.03]">
                  {coverImage ? (
                    <>
                      <img src={coverImage} className="w-full h-full object-cover" alt="cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <Upload className="w-6 h-6 text-white" />
                      </div>
                    </>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-white/[0.05] group-hover:bg-violet-500/10 flex items-center justify-center transition-colors">
                        <Image className="w-5 h-5 text-white/20 group-hover:text-violet-400 transition-colors" />
                      </div>
                      <p className="text-xs text-white/25 group-hover:text-white/40 transition-colors">Upload cover image</p>
                    </div>
                  )}
                </div>
              </label>
            </section>

            {/* Audio Upload */}
            <section>
              <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2">Audio MP3</p>
              <label className="block cursor-pointer group">
                <input type="file" accept="audio/*" className="sr-only" onChange={handleAudioUpload} />
                <div className={`p-3.5 rounded-xl border transition-all ${
                  audioFile
                    ? "border-violet-500/30 bg-violet-500/[0.06]"
                    : "border-white/[0.08] bg-white/[0.03] group-hover:border-violet-500/30 group-hover:bg-violet-500/[0.04]"
                }`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg shrink-0 flex items-center justify-center ${
                      audioFile ? "bg-violet-500/20" : "bg-white/[0.06] group-hover:bg-violet-500/10 transition-colors"
                    }`}>
                      <Music className={`w-4 h-4 ${audioFile ? "text-violet-400" : "text-white/25 group-hover:text-violet-400 transition-colors"}`} />
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm font-medium truncate ${audioFile ? "text-white/80" : "text-white/30 group-hover:text-white/50 transition-colors"}`}>
                        {audioFile ? audioFile.name : "Upload audio file"}
                      </p>
                      {audioFile && (
                        <p className="text-xs text-white/30 mt-0.5">
                          {(audioFile.size / 1024 / 1024).toFixed(1)} MB
                          {isReady && <span className="ml-1 text-violet-400">· {formatTime(duration)}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </label>
            </section>

            {/* AI Transcribe Button */}
            <section>
              <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2">
                Nhận diện lời bài hát (AI)
              </p>

              {/* Primary: full AI transcription (replaces text + timestamps) */}
              <button
                onClick={() => handleAiTranscribe(false)}
                disabled={!audioFile || isTranscribing || isSyncing || isAnalyzing}
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all
                  bg-gradient-to-r from-emerald-600 to-teal-600
                  hover:from-emerald-500 hover:to-teal-500
                  shadow-lg shadow-emerald-500/20
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {isTranscribing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang nhận diện...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Nhận diện với Gemini AI
                  </>
                )}
              </button>

              {/* Secondary: sync timing to manually-typed lyrics */}
              <button
                onClick={() => handleAiTranscribe(false, true)}
                disabled={!audioFile || isTranscribing || isSyncing || isAnalyzing}
                className="mt-2 w-full h-9 rounded-xl font-semibold text-xs flex items-center justify-center gap-2 transition-all
                  border border-violet-500/30 text-violet-300/80
                  hover:bg-violet-500/10 hover:border-violet-500/60 hover:text-violet-200
                  disabled:opacity-30 disabled:cursor-not-allowed"
                title="Giữ nguyên lời nhập tay, chỉ lấy timestamps từ Gemini"
              >
                {isSyncing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang đồng bộ...
                  </>
                ) : (
                  <>
                    <span className="text-base leading-none">⇌</span>
                    Đồng bộ timestamps với lời nhập tay
                  </>
                )}
              </button>

              {/* Status row */}
              <div className="mt-1.5 flex items-center justify-between gap-2 min-h-[18px]">
                {transcribeFromCache ? (
                  <p className="text-[10px] text-emerald-400/80 flex items-center gap-1">
                    <span>⚡</span> Dùng kết quả đã lưu
                  </p>
                ) : (
                  <p className="text-[10px] text-white/20">
                    Gemini tự nghe và trả về lời + timestamp
                  </p>
                )}
                {/* Show "Nhận diện lại" whenever audio is loaded — not just after a cache hit */}
                {audioFile && (lyricsLines.length > 0 || transcribeFromCache) && (
                  <button
                    onClick={() => handleAiTranscribe(true)}
                    disabled={isTranscribing || isSyncing}
                    className="text-[10px] text-white/30 hover:text-violet-400 underline underline-offset-2 transition-colors shrink-0 disabled:opacity-30"
                  >
                    Nhận diện lại
                  </button>
                )}
              </div>

              {transcribeError && (
                <p className="text-[11px] text-red-400/80 leading-relaxed">{transcribeError}</p>
              )}
            </section>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[10px] text-white/20">hoặc nhập thủ công</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Lyrics Input */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">Lyrics</p>
                {lineCount > 0 && <span className="text-[10px] text-white/30">{lineCount} dòng</span>}
              </div>
              <textarea
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                placeholder={"Nhập lyrics ở đây...\nMỗi dòng là một câu\nAuto Timeline sẽ tự xác định thời điểm"}
                className="w-full h-36 bg-white/[0.03] border border-white/[0.08] focus:border-violet-500/40 rounded-xl p-4 text-sm text-white/70 placeholder-white/20 resize-none outline-none transition-all font-mono leading-relaxed"
              />
            </section>

            {/* Auto Timeline Button */}
            <div className="space-y-2">
              <button
                onClick={handleAutoTimeline}
                disabled={!isReady || !lyricsText.trim() || isAnalyzing}
                className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all
                  bg-gradient-to-r from-violet-600 to-fuchsia-600
                  hover:from-violet-500 hover:to-fuchsia-500
                  shadow-lg shadow-violet-500/20
                  disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang phân tích âm thanh...
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    Auto Timeline
                  </>
                )}
              </button>

              {/* Method explanation */}
              <p className="text-[10px] text-white/25 text-center leading-relaxed">
                Phân tích âm thanh và cập nhật timeline theo lời đã nhập ở trên.<br />
                Nhập xong lyrics → nhấn để gán thời gian tự động.
              </p>
            </div>

            {/* Lyric style picker */}
            <section>
              <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2.5">
                Màu chữ
              </p>
              <div className="flex flex-wrap gap-2">
                {LYRIC_STYLES.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setLyricStyleId(s.id)}
                    title={s.label}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                      lyricStyleId === s.id
                        ? "border-white/30 bg-white/[0.1] text-white"
                        : "border-white/[0.06] bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/15"
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: s.dot }}
                    />
                    {s.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Lyric effect picker */}
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30 mb-2">
                Hiệu ứng chữ
              </p>
              <div className="flex flex-wrap gap-2">
                {LYRIC_EFFECTS.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => setLyricEffect(e.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all border ${
                      lyricEffect === e.id
                        ? "border-white/30 bg-white/[0.1] text-white"
                        : "border-white/[0.06] bg-white/[0.03] text-white/40 hover:text-white/70 hover:border-white/15"
                    }`}
                  >
                    {e.label}
                  </button>
                ))}
              </div>
            </section>

            {/* Font size slider */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
                  Cỡ chữ
                </p>
                <span className="text-[10px] font-mono text-violet-400/70">{lyricFontSize}%</span>
              </div>
              <input
                type="range"
                min={60}
                max={180}
                step={5}
                value={lyricFontSize}
                onChange={(e) => setLyricFontSize(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: "#8B5CF6" }}
              />
              <div className="flex justify-between text-[9px] text-white/20 mt-1">
                <span>60%</span><span>100%</span><span>180%</span>
              </div>
            </section>

            {/* Pre-roll slider */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-white/30">
                  Hiện trước
                </p>
                <span className="text-[10px] font-mono text-amber-400/70">
                  {prerollSeconds === 0 ? "tắt" : `${prerollSeconds.toFixed(1)}s`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={3}
                step={0.1}
                value={prerollSeconds}
                onChange={(e) => setPrerollSeconds(Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: "#F59E0B" }}
              />
              <div className="flex justify-between text-[9px] text-white/20 mt-1">
                <span>tắt</span><span>1s</span><span>2s</span><span>3s</span>
              </div>
              <p className="text-[9px] text-white/20 mt-1.5 leading-relaxed">
                Câu hát xuất hiện sớm hơn để người xem chuẩn bị
              </p>
            </section>

            {/* Timeline list */}
            {lyricsLines.length > 0 && (
              <section>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2">
                  Timeline — {lyricsLines.length} dòng
                </p>
                <div className="space-y-0.5 max-h-52 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                  {lyricsLines.map((line, i) => (
                    <div
                      key={i}
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
                          {formatTime(line.start)}
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
                            {formatTime(line.end)}
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
                  ))}
                </div>
                <p className="text-[10px] text-white/20 mt-1.5 text-center">
                  <span className="text-violet-400/50">start</span> ·{" "}
                  <span className="text-emerald-400/50">giây</span> ·{" "}
                  <span className="text-teal-400/50">end</span> nhấn để sửa · ✏ lời · ✂ cắt · 🗑 xoá · Enter lưu · Esc huỷ
                </p>
              </section>
            )}
          </div>
        </aside>

        {/* ── RIGHT PANEL ────────────────────────────────────── */}
        <main className="flex-1 flex flex-col items-center gap-5 px-8 py-6 overflow-y-auto">

          {/* 16:9 Video Preview */}
          <div className="w-full max-w-[800px]">
            <div className="aspect-video rounded-2xl overflow-hidden relative shadow-2xl shadow-black/70 ring-1 ring-white/[0.06]">
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
                    /* Current line — one motion.div, effect applied via animate + style */
                    <div className="absolute inset-0 flex flex-col justify-end items-center pb-10">
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
                            maxWidth: "90%",
                            ...(effectFilter && { filter: effectFilter }),
                          }}
                        >
                          {lyricEffect === "wave" ? (
                            /* Wave: static text + animated swoosh underline draws L→R */
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                              <p style={{
                                fontSize: `calc(clamp(1.3rem, 3.4vw, 2.1rem) * ${lyricFontSize / 100})`,
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
                                viewBox="0 0 400 22"
                                style={{ width: "88%", height: "22px", overflow: "visible", display: "block" }}
                                preserveAspectRatio="none"
                              >
                                <motion.path
                                  key={`wave-${currentLineIndex}`}
                                  d="M 0 11 C 25 3, 50 19, 75 11 C 100 3, 125 19, 150 11 C 175 3, 200 19, 225 11 C 250 3, 275 19, 300 11 C 325 3, 350 19, 375 11 C 387 5, 395 14, 400 11"
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
                              fontSize={`calc(clamp(1.3rem, 3.4vw, 2.1rem) * ${lyricFontSize / 100})`}
                            />
                          ) : lyricEffect === "wipe" ? (
                            /* Wipe: word-by-word erase left→right after 1.5 s hold */
                            <WipeText
                              text={currentLine?.text ?? ""}
                              wipeProgress={wipeProgress}
                              style={activeStyle}
                              fontSize={`calc(clamp(1.3rem, 3.4vw, 2.1rem) * ${lyricFontSize / 100})`}
                            />
                          ) : (
                            <p style={{
                              fontSize: `calc(clamp(1.3rem, 3.4vw, 2.1rem) * ${lyricFontSize / 100})`,
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
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex gap-1.5 items-end h-6">
                        {[0, 1, 2, 3, 4].map((i) => (
                          <span
                            key={i}
                            className="w-1 rounded-full bg-white/20"
                            style={{
                              height: `${40 + Math.sin(i * 1.3) * 30}%`,
                              animation: isPlaying ? `bounce 0.8s ease-in-out ${i * 0.12}s infinite alternate` : "none",
                            }}
                          />
                        ))}
                      </div>
                      {lyricsLines[0] && (
                        <p className="text-[11px] text-white/25 font-mono">
                          lời bắt đầu lúc {formatTime(lyricsLines[0].start)}
                        </p>
                      )}
                    </div>
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

          {/* Audio Player */}
          <div className="w-full max-w-[800px] bg-white/[0.04] border border-white/[0.07] rounded-2xl p-5">
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
                      {audioFile?.name.replace(/\.[^/.]+$/, "")}
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

                  {/* Export buttons — WebM (real-time) + MP4 (offline WebCodecs) */}
                  <div className="shrink-0 flex gap-1.5">
                    <button
                      onClick={() => { setExportingFormat("webm"); handleExportVideo(); }}
                      disabled={!isReady || lyricsLines.length === 0 || isExporting}
                      title="Xuất WebM — realtime, hỗ trợ mọi trình duyệt"
                      className="relative h-9 px-3 rounded-xl flex items-center gap-1.5 font-semibold text-xs transition-all
                        border border-violet-500/40 text-violet-300
                        hover:bg-violet-500/10 hover:border-violet-400/60
                        disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
                    >
                      {isExporting && exportingFormat === "webm" ? (
                        <>
                          <span className="absolute inset-0 bg-violet-500/20 origin-left" style={{ transform: `scaleX(${exportProgress})`, transition: "transform 0.4s linear" }} />
                          <Loader2 className="w-3 h-3 animate-spin relative z-10" />
                          <span className="relative z-10">{Math.round(exportProgress * 100)}%</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" />
                          WebM
                        </>
                      )}
                    </button>

                    <button
                      onClick={handleExportVideoMp4}
                      disabled={!isReady || lyricsLines.length === 0 || isExporting}
                      title="Xuất MP4 — offline rendering, cần Chrome/Edge 94+"
                      className="relative h-9 px-3 rounded-xl flex items-center gap-1.5 font-semibold text-xs transition-all
                        bg-gradient-to-r from-fuchsia-600 to-violet-600
                        hover:from-fuchsia-500 hover:to-violet-500
                        shadow-md shadow-violet-500/25
                        disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none overflow-hidden"
                    >
                      {isExporting && exportingFormat === "mp4" ? (
                        <>
                          <span className="absolute inset-0 bg-white/15 origin-left" style={{ transform: `scaleX(${exportProgress})`, transition: "transform 0.4s linear" }} />
                          <Loader2 className="w-3 h-3 animate-spin relative z-10" />
                          <span className="relative z-10">{Math.round(exportProgress * 100)}%</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3 h-3" />
                          MP4
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 flex flex-col items-center gap-3 text-white/20">
                <div className="w-12 h-12 rounded-xl bg-white/[0.05] flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <p className="text-sm">Upload file nhạc để xem audio player</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
