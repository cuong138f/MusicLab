export function LayoutB() {
  return (
    <div className="w-full h-screen bg-[#0a0a0a] flex flex-col text-white overflow-hidden font-sans">
      {/* ── HEADER + TOOLBAR ────────────────────────────── */}
      <header className="shrink-0 border-b border-white/[0.06] bg-[#0d0d0d]">
        {/* App title row */}
        <div className="flex items-center gap-3 px-5 h-12 border-b border-white/[0.04]">
          <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center text-sm">♪</div>
          <span className="font-bold text-sm tracking-tight">Lyrics Video Generator</span>
          <span className="ml-3 text-xs text-white/30 bg-white/[0.05] px-2 py-0.5 rounded-full">Phương án B — Toolbar trên + 2 cột</span>
        </div>
        {/* Tool bar */}
        <div className="flex items-center gap-3 px-5 py-2.5">
          {/* Lyrics + Prompt dropdowns */}
          <button className="text-[9px] text-violet-400 flex items-center gap-1">▾ Lyrics <span className="w-1.5 h-1.5 rounded-full bg-violet-400 ml-0.5" /></button>
          <button className="text-[9px] text-white/20 hover:text-violet-400 flex items-center gap-1">▾ Prompt</button>

          <div className="h-6 w-px bg-white/[0.08] mx-1" />

          {/* Cover thumbnail */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-white/[0.08] bg-white/[0.03] cursor-pointer hover:border-violet-500/30 group">
            <div className="w-10 h-[22px] rounded bg-white/[0.06] flex items-center justify-center text-[10px]">🖼</div>
            <span className="text-[10px] text-white/35">Ảnh bìa</span>
          </div>
          {/* Audio */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-500/30 bg-violet-500/[0.06]">
            <span className="text-sm">🎵</span>
            <span className="text-[10px] text-white/70 font-medium max-w-[120px] truncate">bai-hat-01.mp3</span>
            <span className="text-[9px] text-white/30">3.2 MB · 3:45</span>
          </div>

          <div className="h-6 w-px bg-white/[0.08] mx-1" />

          {/* AI buttons in toolbar */}
          <button className="h-8 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-[10px] font-semibold flex items-center gap-1.5">
            ✦ Nhận diện AI
          </button>
          <button className="h-8 px-3 rounded-xl border border-violet-500/30 text-violet-300/80 text-[10px] flex items-center gap-1.5">
            ⇌ Đồng bộ
          </button>

          <div className="flex-1" />

          {/* Export in toolbar */}
          <div className="flex items-center gap-1.5">
            <button className="h-8 px-3 rounded-xl border border-violet-500/40 text-violet-300 text-[10px] font-semibold">↓ WebM</button>
            <button className="h-8 px-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white text-[10px] font-semibold">↓ MP4</button>
          </div>
        </div>

        {/* Collapsible Lyrics panel (open) */}
        <div className="px-5 py-3 border-t border-white/[0.06] flex gap-4">
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/40">Lyrics</span>
              <span className="text-[9px] text-white/25">12 dòng</span>
            </div>
            <textarea
              readOnly
              value={"Em ơi Hà Nội phố\nTa còn em mùi hoàng lan\nTa còn em mùi hoa sữa\nCon đường vắng rì rào cơn mưa nhỏ\n..."}
              rows={4}
              className="w-full bg-white/[0.03] border border-white/[0.08] rounded-xl p-3 text-[10px] text-white/50 resize-none outline-none font-mono leading-relaxed"
            />
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── COL LEFT: Timeline only ───────────────────── */}
        <aside className="w-[300px] shrink-0 border-r border-white/[0.06] bg-[#0d0d0d] flex flex-col overflow-hidden">
          <div className="p-4 flex flex-col gap-3 h-full">
            {/* Timeline list */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-white/30">Timeline — 12 dòng</p>
                <div className="flex gap-2">
                  <button className="text-[9px] text-white/25">↑ Import</button>
                  <button className="text-[9px] text-white/25">↓ Export</button>
                </div>
              </div>
              <div className="space-y-0.5 max-h-full overflow-y-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
                {["00:05 — Em ơi Hà Nội phố", "00:12 — Ta còn em mùi hoàng lan", "00:19 — Ta còn em mùi hoa sữa", "00:26 — Con đường vắng rì rào", "00:33 — Ai đó chờ ai tóc xõa vai mềm", "00:40 — Mùa thu qua bao nhiêu lần"].map((l,i) => (
                  <div key={i} className={`px-2 py-1.5 rounded-lg ${i===1?"bg-violet-500/15 border border-violet-500/30":""}`}>
                    <p className={`text-[9px] font-mono truncate ${i===1?"text-violet-300":"text-white/40"}`}>{l}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>

        {/* ── MAIN: Preview + Player + Style ───────────── */}
        <main className="flex-1 flex flex-col gap-0 overflow-y-auto bg-[#0a0a0a]">
          {/* Video preview — takes all available width */}
          <div className="flex-1 flex items-center justify-center p-5 pb-3">
            <div className="w-full max-w-[900px]">
              <div className="aspect-video rounded-2xl overflow-hidden relative shadow-2xl shadow-black/70 ring-1 ring-white/[0.06] bg-gradient-to-br from-[#1a0533] via-[#0d1b3e] to-[#050d1a] flex items-end justify-center pb-10">
                <div className="text-center">
                  <p className="text-xl font-bold text-white/80">♪ Lyrics hiển thị ở đây</p>
                  <p className="text-xs text-violet-400 mt-1">hiệu ứng karaoke / wipe / fade...</p>
                </div>
                <div className="absolute bottom-2 right-3 text-[9px] font-mono text-white/25 bg-black/40 px-2 py-1 rounded">0:00 / 3:45</div>
              </div>
            </div>
          </div>

          {/* Audio player */}
          <div className="px-5 pb-3">
            <div className="max-w-[900px] mx-auto bg-white/[0.04] border border-white/[0.07] rounded-2xl p-4">
              <div className="h-10 rounded-lg bg-white/[0.03] border border-white/[0.05] mb-3 flex items-center px-3">
                <p className="text-[10px] text-white/20">▬▬▬▬ waveform ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬</p>
              </div>
              <div className="flex items-center gap-3">
                <button className="w-8 h-8 rounded-full bg-white/[0.07] flex items-center justify-center text-xs">⏮</button>
                <button className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-black text-sm font-bold">▶</button>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-white/70">bai-hat-01.mp3</p>
                  <p className="text-[10px] text-white/30 font-mono">0:32 / 3:45 · dòng 3/12</p>
                </div>
              </div>
            </div>
          </div>

          {/* Style controls as a horizontal bar */}
          <div className="px-5 pb-4">
            <div className="max-w-[900px] mx-auto bg-white/[0.03] border border-white/[0.06] rounded-2xl px-5 py-3 flex items-center gap-6 flex-wrap">
              {/* Colors */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Màu</p>
                <div className="flex gap-1">
                  {["#fff","#a78bfa","#34d399","#f59e0b","#f43f5e"].map((c,i) => (
                    <div key={i} className={`w-5 h-5 rounded-full border-2 ${i===0?"border-white":"border-transparent"}`} style={{background:c}} />
                  ))}
                </div>
              </div>
              <div className="h-5 w-px bg-white/[0.06]" />
              {/* Effects */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Hiệu ứng</p>
                <div className="flex gap-1">
                  {["Fade","Slide","Wipe","Karaoke","Wave"].map((e,i) => (
                    <button key={e} className={`px-2 py-0.5 rounded text-[9px] border ${i===2?"border-white/30 bg-white/[0.1] text-white":"border-white/[0.06] text-white/35"}`}>{e}</button>
                  ))}
                </div>
              </div>
              <div className="h-5 w-px bg-white/[0.06]" />
              {/* Font size */}
              <div className="flex items-center gap-2">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-white/30 shrink-0">Cỡ chữ</p>
                <div className="w-24 h-1.5 rounded-full bg-white/[0.08] relative">
                  <div className="absolute left-0 top-0 h-full w-1/3 rounded-full bg-violet-500" />
                  <div className="absolute top-1/2 -translate-y-1/2 left-1/3 w-3 h-3 rounded-full bg-violet-400 -translate-x-1.5" />
                </div>
                <span className="text-[9px] font-mono text-violet-400/70">100%</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
