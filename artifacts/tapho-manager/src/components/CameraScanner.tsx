import React, { useRef, useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, CheckCircle, AlertCircle, RotateCcw, SwitchCamera } from "lucide-react";

interface ScannedItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  cx: number;
  cy: number;
}

interface CameraScannerProps {
  onDetected: (items: ScannedItem[]) => void;
  onClose: () => void;
}

const ZOOM_LEVELS = [0.5, 0.8, 1.0, 1.5];

export default function CameraScanner({ onDetected, onClose }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mode, setMode] = useState<"camera" | "preview" | "scanning" | "result">("camera");
  const [capturedImage, setCapturedImage] = useState<string>("");
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [apiCost, setApiCost] = useState<{ inputTokens: number; outputTokens: number; costUsd: number } | null>(null);
  const [error, setError] = useState("");
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [zoom, setZoom] = useState(1.0);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1080 },
          height: { ideal: 1920 },
        },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError("Không thể mở camera. Hãy thử upload ảnh thay thế.");
    }
  }, []);

  useEffect(() => {
    startCamera(facingMode);
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode, startCamera]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const vw = video.videoWidth || 1080;
    const vh = video.videoHeight || 1920;
    const effectiveZoom = Math.max(zoom, 1);
    const srcW = vw / effectiveZoom;
    const srcH = vh / effectiveZoom;
    const srcX = (vw - srcW) / 2;
    const srcY = (vh - srcH) / 2;
    canvas.width = srcW;
    canvas.height = srcH;
    canvas.getContext("2d")!.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImage(dataUrl);
    setMode("preview");
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [zoom]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setCapturedImage(reader.result as string);
      setMode("preview");
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    reader.readAsDataURL(file);
  }, []);

  const retake = useCallback(() => {
    setCapturedImage("");
    setError("");
    setMode("camera");
    startCamera(facingMode);
  }, [facingMode, startCamera]);

  const scanImage = useCallback(async () => {
    if (!capturedImage) return;
    setMode("scanning");
    setError("");
    try {
      const base64 = capturedImage.split(",")[1];
      const mimeType = capturedImage.split(";")[0].split(":")[1] || "image/jpeg";
      const res = await fetch("/api/scan-products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lỗi phân tích");
      if (!data.items || data.items.length === 0) {
        setError("Không nhận dạng được sản phẩm nào. Hãy thử chụp rõ hơn.");
        setMode("preview");
        return;
      }
      setScannedItems(data.items);
      setSelectedIds(new Set(data.items.map((i: ScannedItem) => i.productId)));
      setApiCost(data.apiCost ?? null);
      setMode("result");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Không thể phân tích ảnh");
      setMode("preview");
    }
  }, [capturedImage]);

  const toggleItem = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirm = useCallback(() => {
    onDetected(scannedItems.filter((i) => selectedIds.has(i.productId)));
    onClose();
  }, [scannedItems, selectedIds, onDetected, onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col sm:bg-black/80 sm:items-center sm:justify-center sm:p-4">
      {/* Desktop card wrapper */}
      <div className="flex flex-col flex-1 sm:flex-none sm:bg-white sm:rounded-2xl sm:w-full sm:max-w-lg sm:overflow-hidden sm:shadow-2xl">

        {/* ── CAMERA MODE ── */}
        {mode === "camera" && (
          <>
            {/* Camera fills screen */}
            <div className="relative flex-1 bg-black overflow-hidden sm:aspect-[3/4] sm:flex-none">
              {cameraError ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/70 p-6 text-center">
                  <AlertCircle className="w-12 h-12" />
                  <p className="text-sm">{cameraError}</p>
                </div>
              ) : (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-200"
                  style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
                />
              )}

              {/* Top bar: title + close */}
              <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-safe-top pb-3 pt-4 bg-gradient-to-b from-black/60 to-transparent">
                <div className="flex items-center gap-2 text-white">
                  <Camera className="w-5 h-5" />
                  <span className="font-semibold text-sm">Chụp ảnh sản phẩm</span>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Zoom buttons overlay */}
              {!cameraError && (
                <div className="absolute bottom-24 sm:bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-black/50 rounded-full px-3 py-1.5">
                  {ZOOM_LEVELS.map((level) => (
                    <button
                      key={level}
                      onClick={() => setZoom(level)}
                      className={`text-sm font-semibold px-2.5 py-1 rounded-full transition-colors ${
                        zoom === level
                          ? "bg-white text-black"
                          : "text-white/80 active:text-white"
                      }`}
                    >
                      {level}×
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bottom controls */}
            <div className="bg-black sm:bg-white px-6 py-5 flex items-center gap-4">
              {/* Upload button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1 text-white/70 sm:text-muted-foreground active:text-white sm:hover:text-foreground transition-colors"
              >
                <div className="w-12 h-12 rounded-full border-2 border-white/30 sm:border-border flex items-center justify-center">
                  <Upload className="w-5 h-5" />
                </div>
                <span className="text-xs">Upload</span>
              </button>

              {/* Capture button — center, big */}
              {!cameraError && (
                <button
                  onClick={capture}
                  className="flex-1 flex justify-center"
                >
                  <div className="w-20 h-20 rounded-full bg-white border-4 border-white/40 flex items-center justify-center shadow-lg active:scale-95 transition-transform">
                    <div className="w-14 h-14 rounded-full bg-primary flex items-center justify-center">
                      <Camera className="w-7 h-7 text-white" />
                    </div>
                  </div>
                </button>
              )}

              {/* Flip camera button */}
              {!cameraError ? (
                <button
                  onClick={() => setFacingMode((f) => f === "environment" ? "user" : "environment")}
                  className="flex flex-col items-center gap-1 text-white/70 sm:text-muted-foreground active:text-white sm:hover:text-foreground transition-colors"
                >
                  <div className="w-12 h-12 rounded-full border-2 border-white/30 sm:border-border flex items-center justify-center">
                    <SwitchCamera className="w-5 h-5" />
                  </div>
                  <span className="text-xs">Xoay</span>
                </button>
              ) : (
                <div className="flex-1">
                  <Button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full gap-2 rounded-full"
                  >
                    <Upload className="w-4 h-4" />
                    Chọn ảnh
                  </Button>
                </div>
              )}
            </div>

            <canvas ref={canvasRef} className="hidden" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </>
        )}

        {/* ── PREVIEW / SCANNING MODE ── */}
        {(mode === "preview" || mode === "scanning") && capturedImage && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 sm:border-b bg-white">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-primary" />
                <span className="font-semibold text-sm">Xem lại ảnh</span>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image preview */}
            <div className="flex-1 bg-black sm:max-h-[50vh] overflow-hidden">
              <img src={capturedImage} alt="captured" className="w-full h-full object-contain" />
            </div>

            {/* Controls */}
            <div className="bg-white px-4 py-4 space-y-3">
              {error && (
                <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={retake}
                  className="flex-1 gap-2 rounded-full h-12"
                  disabled={mode === "scanning"}
                >
                  <RotateCcw className="w-4 h-4" />
                  Chụp lại
                </Button>
                <Button
                  type="button"
                  onClick={scanImage}
                  className="flex-1 gap-2 rounded-full h-12"
                  disabled={mode === "scanning"}
                >
                  {mode === "scanning" ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Nhận dạng...</>
                  ) : (
                    <><Camera className="w-4 h-4" /> Nhận dạng</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* ── RESULT MODE ── */}
        {mode === "result" && (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 sm:border-b bg-white">
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="w-5 h-5" />
                <span className="font-semibold text-sm">
                  Nhấn số trên ảnh để chọn / bỏ chọn
                </span>
              </div>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Image with hotspot number markers */}
            <div className="relative bg-black flex-shrink-0" style={{ maxHeight: "45vh" }}>
              <img
                src={capturedImage}
                alt="captured"
                className="w-full h-full object-contain"
                style={{ maxHeight: "45vh" }}
              />
              {scannedItems.map((item, idx) => {
                const selected = selectedIds.has(item.productId);
                return (
                  <button
                    key={item.productId}
                    type="button"
                    onClick={() => toggleItem(item.productId)}
                    style={{
                      position: "absolute",
                      left: `${item.cx * 100}%`,
                      top: `${item.cy * 100}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                    className="group focus:outline-none"
                  >
                    {/* Pulse ring when selected */}
                    {selected && (
                      <span className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
                    )}
                    <div className={`relative w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm shadow-lg border-2 transition-all active:scale-90 ${
                      selected
                        ? "bg-primary border-white text-white"
                        : "bg-black/60 border-white/40 text-white/50"
                    }`}>
                      {idx + 1}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Cost estimate table */}
            <div className="flex-1 overflow-y-auto bg-white">
              {/* Table header */}
              <div className="grid grid-cols-[32px_1fr_52px_76px] gap-x-2 px-4 py-2 bg-muted/50 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                <div />
                <div>Sản phẩm</div>
                <div className="text-center">SL</div>
                <div className="text-right">Thành tiền</div>
              </div>

              {/* Rows */}
              {scannedItems.map((item, idx) => {
                const selected = selectedIds.has(item.productId);
                return (
                  <button
                    key={item.productId}
                    type="button"
                    onClick={() => toggleItem(item.productId)}
                    className={`w-full grid grid-cols-[32px_1fr_52px_76px] gap-x-2 items-center px-4 py-2.5 text-sm text-left border-b last:border-0 transition-colors active:bg-muted/40 ${
                      selected ? "bg-white" : "bg-muted/20"
                    }`}
                  >
                    {/* Number badge */}
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs transition-colors ${
                      selected ? "bg-primary text-white" : "bg-muted text-muted-foreground"
                    }`}>
                      {idx + 1}
                    </div>

                    {/* Name + unit price */}
                    <div className="min-w-0">
                      <div className={`font-medium line-clamp-1 leading-tight ${
                        selected ? "text-foreground" : "text-muted-foreground line-through"
                      }`}>
                        {item.productName}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {item.unitPrice.toLocaleString("vi-VN")}đ/cái
                      </div>
                    </div>

                    {/* Qty */}
                    <div className={`text-center font-medium ${selected ? "text-foreground" : "text-muted-foreground opacity-50"}`}>
                      ×{item.quantity}
                    </div>

                    {/* Subtotal */}
                    <div className={`text-right font-semibold ${selected ? "text-primary" : "text-muted-foreground line-through opacity-40"}`}>
                      {(item.unitPrice * item.quantity).toLocaleString("vi-VN")}đ
                    </div>
                  </button>
                );
              })}

              {/* Summary rows */}
              <div className="px-4 pt-3 pb-2 space-y-1.5 bg-muted/30 border-t">
                {/* Selected subtotal */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Đã chọn ({selectedIds.size}/{scannedItems.length} sản phẩm)
                  </span>
                  <span className="font-medium">
                    {scannedItems
                      .filter((i) => selectedIds.has(i.productId))
                      .reduce((s, i) => s + i.unitPrice * i.quantity, 0)
                      .toLocaleString("vi-VN")}đ
                  </span>
                </div>
                {/* Grand total */}
                <div className="flex items-center justify-between py-2 border-t">
                  <span className="font-bold text-base">Tổng ước tính</span>
                  <span className="font-bold text-primary text-lg">
                    {scannedItems
                      .filter((i) => selectedIds.has(i.productId))
                      .reduce((s, i) => s + i.unitPrice * i.quantity, 0)
                      .toLocaleString("vi-VN")} đ
                  </span>
                </div>
                {/* API cost */}
                {apiCost && (
                  <div className="flex items-center justify-between pt-1.5 border-t border-dashed text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 bg-violet-100 text-violet-700 rounded-full px-2 py-0.5 font-medium">
                        Gemini API
                      </span>
                      <span>{apiCost.inputTokens.toLocaleString()} in · {apiCost.outputTokens.toLocaleString()} out</span>
                    </div>
                    <span className="font-semibold text-violet-700">
                      ~{Math.ceil(apiCost.costUsd * 25500).toLocaleString("vi-VN")} đ
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white border-t px-4 py-4">
              <div className="flex gap-3">
                <Button type="button" variant="outline" onClick={retake} className="flex-1 gap-2 rounded-full h-12">
                  <RotateCcw className="w-4 h-4" />
                  Chụp lại
                </Button>
                <Button
                  type="button"
                  onClick={confirm}
                  disabled={selectedIds.size === 0}
                  className="flex-1 gap-2 rounded-full h-12"
                >
                  <CheckCircle className="w-4 h-4" />
                  Thêm {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
