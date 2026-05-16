import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const router = Router();

// Gemini performs best with these canonical MIME types for audio
function normalizeMimeType(raw: string): { mimeType: string; ext: string } {
  const lower = raw.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return { mimeType: "audio/mp3", ext: "mp3" };
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return { mimeType: "audio/mp4", ext: "mp4" };
  if (lower.includes("ogg")) return { mimeType: "audio/ogg", ext: "ogg" };
  if (lower.includes("wav") || lower.includes("wave")) return { mimeType: "audio/wav", ext: "wav" };
  if (lower.includes("flac")) return { mimeType: "audio/flac", ext: "flac" };
  // webm or unknown → treat as mp3 (most common upload format)
  return { mimeType: "audio/mp3", ext: "mp3" };
}

const PROMPT = `
You are an expert music lyrics transcription assistant. Your task is to listen to the ENTIRE audio file from beginning to end and produce a precise, complete timestamped transcript of ALL sung lyrics.

RETURN FORMAT: A JSON array only — no markdown, no code blocks, no comments, no explanations.
Each object: { "text": "<lyric line>", "start": <seconds>, "end": <seconds> }
- "start": exact second when the singer's voice begins this line
- "end": exact second when the singer's voice stops on the last syllable (NOT when the next line starts)
- Times must be numbers with 1 decimal place precision

CRITICAL RULES — follow every one strictly:

1. SCAN THE ENTIRE AUDIO: Start at 0:00 and work forward to the very last second. Do NOT stop early, do NOT skip the middle or end of the song.

2. EVERY VOCAL LINE MUST BE INCLUDED: Include verse lines, chorus lines, bridge lines, hooks, ad-libs, background harmonies if they carry distinct lyrics. Missing ANY sung line is an error.

3. REPEATED SECTIONS (chorus/hook): If the same lyrics are sung again later in the song (e.g. the chorus repeats at 1:30, 2:45, and 3:10), you MUST include ALL occurrences as separate entries with their real individual timestamps. Never copy-paste the same timestamps — each occurrence has its own unique start/end.

4. "end" = voice stop, NOT next-line start: If a singer holds a note and stops at 3.8s but the next line begins at 6.0s, "end" = 3.8, not 6.0. Each line's duration (end − start) is typically 1.5–7 seconds.

5. NEVER exceed 10 seconds duration for a single line. Long held notes are still ≤10 s. If a line would be longer, split it at a natural breath point.

6. SKIP ONLY TRUE INSTRUMENTALS: Skip intro/outro/solo/break sections with ZERO vocals. Do NOT skip a section just because you are unsure — transcribe your best estimate.

7. DO NOT INVENT LYRICS: Transcribe what is actually sung. If a word is unclear, write your best phonetic approximation. Do not leave lines empty.

8. TIMESTAMPS MUST INCREASE MONOTONICALLY: Each line's start must be strictly greater than the previous line's end. No overlaps.

9. DO NOT TRUNCATE: Many songs have 30–60+ lyric lines. Output ALL of them. Do not stop after 20–30 lines if the song continues.

Verify your work: before outputting, confirm that your last entry's "start" time is near the end of the audio (within the last 60 seconds), and that your count of lines is plausible for a typical song of that length.

Output the JSON array now:
`.trim();

// Files ≤ this size can be sent inline (Gemini inlineData limit)
const INLINE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB

router.post("/transcribe-audio", async (req, res) => {
  const { audioBase64, mimeType: rawMimeType, customPrompt } = req.body as {
    audioBase64?: string;
    mimeType?: string;
    customPrompt?: string;
  };

  if (!audioBase64 || !rawMimeType) {
    res.status(400).json({ error: "audioBase64 and mimeType are required" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    return;
  }

  const { mimeType, ext } = normalizeMimeType(rawMimeType);
  const ai = new GoogleGenAI({ apiKey });
  const audioBuffer = Buffer.from(audioBase64, "base64");

  const activePrompt = (customPrompt?.trim()) || PROMPT;
  req.log.info({ rawMimeType, mimeType, bytes: audioBuffer.byteLength, usingCustomPrompt: !!customPrompt?.trim() }, "Starting transcription");

  let rawText = "";

  try {
    if (audioBuffer.byteLength <= INLINE_LIMIT_BYTES) {
      // ── Small file: inline base64 ──────────────────────────────────
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: activePrompt },
          ],
        }],
        config: { temperature: 0 },
      });
      rawText = response.text?.trim() ?? "";

    } else {
      // ── Large file: Gemini File API ─────────────────────────────────
      const tmpPath = join(tmpdir(), `lv_audio_${randomUUID()}.${ext}`);
      req.log.info({ tmpPath }, "Writing tmp file for File API upload");
      await writeFile(tmpPath, audioBuffer);

      let uploadedFile: { name: string; uri: string; state?: string };
      try {
        uploadedFile = await ai.files.upload({
          file: tmpPath,
          config: { mimeType, displayName: "lyrics-video-audio" },
        }) as { name: string; uri: string; state?: string };
      } finally {
        await unlink(tmpPath).catch(() => {});
      }

      // Poll until ACTIVE
      let fileInfo = await ai.files.get({ name: uploadedFile.name }) as { name: string; uri: string; state?: string };
      let polls = 0;
      while (fileInfo.state === "PROCESSING" && polls < 30) {
        await new Promise((r) => setTimeout(r, 3000));
        fileInfo = await ai.files.get({ name: uploadedFile.name }) as { name: string; uri: string; state?: string };
        polls++;
      }

      if (fileInfo.state !== "ACTIVE") {
        await ai.files.delete({ name: fileInfo.name }).catch(() => {});
        res.status(502).json({ error: "File upload to AI timed out" });
        return;
      }

      req.log.info({ uri: fileInfo.uri, polls }, "File ACTIVE — generating content");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            { fileData: { fileUri: fileInfo.uri, mimeType } },
            { text: activePrompt },
          ],
        }],
        config: { temperature: 0 },
      });

      // Clean up (best-effort, non-blocking)
      ai.files.delete({ name: fileInfo.name }).catch(() => {});
      rawText = response.text?.trim() ?? "";
    }
  } catch (err) {
    req.log.error({ err }, "Gemini transcription failed");
    res.status(500).json({ error: "Transcription failed" });
    return;
  }

  // Parse response
  let lines: { text: string; start: number; end: number }[];
  try {
    lines = parseGeminiResponse(rawText);
  } catch {
    req.log.warn({ rawText: rawText.slice(0, 500) }, "Gemini response was not valid JSON");
    res.status(502).json({ error: "AI returned an unexpected format", raw: rawText.slice(0, 500) });
    return;
  }

  if (!lines.length) {
    res.json({ lines: [] });
    return;
  }

  // Sort by start time
  lines.sort((a, b) => a.start - b.start);

  // Sanity-cap lines whose duration is suspiciously long
  const MAX_NATURAL_DURATION = 10;
  const CHARS_PER_SECOND = 7;
  lines = lines.map((line, i) => {
    const dur = line.end - line.start;
    if (dur <= MAX_NATURAL_DURATION) return line;

    const estimated = Math.max(2.0, Math.min(8.0, line.text.length / CHARS_PER_SECOND));
    const nextStart = lines[i + 1]?.start ?? Infinity;
    const gapBased = nextStart - line.start;
    const cappedEnd = line.start + Math.min(estimated, gapBased > 0 ? Math.min(gapBased, estimated) : estimated);

    req.log.warn({ line: line.text, originalEnd: line.end, cappedEnd }, "Capped suspiciously long duration");
    return { ...line, end: Math.round(cappedEnd * 10) / 10 };
  });

  req.log.info({ lineCount: lines.length, lastStart: lines[lines.length - 1]?.start }, "Transcription complete");
  res.json({ lines });
});

function parseTimestamp(val: unknown): number {
  if (typeof val === "number") return isFinite(val) ? val : 0;
  if (typeof val === "string") {
    const trimmed = val.trim();
    // Handle HH:MM:SS or MM:SS string timestamps (Gemini sometimes returns these)
    if (trimmed.includes(":")) {
      const parts = trimmed.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
    }
    const n = parseFloat(trimmed);
    return isFinite(n) ? n : 0;
  }
  return 0;
}

function parseGeminiResponse(rawText: string): { text: string; start: number; end: number }[] {
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Not an array");
  return (parsed as Record<string, unknown>[]).map((item) => ({
    text: String(item.text ?? "").trim(),
    start: parseTimestamp(item.start),
    end: parseTimestamp(item.end),
  }));
}

export default router;
