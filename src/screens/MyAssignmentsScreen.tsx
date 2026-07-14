// Web pages/MyAssignments.tsx birebir (masaüstü ucAssignment klonu).
// Mevcut API: /api/myassignments{,?scope,workdetail,complete,approve,messages}
//
// Birebir korunanlar:
// - Works / Controls sekmeleri (sayaçlar: Works = In Progress|Pending, Controls = tümü)
// - Works sekmesinde See Others / See My Works; Set Completed yalnız kendi işlerinde
// - Controls sekmesinde Set Approved (durum kontrolleri + mesajları birebir:
//   "This assignment has already been marked as controller approved." /
//   "This assignment is not complete yet! Please approve it after it is completed.")
// - Seçim zorunlu işlemler: tek satır varsa otomatik seçilir, yoksa
//   "PLEASE SELECT AN ASSIGNMENT!" (masaüstü getSelection birebir)
// - Set Completed/Approved öncesi Work Details modalı açılır, Continue ile
//   tamamlanır (masaüstü akışı birebir)
// - Messaging: Responsible/Controller ownerStatus, mesaj listesi + gönderim,
//   ✉ yeni mesaj işareti, "Has Detail" kolonu
// - Priority kolonu config'e göre gizlenir (PriorityIsVisibleForAssignments)
// - Durum ve deadline rozet renkleri web birebir; deadline yoksa "Not Set",
//   geçmişse kırmızı (Closed hariç)
// Mobil uyarlama: tablo yatay kaydırmalı; alert yerine Alert.alert.

import { useEffect, useMemo, useState } from 'react';
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
import type { UserInfo } from '../auth';
import type { MessageDto, MyAssignmentRow, MyAssignmentsDto, WorkDetailDto } from '../types';

const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
    'Demand': { bg: '#fff4d6', fg: '#926000' },
    'Pending': { bg: '#e8ebf2', fg: '#4b5563' },
    'In Progress': { bg: '#dbeafe', fg: '#1d4ed8' },
    'Employee Completed': { bg: '#dceaff', fg: '#1f3a6e' },
    'Controller Approved': { bg: '#d1fae5', fg: '#037f4c' },
    'Closed': { bg: '#e5e7eb', fg: '#6b7280' },
};

function fmtDeadline(s: string | null): string {
    if (!s) return 'Not Set';
    const d = new Date(s);
    return isNaN(d.getTime()) ? 'Not Set' : d.toLocaleDateString('en-GB');
}
function isOverdue(s: string | null, status: string | null): boolean {
    if (!s) return false;
    const d = new Date(s);
    return !isNaN(d.getTime()) && d < new Date() && status !== 'Closed';
}

type Tab = 'works' | 'controls';

interface Props {
    user: UserInfo;
}

function MyAssignmentsScreen({ user }: Props) {
    // MOBİL EK KURALI (masaüstü/webde yok — istek üzerine): Status == "Engineer"
    // olan kullanıcı See Others / See My Works geçişini göremez ve
    // Set Completed yapamaz.
    const isEngineer = user.status === 'Engineer';
    const [data, setData] = useState<MyAssignmentsDto | null>(null);
    const [tab, setTab] = useState<Tab>('works');
    const [othersMode, setOthersMode] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Modals
    const [detailModal, setDetailModal] = useState<{ row: MyAssignmentRow; detail: WorkDetailDto; onContinue?: () => void } | null>(null);
    const [msgModal, setMsgModal] = useState<{ row: MyAssignmentRow; ownerStatus: string; messages: MessageDto[] } | null>(null);
    const [msgText, setMsgText] = useState('');

    function reload() {
        apiGet<MyAssignmentsDto>(`/api/myassignments?scope=${othersMode ? 'others' : 'mine'}`)
            .then(setData).catch((e) => setError(e.message));
    }
    useEffect(reload, [othersMode]);

    const rows = useMemo(() => (!data ? [] : tab === 'works' ? data.works : data.controls), [data, tab]);
    const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

    // Masaüstü ucAssignment_Load: PriorityIsVisibleForAssignments kapalıysa Priority kolonu kaldırılır
    const prioVisible = data?.priorityIsVisible ?? true;

    const counts = {
        works: data?.works.filter((w) => w.status === 'In Progress' || w.status === 'Pending').length ?? 0,
        controls: data?.controls.length ?? 0,
    };

    // Bir satır seçili değilse ve tek satır varsa onu seç; değilse uyar (masaüstü getSelection)
    function requireSelection(): MyAssignmentRow | null {
        if (selected) return selected;
        if (rows.length === 1) { setSelectedId(rows[0].id); return rows[0]; }
        Alert.alert('', 'PLEASE SELECT AN ASSIGNMENT!');
        return null;
    }

    async function openDetails(row: MyAssignmentRow, onContinue?: () => void) {
        if (row.workId == null) { Alert.alert('', 'No work detail.'); return; }
        const detail = await apiGet<WorkDetailDto>(`/api/myassignments/workdetail?workId=${row.workId}`);
        setDetailModal({ row, detail, onContinue });
    }

    function showWorkDetails() {
        const row = requireSelection();
        if (row) openDetails(row);
    }

    function setCompleted() {
        const row = requireSelection();
        if (!row) return;
        // Masaüstü: önce Work Details formu açılır, Continue'da tamamlanır
        openDetails(row, async () => {
            const res = await apiFetch(`/api/myassignments/${row.id}/complete`, { method: 'POST' });
            if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? 'Error'); return; }
            setDetailModal(null); reload();
        });
    }

    function setApproved() {
        const row = requireSelection();
        if (!row) return;
        if (row.status === 'Controller Approved') { Alert.alert('', 'This assignment has already been marked as controller approved.'); return; }
        if (row.status !== 'Employee Completed') { Alert.alert('', 'This assignment is not complete yet! Please approve it after it is completed.'); return; }
        openDetails(row, async () => {
            const res = await apiFetch(`/api/myassignments/${row.id}/approve`, { method: 'POST' });
            if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? 'Error'); return; }
            setDetailModal(null); reload();
        });
    }

    async function openMessaging() {
        const row = requireSelection();
        if (!row) return;
        const ownerStatus = tab === 'works' ? 'Responsible' : 'Controller';
        const messages = await apiGet<MessageDto[]>(`/api/myassignments/${row.id}/messages`);
        setMsgText('');
        setMsgModal({ row, ownerStatus, messages });
    }

    async function sendMessage() {
        if (!msgModal || !msgText.trim()) return;
        const res = await apiFetch(`/api/myassignments/${msgModal.row.id}/messages`, {
            method: 'POST', body: JSON.stringify({ text: msgText, ownerStatus: msgModal.ownerStatus }),
        });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? 'Error'); return; }
        const messages = await apiGet<MessageDto[]>(`/api/myassignments/${msgModal.row.id}/messages`);
        setMsgModal({ ...msgModal, messages });
        setMsgText('');
        reload();
    }

    const cols = prioVisible ? COLS : COLS.filter((c) => c.key !== 'priority');

    return (
        <ScrollView style={styles.wrap} contentContainerStyle={styles.wrapContent}>
            <Text style={styles.h1}>My Assignments</Text>
            {error && <Text style={styles.error}>{error}</Text>}

            {/* Sekmeler */}
            <View style={styles.tabbar}>
                <TouchableOpacity style={[styles.tab, tab === 'works' && styles.tabActive]}
                    onPress={() => { setTab('works'); setSelectedId(null); }}>
                    <Text style={[styles.tabText, tab === 'works' && styles.tabTextActive]}>Works ({counts.works})</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.tab, tab === 'controls' && styles.tabActive]}
                    onPress={() => { setTab('controls'); setSelectedId(null); }}>
                    <Text style={[styles.tabText, tab === 'controls' && styles.tabTextActive]}>Controls ({counts.controls})</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>{tab === 'works' ? 'Work Assignments' : 'Control Assignments'}</Text>
                </View>

                {/* Araç düğmeleri (web myasg-tools birebir) */}
                <View style={styles.tools}>
                    {tab === 'works' && !isEngineer && (
                        <>
                            <TouchableOpacity style={[styles.chip, othersMode && styles.chipOn]} onPress={() => setOthersMode(true)}>
                                <Text style={[styles.chipText, othersMode && styles.chipTextOn]}>See Others</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.chip, !othersMode && styles.chipOn]} onPress={() => setOthersMode(false)}>
                                <Text style={[styles.chipText, !othersMode && styles.chipTextOn]}>See My Works</Text>
                            </TouchableOpacity>
                        </>
                    )}
                    <TouchableOpacity style={styles.btnLight} onPress={showWorkDetails}>
                        <Text style={styles.btnLightText}>Show Work Details</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnLight} onPress={openMessaging}>
                        <Text style={styles.btnLightText}>Messaging</Text>
                    </TouchableOpacity>
                    {tab === 'works' && !othersMode && !isEngineer && (
                        <TouchableOpacity style={styles.btnApprove} onPress={setCompleted}>
                            <Text style={styles.btnApproveText}>Set Completed</Text>
                        </TouchableOpacity>
                    )}
                    {tab === 'controls' && (
                        <TouchableOpacity style={styles.btnApprove} onPress={setApproved}>
                            <Text style={styles.btnApproveText}>Set Approved</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <View style={styles.cardBody}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                {cols.map((c) => (
                                    <Text key={c.key} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {rows.length === 0 ? (
                                <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                            ) : rows.map((r) => {
                                const sc = STATUS_COLORS[r.status ?? ''] ?? { bg: '#eee', fg: '#333' };
                                const overdue = isOverdue(r.deadline, r.status);
                                return (
                                    <TouchableOpacity key={r.id}
                                        style={[styles.gridRow, selectedId === r.id && styles.rowSelected]}
                                        onPress={() => setSelectedId(r.id)}>
                                        <Text style={[styles.gridCell, { width: COLS[0].width }]} numberOfLines={1}>{r.project}</Text>
                                        <Text style={[styles.gridCell, { width: COLS[1].width }]} numberOfLines={1}>{r.workName}</Text>
                                        <Text style={[styles.gridCell, { width: COLS[2].width }]} numberOfLines={1}>{r.assignedBy}</Text>
                                        <Text style={[styles.gridCell, { width: COLS[3].width }]} numberOfLines={1}>{r.assignedTo}</Text>
                                        {prioVisible && (
                                            <Text style={[styles.gridCell, { width: COLS[4].width, textAlign: 'center' }]}>{r.priority}</Text>
                                        )}
                                        <View style={{ width: COLS[5].width }}>
                                            <Text style={[styles.badge, overdue
                                                ? { backgroundColor: '#ffe4e6', color: '#e2445c' }
                                                : { backgroundColor: '#d1fae5', color: '#037f4c' }]}>
                                                {fmtDeadline(r.deadline)}
                                            </Text>
                                        </View>
                                        <View style={{ width: COLS[6].width }}>
                                            <Text style={[styles.badge, { backgroundColor: sc.bg, color: sc.fg }]} numberOfLines={1}>
                                                {r.status}
                                            </Text>
                                        </View>
                                        <Text style={[styles.gridCell, { width: COLS[7].width, textAlign: 'center' }]}>{r.hasNewMessage ? '✉' : ''}</Text>
                                        <Text style={[styles.gridCell, { width: COLS[8].width }]}>{r.hasDetail ? 'Has Detail' : ''}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
            </View>

            {/* Work Details modal */}
            <Modal visible={detailModal != null} transparent animationType="fade"
                onRequestClose={() => setDetailModal(null)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalBox}>
                        <Text style={styles.modalHead}>Work Details — {detailModal?.row.workName}</Text>
                        <ScrollView style={styles.modalBody}>
                            <Text style={styles.wdRow}><Text style={styles.wdLbl}>Project:</Text> {detailModal?.row.project}</Text>
                            <Text style={styles.wdRow}><Text style={styles.wdLbl}>Work:</Text> {detailModal?.row.workName}</Text>
                            <Text style={styles.wdRow}><Text style={styles.wdLbl}>Email:</Text> {detailModal?.detail.email || '—'}</Text>
                            <Text style={styles.wdRow}><Text style={styles.wdLbl}>Description:</Text></Text>
                            <Text style={styles.wdDesc}>{detailModal?.detail.description || '(no description)'}</Text>
                        </ScrollView>
                        <View style={styles.modalActions}>
                            {detailModal?.onContinue && (
                                <TouchableOpacity style={styles.btnApprove} onPress={detailModal.onContinue}>
                                    <Text style={styles.btnApproveText}>Continue</Text>
                                </TouchableOpacity>
                            )}
                            <TouchableOpacity style={styles.btnLight} onPress={() => setDetailModal(null)}>
                                <Text style={styles.btnLightText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Messaging modal */}
            <Modal visible={msgModal != null} transparent animationType="fade"
                onRequestClose={() => setMsgModal(null)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalBox}>
                        <Text style={styles.modalHead}>Messaging — {msgModal?.row.workName}</Text>
                        <ScrollView style={[styles.modalBody, styles.msgList]}>
                            {(msgModal?.messages.length ?? 0) === 0 ? (
                                <Text style={styles.muted}>No messages yet.</Text>
                            ) : msgModal!.messages.map((m, i) => (
                                <View key={i} style={[styles.msg, m.mine ? styles.msgMine : styles.msgOther]}>
                                    <Text style={styles.msgMeta}>
                                        {m.ownerName} · {m.ownerStatus} · {new Date(m.date).toLocaleString('en-GB')}
                                    </Text>
                                    <Text style={styles.msgText}>{m.text}</Text>
                                </View>
                            ))}
                        </ScrollView>
                        <TextInput style={styles.msgInput} value={msgText} placeholder="Type a message…"
                            placeholderTextColor="#9ca3af"
                            onChangeText={setMsgText} onSubmitEditing={sendMessage} />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.btnPrimary} onPress={sendMessage}>
                                <Text style={styles.btnPrimaryText}>Send</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnLight} onPress={() => setMsgModal(null)}>
                                <Text style={styles.btnLightText}>Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}

// Kolonlar web tablo başlıkları birebir
const COLS = [
    { key: 'project', label: 'Project', width: 110 },
    { key: 'work', label: 'Work', width: 140 },
    { key: 'assignedBy', label: 'Assigned By', width: 100 },
    { key: 'assignedTo', label: 'Assigned To', width: 100 },
    { key: 'priority', label: 'Priority', width: 56 },
    { key: 'deadline', label: 'Deadline', width: 90 },
    { key: 'status', label: 'Status', width: 130 },
    { key: 'msg', label: '', width: 28 },
    { key: 'detail', label: 'Detail', width: 80 },
];

// Renkler web App.css birebir (badge/deadline/status renk aileleri)
const styles = StyleSheet.create({
    wrap: { flex: 1, backgroundColor: '#f0f2f7' },
    wrapContent: { padding: 8, paddingBottom: 24 },
    h1: { fontSize: 20, fontWeight: '700', color: '#111827', paddingHorizontal: 8, paddingVertical: 8 },
    error: { color: '#b91c1c', paddingHorizontal: 8, marginBottom: 6 },

    tabbar: { flexDirection: 'row', marginHorizontal: 8, marginBottom: 8, gap: 6 },
    tab: {
        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
        backgroundColor: '#e8ebf2',
    },
    tabActive: { backgroundColor: '#2563eb' },
    tabText: { fontSize: 12, fontWeight: '700', color: '#4b5563' },
    tabTextActive: { color: '#fff' },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, marginBottom: 10 },
    cardHead: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    cardBody: { padding: 8 },

    tools: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: '#fff' },
    chipOn: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
    chipText: { fontSize: 11, color: '#4b5563', fontWeight: '600' },
    chipTextOn: { color: '#1d4ed8' },
    btnLight: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#f9fafb' },
    btnLightText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    btnApprove: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnApproveText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    btnPrimary: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
    btnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f0f2f7', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#2d3748', paddingVertical: 5, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    rowSelected: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 11, color: '#374151', paddingVertical: 8, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 6 },
    badge: {
        fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2,
        borderRadius: 8, textAlign: 'center', overflow: 'hidden', marginHorizontal: 2,
    },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 20 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%', maxHeight: '85%' },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 10 },
    modalBody: { marginBottom: 10 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 8 },

    wdRow: { fontSize: 13, color: '#374151', marginBottom: 6 },
    wdLbl: { fontWeight: '700', color: '#111827' },
    wdDesc: {
        fontSize: 13, color: '#374151', backgroundColor: '#f9fafb',
        borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 6, padding: 8,
    },

    msgList: { maxHeight: 320 },
    muted: { fontSize: 12, color: '#9ca3af' },
    msg: { borderRadius: 8, padding: 8, marginBottom: 6, maxWidth: '90%' },
    msgMine: { backgroundColor: '#dbeafe', alignSelf: 'flex-end' },
    msgOther: { backgroundColor: '#f0f2f7', alignSelf: 'flex-start' },
    msgMeta: { fontSize: 10, color: '#6b7280', marginBottom: 2 },
    msgText: { fontSize: 13, color: '#111827' },
    msgInput: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: '#111827',
    },
});

export default MyAssignmentsScreen;
