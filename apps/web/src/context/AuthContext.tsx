import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { CustomerUser } from '../types/index.js';
import { api, getStoredToken, clearStoredToken } from '../api/client.js';

interface TelegramWebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: {
    user?: TelegramWebAppUser;
    start_param?: string;
  };
  expand: () => void;
  close: () => void;
  ready: () => void;
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
  isVerticalSwipesEnabled?: boolean;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  MainButton: {
    text: string;
    show: () => void;
    hide: () => void;
    enable: () => void;
    disable: () => void;
    showProgress: (leaveActive?: boolean) => void;
    hideProgress: () => void;
    onClick: (fn: () => void) => void;
    offClick: (fn: () => void) => void;
  };
  BackButton: {
    isVisible: boolean;
    show: () => void;
    hide: () => void;
    onClick: (fn: () => void) => void;
    offClick: (fn: () => void) => void;
  };
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: TelegramWebApp;
    };
  }
}

const CACHED_USER_KEY = 'orojackpot_cached_user';

const getInitialOptimisticUser = (): CustomerUser | null => {
  if (typeof window === 'undefined') return null;

  // 1. Try authoritative cached user profile from previous session
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.id || parsed.telegramUserId)) {
        return parsed as CustomerUser;
      }
    }
  } catch {
    // ignore
  }

  // 2. Synchronous Telegram WebApp native user context (instant 0ms initialization)
  const tgUser = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (tgUser && tgUser.id) {
    return {
      id: String(tgUser.id),
      telegramUserId: String(tgUser.id),
      firstName: tgUser.first_name,
      lastName: tgUser.last_name,
      username: tgUser.username,
      role: 'CUSTOMER',
    };
  }

  return null;
};

interface AuthContextType {
  user: CustomerUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  webApp: TelegramWebApp | undefined;
  loginAsDemoUser: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const initialUser = getInitialOptimisticUser();
  const [user, setUser] = useState<CustomerUser | null>(initialUser);
  // Zero-wait startup: If we have an initial user synchronously, start with isLoading = false!
  const [isLoading, setIsLoading] = useState<boolean>(!initialUser);

  const webApp = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

  useEffect(() => {
    async function initAuth() {
      if (webApp) {
        webApp.ready();
        webApp.expand();

        // Prevent accidental gesture dismiss while scrolling through lottery numbers
        if ('isVerticalSwipesEnabled' in webApp) {
          (webApp as any).isVerticalSwipesEnabled = false;
        }

        // Synchronize dark header and background colors with FulusApp theme
        if (webApp.setHeaderColor) {
          try {
            webApp.setHeaderColor('#080b10');
          } catch {
            // ignore
          }
        }
        if (webApp.setBackgroundColor) {
          try {
            webApp.setBackgroundColor('#080b10');
          } catch {
            // ignore
          }
        }
      }

      const initData = webApp?.initData;

      if (initData) {
        try {
          const authResult = await api.authWithTelegram(initData);
          setUser(authResult.user);
          try {
            localStorage.setItem(CACHED_USER_KEY, JSON.stringify(authResult.user));
          } catch {
            // ignore
          }
          setIsLoading(false);
          return;
        } catch (err) {
          console.warn('Failed to authenticate with Telegram initData:', err);
        }
      }

      // Check if existing valid token is stored
      const existingToken = getStoredToken();
      if (existingToken) {
        try {
          const userData = await api.getMe();
          if (userData && userData.id) {
            setUser(userData);
            try {
              localStorage.setItem(CACHED_USER_KEY, JSON.stringify(userData));
            } catch {
              // ignore
            }
            setIsLoading(false);
            return;
          }
        } catch {
          clearStoredToken();
        }
      }

      // If running outside Telegram without initData and without token, authenticate as demo/guest player
      if (!initData && !getStoredToken()) {
        try {
          const now = Math.floor(Date.now() / 1000);
          const mockInitData = `query_id=AAHdF6IQAAAAAN0XohDhrPzN&user=%7B%22id%22%3A888888888%2C%22first_name%22%3A%22Player%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22player%22%7D&auth_date=${now}&hash=mock`;
          const result = await api.authWithTelegram(mockInitData).catch(() => null);
          if (result) {
            setUser(result.user);
            try {
              localStorage.setItem(CACHED_USER_KEY, JSON.stringify(result.user));
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      setIsLoading(false);
    }

    void initAuth();
  }, [webApp]);

  const loginAsDemoUser = async () => {
    setIsLoading(true);
    try {
      // Generate customer session for guest access (ID 888888888 avoids collision with superadmin)
      const now = Math.floor(Date.now() / 1000);
      const mockInitData = `query_id=AAHdF6IQAAAAAN0XohDhrPzN&user=%7B%22id%22%3A888888888%2C%22first_name%22%3A%22Player%22%2C%22last_name%22%3A%22%22%2C%22username%22%3A%22player%22%7D&auth_date=${now}&hash=mock`;
      const result = await api.authWithTelegram(mockInitData).catch(() => null);
      if (result) {
        setUser(result.user);
        try {
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(result.user));
        } catch {
          // ignore
        }
      } else {
        // Fallback local state if API is offline
        const demoUser: CustomerUser = {
          id: 'player-user-id',
          telegramUserId: '888888888',
          firstName: 'Player',
          username: 'player',
          role: 'CUSTOMER',
        };
        setUser(demoUser);
        try {
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(demoUser));
        } catch {
          // ignore
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    clearStoredToken();
    try {
      localStorage.removeItem(CACHED_USER_KEY);
    } catch {
      // ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        webApp,
        loginAsDemoUser,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
