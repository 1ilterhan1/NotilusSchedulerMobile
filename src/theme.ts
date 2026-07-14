// ── AppTheme birebir mobil karşılığı ──
// Masaüstü Logic/AppTheme.cs + web App.css ".theme-light" kuralları.
// KULLANICIYA ÖZEL ayar (masaüstü Properties.Settings.ApplicationTheme /
// web localStorage 'ApplicationTheme'): 'true' = Dark, 'false' = Light; yoksa
// varsayılan Dark. Web'de tema değişince 'app-theme-changed' event'i tüm kabuğu
// canlı boyar; React Native'de window event yok, bunun yerine küçük bir dinleyici
// deposu + useSyncExternalStore hook'u ile aynı canlı yeniden boyama sağlanır.

import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const LS_THEME = 'ApplicationTheme';

// true = Dark (varsayılan), false = Light
let dark = true;
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }

/** Açılışta kayıtlı tercihi yükler (App boot). */
export async function loadTheme(): Promise<void> {
    try {
        const v = await AsyncStorage.getItem(LS_THEME);
        dark = v !== 'false';
    } catch {
        dark = true;
    }
    emit();
}

/** theme_CheckedChanged birebir: redundant yazma atlanır, sonra canlı boyanır. */
export async function setThemeMode(isDark: boolean): Promise<void> {
    if (dark === isDark) return;           // redundant write yok
    dark = isDark;
    await AsyncStorage.setItem(LS_THEME, String(isDark));   // Properties.Settings.Save() karşılığı
    emit();                                // AppTheme.SetMode(isDark) → ThemeChanged karşılığı
}

export function isDark(): boolean { return dark; }

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
}

/** Kabuk/ekranlar bu hook'la temaya abone olur; tema değişince yeniden render olur. */
export function useThemeDark(): boolean {
    return useSyncExternalStore(subscribe, isDark, isDark);
}

export interface ThemeColors {
    // Üst bar (mobil; masaüstü page-header şeridi karşılığı)
    topbarBg: string; topbarText: string; topbarBorder: string;
    // İçerik zemini (AppTheme.PageBg)
    contentBg: string;
    // Kenar çubuğu (FormMainPanel navigasyon)
    sidebarBg: string; sidebarBorder: string;
    brandText: string;
    navLabel: string; navLabelActive: string; navActiveBg: string; chevron: string;
    footerBorder: string; userName: string;
    logoutBg: string; logoutText: string; logoutBorder: string;
}

// Koyu tema — mevcut kabuk renkleri (App.css koyu tema birebir)
const DARK: ThemeColors = {
    topbarBg: '#1e2433', topbarText: '#e5e7eb', topbarBorder: '#2d374b',
    contentBg: '#f3f4f6',
    sidebarBg: '#1e2433', sidebarBorder: '#2d374b',
    brandText: '#e5e7eb',
    navLabel: '#b9c3d7', navLabelActive: '#fff', navActiveBg: '#2d374e', chevron: '#fff',
    footerBorder: '#2d374b', userName: '#e5e7eb',
    logoutBg: '#2d3748', logoutText: '#c8d2e6', logoutBorder: '#4b5563',
};

// Açık tema — App.css ".shell.theme-light" birebir
// (SidebarActiveBg her iki temada da aynı navy #2d374e)
const LIGHT: ThemeColors = {
    topbarBg: '#ffffff', topbarText: '#111827', topbarBorder: '#dae0e9',
    contentBg: '#f7f8fc',
    sidebarBg: '#ffffff', sidebarBorder: '#e8ebf2',
    brandText: '#1f3a6e',
    navLabel: '#4b5563', navLabelActive: '#fff', navActiveBg: '#2d374e', chevron: '#fff',
    footerBorder: '#e8ebf2', userName: '#323338',
    logoutBg: '#f1f5f9', logoutText: '#4b5563', logoutBorder: '#dae0e9',
};

export function colorsFor(darkMode: boolean): ThemeColors { return darkMode ? DARK : LIGHT; }

/** Kabuk renkleri (temaya abone). */
export function useThemeColors(): ThemeColors { return colorsFor(useThemeDark()); }
