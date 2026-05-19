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

    // Step 1: search for relevant product pages
    const productQuery = `${query.trim()} sản phẩm`;
    const searchResult = await (app as unknown as { search: (q: string, opts: object) => Promise<{ web?: { url: string }[] }> })
      .search(productQuery, { limit: 8 });

    const urls: string[] = (searchResult.web ?? []).map((item) => item.url);

    if (urls.length === 0) {
      res.json({ images: [] });
      return;
    }

    // Step 2: parallel scrape up to 6 pages to extract ogImage
    type ScrapeResult = { metadata?: { ogImage?: string }; extract?: { imageUrl?: string } } | null;
    const scrapePromises: Promise<ScrapeResult>[] = urls.slice(0, 6).map((url) =>
      v1.scrapeUrl(url, {
        formats: ["extract"],
        extract: { prompt: "Extract the main product image URL from this page. Return {imageUrl: string}" },
      } as Parameters<typeof v1.scrapeUrl>[1])
        .then((r) => r as ScrapeResult)
        .catch(() => null)
    );

    const scrapeResults = await Promise.allSettled(scrapePromises);

    // Step 3: collect valid image URLs (prefer ogImage, fallback to extract)
    const images: { url: string; title: string }[] = [];
    for (let i = 0; i < scrapeResults.length; i++) {
      if (images.length >= 3) break;
      const result = scrapeResults[i];
      if (result.status !== "fulfilled" || !result.value) continue;

      const r = result.value;
      const candidates = [
        r.metadata?.ogImage,
        r.extract?.imageUrl,
      ].filter((u): u is string =>
        typeof u === "string" &&
        u.startsWith("http") &&
        /\.(jpg|jpeg|png|webp|avif)/i.test(u)
      );

      if (candidates.length > 0) {
        images.push({ url: candidates[0], title: query });
      }
    }

    res.json({ images });
  } catch (err) {
    req.log.error({ err }, "Firecrawl search-image error");
    res.status(500).json({ error: "Không thể tìm ảnh, vui lòng thử lại" });
  }
});

export default router;
