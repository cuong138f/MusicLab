import React, { useState, useEffect } from "react";
import { Product } from "@workspace/api-client-react";
import { useListProducts, useGetProductStats, useGetRevenueStats } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus } from "lucide-react";
import StatsRow from "@/components/StatsRow";
import ProductCard from "@/components/ProductCard";
import ProductForm from "@/components/ProductForm";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: stats, isLoading: isLoadingStats } = useGetProductStats();
  const { data: revenue, isLoading: isLoadingRevenue } = useGetRevenueStats();
  const { data: products, isLoading: isLoadingProducts } = useListProducts(
    { search: debouncedSearch || undefined },
    { query: { queryKey: ["/api/products", debouncedSearch] } }
  );

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const handleAddNew = () => {
    setEditingProduct(undefined);
    setIsFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsFormOpen(false);
    setEditingProduct(undefined);
  };

  return (
    <div className="pb-20">
      <main className="container mx-auto px-4 py-8">
        {isLoadingStats || isLoadingRevenue ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        ) : (
          stats && <StatsRow
            totalProducts={stats.totalProducts}
            todayRevenue={revenue?.today ?? 0}
            weekRevenue={revenue?.thisWeek ?? 0}
            monthRevenue={revenue?.thisMonth ?? 0}
          />
        )}

        <div className="mb-8 flex items-center gap-3 max-w-xl mx-auto">
          <div className="relative group flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
            </div>
            <Input
              type="text"
              placeholder="Tìm kiếm sản phẩm..."
              className="pl-10 h-12 rounded-full border-muted bg-white shadow-sm focus-visible:ring-primary/20 text-base"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={handleAddNew} className="h-12 px-5 rounded-full gap-2 shrink-0">
            <Plus className="w-5 h-5" />
            <span className="hidden sm:inline">Thêm mới</span>
          </Button>
        </div>

        {isLoadingProducts ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <Skeleton key={i} className="aspect-square w-full rounded-xl" />
            ))}
          </div>
        ) : products && products.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {products.map((product, idx) => (
              <ProductCard key={product.id} product={product} onEdit={handleEdit} index={idx} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-white/50 rounded-2xl border border-dashed border-muted mt-8">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-serif font-medium mb-1">Không tìm thấy sản phẩm</h3>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto">
              {search ? `Không có mặt hàng nào phù hợp với "${search}"` : "Chưa có sản phẩm nào trong kho. Hãy thêm sản phẩm đầu tiên!"}
            </p>
            {!search && (
              <Button onClick={handleAddNew} variant="outline" className="mt-6">
                Thêm sản phẩm
              </Button>
            )}
          </div>
        )}
      </main>

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[500px] p-0 bg-background overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="font-serif text-xl">
              {editingProduct ? "Sửa thông tin sản phẩm" : "Thêm sản phẩm mới"}
            </DialogTitle>
          </DialogHeader>
          <ProductForm 
            product={editingProduct} 
            onComplete={handleCloseForm} 
            onCancel={handleCloseForm} 
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
