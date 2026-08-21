import { useCallback, useEffect, useRef, useState } from "react";

// Lightweight webcam helper for guided face capture and live marking.
export function useCamera(onFrame, { width = 640, height = 480 } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const frameCbRef = useRef(onFrame);
  frameCbRef.current = onFrame;
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setLive(false);
  }, []);

  const start = useCallback(
    async (intervalMs) => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width, height },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setError("");
        setLive(true);
        if (intervalMs) {
          intervalRef.current = setInterval(() => {
            if (videoRef.current) frameCbRef.current(videoRef.current);
          }, intervalMs);
        }
      } catch (err) {
        setError(err.message || "Camera access denied");
      }
    },
    [width, height]
  );

  useEffect(() => stop, [stop]);

  return { videoRef, live, start, stop, error };
}

export function resizeImageBlob(blob, { maxDim = 1280, quality = 0.85 } = {}) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let w = img.width;
      let h = img.height;
      if (Math.max(w, h) > maxDim) {
        const ratio = maxDim / Math.max(w, h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(resolve, "image/jpeg", quality);
    };
    img.onerror = () => resolve(blob);
    img.src = URL.createObjectURL(blob);
  });
}

export function captureBlob(video, { maxDim = 1280, quality = 0.85 } = {}) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    let w = video.videoWidth || 640;
    let h = video.videoHeight || 480;
    if (Math.max(w, h) > maxDim) {
      const ratio = maxDim / Math.max(w, h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}
