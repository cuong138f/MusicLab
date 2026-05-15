import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const router = Router();

const PROMPT = `
You are a music lyrics transcription assistant.
Listen to this audio carefully and transcribe ALL lyrics with precise timestamps.
Return ONLY a JSON array — no markdown, no explanation, no code block.

Each element must have:
- "text": the exact lyric line as sung (string)
- "start": time in seconds when the singer BEGINS this line (number, 1 decimal place)
- "end": time in seconds when the singer's voice STOPS on the LAST SYLLABLE of this line (number, 1 decimal place)

Critical timing rules — read carefully:
1. "end" = when the VOICE STOPS, NOT when the next line begins.
   If there is a musical gap or silence after a line, do NOT extend "end" into that gap.
2. Each line's duration (end − start) should be 1.5 – 8 seconds. Most sung lines are 2–5 s.
   Never assign a duration > 10 seconds to a single line unless it contains an extremely long held note.
3. Include EVERY lyric line, including repeated chorus/hook lines.
4. Skip instrumental-only sections (intro, breaks, outros) — do not emit empty lines.
5. If the audio has no vocals at all, return: []

Example (notice the gap between lines is NOT part of either line's duration):
[
  {"text":"First line of lyrics","start":5.2,"end":8.1},
  {"text":"Second line","start":11.0,"end":14.3}
]
In that example the first line ends at 8.1 s even though the next line doesn't start until 11.0 s.
`.trim();

// Gemini inline data limit: ~4 MB for audio (files longer than ~2m20s must use File API)
const INLINE_LIMIT_BYTES = 4 * 1024 * 1024;

router.post("/transcribe-audio", async (req, res) => {
  const { audioBase64, mimeType } = req.body as {
    audioBase64?: string;
    mimeType?: string;
  };

  if (!audioBase64 || !mimeType) {
    res.status(400).json({ error: "audioBase64 and mimeType are required" });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    return;
  }

  const ai = new GoogleGenAI({ apiKey });
  const audioBuffer = Buffer.from(audioBase64, "base64");

  let lines: { text: string; start: number; end: number }[];

  try {
    if (audioBuffer.byteLength <= INLINE_LIMIT_BYTES) {
      // ── Small file: send as inline base64 ───────────────────────────
      req.log.info({ bytes: audioBuffer.byteLength }, "Transcribing via inline data");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            parts: [
              { inlineData: { mimeType, data: audioBase64 } },
              { text: PROMPT },
            ],
          },
        ],
      });

      lines = parseGeminiResponse(response.text?.trim() ?? "");
    } else {
      // ── Large file: upload via File API, reference by URI ────────────
      const ext = mimeType.split("/")[1]?.replace("mpeg", "mp3") ?? "mp3";
      const tmpPath = join(tmpdir(), `lv_audio_${randomUUID()}.${ext}`);

      req.log.info(
        { bytes: audioBuffer.byteLength, tmpPath },
        "Transcribing via Gemini File API — uploading"
      );

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

      // Poll until ACTIVE (usually instant for audio < 200 MB)
      let fileInfo = await ai.files.get({ name: uploadedFile.name }) as { name: string; uri: string; state?: string };
      let polls = 0;
      while (fileInfo.state === "PROCESSING" && polls < 30) {
        await new Promise((r) => setTimeout(r, 3000));
        fileInfo = await ai.files.get({ name: uploadedFile.name }) as { name: string; uri: string; state?: string };
        polls++;
      }

      if (fileInfo.state !== "ACTIVE") {
        await ai.files.delete({ name: fileInfo.name }).catch(() => {});
        res.status(502).json({ error: "File upload to AI timed out or failed" });
        return;
      }

      req.log.info({ uri: fileInfo.uri }, "File ACTIVE — generating content");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            parts: [
              { fileData: { fileUri: fileInfo.uri, mimeType } },
              { text: PROMPT },
            ],
          },
        ],
      });

      // Clean up uploaded file (best-effort)
      ai.files.delete({ name: fileInfo.name }).catch(() => {});

      lines = parseGeminiResponse(response.text?.trim() ?? "");
    }
  } catch (err) {
    req.log.error({ err }, "Gemini transcription failed");
    res.status(500).json({ error: "Transcription failed" });
    return;
  }

  // Sort by start time (defensive)
  lines.sort((a, b) => a.start - b.start);

  // Sanity-cap each line's duration
  const MAX_NATURAL_DURATION = 10;
  const CHARS_PER_SECOND = 7;

  lines = lines.map((line, i) => {
    const duration = line.end - line.start;
    if (duration <= MAX_NATURAL_DURATION) return line;

    const estimated = Math.max(2.0, Math.min(8.0, line.text.length / CHARS_PER_SECOND));
    const nextStart = lines[i + 1]?.start ?? Infinity;
    const gapBased = nextStart - line.start;
    const cappedEnd = line.start + Math.min(estimated, gapBased > 0 ? Math.min(gapBased, estimated) : estimated);

    req.log.warn(
      { line: line.text, originalEnd: line.end, cappedEnd },
      "Capped suspiciously long lyric line duration"
    );
    return { ...line, end: Math.round(cappedEnd * 10) / 10 };
  });

  res.json({ lines });
});

function parseGeminiResponse(rawText: string): { text: string; start: number; end: number }[] {
  const jsonText = rawText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error("Not an array");
  return parsed as { text: string; start: number; end: number }[];
}

export default router;
