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

export function captureBlob(video) {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(resolve, "image/jpeg", 0.9);
  });
}
