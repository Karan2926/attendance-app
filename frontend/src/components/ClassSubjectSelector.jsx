import { useEffect, useRef, useState } from "react";
import { api } from "../api";

// Cascading Class → Subject selects. Mirrors the Flask class_subject.js behavior.
export default function ClassSubjectSelector({
  onSelect,
  initialSubjectId,
  subjectsLabel = "Select subject",
  includeAllOption = false,
  disabled = false,
}) {
  const [classes, setClasses] = useState([]);
  const [classId, setClassId] = useState("");
  const [subjects, setSubjects] = useState([]);
  const [subjectId, setSubjectId] = useState("");

  // Keep onSelect in a ref so the notify effect only reruns on real selection
  // changes, never when the parent passes a fresh inline arrow function.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    api
      .get("/classes")
      .then((d) => setClasses(d.classes || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!classId) {
      setSubjects([]);
      setSubjectId("");
      return;
    }
    api
      .get(`/classes/${classId}/subjects`)
      .then((d) => {
        setSubjects(d.subjects || []);
        if (initialSubjectId && d.subjects.some((s) => String(s.id) === String(initialSubjectId))) {
          setSubjectId(String(initialSubjectId));
        } else {
          setSubjectId("");
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId]);

  useEffect(() => {
    if (onSelectRef.current) onSelectRef.current({ classId, subjectId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, subjectId]);

  return (
    <>
      <div>
        <label className="label2">Class</label>
        <select
          className="input2"
          aria-label="Class"
          value={classId}
          onChange={(e) => setClassId(e.target.value)}
          disabled={disabled}
        >
          <option value="">{includeAllOption ? "All my classes" : "Select class"}</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.section ? ` — Sec ${c.section}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label2">Subject</label>
        <select
          className="input2"
          aria-label="Subject"
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          disabled={!classId || disabled}
        >
          <option value="">{includeAllOption ? "All subjects" : subjectsLabel}</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code ? `${s.name} (${s.code})` : s.name}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
