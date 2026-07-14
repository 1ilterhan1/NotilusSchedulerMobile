// Web pages/WorkEntry.tsx birebir (masaüstü ucWorkEntry klonu).
// Mevcut API: /api/workentry/{config,projects,works,affords,calendar,afford,active-users}
//
// Birebir korunanlar:
// - Project seçimi + Show Finished; proje değişince iş ağacı yenilenir
// - Available Works: klasör ağacı (aç/kapa), arama (ad + drawingNo),
//   Discipline/DrawingNo kolon görünürlüğü config'ten (masaüstü DefineTreeListView)
// - Log Work: takvim (bold = giriş var, alert = eksik gün), Duration h/min,
//   Overwork, Revision (config'e göre gizli → Checked=false), Work Detail,
//   Admin Entry for User (yalnız Administrator)
// - Mesajlar birebir: "Please select a work!", 409 overwork onayı (sunucu
//   mesajıyla), başarı özeti (Estimated/Actual Days + !!! OVERWORK !!! + Progress),
//   "Approved work affords can not be deleted!", "Selected entry will be
//   deleted, Do you confirm?"
// - Works done tablosu: Project/Phase/Work/Detail/Hours/Status + ✕ sil;
//   pending/approved/rejected satır renkleri web CSS birebir
// Mobil uyarlama: tek kolon dikey akış; select yerine modal liste;
// alert/confirm yerine Alert.alert.

import { useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
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
import type { WeAfford, WeCalendar, WeConfig, WeFolder, WeProject, WeWork } from '../types';

interface WeUser { id: number; name: string; }
interface SubmitResult { newTotalHours: number; estimatedHours: number; message: string | null; }

function iso(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hoursToDays(h: number, perDay = 9): string {
    return (h / perDay).toFixed(2);
}

// window.confirm karşılığı (Alert.alert Promise sarmalayıcı)
function confirmAsync(message: string, title = '!'): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}

interface Props {
    user: UserInfo;
}

function WorkEntryScreen({ user }: Props) {
    const [projects, setProjects] = useState<WeProject[]>([]);
    const [showFinished, setShowFinished] = useState(false);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [projectPickerOpen, setProjectPickerOpen] = useState(false);

    const [folders, setFolders] = useState<WeFolder[]>([]);
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selectedWork, setSelectedWork] = useState<WeWork | null>(null);

    const [selectedDate, setSelectedDate] = useState<Date>(new Date());
    const [affords, setAffords] = useState<WeAfford[]>([]);
    const [calendar, setCalendar] = useState<WeCalendar>({ boldDates: [], alertDates: [] });
    const [calMonth, setCalMonth] = useState<Date>(() => { const d = new Date(); d.setDate(1); return d; });

    const [error, setError] = useState<string | null>(null);

    // Entry form state
    const [hour, setHour] = useState(0);
    const [minute, setMinute] = useState(0);
    const [detail, setDetail] = useState('');
    const [overwork, setOverwork] = useState(false);
    const [revision, setRevision] = useState(false);
    const [adminEntry, setAdminEntry] = useState(false);
    const [adminUserId, setAdminUserId] = useState<number | null>(null);
    const [adminPickerOpen, setAdminPickerOpen] = useState(false);
    const [activeUsers, setActiveUsers] = useState<WeUser[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const isAdmin = user.status === 'Administrator';

    // Masaüstü setVisibilities + DefineTreeListView görünürlük kuralları
    const [config, setConfig] = useState<WeConfig | null>(null);
    useEffect(() => {
        apiGet<WeConfig>('/api/workentry/config').then(setConfig).catch(() => { /* varsayılanlar */ });
    }, []);
    const revisionVisible = config?.revisionIsVisibleForWorkEntry ?? true;
    const disciplineVisible = config?.disciplineIsVisibleForWorkEntry ?? true;
    const drawingNoVisible = config?.showDrawingNumberInWorklist ?? false;
    const hpd = config?.hoursPerDay ?? 9;

    // Masaüstü: cbRevision görünmezse Checked = false
    useEffect(() => {
        if (!revisionVisible) setRevision(false);
    }, [revisionVisible]);

    useEffect(() => {
        if (!isAdmin) return;
        apiGet<WeUser[]>('/api/workentry/active-users')
            .then((u) => { setActiveUsers(u); setAdminUserId(u[0]?.id ?? null); })
            .catch(() => { /* sessiz */ });
    }, [isAdmin]);

    function reloadAffords() {
        apiGet<WeAfford[]>(`/api/workentry/affords?date=${iso(selectedDate)}`).then(setAffords).catch((e) => setError(e.message));
    }
    function reloadCalendar() {
        apiGet<WeCalendar>(`/api/workentry/calendar?year=${calMonth.getFullYear()}&month=${calMonth.getMonth() + 1}`).then(setCalendar).catch(() => {});
    }
    function reloadWorks() {
        if (projectId == null) return;
        apiGet<WeFolder[]>(`/api/workentry/works?projectId=${projectId}`).then(setFolders).catch((e) => setError(e.message));
    }

    async function submit(confirmOverwork = false) {
        if (!selectedWork) { Alert.alert('', 'Please select a work!'); return; }
        const hours = hour + minute / 60;
        setSubmitting(true);
        try {
            const body = {
                projectId, workId: selectedWork.workId, hours, date: iso(selectedDate),
                overwork, revision, detail, confirmOverwork,
                adminUserId: adminEntry && isAdmin ? adminUserId : null,
            };
            const res = await apiFetch('/api/workentry/afford', { method: 'POST', body: JSON.stringify(body) });

            if (res.status === 409) {
                const b = await res.json();
                setSubmitting(false);
                if (await confirmAsync(b.message)) return submit(true);
                return;
            }
            if (!res.ok) {
                const b = await res.json().catch(() => null);
                Alert.alert('', b?.message ?? `Error ${res.status}`); setSubmitting(false); return;
            }

            const result = (await res.json()) as SubmitResult;
            if (result.message) {
                Alert.alert('', result.message);
            } else {
                const estDays = (result.estimatedHours / hpd).toFixed(2);
                const actDays = (result.newTotalHours / hpd).toFixed(2);
                const pct = result.estimatedHours > 0 ? (100 * result.newTotalHours / result.estimatedHours) : 0;
                let msg = `Work: ${selectedWork.name}\nEstimated (Days): ${estDays}\nActual (Days): ${actDays}\n`;
                if (pct > 100) msg += '!!! OVERWORK !!!\n';
                msg += `Progress: ${pct.toFixed(2)}%`;
                Alert.alert('', msg);
            }

            setDetail(''); setHour(0); setMinute(0); setOverwork(false); setRevision(false);
            reloadAffords(); reloadCalendar(); reloadWorks();
        } finally {
            setSubmitting(false);
        }
    }

    async function deleteAfford(a: WeAfford) {
        if (a.status.includes('Approved')) { Alert.alert('', 'Approved work affords can not be deleted!'); return; }
        if (!(await confirmAsync('Selected entry will be deleted, Do you confirm?'))) return;
        const res = await apiFetch(`/api/workentry/afford/${a.id}`, { method: 'DELETE' });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        reloadAffords(); reloadCalendar(); reloadWorks();
    }

    useEffect(() => {
        apiGet<WeProject[]>(`/api/workentry/projects?showFinished=${showFinished}`)
            .then((ps) => {
                setProjects(ps);
                setProjectId((cur) => (cur && ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? null));
            })
            .catch((e) => setError(e.message));
    }, [showFinished]);

    useEffect(() => {
        if (projectId == null) { setFolders([]); return; }
        apiGet<WeFolder[]>(`/api/workentry/works?projectId=${projectId}`)
            .then((f) => { setFolders(f); setExpanded(new Set(f.map((x) => x.folder))); })
            .catch((e) => setError(e.message));
    }, [projectId]);

    useEffect(() => {
        apiGet<WeAfford[]>(`/api/workentry/affords?date=${iso(selectedDate)}`).then(setAffords).catch((e) => setError(e.message));
    }, [selectedDate]);

    useEffect(() => {
        apiGet<WeCalendar>(`/api/workentry/calendar?year=${calMonth.getFullYear()}&month=${calMonth.getMonth() + 1}`).then(setCalendar).catch(() => {});
    }, [calMonth]);

    const filteredFolders = useMemo(() => {
        if (!search.trim()) return folders;
        const q = search.toLowerCase();
        return folders
            .map((f) => ({ ...f, works: f.works.filter((w) => w.name.toLowerCase().includes(q) || (w.drawingNo ?? '').toLowerCase().includes(q)) }))
            .filter((f) => f.works.length > 0);
    }, [folders, search]);

    function toggleFolder(name: string) {
        setExpanded((prev) => { const n = new Set(prev); if (n.has(name)) n.delete(name); else n.add(name); return n; });
    }

    const currentProject = projects.find((p) => p.id === projectId);
    const currentAdminUser = activeUsers.find((u) => u.id === adminUserId);

    return (
        <ScrollView style={styles.we} contentContainerStyle={styles.weContent}>
            {/* Header */}
            <Text style={styles.h1}>Work Entry</Text>

            {/* Toolbar: Project + Show Finished */}
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Project</Text>
                <TouchableOpacity style={styles.select} onPress={() => setProjectPickerOpen(true)}>
                    <Text style={styles.selectText} numberOfLines={1}>{currentProject?.name ?? '—'}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
                <Checkbox checked={showFinished} onChange={setShowFinished} label="Show Finished" />
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {/* Available Works */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Available Works</Text>
                </View>
                <View style={styles.searchRow}>
                    <Text style={styles.lbl}>Search</Text>
                    <TextInput style={styles.searchInput} value={search} onChangeText={setSearch}
                        autoCapitalize="none" autoCorrect={false} />
                </View>
                <View style={styles.cardBody}>
                    {filteredFolders.length === 0 ? (
                        <Text style={styles.empty}>No works found.</Text>
                    ) : filteredFolders.map((f) => (
                        <View key={f.folder}>
                            <TouchableOpacity style={styles.treeFolderHead} onPress={() => toggleFolder(f.folder)}>
                                <Text style={styles.treeCaret}>{expanded.has(f.folder) ? '▾' : '▸'}</Text>
                                <Text style={styles.treeFolderName}>{f.folder}</Text>
                                <Text style={styles.treeCount}>({f.works.length})</Text>
                            </TouchableOpacity>
                            {expanded.has(f.folder) && f.works.map((w) => (
                                <TouchableOpacity key={w.workId}
                                    style={[styles.treeWork, selectedWork?.workId === w.workId && styles.treeWorkSel]}
                                    onPress={() => setSelectedWork(w)}>
                                    {disciplineVisible && <Text style={styles.twDisc}>{w.discipline}</Text>}
                                    {drawingNoVisible && !!w.drawingNo && <Text style={styles.twDwg}>{w.drawingNo}</Text>}
                                    <Text style={styles.twName} numberOfLines={2}>{w.name}</Text>
                                    <Text style={styles.twHrs}>{hoursToDays(w.currentTotalHours, hpd)} / {hoursToDays(w.estimatedHours, hpd)} d</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    ))}
                </View>
            </View>

            {/* Log Work: takvim + form */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Log Work</Text>
                </View>
                <View style={styles.cardBody}>
                    <MiniCalendar
                        month={calMonth} selected={selectedDate}
                        bold={calendar.boldDates} alert={calendar.alertDates}
                        onPrev={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                        onNext={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                        onPick={(d) => setSelectedDate(d)}
                    />

                    {selectedWork && (
                        <Text style={styles.selInfo}>
                            {selectedWork.name} — Est: {hoursToDays(selectedWork.estimatedHours, hpd)} d •
                            {' '}Act: {hoursToDays(selectedWork.currentTotalHours, hpd)} d •
                            {' '}{selectedWork.estimatedHours > 0 ? Math.round((selectedWork.currentTotalHours / selectedWork.estimatedHours) * 100) : 0}%
                        </Text>
                    )}

                    <View style={styles.formRow}>
                        <Text style={styles.lbl}>Duration</Text>
                        <TextInput style={styles.numInput} keyboardType="number-pad"
                            value={String(hour)} onChangeText={(t) => setHour(Math.max(0, Number(t) || 0))} />
                        <Text style={styles.unit}>h</Text>
                        <TextInput style={styles.numInput} keyboardType="number-pad"
                            value={String(minute)} onChangeText={(t) => setMinute(Math.max(0, Math.min(59, Number(t) || 0)))} />
                        <Text style={styles.unit}>min</Text>
                    </View>

                    <View style={styles.formRow}>
                        <Checkbox checked={overwork} onChange={setOverwork} label="Overwork" />
                        {revisionVisible && <Checkbox checked={revision} onChange={setRevision} label="Revision" />}
                    </View>

                    <Text style={styles.lbl}>Work Detail</Text>
                    <TextInput style={styles.detailInput} multiline numberOfLines={3}
                        value={detail} onChangeText={setDetail} />

                    {isAdmin && (
                        <View style={styles.formRow}>
                            <Checkbox checked={adminEntry} onChange={setAdminEntry} label="Admin Entry for User:" />
                            <TouchableOpacity
                                style={[styles.select, styles.adminSelect, !adminEntry && styles.selectDisabled]}
                                disabled={!adminEntry}
                                onPress={() => setAdminPickerOpen(true)}>
                                <Text style={styles.selectText} numberOfLines={1}>{currentAdminUser?.name ?? '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    <TouchableOpacity
                        style={[styles.btnPrimary, (submitting || !selectedWork) && styles.btnDisabled]}
                        disabled={submitting || !selectedWork}
                        onPress={() => submit()}>
                        {submitting
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={styles.btnText}>Add Work</Text>}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Works done by ... on ... */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>
                        Works done by {user.name} on {selectedDate.toLocaleDateString('en-GB')}
                    </Text>
                </View>
                <View style={styles.cardBody}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                {AFFORD_COLS.map((c) => (
                                    <Text key={c.label} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {affords.length === 0 ? (
                                <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                            ) : affords.map((a) => {
                                const st = statusStyle(a.status);
                                return (
                                    <View key={a.id} style={[styles.gridRow, st && { backgroundColor: st.bg }]}>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[0].width }, st && { color: st.fg }]} numberOfLines={1}>{a.project}</Text>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[1].width }, st && { color: st.fg }]} numberOfLines={1}>{a.folder}</Text>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[2].width }, st && { color: st.fg }]} numberOfLines={1}>{a.work}</Text>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[3].width }, st && { color: st.fg }]} numberOfLines={1}>{a.detail}</Text>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[4].width }, st && { color: st.fg }]}>{a.hours}</Text>
                                        <Text style={[styles.gridCell, { width: AFFORD_COLS[5].width }, st && { color: st.fg }]} numberOfLines={1}>{a.status}</Text>
                                        <TouchableOpacity style={{ width: AFFORD_COLS[6].width }} onPress={() => deleteAfford(a)}>
                                            <Text style={styles.delBtn}>✕</Text>
                                        </TouchableOpacity>
                                    </View>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
            </View>

            {/* Project picker */}
            <PickerModal
                visible={projectPickerOpen}
                items={projects.map((p) => ({ id: p.id, name: p.name }))}
                selectedId={projectId}
                onClose={() => setProjectPickerOpen(false)}
                onPick={(id) => { setProjectId(id); setProjectPickerOpen(false); }}
            />
            {/* Admin user picker */}
            <PickerModal
                visible={adminPickerOpen}
                items={activeUsers}
                selectedId={adminUserId}
                onClose={() => setAdminPickerOpen(false)}
                onPick={(id) => { setAdminUserId(id); setAdminPickerOpen(false); }}
            />
        </ScrollView>
    );
}

// Works done tablosu kolonları — web/masaüstü sırası birebir
const AFFORD_COLS = [
    { label: 'Project', width: 110 },
    { label: 'Phase', width: 100 },
    { label: 'Work', width: 150 },
    { label: 'Detail', width: 140 },
    { label: 'Hours', width: 52 },
    { label: 'Status', width: 90 },
    { label: '', width: 32 },
];

// Web `we-status-*` CSS sınıfları birebir (aynı anahtar üretimi)
function statusStyle(status: string): { bg: string; fg: string } | null {
    const key = status.toLowerCase().replace(/[^a-z]/g, '');
    if (key === 'pending') return { bg: '#f0f2f7', fg: '#676879' };
    if (key === 'approved') return { bg: '#d1fae5', fg: '#037f4c' };
    if (key === 'rejected') return { bg: '#ffe4e6', fg: '#e2445c' };
    return null;
}

// ── Checkbox (web <input type="checkbox"> karşılığı) ──
function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <TouchableOpacity style={styles.cbRow} onPress={() => onChange(!checked)}>
            <View style={[styles.cbBox, checked && styles.cbBoxChecked]}>
                {checked && <Text style={styles.cbTick}>✓</Text>}
            </View>
            <Text style={styles.cbLabel}>{label}</Text>
        </TouchableOpacity>
    );
}

// ── Seçim modalı (web <select> karşılığı) ──
function PickerModal({ visible, items, selectedId, onClose, onPick }: {
    visible: boolean; items: { id: number; name: string }[]; selectedId: number | null;
    onClose: () => void; onPick: (id: number) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.pickerOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.pickerBox}>
                    <ScrollView>
                        {items.map((it) => (
                            <TouchableOpacity key={it.id}
                                style={[styles.pickerItem, it.id === selectedId && styles.pickerItemSel]}
                                onPress={() => onPick(it.id)}>
                                <Text style={[styles.pickerItemText, it.id === selectedId && styles.pickerItemTextSel]}>
                                    {it.name}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

// ── Basit ay takvimi — web MiniCalendar birebir ──
// bold = o gün giriş var (yeşil kalın), alert = eksik gün (kırmızı çerçeve)
function MiniCalendar({ month, selected, bold, alert, onPrev, onNext, onPick }: {
    month: Date; selected: Date; bold: string[]; alert: string[];
    onPrev: () => void; onNext: () => void; onPick: (d: Date) => void;
}) {
    const y = month.getFullYear(), m = month.getMonth();
    const first = new Date(y, m, 1);
    const startDow = (first.getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const boldSet = new Set(bold), alertSet = new Set(alert);
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));

    return (
        <View style={styles.calWrap}>
            <View style={styles.calHead}>
                <TouchableOpacity style={styles.calNav} onPress={onPrev}><Text style={styles.calNavText}>‹</Text></TouchableOpacity>
                <Text style={styles.calTitle}>{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Text>
                <TouchableOpacity style={styles.calNav} onPress={onNext}><Text style={styles.calNavText}>›</Text></TouchableOpacity>
            </View>
            <View style={styles.calGrid}>
                {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                    <View key={d} style={styles.calCell}><Text style={styles.calDow}>{d}</Text></View>
                ))}
                {cells.map((d, i) => {
                    if (!d) return <View key={i} style={styles.calCell} />;
                    const key = iso(d);
                    const isSel = iso(selected) === key;
                    const isBold = boldSet.has(key);
                    const isAlert = alertSet.has(key);
                    return (
                        <View key={i} style={styles.calCell}>
                            <TouchableOpacity
                                style={[styles.calDay, isAlert && styles.calDayAlert, isSel && styles.calDaySel]}
                                onPress={() => onPick(d)}>
                                <Text style={[
                                    styles.calDayText,
                                    isBold && styles.calDayBold,
                                    isAlert && styles.calDayAlertText,
                                    isSel && styles.calDaySelText,
                                ]}>
                                    {d.getDate()}
                                </Text>
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// Renkler web App.css birebir (cal-day.bold #166534, .alert #ef4444/#b91c1c,
// .sel #2563eb; tree/grid renkleri aynı aile)
const styles = StyleSheet.create({
    we: { flex: 1, backgroundColor: '#f0f2f7' },
    weContent: { padding: 8, paddingBottom: 24 },
    h1: { fontSize: 20, fontWeight: '700', color: '#111827', paddingHorizontal: 8, paddingVertical: 8 },
    error: { color: '#b91c1c', paddingHorizontal: 8, marginBottom: 6 },

    toolbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, marginBottom: 8, flexWrap: 'wrap', gap: 8 },
    lbl: { fontSize: 12, color: '#374151', marginRight: 6 },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, flex: 1, minWidth: 120,
    },
    adminSelect: { flex: 1 },
    selectDisabled: { opacity: 0.5 },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, marginBottom: 10 },
    cardHead: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    cardBody: { padding: 8 },
    empty: { fontSize: 12, color: '#9ca3af', padding: 8 },

    searchRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 10, paddingVertical: 6,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    searchInput: {
        flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, color: '#111827',
    },

    treeFolderHead: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 4, backgroundColor: '#f7f9fc' },
    treeCaret: { width: 16, fontSize: 12, color: '#6b7280' },
    treeFolderName: { fontSize: 13, fontWeight: '700', color: '#1f2937', flex: 1 },
    treeCount: { fontSize: 11, color: '#9ca3af' },
    treeWork: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
        paddingVertical: 7, paddingLeft: 20, paddingRight: 6,
        borderBottomWidth: 1, borderBottomColor: '#f0f2f7',
    },
    treeWorkSel: { backgroundColor: '#eef2ff' },
    twDisc: { fontSize: 10, color: '#6b7280', backgroundColor: '#f0f2f7', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, marginRight: 6 },
    twDwg: { fontSize: 10, color: '#6b7280', marginRight: 6 },
    twName: { fontSize: 12, color: '#374151', flex: 1, minWidth: 120 },
    twHrs: { fontSize: 11, color: '#6b7280', marginLeft: 6 },

    selInfo: { fontSize: 13, color: '#374151', marginTop: 8, marginBottom: 4 },
    formRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 8 },
    numInput: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 5, fontSize: 13, color: '#111827', width: 56, textAlign: 'center',
    },
    unit: { fontSize: 12, color: '#374151' },
    detailInput: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, color: '#111827',
        minHeight: 64, textAlignVertical: 'top', marginTop: 4,
    },
    btnPrimary: { padding: 10, backgroundColor: '#2563eb', borderRadius: 6, alignItems: 'center', marginTop: 12 },
    btnDisabled: { backgroundColor: '#93c5fd' },
    btnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

    cbRow: { flexDirection: 'row', alignItems: 'center' },
    cbBox: {
        width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3,
        alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff',
    },
    cbBoxChecked: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    cbLabel: { fontSize: 12, color: '#374151', marginLeft: 6 },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f0f2f7', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#2d3748', paddingVertical: 5, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    gridCell: { fontSize: 11, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 6 },
    delBtn: { color: '#e2445c', fontSize: 13, fontWeight: '700', textAlign: 'center' },

    pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    pickerBox: { backgroundColor: '#fff', borderRadius: 8, maxHeight: 420, width: '100%', paddingVertical: 6 },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 14, color: '#111827' },
    pickerItemTextSel: { color: '#2563eb', fontWeight: '700' },

    calWrap: { borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 6, padding: 6 },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    calNav: { paddingHorizontal: 12, paddingVertical: 4 },
    calNavText: { fontSize: 18, color: '#374151' },
    calTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
    calDow: { fontSize: 10, fontWeight: '700', color: '#6b7280', paddingVertical: 2 },
    calDay: {
        width: 32, height: 32, borderRadius: 16,
        alignItems: 'center', justifyContent: 'center',
    },
    calDaySel: { backgroundColor: '#2563eb' },
    calDayAlert: { borderWidth: 1.5, borderColor: '#ef4444' },
    calDayText: { fontSize: 12, color: '#374151' },
    calDayBold: { fontWeight: '800', color: '#166534' },
    calDayAlertText: { color: '#b91c1c' },
    calDaySelText: { color: '#fff', fontWeight: '700' },
});

export default WorkEntryScreen;
