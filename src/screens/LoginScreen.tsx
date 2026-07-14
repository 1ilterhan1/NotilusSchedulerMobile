// Web pages/Login.tsx birebir: aynı alanlar, aynı metinler, aynı akış.
// POST /api/auth/login → { token, expiresAt, user } → AsyncStorage'a yaz.

import { useState } from 'react';
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { API_BASE_URL } from '../config';
import { setAuth, type UserInfo } from '../auth';

interface LoginResponse {
    token: string;
    expiresAt: string;
    user: UserInfo;
}

interface Props {
    onLogin: (user: UserInfo) => void;
}

function LoginScreen({ onLogin }: Props) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    async function handleSubmit() {
        setError(null);
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            if (!res.ok) {
                const body = await res.json().catch(() => null);
                throw new Error(body?.message ?? `Login failed (${res.status})`);
            }

            const data = (await res.json()) as LoginResponse;
            await setAuth({ token: data.token, expiresAt: data.expiresAt, user: data.user });
            onLogin(data.user);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    }

    return (
        <KeyboardAvoidingView
            style={styles.wrap}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
            <View style={styles.card}>
                <Text style={styles.brand}>Notilus Scheduler</Text>
                <Text style={styles.sub}>Sign in to continue</Text>

                <View style={styles.field}>
                    <Text style={styles.label}>Username</Text>
                    <TextInput
                        style={styles.input}
                        value={username}
                        onChangeText={setUsername}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                    />
                </View>

                <View style={styles.field}>
                    <Text style={styles.label}>Password</Text>
                    <TextInput
                        style={styles.input}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        onSubmitEditing={handleSubmit}
                    />
                </View>

                {error && <Text style={styles.error}>{error}</Text>}

                <TouchableOpacity
                    style={[styles.btnPrimary, loading && styles.btnDisabled]}
                    onPress={handleSubmit}
                    disabled={loading}
                >
                    {loading
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.btnText}>Sign In</Text>}
                </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
    );
}

// Web App.css login-* birebir renkler
const styles = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6' },
    card: {
        backgroundColor: '#fff', padding: 32, borderRadius: 12, width: 340,
        shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 4 },
        elevation: 4,
    },
    brand: { fontSize: 20, color: '#111827', textAlign: 'center', marginBottom: 4, fontWeight: '600' },
    sub: { textAlign: 'center', color: '#6b7280', fontSize: 14, marginBottom: 20 },
    field: { marginBottom: 14 },
    label: { fontSize: 13, color: '#374151', marginBottom: 6 },
    input: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, color: '#111827',
    },
    error: { color: '#b91c1c', marginBottom: 10, fontSize: 13 },
    btnPrimary: {
        padding: 10, backgroundColor: '#2563eb', borderRadius: 6,
        alignItems: 'center', marginTop: 4,
    },
    btnDisabled: { backgroundColor: '#93c5fd' },
    btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
});

export default LoginScreen;
