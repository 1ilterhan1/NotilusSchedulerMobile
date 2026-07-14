// Giriş bilgisini (token + kullanıcı) cihazda saklar.
// Web auth.ts birebir — localStorage yerine AsyncStorage (async API).

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UserInfo {
    id: number;
    name: string;
    companyId: number;
    status: string;
    canAssign: boolean;
}

export interface StoredAuth {
    token: string;
    expiresAt: string;
    user: UserInfo;
}

const KEY = 'notilus_auth';

export async function setAuth(auth: StoredAuth): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(auth));
}

export async function getAuth(): Promise<StoredAuth | null> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    try {
        const auth = JSON.parse(raw) as StoredAuth;
        // Süresi geçtiyse geçersiz say (web birebir)
        if (new Date(auth.expiresAt) <= new Date()) {
            await clearAuth();
            return null;
        }
        return auth;
    } catch {
        return null;
    }
}

export async function clearAuth(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
}

export async function getToken(): Promise<string | null> {
    return (await getAuth())?.token ?? null;
}

export async function getUser(): Promise<UserInfo | null> {
    return (await getAuth())?.user ?? null;
}
