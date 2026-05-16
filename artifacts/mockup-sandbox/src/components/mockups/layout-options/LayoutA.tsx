export function LayoutA() {
  return (
    <div className="w-full h-screen bg-[#0a0a0a] flex flex-col text-white overflow-hidden font-sans">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center gap-3 px-5 border-b border-white/[0.06] bg-[#0d0d0d]">
        <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-sm">♪</div>
        <span className="font-bold text-sm tracking-tight">Lyrics Video Generator</span>
        <span className="ml-3 text-xs text-white/30 bg-white/[0.05] px-2 py-0.5 rounded-full">Phương án A — 3 cột</span>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── COL 1: Upload + AI ─────────────────────────── */}
        <aside className="w-[260px] shrink-0 border-r border-white/[0.06] bg-[#0d0d0d] flex flex-col overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Cover */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Cover 16:9</p>
              <div className="aspect-video rounded-xl border border-white/[0.08] bg-white/[0.03] flex flex-col items-center justify-center gap-1">
                <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-base">🖼</div>
                <p className="text-[10px] text-white/20">Upload ảnh bìa</p>
              </div>
            </div>

            {/* Audio */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Audio MP3</p>
              <div className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.03] flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-sm shrink-0">🎵</div>
                <p className="text-xs text-white/25">Upload file nhạc</p>
              </div>
            </div>

            {/* AI Section */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Nhận diện AI</p>
              <button className="w-full h-10 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-xs font-semibold flex items-center justify-center gap-1.5">
                ✦ Nhận diện với Gemini AI
              </button>
              <button className="mt-1.5 w-full h-8 rounded-xl border border-violet-500/30 text-violet-300/80 text-xs flex items-center justify-center gap-1.5">
                ⇌ Đồng bộ timestamps
              </button>
              <p className="mt-1.5 text-[9px] text-white/20 text-center">Gemini tự nghe và trả về lời + timestamp</p>
              <button className="mt-2 flex items-center gap-1 text-[9px] text-white/20 hover:text-violet-400">
                ▾ Prompt gửi Gemini
              </button>
            </div>

            {/* Divider */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="text-[9px] text-white/15">hoặc nhập tay</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>

            {/* Lyrics textarea */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Lyrics</p>
              <div className="w-full h-32 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                <p className="text-[10px] text-white/20 font-mono leading-relaxed">Nhập lyrics ở đây...<br/>Mỗi dòng là một câu</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ── COL 2: Video + Player ─────────────────────── */}
        <main className="flex-1 flex flex-col items-center gap-4 px-6 py-5 overflow-y-auto bg-[#0a0a0a]">
          {/* Video preview — bigger because left/right cols absorbed the clutter */}
          <div className="w-full max-w-[820px]">
            <div className="aspect-video rounded-2xl overflow-hidden relative shadow-2xl shadow-black/70 ring-1 ring-white/[0.06] bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#050d1a] flex items-end justify-center pb-10">
              <div className="text-center">
                <p className="text-xl font-bold text-white/80">♪ Lyrics hiển thị ở đây</p>
                <p className="text-xs text-violet-400 mt-1">hiệu ứng karaoke / wipe / fade...</p>
              </div>
              <div className="absolute bottom-2 right-3 text-[9px] font-mono text-white/25 bg-black/40 px-2 py-1 rounded">0:00 / 3:45</div>
            </div>
          </div>

          {/* Audio player */}
          <div className="w-full max-w-[820px] bg-white/[0.04] border border-white/[0.07] rounded-2xl p-4">
            <div className="h-12 rounded-lg bg-white/[0.03] border border-white/[0.05] mb-3 flex items-center px-3">
              <p className="text-[10px] text-white/20">▬▬▬▬ waveform ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬</p>
            </div>
            <div className="flex items-center gap-3">
              <button className="w-9 h-9 rounded-full bg-white/[0.07] flex items-center justify-center text-xs">⏮</button>
              <button className="w-11 h-11 rounded-full bg-white flex items-center justify-center text-black text-sm font-bold">▶</button>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white/70 truncate">Tên bài hát</p>
                <p className="text-[10px] text-white/30 font-mono">0:00 / 3:45</p>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                <span className="text-[10px] text-violet-300">Syncing</span>
              </div>
              <div className="flex gap-1.5">
                <button className="h-8 px-3 rounded-xl border border-violet-500/40 text-violet-300 text-[10px] font-semibold">WebM</button>
                <button className="h-8 px-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white text-[10px] font-semibold">MP4</button>
              </div>
            </div>
          </div>
        </main>

        {/* ── COL 3: Style + Timeline ───────────────────── */}
        <aside className="w-[260px] shrink-0 border-l border-white/[0.06] bg-[#0d0d0d] flex flex-col overflow-y-auto">
          <div className="p-4 space-y-4">
            {/* Auto Timeline */}
            <button className="w-full h-10 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-xs font-semibold flex items-center justify-center gap-1.5">
              ✦ Auto Timeline
            </button>
            <p className="text-[9px] text-white/20 text-center -mt-2 leading-relaxed">Phân tích âm thanh và gán thời gian tự động</p>

            {/* Color */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Màu chữ</p>
              <div className="flex flex-wrap gap-1.5">
                {["#fff","#a78bfa","#34d399","#f59e0b","#f43f5e","#38bdf8"].map((c,i) => (
                  <div key={i} className={`w-6 h-6 rounded-full border-2 ${i===0?"border-white":"border-transparent"}`} style={{background:c}} />
                ))}
                <div className="px-2 py-1 rounded-lg border border-white/[0.06] text-[9px] text-white/40 bg-white/[0.03]">Gradient</div>
                <div className="px-2 py-1 rounded-lg border border-white/[0.06] text-[9px] text-white/40 bg-white/[0.03]">Fire</div>
              </div>
            </div>

            {/* Effect */}
            <div>
              <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30 mb-1.5">Hiệu ứng chữ</p>
              <div className="flex flex-wrap gap-1">
                {["Fade","Slide","Pop","Wipe","Karaoke","Wave"].map((e,i) => (
                  <button key={e} className={`px-2 py-1 rounded-lg text-[9px] border ${i===3?"border-white/30 bg-white/[0.1] text-white":"border-white/[0.06] text-white/40"}`}>{e}</button>
                ))}
              </div>
            </div>

            {/* Font size */}
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Cỡ chữ</p>
                <span className="text-[9px] font-mono text-violet-400/70">100%</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.08] relative">
                <div className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-violet-500" />
                <div className="absolute top-1/2 -translate-y-1/2 left-1/3 w-3 h-3 rounded-full bg-violet-400 -translate-x-1.5" />
              </div>
            </div>

            {/* Pre-roll */}
            <div>
              <div className="flex justify-between mb-1">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30">Hiện trước</p>
                <span className="text-[9px] font-mono text-amber-400/70">1.0s</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/[0.08] relative">
                <div className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-amber-500" />
                <div className="absolute top-1/2 -translate-y-1/2 left-1/3 w-3 h-3 rounded-full bg-amber-400 -translate-x-1.5" />
              </div>
            </div>

            {/* Timeline */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30">Timeline — 12 dòng</p>
                <div className="flex gap-1">
                  <button className="text-[9px] text-white/25 hover:text-violet-400">↑ Import</button>
                  <button className="text-[9px] text-white/25 hover:text-violet-400">↓ Export</button>
                </div>
              </div>
              <div className="space-y-0.5 max-h-44 overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                {["00:05 — Em ơi Hà Nội phố", "00:12 — Ta còn em mùi hoàng lan", "00:19 — Ta còn em mùi hoa sữa", "00:26 — Con đường vắng rì rào cơn mưa nhỏ", "00:34 — Ai đó chờ ai tóc xõa vai mềm"].map((l,i) => (
                  <div key={i} className={`px-2 py-1.5 rounded-lg ${i===1?"bg-violet-500/15 border border-violet-500/30":"hover:bg-white/[0.04]"}`}>
                    <p className={`text-[9px] font-mono truncate ${i===1?"text-violet-300":"text-white/40"}`}>{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
