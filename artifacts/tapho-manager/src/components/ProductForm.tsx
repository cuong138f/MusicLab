import React, { useState, useEffect, useRef } from "react";
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
import { Image as ImageIcon, Link as LinkIcon, UploadCloud, Loader2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const formSchema = z.object({
  name: z.string().min(1, "Vui lòng nhập tên sản phẩm"),
  price: z.coerce.number().min(0, "Giá phải lớn hơn hoặc bằng 0"),
  description: z.string().optional(),
  quantity: z.string().optional(),
  imageUrl: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

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
  
  const createFnRef = useRef(createProduct.mutate);
  createFnRef.current = createProduct.mutate;
  
  const updateFnRef = useRef(updateProduct.mutate);
  updateFnRef.current = updateProduct.mutate;

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

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value;
    setImagePreview(url);
    form.setValue("imageUrl", url);
  };

  const onSubmit = (data: FormValues) => {
    const payload = {
      name: data.name,
      price: data.price,
      description: data.description || null,
      quantity: data.quantity || null,
      imageUrl: data.imageUrl || null,
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
      updateFnRef.current(
        { id: product.id, data: payload },
        { onSuccess, onError }
      );
    } else {
      createFnRef.current(
        { data: payload },
        { onSuccess, onError }
      );
    }
  };

  const isPending = createProduct.isPending || updateProduct.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col">
        <div className="p-6 pt-2 space-y-6 max-h-[70vh] overflow-y-auto">
          
          <div className="space-y-4 bg-muted/30 p-4 rounded-xl">
            <label className="text-base font-serif font-medium">Hình ảnh sản phẩm</label>
            <div className="flex gap-4">
              <div className="w-24 h-24 shrink-0 rounded-xl bg-muted border border-border flex items-center justify-center overflow-hidden">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-muted-foreground/50" />
                )}
              </div>
              
              <Tabs defaultValue="upload" className="flex-1">
                <TabsList className="grid w-full grid-cols-2 mb-2">
                  <TabsTrigger value="upload" className="text-xs">Tải lên</TabsTrigger>
                  <TabsTrigger value="url" className="text-xs">Dán Link</TabsTrigger>
                </TabsList>
                <TabsContent value="upload" className="mt-0">
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="w-full h-10 border-dashed border-2 bg-transparent hover:bg-muted/50"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <UploadCloud className="w-4 h-4 mr-2" />
                    Chọn tệp...
                  </Button>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleImageUpload}
                  />
                </TabsContent>
                <TabsContent value="url" className="mt-0">
                  <div className="relative">
                    <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input 
                      placeholder="https://..." 
                      className="pl-9 h-10" 
                      value={form.watch("imageUrl") || ""}
                      onChange={handleUrlChange}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>

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
