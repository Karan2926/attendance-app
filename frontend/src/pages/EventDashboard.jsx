import { useState, useEffect } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

export default function EventDashboard() {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [form, setForm] = useState({ name: "", venue: "ITM University, Gwalior", description: "", event_date: "", start_time: "", end_time: "", radius: 300, latitude: "", longitude: "" });

  const [formError, setFormError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState("events");

  function loadEvents() {
    api.get("/events").then(d => { setEvents(d.events || []); setLoading(false); }).catch(() => setLoading(false));
  }

  useEffect(() => { loadEvents(); }, []);

  function loadAttendees(eventId) {
    api.get("/events/" + eventId + "/attendance").then(d => {
      setSelected(d.event);
      setAttendees(d.attendees || []);
      setTab("attendees");
    }).catch(err => alert(err.message));
  }

  async function createEvent(e) {
    e.preventDefault(); setFormError(""); setCreating(true);
    try {
      await api.post("/events", form);
      setForm({ name: "", venue: "ITM University, Gwalior", description: "", event_date: "", start_time: "", end_time: "", radius: 300, latitude: "", longitude: "" });
      setShowCreate(false);

      loadEvents();
    } catch (err) { setFormError(err.message || "Failed to create event"); }
    finally { setCreating(false); }
  }

  async function toggleEvent(eventId) {
    setToggling(true);
    try {
      await api.post("/events/" + eventId + "/toggle", {});
      loadEvents();
      if (selected && selected.id === eventId) loadAttendees(eventId);
    } catch (err) { alert(err.message); }
    finally { setToggling(false); }
  }

  function downloadCSV(eventId) {
    window.open("/api/events/" + eventId + "/attendance.csv", "_blank");
  }

  function copyCheckinLink(eventId) {
    const url = window.location.origin + "/event/" + eventId;
    navigator.clipboard.writeText(url).then(() => alert("Check-in link copied! Share this with students: " + url));
  }

  async function deleteEvent(eventId, name) {
    if (!window.confirm(`Are you sure you want to permanently delete event "${name}"? All checked-in data for this event will be permanently deleted.`)) return;
    try {
      await api.delete("/events/" + eventId + "/delete");
      loadEvents();
      if (selected && selected.id === eventId) {
        setSelected(null);
        setAttendees([]);
        setTab("events");
      }
    } catch (err) {
      alert(err.message || "Failed to delete event");
    }
  }


  return (
    <>
      <div className="page">
        <div className="dash-hero">
          <div className="dash-hero-main">
            <span className="eyebrow">event organizer workspace</span>
            <h1>Event Attendance</h1>
            <p>Create college functions and events. Students scan their face to check in with GPS location evidence.</p>
          </div>
          <div className="dash-stat">
            <span className="eyebrow">Total Events</span>
            <div className="num">{events.length}</div>
            <div className="mono" style={{color:"var(--ink-soft)",marginTop:"0.4rem",fontSize:"0.78rem"}}>
              {events.filter(e => e.is_active).length} active
            </div>
          </div>
        </div>

        <div className="d-flex gap-2 mb-4" style={{borderBottom:"1px solid var(--line)",paddingBottom:"0.5rem"}}>
          {["events","attendees"].map(t => (
            <button key={t} onClick={() => setTab(t)} className={"btn2 " + (tab===t?"btn2-primary":"btn2-outline")} style={{textTransform:"capitalize"}}>
              {t === "attendees" ? (selected ? selected.name : "Attendees") : "All Events"}
            </button>
          ))}
          <div style={{flex:1}}/>
          <button className="btn2 btn2-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? "Cancel" : "+ New Event"}
          </button>
        </div>

        {showCreate && (
          <div className="card2 mb-4" style={{maxWidth:600}}>
            <span className="eyebrow">Create Event</span>
            <h2 className="panel-title" style={{marginBottom:"1rem"}}>New Event / Function</h2>
            <form onSubmit={createEvent}>
              <label className="label2">Event Name *</label>
              <input className="input2 mb-2" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="IKS Cultural Program 2025" required/>
              <div className="d-flex gap-2">
                <div style={{flex:2}}>
                  <label className="label2">Venue *</label>
                  <input className="input2 mb-2" value={form.venue} onChange={e=>setForm({...form,venue:e.target.value})} placeholder="ITM University, Gwalior" required/>
                </div>
                <div style={{flex:1}}>
                  <label className="label2">Geofence Radius (meters) *</label>
                  <input className="input2 mb-2" type="number" min="50" max="5000" value={form.radius} onChange={e=>setForm({...form,radius:e.target.value})} required/>
                </div>
              </div>

              <div style={{marginTop: "0.2rem", marginBottom: "1rem"}}>
                <details style={{fontSize: "0.85rem", color: "var(--ink-soft)"}}>
                  <summary style={{cursor: "pointer", fontWeight: 600, color: "var(--teal)"}}>🗺️ Advanced Geofencing GPS coordinates (Optional)</summary>
                  <div className="d-flex gap-2 mt-2">
                    <div style={{flex:1}}>
                      <label className="label2">Custom Latitude</label>
                      <input className="input2" type="number" step="any" value={form.latitude} onChange={e=>setForm({...form,latitude:e.target.value})} placeholder="e.g. 26.0607"/>
                    </div>
                    <div style={{flex:1}}>
                      <label className="label2">Custom Longitude</label>
                      <input className="input2" type="number" step="any" value={form.longitude} onChange={e=>setForm({...form,longitude:e.target.value})} placeholder="e.g. 78.1396"/>
                    </div>
                  </div>
                  <small style={{display: "block", marginTop: "0.4rem", color: "var(--ink-soft)", lineHeight: 1.3}}>
                    Leave coordinates blank to automatically lookup coordinates via OpenStreetMap (defaults to ITM University campus coordinates: 26.0607, 78.1396).
                  </small>
                </details>
              </div>

              <label className="label2">Description</label>

              <textarea className="input2 mb-2" rows={2} value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Brief description of the event (optional)"/>
              <div className="d-flex gap-2">
                <div style={{flex:1}}>
                  <label className="label2">Date *</label>
                  <input className="input2 mb-2" type="date" value={form.event_date} onChange={e=>setForm({...form,event_date:e.target.value})} required/>
                </div>
                <div style={{flex:1}}>
                  <label className="label2">Start Time *</label>
                  <input className="input2 mb-2" type="time" value={form.start_time} onChange={e=>setForm({...form,start_time:e.target.value})} required/>
                </div>
                <div style={{flex:1}}>
                  <label className="label2">End Time *</label>
                  <input className="input2 mb-2" type="time" value={form.end_time} onChange={e=>setForm({...form,end_time:e.target.value})} required/>
                </div>
              </div>
              {formError && <div style={{color:"#DC2626",fontSize:"0.85rem",marginBottom:"0.75rem"}}>{formError}</div>}
              <button className="btn2 btn2-primary w-100" type="submit" disabled={creating}>{creating ? "Creating..." : "Create Event"}</button>
            </form>
          </div>
        )}

        {tab === "events" && (
          <div>
            {loading && <div className="mono" style={{color:"var(--ink-soft)"}}>Loading events...</div>}
            {!loading && events.length === 0 && (
              <div className="card2" style={{textAlign:"center",padding:"2rem"}}>
                <div style={{fontSize:"2.5rem",marginBottom:"0.75rem"}}>📅</div>
                <h3>No events yet</h3>
                <p className="panel-copy" style={{color:"var(--ink-soft)"}}>Click "+ New Event" to create your first event.</p>
              </div>
            )}
            <div className="row g-3">
              {events.map(ev => (
                <div key={ev.id} className="col-lg-6">
                  <div className="card2" style={{borderLeft:ev.is_active?"4px solid #10B981":"4px solid var(--line)"}}>
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <span className="eyebrow">{ev.is_active ? "LIVE" : "CLOSED"}</span>
                        <h3 style={{margin:"0.2rem 0",fontSize:"1.1rem"}}>{ev.name}</h3>
                      </div>
                      <div className="mono" style={{fontSize:"0.78rem",color:"var(--ink-soft)",textAlign:"right"}}>
                        <div>{ev.attendance_count} checked in</div>
                      </div>
                    </div>
                    {ev.venue && <div className="mono" style={{fontSize:"0.78rem",color:"var(--ink-soft)",marginBottom:"0.25rem"}}>Location: {ev.venue}</div>}
                    <div className="mono" style={{fontSize:"0.78rem",color:"var(--ink-soft)",marginBottom:"1rem"}}>{ev.event_date} | {ev.start_time} - {ev.end_time}</div>
                    <div className="d-flex gap-2 flex-wrap">
                      <button className="btn2 btn2-outline btn-sm" style={{fontSize:"0.8rem"}} onClick={() => loadAttendees(ev.id)}>View Attendees</button>
                      <button className="btn2 btn2-outline btn-sm" style={{fontSize:"0.8rem"}} onClick={() => copyCheckinLink(ev.id)}>Copy Link</button>
                      <button className={"btn2 btn-sm " + (ev.is_active?"btn2-outline":"btn2-primary")} style={{fontSize:"0.8rem"}} onClick={() => toggleEvent(ev.id)} disabled={toggling}>
                        {ev.is_active ? "Close" : "Open"}
                      </button>
                      <button className="btn2 btn2-outline btn-sm" style={{fontSize:"0.8rem", color:"#EF4444", borderColor:"#FECACA"}} onClick={() => deleteEvent(ev.id, ev.name)}>
                        🗑️ Delete
                      </button>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "attendees" && selected && (
          <div>
            <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
              <div>
                <span className="eyebrow">Attendance for</span>
                <h2 style={{margin:"0.2rem 0"}}>{selected.name}</h2>
                <div className="mono" style={{fontSize:"0.8rem",color:"var(--ink-soft)"}}>{selected.event_date} | {selected.start_time} - {selected.end_time} | {selected.venue}</div>
              </div>
              <div className="d-flex gap-2">
                <button className="btn2 btn2-outline" onClick={() => loadAttendees(selected.id)}>Refresh</button>
                <button className="btn2 btn2-primary" onClick={() => downloadCSV(selected.id)}>Download CSV</button>
              </div>
            </div>
            <div className="card2" style={{background:"#F0FDF4",borderColor:"#86EFAC",marginBottom:"1rem",padding:"0.75rem 1rem"}}>
              <span style={{fontWeight:700,fontSize:"1.2rem"}}>{attendees.length}</span>
              <span className="mono" style={{color:"var(--ink-soft)",marginLeft:"0.5rem"}}>students checked in</span>
            </div>
            {attendees.length === 0 ? (
              <div className="card2" style={{textAlign:"center",padding:"2rem"}}>
                <div style={{fontSize:"2rem",marginBottom:"0.5rem"}}>0</div>
                <p className="panel-copy" style={{color:"var(--ink-soft)"}}>No students have checked in yet. Share the check-in link with students.</p>
                <button className="btn2 btn2-outline mt-2" onClick={() => copyCheckinLink(selected.id)}>Copy Check-In Link</button>
              </div>
            ) : (
              <div className="table-responsive">
                <table className="table2">
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>Roll No.</th><th>Class</th><th>Section</th><th>Check-In Time</th><th>Location</th><th>Confidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendees.map((a, i) => {
                      const mapsUrl = a.latitude && a.longitude ? "https://maps.google.com/?q=" + a.latitude + "," + a.longitude : null;
                      const time = a.checked_in_at ? new Date(a.checked_in_at).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "--";
                      return (
                        <tr key={a.id}>
                          <td className="mono" style={{color:"var(--ink-soft)"}}>{i+1}</td>
                          <td style={{fontWeight:600}}>{a.name}</td>
                          <td className="mono">{a.roll || "--"}</td>
                          <td>{a.class_name || "--"}</td>
                          <td>{a.section || "--"}</td>
                          <td className="mono" style={{fontSize:"0.82rem"}}>{time}</td>
                          <td>
                            {a.location_name ? (
                              <div style={{fontSize:"0.82rem", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"}} title={a.location_name}>
                                {a.location_name}
                                {mapsUrl && <a href={mapsUrl} target="_blank" rel="noreferrer" style={{marginLeft:"0.5rem",color:"var(--teal)",fontSize:"0.78rem"}}>📍 Map</a>}
                              </div>
                            ) : (
                              <span style={{color:"var(--ink-soft)"}}>--</span>
                            )}
                          </td>

                          <td className="mono" style={{fontSize:"0.82rem"}}>{a.face_confidence ? a.face_confidence + "%" : "--"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
