import React, { useRef } from "react";
import { Product } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2, Image as ImageIcon } from "lucide-react";
import { formatVND } from "@/lib/format";
import { useDeleteProduct, getListProductsQueryKey, getGetProductStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ProductCardProps {
  product: Product;
  onEdit: (product: Product) => void;
  index: number;
}

export default function ProductCard({ product, onEdit, index }: ProductCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const deleteProduct = useDeleteProduct();
  const deleteFnRef = useRef(deleteProduct.mutate);
  deleteFnRef.current = deleteProduct.mutate;

  const handleDelete = () => {
    deleteFnRef.current(
      { id: product.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProductsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetProductStatsQueryKey() });
          toast({
            title: "Đã xóa",
            description: `Đã xóa mặt hàng "${product.name}"`,
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            title: "Lỗi",
            description: "Không thể xóa mặt hàng. Vui lòng thử lại.",
          });
        }
      }
    );
  };

  return (
    <Card
      className="overflow-hidden shadow-sm hover:shadow-md transition-all duration-300 border-transparent bg-white animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: "backwards" }}
    >
      <div className="aspect-square w-full bg-secondary/50 flex items-center justify-center relative overflow-hidden">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.name} className="object-cover w-full h-full" />
        ) : (
          <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
        )}
      </div>
      <CardContent className="p-3">
        <p className="font-medium text-sm line-clamp-1 mb-0.5" title={product.name}>{product.name}</p>
        <p className="text-primary text-sm font-semibold mb-2">{formatVND(product.price)}</p>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium bg-secondary px-2 py-0.5 rounded-md text-secondary-foreground">
            {product.quantity ?? "N/A"}
          </span>
          <div className="flex gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => onEdit(product)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive/60 hover:text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="max-w-[90vw] sm:max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle>Xóa mặt hàng này?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Bạn có chắc chắn muốn xóa "{product.name}"? Hành động này không thể hoàn tác.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Xóa</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
