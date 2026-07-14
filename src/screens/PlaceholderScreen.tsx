// Henüz klonlanmamış ekranlar için geçici içerik.
// Her ekran klonlandıkça MainShell'de gerçek bileşeniyle değiştirilecek.

import { StyleSheet, Text, View } from 'react-native';

interface Props {
    title: string;
}

function PlaceholderScreen({ title }: Props) {
    return (
        <View style={styles.wrap}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.note}>This screen has not been cloned yet.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 8 },
    note: { fontSize: 14, color: '#6b7280' },
});

export default PlaceholderScreen;
