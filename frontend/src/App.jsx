import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
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
import MentorApprovals from "./pages/MentorApprovals";

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

function RequireRole({ roles, children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

// Landing page for visitors; dashboard (in the app layout) for signed-in users.
function HomeGate() {
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
  if (user) {
    return (
      <Layout>
        <Dashboard />
      </Layout>
    );
  }
  return <Landing />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeGate />} />

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
          <Route
            path="/my_attendance"
            element={
              <RequireRole roles={["student"]}>
                <MyAttendance />
              </RequireRole>
            }
          />
          <Route
            path="/add_student"
            element={
              <RequireRole roles={["teacher"]}>
                <AddStudent />
              </RequireRole>
            }
          />
          <Route
            path="/manage_students"
            element={
              <RequireRole roles={["teacher"]}>
                <ManageStudents />
              </RequireRole>
            }
          />
          <Route
            path="/mentor_approvals"
            element={
              <RequireRole roles={["teacher"]}>
                <MentorApprovals />
              </RequireRole>
            }
          />
          <Route
            path="/mark_attendance"
            element={
              <RequireRole roles={["teacher"]}>
                <MarkAttendance />
              </RequireRole>
            }
          />
          <Route
            path="/mark_attendance_classroom"
            element={
              <RequireRole roles={["teacher"]}>
                <MarkClassroom />
              </RequireRole>
            }
          />
          <Route
            path="/attendance_record"
            element={
              <RequireRole roles={["teacher", "admin"]}>
                <Records />
              </RequireRole>
            }
          />
          <Route
            path="/analytics"
            element={
              <RequireRole roles={["teacher"]}>
                <Analytics />
              </RequireRole>
            }
          />
          <Route
            path="/copilot"
            element={
              <RequireRole roles={["teacher"]}>
                <Copilot />
              </RequireRole>
            }
          />
          <Route
            path="/register_export"
            element={
              <RequireRole roles={["teacher"]}>
                <RegisterExport />
              </RequireRole>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireRole roles={["admin"]}>
                <Admin />
              </RequireRole>
            }
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
