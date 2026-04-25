import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Nav from './components/Nav.jsx';
import Login from './pages/Login.jsx';
import Week from './pages/Week.jsx';
import Grocery from './pages/Grocery.jsx';
import Staples from './pages/Staples.jsx';
import Preferences from './pages/Preferences.jsx';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="container">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route
          path="/login"
          element={loading ? <div className="container">Loading…</div> : user ? <Navigate to="/week" replace /> : <Login />}
        />
        <Route path="/week" element={<Protected><Week /></Protected>} />
        <Route path="/grocery" element={<Protected><Grocery /></Protected>} />
        <Route path="/staples" element={<Protected><Staples /></Protected>} />
        <Route path="/preferences" element={<Protected><Preferences /></Protected>} />
        <Route path="*" element={<Navigate to="/week" replace />} />
      </Routes>
    </div>
  );
}
