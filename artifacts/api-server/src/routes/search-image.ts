import { Router } from "express";
import FirecrawlApp from "@mendable/firecrawl-js";

const router = Router();

router.get("/search-image", async (req, res) => {
  const query = req.query.q as string;
  if (!query || query.trim() === "") {
    res.status(400).json({ error: "Thiếu tham số tìm kiếm" });
    return;
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "FIRECRAWL_API_KEY chưa được cấu hình" });
    return;
  }

  try {
    const app = new FirecrawlApp({ apiKey });
    const v1 = app.v1;

    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query.trim())}&form=HDRSC2&first=1`;
    const result = await v1.scrapeUrl(bingUrl, { formats: ["links"] });

    const images: { url: string; title: string }[] = [];

    const links: string[] = (result?.links as string[] | undefined) ?? [];
    for (const link of links) {
      if (images.length >= 8) break;
      // Bing image detail links contain mediaurl= param with the actual image URL
      try {
        const parsed = new URL(link);
        const mediaUrl = parsed.searchParams.get("mediaurl");
        if (mediaUrl && mediaUrl.match(/\.(jpg|jpeg|png|webp)/i)) {
          images.push({ url: mediaUrl, title: query });
        }
      } catch {
        // skip malformed URLs
      }
    }

    res.json({ images });
  } catch (err) {
    req.log.error({ err }, "Firecrawl search-image error");
    res.status(500).json({ error: "Không thể tìm ảnh, vui lòng thử lại" });
  }
});

export default router;
