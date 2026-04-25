import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth.jsx';

export default function Nav() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <nav className="nav">
      <div className="nav-brand">Nourish</div>
      <div className="nav-links">
        <NavLink to="/week" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Week
        </NavLink>
        <NavLink to="/grocery" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Grocery
        </NavLink>
        <NavLink to="/staples" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Staples
        </NavLink>
        <NavLink to="/preferences" className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
          Preferences
        </NavLink>
      </div>
      <div className="nav-user">
        <span>{user.display_name}</span>
        <button onClick={logout}>Sign out</button>
      </div>
    </nav>
  );
}
