import { Router } from "express";

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
    const productQuery = `${query.trim()} bao bì sản phẩm`;

    const response = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: productQuery,
        sources: ["images"],
        limit: 3,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      req.log.error({ status: response.status, err }, "Firecrawl v2 search error");
      res.status(500).json({ error: "Không thể tìm ảnh, vui lòng thử lại" });
      return;
    }

    const data = await response.json() as {
      success: boolean;
      data?: { images?: { title: string; imageUrl: string; url: string }[] };
    };

    const images = (data.data?.images ?? []).map((img) => ({
      url: img.imageUrl,
      title: img.title,
      source: img.url,
    }));

    res.json({ images });
  } catch (err) {
    req.log.error({ err }, "Firecrawl search-image error");
    res.status(500).json({ error: "Không thể tìm ảnh, vui lòng thử lại" });
  }
});

export default router;
