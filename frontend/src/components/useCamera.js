import { useCallback, useEffect, useRef, useState } from "react";

// Lightweight webcam helper for guided face capture and live marking.
export function useCamera(onFrame, { width = 1280, height = 720, defaultFacing = "user" } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  const frameCbRef = useRef(onFrame);
  frameCbRef.current = onFrame;
  const [live, setLive] = useState(false);
  const [error, setError] = useState("");
  const [facingMode, setFacingMode] = useState(defaultFacing); // "user" | "environment"
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);

  // Check available cameras
  useEffect(() => {
    async function checkCameras() {
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const videoDevices = devices.filter((d) => d.kind === "videoinput");
          setHasMultipleCameras(videoDevices.length > 1);
        }
      } catch {
        // ignore device enum errors
      }
    }
    checkCameras();
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setLive(false);
  }, []);

  const start = useCallback(
    async (intervalMs, overrideMode) => {
      stop();
      const mode = overrideMode || facingMode;
      try {
        const constraints = {
          video: {
            width: { ideal: width },
            height: { ideal: height },
            ...(mode ? { facingMode: { ideal: mode } } : {}),
          },
          audio: false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;
        setError("");
        setLive(true);

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }

        if (intervalMs) {
          intervalRef.current = setInterval(() => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              frameCbRef.current(videoRef.current);
            }
          }, intervalMs);
        }
      } catch (err) {
        // If ideal facingMode failed, try fallback without facingMode
        try {
          const fallbackStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: width }, height: { ideal: height } },
            audio: false,
          });
          streamRef.current = fallbackStream;
          setError("");
          setLive(true);
          if (videoRef.current) {
            videoRef.current.srcObject = fallbackStream;
            videoRef.current.play().catch(() => {});
          }
        } catch (fallbackErr) {
          setError(err.message || fallbackErr.message || "Camera access denied");
          setLive(false);
        }
      }
    },
    [width, height, facingMode, stop]
  );

  // Callback ref and effect to guarantee stream is attached immediately when <video> mounts
  const attachVideo = useCallback((node) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (live && streamRef.current && videoRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [live]);

  const flipCamera = useCallback(async () => {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    await start(intervalRef.current ? 500 : 0, nextMode);
  }, [facingMode, start]);

  useEffect(() => stop, [stop]);

  return { videoRef, attachVideo, live, start, stop, error, facingMode, flipCamera, hasMultipleCameras };
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
