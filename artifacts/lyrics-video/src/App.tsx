import { useState, useRef, useEffect } from "react";
import WaveSurfer from "wavesurfer.js";
import { Music, Image, Play, Pause, Wand2, SkipBack, Upload } from "lucide-react";

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

  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const lyricsViewRef = useRef<HTMLDivElement>(null);

  // Init / reload WaveSurfer when audio changes
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

    return () => {
      ws.destroy();
    };
  }, [audioUrl]);

  // Update current lyric line
  useEffect(() => {
    if (!lyricsLines.length) return;
    let idx = -1;
    for (let i = 0; i < lyricsLines.length; i++) {
      if (currentTime >= lyricsLines[i].start) idx = i;
    }
    setCurrentLineIndex(idx);
  }, [currentTime, lyricsLines]);

  // Auto-scroll lyrics in preview
  useEffect(() => {
    if (!lyricsViewRef.current || currentLineIndex < 0) return;
    const el = lyricsViewRef.current.querySelector<HTMLElement>(`[data-line="${currentLineIndex}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentLineIndex]);

  const handleCoverUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const prev = coverImage;
    if (prev) URL.revokeObjectURL(prev);
    setCoverImage(URL.createObjectURL(file));
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const prev = audioUrl;
    if (prev) URL.revokeObjectURL(prev);
    setAudioFile(file);
    setAudioUrl(URL.createObjectURL(file));
    setLyricsLines([]);
    setCurrentLineIndex(-1);
  };

  const handleAutoTimeline = () => {
    if (!duration || !lyricsText.trim()) return;
    const lines = lyricsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;

    const timePerLine = duration / lines.length;
    setLyricsLines(
      lines.map((text, i) => ({
        text,
        start: i * timePerLine,
        end: (i + 1) * timePerLine,
      }))
    );
    setCurrentLineIndex(-1);
  };

  const handlePlayPause = () => {
    wavesurferRef.current?.playPause();
  };

  const handleRestart = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.seekTo(0);
    wavesurferRef.current.play();
  };

  const lineCount = lyricsText.split("\n").filter((l) => l.trim()).length;

  // Which lines to show in the preview (window around current)
  const windowSize = 5;
  const previewLines = lyricsLines.length > 0
    ? lyricsLines.map((line, i) => ({ ...line, idx: i }))
    : [];

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
                    <img src={coverImage} className="w-full h-full object-cover" alt="cover" />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                      <div className="w-10 h-10 rounded-xl bg-white/[0.05] group-hover:bg-violet-500/10 flex items-center justify-center transition-colors">
                        <Image className="w-5 h-5 text-white/20 group-hover:text-violet-400 transition-colors" />
                      </div>
                      <p className="text-xs text-white/25 group-hover:text-white/40 transition-colors">Upload cover image</p>
                    </div>
                  )}
                  {coverImage && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <Upload className="w-6 h-6 text-white" />
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

            {/* Lyrics Input */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-semibold tracking-[0.12em] uppercase text-white/40">Lyrics</p>
                {lineCount > 0 && (
                  <span className="text-[10px] text-white/30">{lineCount} dòng</span>
                )}
              </div>
              <textarea
                value={lyricsText}
                onChange={(e) => setLyricsText(e.target.value)}
                placeholder={"Nhập lyrics ở đây...\nMỗi dòng là một câu\nAuto Timeline sẽ tự chia thời gian"}
                className="w-full h-48 bg-white/[0.03] border border-white/[0.08] focus:border-violet-500/40 rounded-xl p-4 text-sm text-white/70 placeholder-white/20 resize-none outline-none transition-all font-mono leading-relaxed"
              />
            </section>

            {/* Auto Timeline */}
            <button
              onClick={handleAutoTimeline}
              disabled={!isReady || !lyricsText.trim()}
              className="w-full h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all
                bg-gradient-to-r from-violet-600 to-fuchsia-600
                hover:from-violet-500 hover:to-fuchsia-500
                shadow-lg shadow-violet-500/20
                disabled:opacity-25 disabled:cursor-not-allowed disabled:shadow-none"
            >
              <Wand2 className="w-4 h-4" />
              Auto Timeline
            </button>

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
                      <span className="font-mono text-violet-400/70 shrink-0">{formatTime(line.start)}</span>
                      <span className="truncate">{line.text}</span>
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

              {/* Background layers */}
              {coverImage ? (
                <>
                  <img
                    src={coverImage}
                    className="absolute inset-0 w-full h-full object-cover scale-110"
                    style={{ filter: "blur(24px) brightness(0.35) saturate(1.4)" }}
                    alt=""
                  />
                  <img
                    src={coverImage}
                    className="absolute inset-0 w-full h-full object-contain"
                    alt="cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                </>
              ) : (
                <div className="absolute inset-0 bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#050d1a]" />
              )}

              {/* Lyrics overlay */}
              <div
                ref={lyricsViewRef}
                className="absolute inset-0 flex flex-col items-center justify-center overflow-hidden px-10 py-10"
              >
                {previewLines.length > 0 ? (
                  <div className="w-full flex flex-col items-center gap-2 text-center">
                    {previewLines.map((line) => {
                      const isCurrent = line.idx === currentLineIndex;
                      const isPast = line.idx < currentLineIndex;
                      const distance = Math.abs(line.idx - Math.max(0, currentLineIndex));

                      // Visibility: only show lines within window
                      const visible = distance <= windowSize;
                      if (!visible) return null;

                      return (
                        <p
                          key={line.idx}
                          data-line={line.idx}
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
                )}
              </div>

              {/* Time badge */}
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
                {/* Waveform */}
                <div
                  ref={waveformRef}
                  className="w-full rounded-lg overflow-hidden cursor-pointer"
                />

                {/* Controls row */}
                <div className="flex items-center gap-4">
                  {/* Restart */}
                  <button
                    onClick={handleRestart}
                    disabled={!isReady}
                    title="Restart"
                    className="w-9 h-9 rounded-full bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center transition-colors disabled:opacity-25"
                  >
                    <SkipBack className="w-4 h-4 text-white/70" />
                  </button>

                  {/* Play/Pause */}
                  <button
                    onClick={handlePlayPause}
                    disabled={!isReady}
                    title={isPlaying ? "Pause" : "Play"}
                    className="w-12 h-12 rounded-full bg-white flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-black/30 disabled:opacity-25"
                  >
                    {isPlaying
                      ? <Pause className="w-5 h-5 text-black" />
                      : <Play className="w-5 h-5 text-black ml-0.5" />
                    }
                  </button>

                  {/* Track info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white/80 truncate">
                      {audioFile?.name.replace(/\.[^/.]+$/, "")}
                    </p>
                    <p className="text-xs text-white/35 mt-0.5 font-mono">
                      {formatTime(currentTime)}
                      <span className="text-white/20"> / {formatTime(duration)}</span>
                      {lyricsLines.length > 0 && currentLineIndex >= 0 && (
                        <span className="ml-2 text-violet-400/70 not-mono font-sans">
                          · dòng {currentLineIndex + 1}/{lyricsLines.length}
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Status pill */}
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

          {/* Hint */}
          {!lyricsLines.length && isReady && lyricsText.trim() && (
            <p className="text-xs text-white/25 text-center">
              ↑ Nhấn <span className="text-violet-400/60">Auto Timeline</span> để AI chia thời gian lyrics theo độ dài bài nhạc
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
