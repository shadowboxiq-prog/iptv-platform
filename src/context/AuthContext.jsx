import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch } from '../utils/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [admin, setAdmin] = useState(null);
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const checkStatus = async () => {
    try {
      const res = await apiFetch('/api/auth/status');
      setIsAuthenticated(res.isAuthenticated);
      setAdmin(res.admin || null);
      setRequiresSetup(res.requiresSetup || false);
    } catch (err) {
      console.warn('Auth status check error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  const login = async (username, password) => {
    const res = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    });
    setIsAuthenticated(true);
    setAdmin(res.admin);
    return res;
  };

  const logout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    setIsAuthenticated(false);
    setAdmin(null);
  };

  const setupFirstAdmin = async ({ username, email, password, setupToken }) => {
    const res = await apiFetch('/api/auth/setup', {
      method: 'POST',
      body: { username, email, password, setupToken }
    });
    setRequiresSetup(false);
    return res;
  };

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      admin,
      requiresSetup,
      loading,
      login,
      logout,
      setupFirstAdmin,
      refreshAuth: checkStatus
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
