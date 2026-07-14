// Web pages/Approvals.tsx birebir (masaüstü ucApproveWork klonu).
// Mevcut API: /api/approvals/{pending,processed,approve,reject,approve-all,
// reject-all,reapprove,DELETE}
//
// Birebir korunanlar:
// - Pending tablosu (Date/User/Project/Phase/Work/Detail/Start/End/Hours/
//   Rev/OW + Approve/Reject) ve ↻ yenile
// - Approve All / Reject All (onay metinleri birebir:
//   "Approve all pending work affords?" / "All work afford(s) will be
//   rejected. Are you sure?")
// - Reject nedeni sorulur: 'Reject reason for "<work>" (<user>):'
// - Approved / Rejected History: Start/End tarih aralığı + Last Week/Month/Year
//   kısayolları; Rejected satırında ↺ re-approve ("Selected Work Afford will
//   be re-approved. Do you confirm?"), ✕ sil ("Selected Work Afford will be
//   deleted, Do you confirm?"); Approved yeşil / Rejected kırmızı rozet
// Mobil uyarlama: tablolar yatay kaydırmalı; prompt/confirm yerine
// Alert.alert + metin girişli modal; tarih seçimi takvim modalıyla.

import { useEffect, useState } from 'react';
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
import type { ApprovalRow } from '../types';

function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmt(s: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB');
}

function confirmAsync(message: string, title = '!'): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}

function ApprovalsScreen() {
    const [pending, setPending] = useState<ApprovalRow[]>([]);
    const [processed, setProcessed] = useState<ApprovalRow[]>([]);
    const [start, setStart] = useState<string>(() => iso(new Date(Date.now() - 7 * 864e5)));
    const [end, setEnd] = useState<string>(() => iso(new Date()));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reject nedeni modalı (web window.prompt karşılığı)
    const [rejectTarget, setRejectTarget] = useState<ApprovalRow | null>(null);
    const [rejectReason, setRejectReason] = useState('');

    // Tarih seçici modalı: 'start' | 'end' | null
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);

    function reloadPending() {
        apiGet<ApprovalRow[]>('/api/approvals/pending').then(setPending).catch((e) => setError(e.message));
    }
    function reloadProcessed() {
        apiGet<ApprovalRow[]>(`/api/approvals/processed?start=${start}&end=${end}`).then(setProcessed).catch((e) => setError(e.message));
    }

    useEffect(reloadPending, []);
    useEffect(reloadProcessed, [start, end]);

    function setRange(days: number) {
        setStart(iso(new Date(Date.now() - days * 864e5)));
        setEnd(iso(new Date()));
    }

    async function post(url: string, body?: unknown): Promise<string | null> {
        const res = await apiFetch(url, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? `Error ${res.status}`); return null; }
        return b?.message ?? '';
    }

    async function approve(row: ApprovalRow) {
        setBusy(true);
        await post(`/api/approvals/${row.id}/approve`);
        reloadPending(); reloadProcessed();
        setBusy(false);
    }

    // Reject: neden modalı açılır; onaylanınca gönderilir (web prompt birebir)
    function reject(row: ApprovalRow) {
        setRejectReason('');
        setRejectTarget(row);
    }
    async function submitReject() {
        const row = rejectTarget;
        if (!row) return;
        setRejectTarget(null);
        setBusy(true);
        await post(`/api/approvals/${row.id}/reject`, { rejectDetail: rejectReason });
        reloadPending(); reloadProcessed();
        setBusy(false);
    }

    async function approveAll() {
        if (!(await confirmAsync('Approve all pending work affords?'))) return;
        setBusy(true);
        const m = await post('/api/approvals/approve-all');
        if (m) Alert.alert('', m);
        reloadPending(); reloadProcessed();
        setBusy(false);
    }
    async function rejectAll() {
        if (!(await confirmAsync('All work afford(s) will be rejected. Are you sure?'))) return;
        setBusy(true);
        const m = await post('/api/approvals/reject-all');
        if (m) Alert.alert('', m);
        reloadPending(); reloadProcessed();
        setBusy(false);
    }
    async function del(row: ApprovalRow) {
        if (!(await confirmAsync('Selected Work Afford will be deleted, Do you confirm?'))) return;
        const res = await apiFetch(`/api/approvals/${row.id}`, { method: 'DELETE' });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        reloadProcessed();
    }
    async function reapprove(row: ApprovalRow) {
        if (!(await confirmAsync('Selected Work Afford will be re-approved. Do you confirm?'))) return;
        await post(`/api/approvals/${row.id}/reapprove`);
        reloadProcessed();
    }

    return (
        <ScrollView style={styles.appr} contentContainerStyle={styles.apprContent}>
            <Text style={styles.h1}>Pending Approvals</Text>
            {error && <Text style={styles.error}>{error}</Text>}

            {/* Pending */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <View style={styles.headLeft}>
                        <TouchableOpacity style={styles.btnRefresh} onPress={() => { reloadPending(); reloadProcessed(); }}>
                            <Text style={styles.btnRefreshText}>↻</Text>
                        </TouchableOpacity>
                        <Text style={styles.cardTitle}>Pending ({pending.length})</Text>
                    </View>
                    <View style={styles.headActions}>
                        <TouchableOpacity
                            style={[styles.btnReject, (busy || pending.length === 0) && styles.btnDim]}
                            disabled={busy || pending.length === 0} onPress={rejectAll}>
                            <Text style={styles.btnRejectText}>Reject All</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.btnApprove, (busy || pending.length === 0) && styles.btnDim]}
                            disabled={busy || pending.length === 0} onPress={approveAll}>
                            <Text style={styles.btnApproveText}>Approve All</Text>
                        </TouchableOpacity>
                    </View>
                </View>
                <View style={styles.cardBody}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                {PENDING_COLS.map((c, i) => (
                                    <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {pending.length === 0 ? (
                                <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                            ) : pending.map((r) => (
                                <View key={r.id} style={styles.gridRow}>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[0].width }]}>{fmt(r.date)}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[1].width }]} numberOfLines={1}>{r.user}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[2].width }]} numberOfLines={1}>{r.project}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[3].width }]} numberOfLines={1}>{r.folder}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[4].width }]} numberOfLines={1}>{r.work}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[5].width }]} numberOfLines={1}>{r.detail}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[6].width }]}>{fmt(r.startDate)}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[7].width }]}>{fmt(r.endDate)}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[8].width }]}>{r.hours}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[9].width }]}>{r.revision ? 'Yes' : 'No'}</Text>
                                    <Text style={[styles.gridCell, { width: PENDING_COLS[10].width }]}>{r.overwork ? 'Yes' : 'No'}</Text>
                                    <TouchableOpacity style={{ width: PENDING_COLS[11].width }} disabled={busy} onPress={() => approve(r)}>
                                        <Text style={styles.rowApprove}>Approve</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity style={{ width: PENDING_COLS[12].width }} disabled={busy} onPress={() => reject(r)}>
                                        <Text style={styles.rowReject}>Reject</Text>
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    </ScrollView>
                </View>
            </View>

            {/* Processed */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Approved / Rejected History</Text>
                </View>
                <View style={styles.dateRow}>
                    <Text style={styles.lbl}>Start :</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('start')}>
                        <Text style={styles.dateBtnText}>{start}</Text>
                    </TouchableOpacity>
                    <Text style={styles.lbl}>End :</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('end')}>
                        <Text style={styles.dateBtnText}>{end}</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.rangeRow}>
                    <TouchableOpacity style={styles.rangeBtn} onPress={() => setRange(7)}><Text style={styles.rangeBtnText}>Last Week</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.rangeBtn} onPress={() => setRange(30)}><Text style={styles.rangeBtnText}>Last Month</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.rangeBtn} onPress={() => setRange(365)}><Text style={styles.rangeBtnText}>Last Year</Text></TouchableOpacity>
                </View>
                <View style={styles.cardBody}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                {PROCESSED_COLS.map((c, i) => (
                                    <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {processed.length === 0 ? (
                                <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                            ) : processed.map((r) => (
                                <View key={r.id} style={styles.gridRow}>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[0].width }]}>{fmt(r.date)}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[1].width }]} numberOfLines={1}>{r.user}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[2].width }]} numberOfLines={1}>{r.project}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[3].width }]} numberOfLines={1}>{r.folder}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[4].width }]} numberOfLines={1}>{r.work}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[5].width }]} numberOfLines={1}>{r.detail}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[6].width }]}>{r.hours}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[7].width }]}>{r.revision ? 'Yes' : 'No'}</Text>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[8].width }]}>{r.overwork ? 'Yes' : 'No'}</Text>
                                    <View style={{ width: PROCESSED_COLS[9].width }}>
                                        <Text style={[styles.badge, r.status === 'Approved' ? styles.badgeDone : styles.badgeRej]}>
                                            {r.status}
                                        </Text>
                                    </View>
                                    <Text style={[styles.gridCell, { width: PROCESSED_COLS[10].width }]} numberOfLines={1}>{r.rejectDetail}</Text>
                                    <View style={[styles.rowActs, { width: PROCESSED_COLS[11].width }]}>
                                        {r.status === 'Rejected' && (
                                            <TouchableOpacity onPress={() => reapprove(r)}>
                                                <Text style={styles.rowReapprove}>↺</Text>
                                            </TouchableOpacity>
                                        )}
                                        <TouchableOpacity onPress={() => del(r)}>
                                            <Text style={styles.rowDel}>✕</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </ScrollView>
                </View>
            </View>

            {/* Reject nedeni modalı — web window.prompt birebir metin */}
            <Modal visible={rejectTarget != null} transparent animationType="fade"
                onRequestClose={() => setRejectTarget(null)}>
                <View style={styles.modalOverlay}>
                    <View style={styles.modalBox}>
                        <Text style={styles.modalTitle}>
                            {rejectTarget ? `Reject reason for "${rejectTarget.work}" (${rejectTarget.user}):` : ''}
                        </Text>
                        <TextInput style={styles.modalInput} value={rejectReason}
                            onChangeText={setRejectReason} autoFocus multiline />
                        <View style={styles.modalBtns}>
                            <TouchableOpacity style={styles.modalCancel} onPress={() => setRejectTarget(null)}>
                                <Text style={styles.modalCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.modalOk} onPress={submitReject}>
                                <Text style={styles.modalOkText}>OK</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Tarih seçici modalı */}
            <Modal visible={datePick != null} transparent animationType="fade"
                onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker
                            initial={datePick === 'start' ? start : end}
                            onPick={(d) => {
                                if (datePick === 'start') setStart(d); else setEnd(d);
                                setDatePick(null);
                            }}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>
        </ScrollView>
    );
}

// Kolonlar web tablo başlıkları birebir
const PENDING_COLS = [
    { label: 'Date', width: 78 }, { label: 'User', width: 90 }, { label: 'Project', width: 100 },
    { label: 'Phase', width: 90 }, { label: 'Work', width: 130 }, { label: 'Detail', width: 120 },
    { label: 'Start', width: 78 }, { label: 'End', width: 78 }, { label: 'Hours', width: 48 },
    { label: 'Rev', width: 40 }, { label: 'OW', width: 40 }, { label: '', width: 64 }, { label: '', width: 56 },
];
const PROCESSED_COLS = [
    { label: 'Date', width: 78 }, { label: 'User', width: 90 }, { label: 'Project', width: 100 },
    { label: 'Phase', width: 90 }, { label: 'Work', width: 130 }, { label: 'Detail', width: 120 },
    { label: 'Hours', width: 48 }, { label: 'Rev', width: 40 }, { label: 'OW', width: 40 },
    { label: 'Status', width: 78 }, { label: 'Reject Details', width: 130 }, { label: '', width: 56 },
];

// ── Ay takvimi tarih seçici (Work Entry MiniCalendar ile aynı düzen) ──
function CalendarPicker({ initial, onPick }: { initial: string; onPick: (isoDate: string) => void }) {
    const init = new Date(initial + 'T00:00:00');
    const [month, setMonth] = useState<Date>(() =>
        isNaN(init.getTime()) ? new Date() : new Date(init.getFullYear(), init.getMonth(), 1));

    const y = month.getFullYear(), m = month.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));

    return (
        <View>
            <View style={styles.calHead}>
                <TouchableOpacity style={styles.calNav} onPress={() => setMonth(new Date(y, m - 1, 1))}>
                    <Text style={styles.calNavText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.calTitle}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
                <TouchableOpacity style={styles.calNav} onPress={() => setMonth(new Date(y, m + 1, 1))}>
                    <Text style={styles.calNavText}>›</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.calGrid}>
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                    <View key={d} style={styles.calCell}><Text style={styles.calDow}>{d}</Text></View>
                ))}
                {cells.map((d, i) => {
                    if (!d) return <View key={i} style={styles.calCell} />;
                    const isSel = iso(d) === initial;
                    return (
                        <View key={i} style={styles.calCell}>
                            <TouchableOpacity style={[styles.calDay, isSel && styles.calDaySel]} onPress={() => onPick(iso(d))}>
                                <Text style={[styles.calDayText, isSel && styles.calDaySelText]}>{d.getDate()}</Text>
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// Renkler web App.css birebir (badge done #d1fae5/#037f4c, rej #ffe4e6/#e2445c;
// approve yeşil, reject kırmızı buton aileleri)
const styles = StyleSheet.create({
    appr: { flex: 1, backgroundColor: '#f0f2f7' },
    apprContent: { padding: 8, paddingBottom: 24 },
    h1: { fontSize: 20, fontWeight: '700', color: '#111827', paddingHorizontal: 8, paddingVertical: 8 },
    error: { color: '#b91c1c', paddingHorizontal: 8, marginBottom: 6 },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, marginBottom: 10 },
    cardHead: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0', gap: 6,
    },
    headLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headActions: { flexDirection: 'row', gap: 8 },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    cardBody: { padding: 8 },

    btnRefresh: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb' },
    btnRefreshText: { fontSize: 14, color: '#374151' },
    btnApprove: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnApproveText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnReject: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnRejectText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnDim: { opacity: 0.45 },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f0f2f7', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#2d3748', paddingVertical: 5, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    gridCell: { fontSize: 11, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 6 },
    rowApprove: { color: '#037f4c', fontSize: 11, fontWeight: '700', textAlign: 'center' },
    rowReject: { color: '#e2445c', fontSize: 11, fontWeight: '700', textAlign: 'center' },
    rowActs: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
    rowReapprove: { color: '#0073ea', fontSize: 14, fontWeight: '700' },
    rowDel: { color: '#e2445c', fontSize: 13, fontWeight: '700' },

    badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, textAlign: 'center', overflow: 'hidden' },
    badgeDone: { backgroundColor: '#d1fae5', color: '#037f4c' },
    badgeRej: { backgroundColor: '#ffe4e6', color: '#e2445c' },

    dateRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 8, gap: 6, flexWrap: 'wrap' },
    lbl: { fontSize: 12, color: '#374151' },
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
    dateBtnText: { fontSize: 12, color: '#111827' },
    rangeRow: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 6, paddingBottom: 2, gap: 8 },
    rangeBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 5 },
    rangeBtnText: { fontSize: 11, color: '#374151' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 16, width: '100%' },
    modalTitle: { fontSize: 13, fontWeight: '600', color: '#111827', marginBottom: 10 },
    modalInput: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: '#111827',
        minHeight: 60, textAlignVertical: 'top',
    },
    modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12, gap: 10 },
    modalCancel: { paddingHorizontal: 14, paddingVertical: 8 },
    modalCancelText: { color: '#6b7280', fontSize: 13, fontWeight: '600' },
    modalOk: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8 },
    modalOkText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    calNav: { paddingHorizontal: 12, paddingVertical: 4 },
    calNavText: { fontSize: 18, color: '#374151' },
    calTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
    calDow: { fontSize: 10, fontWeight: '700', color: '#6b7280', paddingVertical: 2 },
    calDay: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    calDaySel: { backgroundColor: '#2563eb' },
    calDayText: { fontSize: 12, color: '#374151' },
    calDaySelText: { color: '#fff', fontWeight: '700' },
});

export default ApprovalsScreen;
