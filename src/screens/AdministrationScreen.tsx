// Web pages/Administration.tsx birebir (masaüstü ucLibraryManagement klonu).
// Başlık "Library Management", 2 sekme:
//  • Phases (ucFolderManagement): faz (Folder) listesi; ekle, sil (iş öğesi içeren
//    silinemez), uzun basış → Update (FormUpdateFolder — ad değişince o faza bağlı
//    tüm Work adları da güncellenir, sunucu tarafında birebir).
//  • Resources (ucResourceManagement): kaynak listesi; ekle, sil, uzun basış → Update.
// Mevcut API: /api/administration/* (YENİ API YAZILMAZ). Tüm mesaj metinleri birebir.
// Masaüstünde sekme her geçişte yeniden oluşturulur → mobilde de key ile remount.
//
// Mobil uyarlama (mevcut ekranlarla tutarlı): sağ tık → uzun basış (Update);
// alert/confirm → Alert.alert; sekme kabı Inventory/QA ile aynı; sekme zemini
// temaya duyarlı, başlık navy.

import { useCallback, useEffect, useState } from 'react';
import {
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { apiGet, apiFetch } from '../api';
import { useThemeDark } from '../theme';
import type { IdName } from '../types';

interface OpResult { success: boolean; message?: string }

function confirmAsync(message: string, title = ''): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}

const TABS = ['Phases', 'Resources'] as const;
type Tab = typeof TABS[number];

function AdministrationScreen() {
    const dark = useThemeDark();
    const [tab, setTab] = useState<Tab>('Phases');

    return (
        <View style={[styles.adm, { backgroundColor: dark ? '#f0f2f7' : '#f7f8fc' }]}>
            {/* pnlHeader */}
            <View style={styles.header}><Text style={styles.headerText}>Library Management</Text></View>

            {/* tabControl */}
            <View style={styles.tabs}>
                {TABS.map((t) => (
                    <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
                        <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            {tab === 'Phases' ? (
                <LibraryTab key="phases"
                    title="Phases"
                    addLabel="Phase Name"
                    addButton="Add Phase"
                    columnHeader="Phase Name"
                    endpoint="folders"
                    emptyAddMessage="Please enter a folder name."
                    saveFailMessage="Folder could not be saved."
                    selectMessage="Please select a folder."
                    confirmMessage="Are you sure you want to delete this folder?"
                    updateTitle="Update Folder"
                    updatedMessage="folder updated!" />
            ) : (
                <LibraryTab key="resources"
                    title="Resources"
                    addLabel="Resource Name"
                    addButton="Add Resource"
                    columnHeader="Resource Name"
                    endpoint="resources"
                    emptyAddMessage="Please enter a Resource name."
                    saveFailMessage="Resource could not be saved."
                    selectMessage="Please select a Resource."
                    confirmMessage="Are you sure you want to delete this Resource?"
                    updateTitle="Update Resource"
                    updatedMessage="resource updated!" />
            )}
        </View>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  ORTAK SEKME (ucFolderManagement / ucResourceManagement birebir)
// ═════════════════════════════════════════════════════════════════════════════
interface LibraryTabProps {
    title: string;
    addLabel: string;
    addButton: string;
    columnHeader: string;
    endpoint: 'folders' | 'resources';
    emptyAddMessage: string;
    saveFailMessage: string;
    selectMessage: string;
    confirmMessage: string;
    updateTitle: string;
    updatedMessage: string;
}

function LibraryTab(p: LibraryTabProps) {
    const [rows, setRows] = useState<IdName[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);   // MultiSelect=false
    const [newName, setNewName] = useState('');
    const [updating, setUpdating] = useState<{ id: number; name: string } | null>(null);

    // LoadListView birebir
    const reload = useCallback(() => {
        apiGet<IdName[]>(`/api/administration/${p.endpoint}`).then((r) => {
            setRows(r);
            setSelectedId(null);
        }).catch(() => setRows([]));
    }, [p.endpoint]);

    useEffect(reload, [reload]);

    // btnAdd_Click birebir
    async function add() {
        const name = newName.trim();
        if (!name) { Alert.alert('', p.emptyAddMessage); return; }

        const res = await apiFetch(`/api/administration/${p.endpoint}`, {
            method: 'POST', body: JSON.stringify({ name }),
        });
        const b = res.ok ? await res.json() as OpResult : { success: false };

        if (b.success) {
            setNewName('');
            reload();
        } else {
            Alert.alert('', p.saveFailMessage);
        }
    }

    // btnDeleteSelectedUsers_Click birebir
    async function deleteSelected() {
        if (selectedId == null) { Alert.alert('', p.selectMessage); return; }
        if (!(await confirmAsync(p.confirmMessage))) return;

        const res = await apiFetch(`/api/administration/${p.endpoint}/delete`, {
            method: 'POST', body: JSON.stringify({ id: selectedId }),
        });
        const b = res.ok ? await res.json() as OpResult : { success: false, message: '' };

        if (b.success) reload();
        else Alert.alert('', b.message ?? '');
    }

    // folderUpdate_Click (uzun basış → Update) birebir
    function openUpdate(id: number) {
        const row = rows.find((r) => r.id === id);
        setSelectedId(id);
        setUpdating({ id, name: row?.name ?? '' });
    }

    // FormUpdateFolder/FormUpdateResource.btnUpdate_Click birebir
    async function saveUpdate() {
        if (!updating) return;
        if (!updating.name.trim()) { Alert.alert('', 'Please Enter Name'); return; }

        await apiFetch(`/api/administration/${p.endpoint}/update`, {
            method: 'POST', body: JSON.stringify({ id: updating.id, name: updating.name }),
        });
        Alert.alert('', p.updatedMessage);
        setUpdating(null);
        reload();
    }

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.card}>
                {/* pnlToolbar */}
                <Text style={styles.cardTitle}>{p.title}</Text>

                {/* pnlAddRow */}
                <Text style={styles.fieldLbl}>{p.addLabel}</Text>
                <View style={styles.addRow}>
                    <TextInput style={styles.input} value={newName} onChangeText={setNewName}
                        onSubmitEditing={add} returnKeyType="done" />
                    <TouchableOpacity style={styles.btnAdd} onPress={add}><Text style={styles.btnText}>{p.addButton}</Text></TouchableOpacity>
                </View>

                {/* lvFolders / lvResources (tek seçim, uzun basış → Update) */}
                <Text style={styles.colHead}>{p.columnHeader}</Text>
                <View style={styles.list}>
                    {rows.length === 0 && <Text style={styles.none}>(none)</Text>}
                    {rows.map((r) => (
                        <TouchableOpacity key={r.id} style={[styles.listItem, selectedId === r.id && styles.rowSel]}
                            onPress={() => setSelectedId(r.id)} onLongPress={() => openUpdate(r.id)}>
                            <Text style={styles.listItemText}>{r.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>

                {/* pnlFooter */}
                <View style={styles.footer}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                </View>
            </View>

            {/* FormUpdateFolder / FormUpdateResource modalı
                (etiket masaüstünde iki formda da "Folder : " — birebir korunur) */}
            {updating && (
                <Modal visible transparent animationType="fade" onRequestClose={() => setUpdating(null)}>
                    <View style={styles.modalOverlay}>
                        <View style={styles.modalBox}>
                            <View style={styles.modalHeadRow}>
                                <Text style={styles.modalHead}>{p.updateTitle}</Text>
                                <TouchableOpacity onPress={() => setUpdating(null)}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                            </View>
                            <View style={styles.modalBody}>
                                <Text style={styles.modalLbl}>Folder :</Text>
                                <TextInput style={[styles.input, { flex: 1 }]} value={updating.name} autoFocus
                                    onChangeText={(t) => setUpdating({ ...updating, name: t })}
                                    onSubmitEditing={saveUpdate} returnKeyType="done" />
                            </View>
                            <View style={styles.modalActions}>
                                <TouchableOpacity style={styles.btnUpdate} onPress={saveUpdate}><Text style={styles.btnText}>Update</Text></TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </Modal>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    adm: { flex: 1 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
    tabs: { flexDirection: 'row', backgroundColor: '#1e2433', borderTopWidth: 1, borderTopColor: '#2d374b' },
    tab: { paddingVertical: 11, paddingHorizontal: 20, borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: '#4c8bf5', backgroundColor: '#2d374b' },
    tabText: { color: '#b9c3d7', fontSize: 12, fontWeight: '600' },
    tabTextActive: { color: '#fff' },

    body: { flex: 1 },
    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 4, margin: 8, padding: 12 },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#1f3a6e', marginBottom: 8 },
    fieldLbl: { fontSize: 11, fontWeight: '700', color: '#8a90a2', letterSpacing: 0.3, marginBottom: 4 },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
        flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: '#111827',
    },
    colHead: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', marginTop: 14, marginBottom: 4 },
    list: { borderWidth: 1, borderColor: '#e8ebf2', borderRadius: 6, overflow: 'hidden' },
    listItem: { paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    listItemText: { fontSize: 13, color: '#323338' },
    rowSel: { backgroundColor: '#eef2ff' },
    none: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 10 },
    footer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },

    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnAdd: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnDelete: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnUpdate: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 9 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 12 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    modalHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827' },
    modalClose: { fontSize: 16, color: '#6b7280', padding: 4 },
    modalBody: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    modalLbl: { fontSize: 13, color: '#374151' },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
});

export default AdministrationScreen;
