import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value = {
    user,
    loading,
    login: async (email, password) => {
      const u = await api.post('/api/auth/login', { email, password });
      setUser(u);
      return u;
    },
    signup: async (email, password, display_name) => {
      const u = await api.post('/api/auth/signup', { email, password, display_name });
      setUser(u);
      return u;
    },
    logout: async () => {
      await api.post('/api/auth/logout');
      setUser(null);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
