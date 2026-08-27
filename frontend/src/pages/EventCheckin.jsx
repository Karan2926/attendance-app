import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { api, postFormData } from "../api";
import { useCamera } from "../components/useCamera";
import Brand from "../components/Brand";

export default function EventCheckin() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [eventError, setEventError] = useState("");
  const [step, setStep] = useState("info");
  const [scanning, setScanning] = useState(false);
  const [feedback, setFeedback] = useState("Position your face in the centre and click Scan");
  const [cornerColor, setCornerColor] = useState("#0EA5A4");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("pending");

  const { videoRef, live, start, stop, attachVideo } = useCamera(() => {}, {
    width: 1280, height: 720, defaultFacing: "user"
  });

  useEffect(() => {
    api.get("/events/" + eventId)
      .then(d => { setEvent(d.event); setLoadingEvent(false); })
      .catch(err => { setEventError(err.message || "Event not found"); setLoadingEvent(false); });
  }, [eventId]);

  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) { setLocationStatus("denied"); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy });
        setLocationStatus("ok");
      },
      () => setLocationStatus("denied"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  function enterScan() { setStep("scan"); setError(""); start(); requestLocation(); }
  useEffect(() => () => stop(), [stop]);

  async function captureAndSubmit() {
    if (!videoRef.current || scanning) return;
    setScanning(true); setError(""); setFeedback("Scanning your face..."); setCornerColor("#F59E0B");
    try {
      const video = videoRef.current;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280; canvas.height = video.videoHeight || 720;
      canvas.getContext("2d").drawImage(video, 0, 0);
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", 0.92));
      const fd = new FormData();
      fd.append("images[]", blob, "face.jpg");
      if (location) {
        fd.append("latitude", location.latitude);
        fd.append("longitude", location.longitude);
        fd.append("accuracy", location.accuracy);
      }
      const data = await postFormData("/events/" + eventId + "/checkin", fd);
      stop(); setCornerColor("#10B981"); setResult(data); setStep("success");
    } catch (err) {
      setCornerColor("#EF4444");
      if (err.status === 409) {
        setError(err.message || "Already checked in.");
        setResult({ already_checked_in: true, student_name: err.student_name || "" });
        setStep("error");
      } else {
        setFeedback(err.message || "Recognition failed. Try again.");
        setScanning(false);
      }
    }
  }

  if (loadingEvent) return (
    <div className="auth-shell"><div className="auth-panel" style={{textAlign:"center"}}>
      <Brand /><div className="mono mt-4" style={{color:"var(--ink-soft)"}}>Loading event...</div>
    </div></div>
  );

  if (eventError || !event) return (
    <div className="auth-shell"><div className="auth-panel" style={{textAlign:"center"}}>
      <Brand /><h2 style={{marginTop:"1.5rem",color:"#EF4444"}}>Event Not Found</h2>
      <p className="panel-copy">{eventError || "This event does not exist."}</p>
    </div></div>
  );

  if (step === "success" && result) {
    const checkinTime = result.checked_in_at
      ? new Date(result.checked_in_at).toLocaleTimeString("en-IN", {hour:"2-digit",minute:"2-digit",second:"2-digit"})
      : "--";
    const mapsUrl = result.latitude && result.longitude
      ? "https://maps.google.com/?q=" + result.latitude + "," + result.longitude
      : null;
    return (
      <div className="auth-shell">
        <div className="auth-panel" style={{maxWidth:520,textAlign:"center"}}>
          <Brand />
          <div style={{width:90,height:90,borderRadius:"50%",background:"linear-gradient(135deg,#10B981 0%,#059669 100%)",display:"flex",alignItems:"center",justifyContent:"center",margin:"1.5rem auto 1rem",boxShadow:"0 8px 32px rgba(16,185,129,0.4)"}}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h1 style={{fontSize:"1.7rem",color:"var(--navy)",marginBottom:"0.25rem"}}>Attendance Marked!</h1>
          <p className="panel-copy" style={{color:"var(--ink-soft)",marginBottom:"1.5rem"}}>You are marked present for <strong>{result.event_name}</strong></p>
          <div className="card2" style={{background:"#F0FDF4",borderColor:"#86EFAC",textAlign:"left"}}>
            <div className="mono" style={{fontSize:"0.75rem",color:"var(--ink-soft)",marginBottom:"0.75rem"}}>YOUR DETAILS</div>
            <div style={{display:"flex",flexDirection:"column",gap:"0.6rem"}}>
              {[["Name",result.student_name],["Roll No.",result.student_roll||"--"],["Class",(result.class_name||"") + (result.section ? " -- Sec "+result.section : "")],["Check-In Time",checkinTime],["Face Match",result.face_confidence+"%"]].map(([l,v])=>(
                <div key={l} style={{display:"flex",gap:"0.5rem"}}>
                  <span style={{fontWeight:600,minWidth:120,fontSize:"0.88rem"}}>{l}</span>
                  <span style={{fontSize:"0.88rem"}}>{v}</span>
                </div>
              ))}
              {result.latitude && (
                <div style={{display:"flex",gap:"0.5rem"}}>
                  <span style={{fontWeight:600,minWidth:120,fontSize:"0.88rem"}}>Location</span>
                  <span style={{fontSize:"0.85rem"}}>
                    {Number(result.latitude).toFixed(5)}, {Number(result.longitude).toFixed(5)}
                    {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" style={{marginLeft:"0.5rem",color:"var(--teal)",fontSize:"0.8rem"}}>Open Map</a>}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="mono mt-3" style={{fontSize:"0.8rem",color:"var(--ink-soft)"}}>Thank you! Your attendance has been recorded.</div>
        </div>
      </div>
    );
  }

  if (step === "error") return (
    <div className="auth-shell"><div className="auth-panel" style={{maxWidth:480,textAlign:"center"}}>
      <Brand />
      <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,#F59E0B,#D97706)",display:"flex",alignItems:"center",justifyContent:"center",margin:"1.5rem auto 1rem"}}>
        <span style={{fontSize:"2rem"}}>Already</span>
      </div>
      <h2 style={{color:"var(--navy)"}}>Already Checked In</h2>
      {result && result.student_name && <p className="panel-copy"><strong>{result.student_name}</strong> -- already marked for this event.</p>}
      <p className="panel-copy" style={{color:"var(--ink-soft)"}}>{error}</p>
    </div></div>
  );

  if (step === "info") return (
    <div className="auth-shell"><div className="auth-panel" style={{maxWidth:500}}>
      <Brand />
      <div style={{background:"linear-gradient(135deg,var(--navy) 0%,#1E3A5F 100%)",borderRadius:16,padding:"1.5rem",margin:"1.5rem 0 1rem",color:"#fff"}}>
        <div className="eyebrow" style={{color:"#93C5FD",marginBottom:"0.5rem"}}>EVENT CHECK-IN</div>
        <h1 style={{fontSize:"1.5rem",margin:"0 0 0.5rem"}}>{event.name}</h1>
        {event.venue && <div style={{opacity:0.8,fontSize:"0.9rem"}}>Location: {event.venue}</div>}
        <div style={{marginTop:"0.75rem",display:"flex",gap:"1rem",fontSize:"0.85rem",opacity:0.9}}>
          <span>Date: {event.event_date}</span><span>Time: {event.start_time} to {event.end_time}</span>
        </div>
      </div>
      {event.description && <p className="panel-copy" style={{color:"var(--ink-soft)",marginBottom:"1rem"}}>{event.description}</p>}
      {!event.is_active ? (
        <div className="card2" style={{background:"#FEF3C7",borderColor:"#FDE68A",textAlign:"center"}}>
          <div style={{fontWeight:600,marginBottom:"0.25rem"}}>Check-in is closed</div>
          <div className="mono" style={{fontSize:"0.8rem",color:"var(--ink-soft)"}}>This event is not currently accepting attendance.</div>
        </div>
      ) : (
        <>
          <div className="card2 mb-3" style={{background:"#F0FDF4",borderColor:"#86EFAC"}}>
            <div className="mono" style={{fontSize:"0.78rem",color:"var(--teal)",marginBottom:"0.5rem"}}>HOW IT WORKS</div>
            <div style={{fontSize:"0.88rem",display:"flex",flexDirection:"column",gap:"0.4rem"}}>
              <div>Your face will be scanned and matched automatically</div>
              <div>Your GPS location will be recorded as evidence</div>
              <div>Only registered and approved students can check in</div>
            </div>
          </div>
          <button className="btn2 btn2-primary w-100" style={{fontSize:"1.05rem",padding:"0.9rem"}} onClick={enterScan}>
            Mark My Attendance
          </button>
        </>
      )}
    </div></div>
  );

  return (
    <div className="auth-shell"><div className="auth-panel" style={{maxWidth:540}}>
      <Brand />
      <div className="eyebrow mt-3" style={{color:"var(--teal)"}}>Face Scan - {event.name}</div>
      <div className="mono mb-2 mt-2" style={{fontSize:"0.78rem",color:locationStatus==="ok"?"#10B981":locationStatus==="denied"?"#EF4444":"var(--ink-soft)"}}>
        {locationStatus==="ok"?"Location captured":locationStatus==="denied"?"Location not available":"Capturing location..."}
      </div>
      <div style={{position:"relative",borderRadius:12,overflow:"hidden",background:"#000",border:"3px solid "+cornerColor,transition:"border-color 0.3s"}}>
        <video ref={el=>{videoRef.current=el;attachVideo(el);}} autoPlay playsInline muted style={{width:"100%",display:"block",aspectRatio:"4/3",objectFit:"cover"}}/>
      </div>
      <div className="mono mt-2 mb-3" style={{textAlign:"center",color:cornerColor==="#EF4444"?"#EF4444":"var(--ink-soft)",fontSize:"0.85rem"}}>{feedback}</div>
      {error && <div className="card2 mb-3" style={{background:"#FEF2F2",borderColor:"#FECACA",color:"#DC2626",fontSize:"0.88rem"}}>{error}</div>}
      <div className="d-flex gap-2">
        <button className="btn2 btn2-outline" onClick={()=>{stop();setStep("info");setError("");setScanning(false);}}>Back</button>
        <button className="btn2 btn2-primary" style={{flex:1}} onClick={captureAndSubmit} disabled={scanning||!live}>
          {scanning?"Scanning...":"Scan and Check In"}
        </button>
      </div>
      <div className="mono mt-3" style={{fontSize:"0.78rem",color:"var(--ink-soft)",textAlign:"center"}}>Make sure your face is clearly visible in good lighting</div>
    </div></div>
  );
}
