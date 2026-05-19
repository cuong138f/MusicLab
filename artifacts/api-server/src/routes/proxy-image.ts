import { Router } from "express";

const router = Router();

router.get("/proxy-image", async (req, res) => {
  const url = req.query["url"] as string | undefined;
  if (!url) {
    res.status(400).json({ error: "Missing url parameter" });
    return;
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; TaphoManager/1.0)",
        Accept: "image/*,*/*",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(502).json({ error: `Upstream returned ${response.status}` });
      return;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buffer);
  } catch (err: unknown) {
    req.log.warn({ err, url }, "proxy-image fetch failed");
    res.status(502).json({ error: "Failed to fetch image" });
  }
});

export default router;
