import { useState } from "react";

export function LayoutC() {
  const [tab, setTab] = useState<"input"|"style"|"timeline">("input");
  return (
    <div className="w-full h-screen bg-[#0a0a0a] flex flex-col text-white overflow-hidden font-sans">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center gap-3 px-5 border-b border-white/[0.06] bg-[#0d0d0d]">
        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-sm">♪</div>
        <span className="font-bold text-sm tracking-tight">Lyrics Video Generator</span>
        <span className="ml-3 text-xs text-white/30 bg-white/[0.05] px-2 py-0.5 rounded-full">Phương án C — Preview lớn + Panel tab</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── LEFT: Large preview + player ─────────────── */}
        <main className="flex-1 flex flex-col gap-4 p-5 overflow-y-auto bg-[#0a0a0a]">
          {/* Big video preview */}
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full">
              <div className="aspect-video rounded-2xl overflow-hidden relative shadow-2xl shadow-black/70 ring-1 ring-white/[0.06] bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#050d1a] flex items-end justify-center pb-10">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white/80">♪ Em ơi Hà Nội phố</p>
                  <p className="text-sm text-violet-400 mt-1">Hiệu ứng karaoke • đang phát</p>
                </div>
                <div className="absolute bottom-2 right-3 text-[9px] font-mono text-white/25 bg-black/40 px-2 py-1 rounded">0:32 / 3:45</div>
              </div>
            </div>
          </div>

          {/* Audio player */}
          <div className="bg-white/[0.04] border border-white/[0.07] rounded-2xl p-4 shrink-0">
            <div className="h-10 rounded-lg bg-white/[0.03] border border-white/[0.05] mb-3 flex items-center px-3">
              <p className="text-[10px] text-white/20">▬▬▬▬▬▬▬ waveform ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬</p>
            </div>
            <div className="flex items-center gap-3">
              <button className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center text-sm">⏮</button>
              <button className="w-12 h-12 rounded-full bg-white flex items-center justify-center text-black text-base font-bold">⏸</button>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/80">bai-hat-01.mp3</p>
                <p className="text-xs text-white/30 font-mono">0:32 <span className="text-white/20">/ 3:45</span> <span className="ml-2 text-violet-400/70">· dòng 3/12</span></p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-[11px] text-violet-300">Syncing</span>
              </div>
              <div className="flex gap-1.5">
                <button className="h-9 px-3 rounded-xl border border-violet-500/40 text-violet-300 text-xs font-semibold">↓ WebM</button>
                <button className="h-9 px-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white text-xs font-semibold">↓ MP4</button>
              </div>
            </div>
          </div>
        </main>

        {/* ── RIGHT: Tabbed panel ───────────────────────── */}
        <aside className="w-[320px] shrink-0 border-l border-white/[0.06] bg-[#0d0d0d] flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-white/[0.06] px-2 pt-2 gap-1">
            {(["input","style","timeline"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-2 text-[10px] font-semibold rounded-t-lg transition-colors ${
                  tab === t
                    ? "text-white bg-white/[0.06] border-b-2 border-violet-500"
                    : "text-white/30 hover:text-white/50"
                }`}
              >
                {t === "input" ? "📥 Nhập liệu" : t === "style" ? "🎨 Phong cách" : "⏱ Timeline"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">
            {tab === "input" && (
              <div className="space-y-4">
                {/* Cover */}
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Cover 16:9</p>
                  <div className="aspect-video rounded-xl border border-white/[0.08] bg-white/[0.03] flex flex-col items-center justify-center gap-1">
                    <div className="text-base">🖼</div>
                    <p className="text-[9px] text-white/20">Upload ảnh bìa</p>
                  </div>
                </div>
                {/* Audio */}
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Audio MP3</p>
                  <div className="p-3 rounded-xl border border-violet-500/30 bg-violet-500/[0.06] flex items-center gap-2">
                    <span className="text-sm shrink-0">🎵</span>
                    <div>
                      <p className="text-[10px] text-white/70 font-medium">bai-hat-01.mp3</p>
                      <p className="text-[9px] text-white/30">3.2 MB · 3:45</p>
                    </div>
                  </div>
                </div>
                {/* AI */}
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Nhận diện AI</p>
                  <button className="w-full h-10 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-[10px] font-semibold flex items-center justify-center gap-1.5">
                    ✦ Nhận diện với Gemini AI
                  </button>
                  <button className="mt-1.5 w-full h-8 rounded-xl border border-violet-500/30 text-violet-300/80 text-[10px] flex items-center justify-center gap-1.5">
                    ⇌ Đồng bộ timestamps với lời nhập tay
                  </button>
                  <button className="mt-2 flex items-center gap-1 text-[9px] text-white/20">▾ Prompt gửi Gemini</button>
                </div>
                {/* Divider */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-px bg-white/[0.06]" />
                  <span className="text-[9px] text-white/15">hoặc nhập tay</span>
                  <div className="flex-1 h-px bg-white/[0.06]" />
                </div>
                {/* Lyrics */}
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Lyrics</p>
                  <div className="w-full h-36 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                    <p className="text-[9px] text-white/30 font-mono leading-relaxed">Em ơi Hà Nội phố<br/>Ta còn em mùi hoàng lan<br/>Ta còn em mùi hoa sữa<br/>...</p>
                  </div>
                </div>
                <button className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-[10px] font-semibold flex items-center justify-center gap-1.5">
                  ✦ Auto Timeline
                </button>
              </div>
            )}

            {tab === "style" && (
              <div className="space-y-5">
                {/* Color */}
                <div>
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-2">Màu chữ</p>
                  <div className="flex flex-wrap gap-2">
                    {["#fff","#a78bfa","#34d399","#f59e0b","#f43f5e","#38bdf8"].map((c,i) => (
                      <div key={i} className={`w-7 h-7 rounded-full border-2 ${i===0?"border-white":"border-transparent"}`} style={{background:c}} />
                    ))}
                    <div className="px-2.5 py-1 rounded-lg border border-white/[0.06] text-[9px] text-white/40 bg-white/[0.03]">Gradient</div>
                    <div className="px-2.5 py-1 rounded-lg border border-white/[0.06] text-[9px] text-white/40 bg-white/[0.03]">Fire</div>
                    <div className="px-2.5 py-1 rounded-lg border border-white/[0.06] text-[9px] text-white/40 bg-white/[0.03]">Dot</div>
                  </div>
                </div>
                {/* Effects */}
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 mb-2">Hiệu ứng chữ</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["Fade","Slide","Pop","Wipe","Karaoke","Wave"].map((e,i) => (
                      <button key={e} className={`px-2.5 py-1.5 rounded-lg text-[10px] border ${i===4?"border-white/30 bg-white/[0.1] text-white":"border-white/[0.06] text-white/40"}`}>{e}</button>
                    ))}
                  </div>
                </div>
                {/* Font size */}
                <div>
                  <div className="flex justify-between mb-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Cỡ chữ</p>
                    <span className="text-[9px] font-mono text-violet-400/70">100%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/[0.08] relative">
                    <div className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-violet-500" />
                    <div className="absolute top-1/2 -translate-y-1/2 left-1/3 w-3 h-3 rounded-full bg-violet-400 -translate-x-1.5" />
                  </div>
                  <div className="flex justify-between text-[9px] text-white/20 mt-1"><span>60%</span><span>100%</span><span>180%</span></div>
                </div>
                {/* Pre-roll */}
                <div>
                  <div className="flex justify-between mb-2">
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Hiện trước</p>
                    <span className="text-[9px] font-mono text-amber-400/70">1.0s</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/[0.08] relative">
                    <div className="absolute left-0 top-0 h-full w-1/4 rounded-full bg-amber-500" />
                    <div className="absolute top-1/2 -translate-y-1/2 left-1/4 w-3 h-3 rounded-full bg-amber-400 -translate-x-1.5" />
                  </div>
                </div>
              </div>
            )}

            {tab === "timeline" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30">Timeline — 12 dòng</p>
                  <div className="flex gap-2">
                    <button className="text-[9px] text-white/25 hover:text-violet-400">↑ Import</button>
                    <button className="text-[9px] text-white/25 hover:text-violet-400">↓ Export</button>
                  </div>
                </div>
                <div className="space-y-0.5">
                  {[
                    ["00:05","Em ơi Hà Nội phố"],
                    ["00:12","Ta còn em mùi hoàng lan"],
                    ["00:19","Ta còn em mùi hoa sữa"],
                    ["00:26","Con đường vắng rì rào cơn mưa nhỏ"],
                    ["00:34","Ai đó chờ ai tóc xõa vai mềm"],
                    ["00:42","Ta còn em tiếng còi xe đêm khuya"],
                    ["00:50","Và mùi khói chiều đông"],
                  ].map(([time, text], i) => (
                    <div key={i} className={`px-3 py-2 rounded-xl border ${i===2?"border-violet-500/30 bg-violet-500/10":"border-white/[0.04] bg-white/[0.02] hover:bg-white/[0.04]"}`}>
                      <div className="flex items-center gap-2">
                        <span className={`text-[9px] font-mono shrink-0 ${i===2?"text-violet-400":"text-white/25"}`}>{time}</span>
                        <span className={`text-[10px] truncate ${i===2?"text-white/80":"text-white/45"}`}>{text}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
