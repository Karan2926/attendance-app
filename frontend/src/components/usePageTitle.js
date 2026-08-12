import { useEffect } from "react";

// Sets the browser tab title for a page. Pass a short label.
export default function usePageTitle(label) {
  useEffect(() => {
    document.title = label ? `${label} · ITM University` : "ITM University · Digital Attendance";
  }, [label]);
}
