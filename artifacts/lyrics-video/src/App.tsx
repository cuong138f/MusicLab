import { useState, useRef, useEffect } from "react";
import WaveSurfer from "wavesurfer.js";
import { Music, Image, Play, Pause, Wand2, SkipBack, Upload, Loader2, Sparkles } from "lucide-react";

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

export default function App() {
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [lyricsText, setLyricsText] = useState("");
  const [lyricsLines, setLyricsLines] = useState<LyricLine[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentLineIndex, setCurrentLineIndex] = useState(-1);
  const [isReady, setIsReady] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);

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
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (currentTime >= lyricsLines[i].start) idx = i;
    }
    setCurrentLineIndex(idx);
  }, [currentTime, lyricsLines]);

  useEffect(() => {
    if (!lyricsViewRef.current || currentLineIndex < 0) return;
    const el = lyricsViewRef.current.querySelector<HTMLElement>(`[data-line="${currentLineIndex}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentLineIndex]);

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

  const handleAiTranscribe = async () => {
    if (!audioFile) return;
    setIsTranscribing(true);
    setTranscribeError(null);

    try {
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

      // Populate both lyricsText and timed lines
      setLyricsText(lines.map((l) => l.text).join("\n"));
      setLyricsLines(lines);
      setCurrentLineIndex(-1);
    } catch (err) {
      setTranscribeError(err instanceof Error ? err.message : "Lỗi không xác định");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handlePlayPause = () => wavesurferRef.current?.playPause();
  const handleRestart = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.seekTo(0);
    wavesurferRef.current.play();
  };

  const lineCount = lyricsText.split("\n").filter((l) => l.trim()).length;
  const windowSize = 5;

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
              <button
                onClick={handleAiTranscribe}
                disabled={!audioFile || isTranscribing || isAnalyzing}
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
              {transcribeError && (
                <p className="mt-2 text-[11px] text-red-400/80 leading-relaxed">{transcribeError}</p>
              )}
              <p className="mt-1.5 text-[10px] text-white/20 leading-relaxed">
                Gemini sẽ tự nghe và trả về lời + timestamp — không cần nhập tay
              </p>
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
                Phân tích năng lượng âm thanh để tìm khoảng lặng tự nhiên,<br />
                tự động gán timestamp cho từng dòng lyrics
              </p>
            </div>

            {/* Timeline list */}
            {lyricsLines.length > 0 && (
              <section>
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40 mb-2">
                  Timeline — {lyricsLines.length} dòng
                </p>
                <div className="space-y-0.5 max-h-44 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                  {lyricsLines.map((line, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
                        i === currentLineIndex
                          ? "bg-violet-500/15 text-white"
                          : "text-white/40 hover:bg-white/[0.04]"
                      }`}
                    >
                      <span className="font-mono text-violet-400/70 shrink-0 tabular-nums">{formatTime(line.start)}</span>
                      <span className="truncate">{line.text}</span>
                      <span className="font-mono text-white/20 shrink-0 ml-auto tabular-nums text-[10px]">
                        {(line.end - line.start).toFixed(1)}s
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </aside>

        {/* ── RIGHT PANEL ────────────────────────────────────── */}
        <main className="flex-1 flex flex-col items-center justify-center gap-5 p-8 overflow-y-auto">

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
                className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-10 py-10"
              >
                {lyricsLines.length > 0 ? (
                  currentLineIndex >= 0 ? (
                    /* ── Active lyrics window ── */
                    <div className="w-full flex flex-col items-center gap-2 text-center">
                      {lyricsLines.map((line, i) => {
                        const isCurrent = i === currentLineIndex;
                        const isPast = i < currentLineIndex;
                        const distance = Math.abs(i - currentLineIndex);
                        if (distance > windowSize) return null;

                        return (
                          <p
                            key={i}
                            data-line={i}
                            className="lyric-line leading-tight"
                            style={{
                              fontSize: isCurrent ? "clamp(1.1rem, 2.8vw, 1.6rem)" : "clamp(0.75rem, 1.8vw, 1rem)",
                              fontWeight: isCurrent ? 700 : 400,
                              opacity: isCurrent ? 1 : isPast ? 0.18 : Math.max(0.12, 0.45 - distance * 0.08),
                              color: "#ffffff",
                              textShadow: isCurrent
                                ? "0 0 40px rgba(168,85,247,0.7), 0 2px 12px rgba(0,0,0,0.9)"
                                : "0 1px 6px rgba(0,0,0,0.7)",
                              transform: isCurrent ? "scale(1.04)" : "scale(1)",
                              letterSpacing: isCurrent ? "0.01em" : "0",
                              maxWidth: "90%",
                              margin: "0 auto",
                            }}
                          >
                            {line.text}
                          </p>
                        );
                      })}
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
