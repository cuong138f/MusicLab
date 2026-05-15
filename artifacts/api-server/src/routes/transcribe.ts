import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

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

  try {
    const ai = new GoogleGenAI({ apiKey });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: audioBase64,
              },
            },
            { text: PROMPT },
          ],
        },
      ],
    });

    const rawText = response.text?.trim() ?? "";

    // Strip any markdown code blocks if model wraps the JSON
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let lines: { text: string; start: number; end: number }[];
    try {
      lines = JSON.parse(jsonText);
      if (!Array.isArray(lines)) throw new Error("Not an array");
    } catch {
      req.log.warn({ rawText }, "Gemini response was not valid JSON");
      res.status(502).json({
        error: "AI returned an unexpected format",
        raw: rawText.slice(0, 500),
      });
      return;
    }

    // Sort by start time (defensive)
    lines.sort((a, b) => a.start - b.start);

    // Sanity-cap each line's duration:
    // If a line is suspiciously long AND the next line starts just before its end,
    // Gemini likely extended the end through a musical gap — trim it.
    const MAX_NATURAL_DURATION = 10; // seconds; >10 s is almost never a single sung line
    const CHARS_PER_SECOND = 7;      // rough sung speech rate for estimating cap

    lines = lines.map((line, i) => {
      const duration = line.end - line.start;
      if (duration <= MAX_NATURAL_DURATION) return line;

      // Estimate how long the line should actually be based on text length
      const estimated = Math.max(2.0, Math.min(8.0, line.text.length / CHARS_PER_SECOND));

      // Also cap at the gap before the next line starts (if it starts soon)
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
  } catch (err) {
    req.log.error({ err }, "Gemini transcription failed");
    res.status(500).json({ error: "Transcription failed" });
  }
});

export default router;
