import React, { useState, useRef, useCallback } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Product } from "@workspace/api-client-react";
import { useCreateProduct, useUpdateProduct, getListProductsQueryKey, getGetProductStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Image as ImageIcon, UploadCloud, Loader2, Search, X, ChevronLeft, ChevronRight, Eraser } from "lucide-react";

const formSchema = z.object({
  name: z.string().min(1, "Vui lòng nhập tên sản phẩm"),
  price: z.coerce.number().min(0, "Giá phải lớn hơn hoặc bằng 0"),
  description: z.string().optional(),
  quantity: z.string().optional(),
  imageUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

interface ImageResult {
  url: string;
  title: string;
  source: string;
}

interface ProductFormProps {
  product?: Product;
  onComplete: () => void;
  onCancel: () => void;
}

export default function ProductForm({ product, onComplete, onCancel }: ProductFormProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();

  const isEditing = !!product;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product?.name || "",
      price: product?.price || 0,
      description: product?.description || "",
      quantity: product?.quantity || "",
      imageUrl: product?.imageUrl || "",
    },
  });

  const [imagePreview, setImagePreview] = useState<string>(product?.imageUrl || "");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ImageResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchPanel, setShowSearchPanel] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isRemovingBg, setIsRemovingBg] = useState(false);

  const handleRemoveBg = useCallback(async () => {
    if (!imagePreview) return;
    setIsRemovingBg(true);
    try {
      const { removeBackground } = await import("@imgly/background-removal");

      let input: Blob | string;
      if (imagePreview.startsWith("data:")) {
        const res = await fetch(imagePreview);
        input = await res.blob();
      } else {
        const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(imagePreview)}`;
        const res = await fetch(proxyUrl);
        if (!res.ok) throw new Error("proxy failed");
        input = await res.blob();
      }

      const resultBlob = await removeBackground(input);
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setImagePreview(base64);
        form.setValue("imageUrl", base64);
        setIsRemovingBg(false);
      };
      reader.readAsDataURL(resultBlob);
    } catch {
      toast({ variant: "destructive", title: "Lỗi", description: "Không thể xóa nền ảnh. Hãy thử tải ảnh lên trước rồi xóa nền." });
      setIsRemovingBg(false);
    }
  }, [imagePreview, form, toast]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        setImagePreview(base64String);
        form.setValue("imageUrl", base64String);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSearchImages = async () => {
    const q = searchQuery.trim() || form.getValues("name").trim();
    if (!q) {
      setSearchError("Vui lòng nhập từ khóa tìm kiếm");
      return;
    }
    setIsSearching(true);
    setSearchError("");
    setSearchResults([]);
    try {
      const res = await fetch(`/api/products/search-image?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi tìm kiếm");
      if (!data.images || data.images.length === 0) {
        setSearchError("Không tìm thấy ảnh phù hợp, thử từ khóa khác");
      } else {
        setSearchResults(data.images);
      }
    } catch (err: unknown) {
      setSearchError(err instanceof Error ? err.message : "Không thể tìm ảnh, vui lòng thử lại");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectImage = (url: string) => {
    setImagePreview(url);
    form.setValue("imageUrl", url);
    setShowSearchPanel(false);
    setSearchResults([]);
    setSearchQuery("");
  };

  const handleClearImage = () => {
    setImagePreview("");
    form.setValue("imageUrl", "");
  };

  const onSubmit = (data: FormValues) => {
    const payload = {
      name: data.name,
      price: data.price,
      description: data.description || undefined,
      quantity: data.quantity || undefined,
      imageUrl: data.imageUrl || undefined,
    };

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetProductStatsQueryKey() });
      toast({
        title: isEditing ? "Đã cập nhật" : "Đã thêm mới",
        description: `Mặt hàng "${data.name}" đã được lưu.`,
      });
      onComplete();
    };

    const onError = () => {
      toast({
        variant: "destructive",
        title: "Lỗi",
        description: "Có lỗi xảy ra khi lưu mặt hàng. Vui lòng thử lại.",
      });
    };

    if (isEditing) {
      updateProduct.mutate({ id: product.id, data: payload }, { onSuccess, onError });
    } else {
      createProduct.mutate({ data: payload }, { onSuccess, onError });
    }
  };

  const isPending = createProduct.isPending || updateProduct.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
        <div className="p-6 pt-2 space-y-6 max-h-[75vh] overflow-y-auto">

          {/* Image section */}
          <div className="space-y-3 bg-muted/30 p-4 rounded-xl">
            <label className="text-sm font-medium">Hình ảnh sản phẩm</label>

            <div className="flex gap-3">
              {/* Preview box */}
              <div className="relative w-24 h-24 shrink-0 rounded-xl bg-muted border border-border flex items-center justify-center overflow-hidden group">
                {imagePreview ? (
                  <>
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={handleClearImage}
                      className="absolute top-1 right-1 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                )}
              </div>

              {/* Buttons */}
              <div className="flex flex-col gap-2 flex-1">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-10 border-dashed border-2 bg-transparent hover:bg-muted/50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <UploadCloud className="w-4 h-4 mr-2" />
                  Tải ảnh lên
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full h-10 bg-transparent hover:bg-muted/50"
                  onClick={() => {
                    setShowSearchPanel((v) => !v);
                    setSearchError("");
                    if (!searchQuery) {
                      const name = form.getValues("name").trim();
                      const qty = (form.getValues("quantity") ?? "").trim();
                      setSearchQuery([name, qty].filter(Boolean).join(" "));
                    }
                  }}
                >
                  <Search className="w-4 h-4 mr-2" />
                  Tìm ảnh
                </Button>

                {imagePreview && (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full h-9 text-xs bg-transparent hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                    onClick={handleRemoveBg}
                    disabled={isRemovingBg}
                    title="Xóa nền ảnh (lần đầu có thể chờ ~15s để tải model AI)"
                  >
                    {isRemovingBg ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Eraser className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {isRemovingBg ? "Đang xóa nền..." : "Xóa nền"}
                  </Button>
                )}
              </div>

              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handleImageUpload}
              />
            </div>

            {/* Search panel */}
            {showSearchPanel && (
              <div className="space-y-3 pt-1">
                <div className="flex gap-2">
                  <Input
                    placeholder="Nhập tên sản phẩm để tìm ảnh..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearchImages())}
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    type="button"
                    onClick={handleSearchImages}
                    disabled={isSearching}
                    className="shrink-0"
                  >
                    {isSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                </div>

                {searchError && (
                  <p className="text-sm text-destructive">{searchError}</p>
                )}

                {isSearching && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang tìm kiếm ảnh...
                  </div>
                )}

                {searchResults.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 max-w-sm">
                    {searchResults.map((img, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => handleSelectImage(img.url)}
                        className="relative aspect-square rounded-lg overflow-hidden border-2 border-transparent hover:border-primary transition-all group focus:outline-none focus:border-primary"
                        title={img.title}
                      >
                        <img
                          src={img.url}
                          alt={img.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          onError={(e) => {
                            (e.target as HTMLImageElement).parentElement!.style.display = "none";
                          }}
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tên sản phẩm *</FormLabel>
                <FormControl>
                  <Input placeholder="Vd: Nước mắm Nam Ngư" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Price + Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="price"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Giá (VND) *</FormLabel>
                  <FormControl>
                    <Input type="number" placeholder="Vd: 25000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Số lượng & Đơn vị</FormLabel>
                  <FormControl>
                    <Input placeholder="Vd: 12 chai" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Description */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Mô tả thêm</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Ghi chú về mặt hàng..."
                    className="resize-none h-20"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="p-4 bg-muted/20 border-t flex justify-end gap-3 mt-auto">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
            Hủy
          </Button>
          <Button type="submit" disabled={isPending} className="min-w-[100px]">
            {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Lưu"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
