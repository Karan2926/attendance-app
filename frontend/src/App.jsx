import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import MyAttendance from "./pages/MyAttendance";
import AddStudent from "./pages/AddStudent";
import ManageStudents from "./pages/ManageStudents";
import MarkAttendance from "./pages/MarkAttendance";
import MarkClassroom from "./pages/MarkClassroom";
import Records from "./pages/Records";
import Analytics from "./pages/Analytics";
import Copilot from "./pages/Copilot";
import Admin from "./pages/Admin";
import RegisterExport from "./pages/RegisterExport";

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page" style={{ textAlign: "center", paddingTop: "6rem" }}>
        <div className="mono" style={{ color: "var(--ink-soft)" }}>
          Loading…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="/register"
        element={
          <GuestOnly>
            <Register />
          </GuestOnly>
        }
      />

      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/my_attendance" element={<MyAttendance />} />
          <Route path="/add_student" element={<AddStudent />} />
          <Route path="/manage_students" element={<ManageStudents />} />
          <Route path="/mark_attendance" element={<MarkAttendance />} />
          <Route path="/mark_attendance_classroom" element={<MarkClassroom />} />
          <Route path="/attendance_record" element={<Records />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/copilot" element={<Copilot />} />
          <Route path="/register_export" element={<RegisterExport />} />
          <Route path="/admin" element={<Admin />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
