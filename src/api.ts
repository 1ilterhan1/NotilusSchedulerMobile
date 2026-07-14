// Web api.ts birebir — iki fark:
// 1. Görece URL'lerin önüne API_BASE_URL eklenir (vite proxy yok).
// 2. 401'de window.location.reload() yerine onSessionExpired dinleyicisi
//    çağrılır (App.tsx login ekranına döndürür).

import { API_BASE_URL } from './config';
import { getToken, clearAuth } from './auth';

let sessionExpiredListener: (() => void) | null = null;

/** App.tsx kaydeder: 401 gelince login ekranına dönmek için. */
export function onSessionExpired(listener: (() => void) | null): void {
    sessionExpiredListener = listener;
}

/**
 * Tüm API çağrıları buradan geçer. Token'ı otomatik ekler.
 * 401 dönerse oturumu temizler ve login'e yönlendirir.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const token = await getToken();
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // FormData gövdesinde Content-Type'ı fetch belirler (multipart boundary);
    // elle set edilirse upload bozulur. (web birebir)
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const url = input.startsWith('http') ? input : `${API_BASE_URL}${input}`;
    const res = await fetch(url, { ...init, headers });

    if (res.status === 401) {
        await clearAuth();
        sessionExpiredListener?.();
        throw new Error('Session expired, please sign in again.');
    }

    return res;
}

export async function apiGet<T>(url: string): Promise<T> {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<T>;
}
