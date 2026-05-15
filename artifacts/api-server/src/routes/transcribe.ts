import { Router } from "express";
import { GoogleGenAI } from "@google/genai";

const router = Router();

const PROMPT = `
You are a music lyrics transcription assistant.
Listen to this audio file and transcribe ALL lyrics you hear.
Return a JSON array only — no markdown, no explanation, no code block.

Each element in the array must have:
- "text": the exact lyric line (string)
- "start": start time in seconds (number, 1 decimal place)
- "end": end time in seconds (number, 1 decimal place)

Important rules:
- Include every lyric line, including repeated lines (chorus, hooks)
- If a section has no lyrics (intro, instrumental break, outro), skip it — do not include empty lines
- Times must be accurate to the actual audio
- If you cannot transcribe lyrics (instrumental only), return an empty array: []

Example format:
[{"text":"First line of lyrics","start":5.2,"end":8.7},{"text":"Second line","start":9.0,"end":12.3}]
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

    res.json({ lines });
  } catch (err) {
    req.log.error({ err }, "Gemini transcription failed");
    res.status(500).json({ error: "Transcription failed" });
  }
});

export default router;
