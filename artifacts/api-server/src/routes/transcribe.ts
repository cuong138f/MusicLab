import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import multer from "multer";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const router = Router();

// Gemini performs best with these canonical MIME types for audio/video
function normalizeMimeType(raw: string): { mimeType: string; ext: string } {
  const lower = raw.toLowerCase();
  if (lower.includes("mpeg") || lower.includes("mp3")) return { mimeType: "audio/mp3",  ext: "mp3"  };
  if (lower.includes("mp4") || lower.includes("m4a") || lower.includes("aac")) return { mimeType: "audio/mp4",  ext: "mp4"  };
  if (lower.includes("ogg"))  return { mimeType: "audio/ogg",  ext: "ogg"  };
  if (lower.includes("wav") || lower.includes("wave")) return { mimeType: "audio/wav",  ext: "wav"  };
  if (lower.includes("flac")) return { mimeType: "audio/flac", ext: "flac" };
  // WebM containers — must be sent with the correct MIME type so Gemini's demuxer
  // can parse the timeline correctly.
  if (lower.includes("webm")) return { mimeType: "video/webm", ext: "webm" };
  return { mimeType: "audio/mp3", ext: "mp3" };
}

const PROMPT = `You are an expert music lyrics transcription assistant.

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

const SYNC_PROMPT = (lyrics: string[]) =>
  `Bạn là chuyên gia đồng bộ lời bài hát. Nghe audio và tìm timestamp chính xác cho ${lyrics.length} dòng lời dưới đây.

LỜI BÀI HÁT (${lyrics.length} dòng, theo thứ tự xuất hiện trong bài):
${lyrics.map((l, i) => `${i + 1}. ${l}`).join("\n")}

OUTPUT: Chỉ mảng JSON thuần — không markdown, không giải thích. Đúng ${lyrics.length} phần tử, đúng thứ tự.
[{ "text": "nguyên văn dòng lời", "start": 12.3, "end": 14.8 }, ...]

QUY TẮC:
• Sao chép NGUYÊN VĂN từng dòng từ danh sách trên — không đổi chính tả, dấu câu, từ ngữ
• "start" = giây giọng bắt đầu  •  "end" = giây giọng ngừng hẳn (không phải lúc dòng kế bắt đầu)
• Số thập phân 1 chữ số  •  "end" > "start"  •  thường 1.5–8 giây/dòng
• Tăng dần: "start"[n] > "end"[n-1] — không chồng chéo

Xuất mảng JSON:`.trim();

const buildFixPrompt = (
  current: Array<{ text: string; start: number; end: number }>,
  request: string
) =>
  `Đây là kết quả phiên âm hiện tại (${current.length} dòng):
${JSON.stringify(current, null, 2)}

Yêu cầu sửa: ${request}

Hãy lắng nghe lại audio và thực hiện yêu cầu trên. Trả về mảng JSON đầy đủ đã được sửa — toàn bộ danh sách (không chỉ các dòng thay đổi).
[{ "text": "dòng lời", "start": 12.3, "end": 14.8 }, ...]
Chỉ mảng JSON thuần — không markdown, không giải thích.`.trim();

// Files ≤ this size can be sent inline (Gemini inlineData limit)
const INLINE_LIMIT_BYTES = 4 * 1024 * 1024; // 4 MB

// Accept up to 200 MB audio upload via multipart/form-data
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

router.post("/transcribe-audio", upload.single("audio"), async (req, res) => {
  // Support both multipart/form-data (new) and legacy JSON body
  let audioBuffer: Buffer;
  let rawMimeType: string;
  let customPrompt: string | undefined;
  let knownLyrics: string[] | undefined;
  let hintLyrics: string[] | undefined;
  let fixRequest: string | undefined;
  let currentLyrics: Array<{ text: string; start: number; end: number }> | undefined;

  if (req.file) {
    // Multipart upload
    audioBuffer   = req.file.buffer;
    rawMimeType   = req.file.mimetype || (req.body.mimeType as string) || "audio/mpeg";
    customPrompt  = req.body.customPrompt as string | undefined;
    const kl = req.body.knownLyrics as string | undefined;
    if (kl) {
      try { knownLyrics = JSON.parse(kl) as string[]; } catch { /* ignore */ }
    }
    const hl = req.body.hintLyrics as string | undefined;
    if (hl) {
      try { hintLyrics = JSON.parse(hl) as string[]; } catch { /* ignore */ }
    }
    fixRequest = req.body.fixRequest as string | undefined;
    const cl = req.body.currentLyrics as string | undefined;
    if (cl) {
      try { currentLyrics = JSON.parse(cl) as Array<{ text: string; start: number; end: number }>; } catch { /* ignore */ }
    }
  } else {
    // Legacy JSON body fallback
    const body = req.body as {
      audioBase64?: string;
      mimeType?: string;
      customPrompt?: string;
      knownLyrics?: string[];
      hintLyrics?: string[];
      fixRequest?: string;
      currentLyrics?: Array<{ text: string; start: number; end: number }>;
    };
    if (!body.audioBase64 || !body.mimeType) {
      res.status(400).json({ error: "Provide audio via multipart 'audio' field or legacy audioBase64+mimeType JSON" });
      return;
    }
    audioBuffer    = Buffer.from(body.audioBase64, "base64");
    rawMimeType    = body.mimeType;
    customPrompt   = body.customPrompt;
    knownLyrics    = body.knownLyrics;
    hintLyrics     = body.hintLyrics;
    fixRequest     = body.fixRequest;
    currentLyrics  = body.currentLyrics;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY not configured" });
    return;
  }

  const { mimeType, ext } = normalizeMimeType(rawMimeType);
  const ai = new GoogleGenAI({ apiKey });

  const validKnownLyrics = Array.isArray(knownLyrics) && knownLyrics.length > 0
    ? knownLyrics.map((l) => String(l).trim()).filter(Boolean)
    : null;

  const validHintLyrics = !validKnownLyrics && Array.isArray(hintLyrics) && hintLyrics.length > 0
    ? hintLyrics.map((l) => String(l).trim()).filter(Boolean)
    : null;

  // Fix-request mode: takes priority over all other prompt types
  const validFixRequest = !validKnownLyrics && fixRequest?.trim() ? fixRequest.trim() : null;
  const validCurrentLyrics = validFixRequest && Array.isArray(currentLyrics) && currentLyrics.length > 0
    ? currentLyrics
    : null;

  const basePrompt = validKnownLyrics
    ? SYNC_PROMPT(validKnownLyrics)
    : (customPrompt?.trim()) || PROMPT;

  // Inject hintLyrics into prompt: replace [PASTE OFFICIAL LYRICS HERE] if present, else append
  const injectHint = (prompt: string, hints: string[]): string => {
    const lines = hints.map((l, i) => `${i + 1}. ${l}`).join("\n");
    if (prompt.includes("[PASTE OFFICIAL LYRICS HERE]")) {
      return prompt.replace("[PASTE OFFICIAL LYRICS HERE]", lines);
    }
    return `${prompt}\n\nREFERENCE LYRICS (for spelling/diacritics — actual audio takes priority):\n${lines}`;
  };

  // Remove the placeholder when no hint is provided
  const cleanPrompt = (prompt: string): string =>
    prompt.includes("[PASTE OFFICIAL LYRICS HERE]")
      ? prompt.replace(/\nREFERENCE LYRICS[^\n]*\n\[PASTE OFFICIAL LYRICS HERE\]/, "").trimEnd()
      : prompt;

  // Priority: fix-request > hint > base
  const activePrompt = validFixRequest && validCurrentLyrics
    ? buildFixPrompt(validCurrentLyrics, validFixRequest)
    : validHintLyrics
      ? injectHint(basePrompt, validHintLyrics)
      : cleanPrompt(basePrompt);

  req.log.info(
    { rawMimeType, mimeType, bytes: audioBuffer.byteLength, syncMode: !!validKnownLyrics, hasHint: !!validHintLyrics, fixMode: !!validFixRequest, usingCustomPrompt: !!customPrompt?.trim() },
    "Starting transcription"
  );

  let rawText = "";

  try {
    if (audioBuffer.byteLength <= INLINE_LIMIT_BYTES) {
      // ── Small file: inline base64 ──────────────────────────────────
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{
          parts: [
            { inlineData: { mimeType, data: audioBuffer.toString("base64") } },
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

  // Detect near-zero timestamp collapse — Gemini returns this when it can't parse
  // the audio timeline (wrong MIME type, corrupted file, unsupported encoding, etc.)
  const maxStart = Math.max(...lines.map((l) => l.start));
  if (lines.length > 3 && maxStart < 2) {
    req.log.error({ maxStart, lineCount: lines.length }, "Near-zero timestamps — Gemini could not read audio timeline");
    res.status(502).json({
      error: "AI nhận ra lời nhưng không đọc được thời gian trong file nhạc này. Hãy thử lại với file MP3 hoặc M4A thay vì WAV/FLAC.",
    });
    return;
  }

  // In sync mode: overwrite Gemini's text with the user's verbatim lines (in order)
  // to guarantee the returned text is exactly what the user typed.
  if (validKnownLyrics && lines.length === validKnownLyrics.length) {
    lines = lines.map((line, i) => ({ ...line, text: validKnownLyrics[i] }));
  }

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
