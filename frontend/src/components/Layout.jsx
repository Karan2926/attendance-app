import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import Brand from "./Brand";

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const role = user?.role;
  const [open, setOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const navLinkClass = ({ isActive }) =>
    `nav-link${isActive ? " primary" : ""}`;

  return (
    <>
      <nav className="topbar">
        <Link className="brand-link" to="/" aria-label="Go to dashboard">
          <Brand />
        </Link>

        <button
          className="nav-toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>

        <div className={`nav-links ${open ? "open" : ""}`}>
          {role === "student" ? (
            <>
              <NavLink to="/my_attendance" className={navLinkClass}>
                My Attendance
              </NavLink>
            </>
          ) : role === "mentor" ? (
            <>
              <NavLink to="/mentor_approvals" className={navLinkClass}>
                Section Approvals &amp; CSV
              </NavLink>
              <NavLink to="/manage_students" className={navLinkClass}>
                Section Roster
              </NavLink>
              <NavLink to="/add_student" className={navLinkClass}>
                Add Student
              </NavLink>
            </>
          ) : role === "admin" ? (
            <>
              <NavLink to="/" className={navLinkClass} end>
                Dashboard
              </NavLink>
              <NavLink to="/event_dashboard" className={navLinkClass}>
                Event Attendance
              </NavLink>
              <NavLink to="/admin" className={navLinkClass}>
                System Management
              </NavLink>
              <NavLink to="/admin?tab=audit" className={navLinkClass}>
                Audit Log
              </NavLink>
            </>
          ) : role === "event_organizer" ? (
            <>
              <NavLink to="/event_dashboard" className={navLinkClass}>
                Event Dashboard
              </NavLink>
            </>
          ) : (
            <>
              <NavLink to="/mark_attendance" className={navLinkClass}>
                Mark Attendance
              </NavLink>
              <NavLink to="/mark_attendance_classroom" className={navLinkClass}>
                Classroom Photo
              </NavLink>
              <NavLink to="/attendance_record" className={navLinkClass}>
                Records
              </NavLink>
              <NavLink to="/analytics" className={navLinkClass}>
                Analytics
              </NavLink>
              <NavLink to="/copilot" className={navLinkClass}>
                AI Copilot
              </NavLink>
            </>
          )}
          <div className="nav-user">
            <span className="nav-user-name">{user?.username}</span>
            <button
              className="nav-link nav-logout"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      </nav>
      <Outlet />
      {children}
    </>
  );
}
