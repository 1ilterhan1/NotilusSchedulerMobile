// Web App.tsx birebir akış:
// - Açılışta AsyncStorage'dan oturum okunur (süresi geçmişse temizlenir).
// - user yoksa → LoginScreen; varsa → MainShell.
// - api.ts 401 yakalarsa onSessionExpired ile login'e dönülür
//   (web'deki window.location.reload karşılığı).

import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { clearAuth, getUser, type UserInfo } from './src/auth';
import { onSessionExpired } from './src/api';
import { loadTheme, useThemeDark } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import MainShell from './src/screens/MainShell';

export default function App() {
    const [user, setUser] = useState<UserInfo | null>(null);
    const [booting, setBooting] = useState(true);
    // Tema (kullanıcıya özel) — açılışta yüklenir, değişince StatusBar da güncellenir
    const dark = useThemeDark();

    useEffect(() => {
        // Kayıtlı tema tercihini ve oturumu yükle (web: senkron; mobilde async)
        Promise.all([loadTheme(), getUser()]).then(([, u]) => { setUser(u); setBooting(false); });
        // 401 → oturum düştü → login ekranı
        onSessionExpired(() => setUser(null));
        return () => onSessionExpired(null);
    }, []);

    async function logout() {
        await clearAuth();
        setUser(null);
    }

    if (booting) {
        return (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' }}>
                <ActivityIndicator size="large" color="#2563eb" />
            </View>
        );
    }

    return (
        <>
            <StatusBar style={dark ? 'light' : 'dark'} />
            {user
                ? <MainShell user={user} onLogout={logout} />
                : <LoginScreen onLogin={setUser} />}
        </>
    );
}
