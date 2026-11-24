/** Authentication and Favorite Lists context provider. */

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getStoredToken, setStoredToken } from "../lib/api";
import type { FavoriteList, RegistrationResponse, UserPublic } from "../types/api";

interface AuthContextValue {
  user: UserPublic | null;
  loading: boolean;
  favoriteLists: FavoriteList[];
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<RegistrationResponse>;
  logout: () => void;
  refreshFavorites: () => Promise<void>;
  createList: (name: string, description?: string) => Promise<FavoriteList>;
  renameList: (listId: number, name: string, description?: string) => Promise<void>;
  deleteList: (listId: number) => Promise<void>;
  addFavoriteItem: (listId: number, meetingDate: string, docType: string, note?: string) => Promise<void>;
  removeFavoriteItem: (listId: number, itemId: number) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [favoriteLists, setFavoriteLists] = useState<FavoriteList[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshFavorites = useCallback(async () => {
    if (!getStoredToken()) {
      setFavoriteLists([]);
      return;
    }
    try {
      const lists = await api.getFavoriteLists();
      setFavoriteLists(lists);
    } catch {
      setFavoriteLists([]);
    }
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .getMe()
      .then(async (u) => {
        setUser(u);
        await refreshFavorites();
      })
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [refreshFavorites]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.login(email, password);
      setStoredToken(res.access_token);
      setUser(res.user);
      await refreshFavorites();
    },
    [refreshFavorites]
  );

  const register = useCallback(async (email: string, username: string, password: string) => {
    return await api.register(email, username, password);
  }, []);

  const logout = useCallback(() => {
    setStoredToken(null);
    setUser(null);
    setFavoriteLists([]);
  }, []);

  const createList = useCallback(async (name: string, description = "") => {
    const created = await api.createFavoriteList(name, description);
    setFavoriteLists((prev) => [created, ...prev]);
    return created;
  }, []);

  const renameList = useCallback(async (listId: number, name: string, description?: string) => {
    const updated = await api.updateFavoriteList(listId, { name, description });
    setFavoriteLists((prev) => prev.map((fl) => (fl.id === listId ? updated : fl)));
  }, []);

  const deleteList = useCallback(async (listId: number) => {
    await api.deleteFavoriteList(listId);
    setFavoriteLists((prev) => prev.filter((fl) => fl.id !== listId));
  }, []);

  const addFavoriteItem = useCallback(
    async (listId: number, meetingDate: string, docType: string, note = "") => {
      await api.addFavoriteItem(listId, meetingDate, docType, note);
      await refreshFavorites();
    },
    [refreshFavorites]
  );

  const removeFavoriteItem = useCallback(
    async (listId: number, itemId: number) => {
      await api.removeFavoriteItem(listId, itemId);
      await refreshFavorites();
    },
    [refreshFavorites]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        favoriteLists,
        login,
        register,
        logout,
        refreshFavorites,
        createList,
        renameList,
        deleteList,
        addFavoriteItem,
        removeFavoriteItem,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
