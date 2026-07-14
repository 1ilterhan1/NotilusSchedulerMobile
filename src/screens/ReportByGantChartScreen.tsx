// Web pages/ReportByGantChart.tsx birebir (masaüstü ucReportByGantChart klonu).
// Mevcut API: /api/reportbygantchart/{init,data}
//
// Birebir korunanlar:
// - Grid DAİMA tam listeyi gösterir; From/To filtresi yalnız Gantt'a uygulanır
// - Filtre: planlı aralığı [From,To] ile KESİŞEN işler (planı olmayan daima dahil)
// - Gantt görünümü From/To'ya sabitlenir; From bir önceki Pazartesi'ye çekilir
// - From/To başlangıcı yüklenen işlerin TÜM tarihlerinden (planlı + gerçekleşen
//   + segment); boşsa bugün-3ay / bugün+12ay
// - Her WorkAfford kaydı ayrı bar; genişlik = saat / (saat/gün) × px/gün (min 3px)
// - Renkler birebir: planlı cornflower, on-time sea green, delayed indian red,
//   early steel blue; Today turuncu kesikli çizgi; Legend şeridi
// - Status renkleri (GanttStatusColor) ve gerçekleşen bar rengi (ActualBarColor)
// - Status bar: Tasks | Completed | In Progress | Delayed | Avg Completion
// - Görev adı 24 karakterden uzunsa 22 + "…"
// - Reload / Project / Completed Projects toolbar'ı
// Mobil uyarlama: Ctrl+tekerlek zoom yerine −/+ butonları (aynı 4–80 px, adım 3);
// splitter yerine dikey akış (üstte tablo, altta Gantt); select → modal liste;
// tarih → takvim modalı; sol görev kolonu sabit, zaman ekseni yatay kaydırmalı.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { apiGet } from '../api';
import type { RgData, RgInit, RgTask, RpProjectItem } from '../types';

// ── Layout sabitleri (GanttChartPanel birebir; sol kolon mobilde 140px) ──
const LEFT_COL_WIDTH = 140;
const HEADER_MONTH_H = 24;
const HEADER_WEEK_H = 22;
const HEADER_H = HEADER_MONTH_H + HEADER_WEEK_H;
const ROW_H = 50;
const PLANNED_BAR_H = 10;
const ACTUAL_BAR_H = 10;
const BAR_GAP = 4;
const MIN_DAY_PX = 4;
const MAX_DAY_PX = 80;
const DEF_DAY_PX = 22;

// ── Renkler (GanttChartPanel birebir) ──
const C_PLANNED = 'rgb(100,149,237)';        // cornflower blue
const C_ACTUAL_ONTIME = 'rgb(60,179,113)';   // medium sea green
const C_ACTUAL_DELAYED = 'rgb(205,92,92)';   // indian red
const C_ACTUAL_EARLY = 'rgb(70,130,180)';    // steel blue
const C_TODAY = 'rgb(255,160,0)';

// ── Tarih yardımcıları (web birebir) ──
function parseIso(s: string): Date {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function toInput(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
}
function addMonths(d: Date, n: number): Date {
    const r = new Date(d);
    r.setMonth(r.getMonth() + n);
    return r;
}
function dayDiff(a: Date, b: Date): number {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}
function startOfToday(): Date {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
// Bir önceki Pazartesi'ye çek — masaüstü birebir
function snapToMonday(d: Date): Date {
    const r = new Date(d);
    while (r.getDay() !== 1) r.setDate(r.getDate() - 1);
    return r;
}

// ── Status rengi (GanttStatusColor birebir) ──
function ganttStatusColor(status: string): string {
    switch (status) {
        case 'Completed': return 'rgb(34,139,34)';
        case 'In Progress': return 'rgb(255,140,0)';
        case 'Overdue Start': return 'rgb(220,20,60)';
        default: return 'gray';
    }
}

// ── Gerçekleşen bar rengi (ActualBarColor birebir) ──
function actualBarColor(task: RgTask): string {
    if (task.status === 'Completed') {
        if (task.actualEnd && task.plannedEnd && task.actualEnd < task.plannedEnd)
            return C_ACTUAL_EARLY;
        return C_ACTUAL_ONTIME;
    }
    if (task.plannedEnd && toInput(startOfToday()) > task.plannedEnd)
        return C_ACTUAL_DELAYED;
    return C_ACTUAL_ONTIME;
}

function ReportByGantChartScreen() {
    const [projects, setProjects] = useState<RpProjectItem[]>([]);
    const [completed, setCompleted] = useState(false);
    const [projectId, setProjectId] = useState<number | null>(null);

    // _allTasks karşılığı — grid daima bunu gösterir
    const [allTasks, setAllTasks] = useState<RgTask[]>([]);
    const [hoursPerDay, setHoursPerDay] = useState(9);

    const [fromDate, setFromDate] = useState<string>('');
    const [toDate, setToDate] = useState<string>('');

    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false);
    const [selRow, setSelRow] = useState<number | null>(null);
    const [projPickerOpen, setProjPickerOpen] = useState(false);
    const [datePick, setDatePick] = useState<'from' | 'to' | null>(null);
    const bootRef = useRef(false);

    // ── Açılış ──
    useEffect(() => {
        if (bootRef.current) return;
        bootRef.current = true;
        (async () => {
            setLoading(true);
            try {
                const init = await apiGet<RgInit>('/api/reportbygantchart/init?completed=false');
                setProjects(init.projects);
                setHoursPerDay(init.hoursPerDay);
                const pick = init.projects[0]?.id ?? null;
                setProjectId(pick);
                if (pick != null) await fetchData(pick);
                else { setAllTasks([]); setLoaded(true); }
            } catch { /* yoksay */ } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── LoadData birebir ──
    async function fetchData(pid: number) {
        setLoading(true);
        try {
            const d = await apiGet<RgData>(`/api/reportbygantchart/data?projectId=${pid}`);
            setAllTasks(d.tasks);
            setHoursPerDay(d.hoursPerDay);
            setSelRow(null);

            const starts: string[] = [];
            const ends: string[] = [];
            for (const t of d.tasks) {
                if (t.plannedStart) starts.push(t.plannedStart);
                if (t.plannedEnd) ends.push(t.plannedEnd);
                if (t.actualStart) starts.push(t.actualStart);
                if (t.actualEnd) ends.push(t.actualEnd);
                for (const seg of t.segments) { starts.push(seg.date); ends.push(seg.date); }
            }
            setFromDate(starts.length ? starts.reduce((a, b) => (a < b ? a : b))
                : toInput(addMonths(startOfToday(), -3)));
            setToDate(ends.length ? ends.reduce((a, b) => (a > b ? a : b))
                : toInput(addMonths(startOfToday(), 12)));
            setLoaded(true);
        } finally {
            setLoading(false);
        }
    }

    // ── ApplyDateFilter birebir ──
    const filtered = useMemo(() => {
        if (!fromDate || !toDate) return allTasks;
        return allTasks.filter(t => {
            if (!t.plannedStart && !t.plannedEnd) return true;
            if (t.plannedEnd && t.plannedEnd < fromDate) return false;
            if (t.plannedStart && t.plannedStart > toDate) return false;
            return true;
        });
    }, [allTasks, fromDate, toDate]);

    // ── UpdateStatusBar birebir ──
    const statusText = useMemo(() => {
        if (!loaded) return 'Ready';
        const total = filtered.length;
        const comp = filtered.filter(t => t.status === 'Completed').length;
        const inProg = filtered.filter(t => t.status === 'In Progress').length;
        const delayed = filtered.filter(t =>
            t.status === 'Overdue Start' ||
            (t.plannedEnd != null && t.actualEnd != null && t.actualEnd > t.plannedEnd)).length;
        const avg = total > 0 ? filtered.reduce((s, t) => s + t.percent, 0) / total : 0;
        return `Tasks: ${total}   |   Completed: ${comp}   |   In Progress: ${inProg}` +
            `   |   Delayed: ${delayed}   |   Avg Completion: ${avg.toFixed(0)}%`;
    }, [filtered, loaded]);

    function onSelectProject(id: number) {
        setProjectId(id);
        fetchData(id);
    }
    async function onToggleCompleted(next: boolean) {
        setCompleted(next);
        setLoading(true);
        try {
            const init = await apiGet<RgInit>(`/api/reportbygantchart/init?completed=${next}`);
            setProjects(init.projects);
            const pick = init.projects[0]?.id ?? null;
            setProjectId(pick);
            if (pick != null) await fetchData(pick);
            else {
                setAllTasks([]);
                setSelRow(null);
                setLoaded(true);
            }
        } catch { /* yoksay */ } finally {
            setLoading(false);
        }
    }
    function onReload() {
        if (projectId == null) return;
        fetchData(projectId);
    }

    const currentProject = projects.find(p => p.id === projectId);

    return (
        <View style={styles.rbg}>
            <ScrollView contentContainerStyle={styles.rbgContent}>
                {/* ── toolStrip1 birebir ── */}
                <View style={styles.toolbar}>
                    <Text style={styles.title}>Reports — Project Gantt Chart</Text>
                </View>
                <View style={styles.toolbar}>
                    <TouchableOpacity style={[styles.btn, (projectId == null || loading) && styles.btnDim]}
                        disabled={projectId == null || loading} onPress={onReload}>
                        <Text style={styles.btnText}>Reload</Text>
                    </TouchableOpacity>
                    <Text style={styles.loadingLbl}>{loading ? 'Loading…' : ''}</Text>
                    <Text style={styles.lbl}>Project:</Text>
                    <TouchableOpacity style={[styles.select, loading && styles.btnDim]} disabled={loading}
                        onPress={() => setProjPickerOpen(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{currentProject?.name ?? '—'}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.toolbar}>
                    <TouchableOpacity style={styles.checkRow} disabled={loading} onPress={() => onToggleCompleted(!completed)}>
                        <View style={[styles.cbBox, completed && styles.cbBoxOn]}>
                            {completed && <Text style={styles.cbTick}>✓</Text>}
                        </View>
                        <Text style={styles.lbl}>Completed Projects</Text>
                    </TouchableOpacity>
                </View>

                {/* ── pnlDateFilter birebir ── */}
                <View style={styles.datebar}>
                    <Text style={styles.dlabel}>From Date</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('from')}>
                        <Text style={styles.dateBtnText}>{fromDate || '—'}</Text>
                    </TouchableOpacity>
                    <Text style={styles.dlabel}>To Date</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('to')}>
                        <Text style={styles.dateBtnText}>{toDate || '—'}</Text>
                    </TouchableOpacity>
                </View>

                {/* ── Görev tablosu (dgvTasks birebir — daima TAM liste) ── */}
                <View style={styles.card}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <TouchableOpacity style={styles.gridHeadRow} onPress={() => setSelRow(null)}>
                                {GRID_COLS.map((c, i) => (
                                    <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </TouchableOpacity>
                            {allTasks.map((t, i) => {
                                const sel = selRow === t.id;
                                return (
                                    <TouchableOpacity key={t.id}
                                        style={[styles.gridRow, i % 2 === 1 && styles.gridRowAlt, sel && styles.gridRowSel]}
                                        onPress={() => setSelRow(t.id)}>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[0].width }]} numberOfLines={2}>{t.name}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[1].width }]} numberOfLines={1}>{t.category}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[2].width }]}>{t.plannedStart ?? '-'}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[3].width }]}>{t.plannedEnd ?? '-'}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[4].width }]}>{t.actualStart ?? '-'}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[5].width }]}>{t.actualEnd ?? '-'}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[6].width }, { color: ganttStatusColor(t.status) }]}>{t.status}</Text>
                                        <Text style={[styles.gridCell, { width: GRID_COLS[7].width }, { textAlign: 'center' }]}>{t.percent}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>

                {/* ── Gantt (GanttChartPanel birebir) ── */}
                <View style={styles.card}>
                    <GanttChart tasks={filtered} from={fromDate} to={toDate} hoursPerDay={hoursPerDay} />
                </View>

                {/* ── statusStrip1 birebir ── */}
                <View style={styles.status}><Text style={styles.statusText}>{statusText}</Text></View>
            </ScrollView>

            {/* Proje seçimi */}
            <PickerModal visible={projPickerOpen} items={projects} selectedId={projectId}
                onClose={() => setProjPickerOpen(false)}
                onPick={(id) => { setProjPickerOpen(false); onSelectProject(id); }} />

            {/* Tarih seçici (filtre anında uygulanır — ValueChanged birebir) */}
            <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker initial={datePick === 'from' ? (fromDate || toInput(new Date())) : (toDate || toInput(new Date()))}
                            onPick={(d) => {
                                if (datePick === 'from') setFromDate(d); else setToDate(d);
                                setDatePick(null);
                            }} />
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

const GRID_COLS = [
    { label: 'Task Name', width: 150 },
    { label: 'Category', width: 100 },
    { label: 'Planned Start', width: 92 },
    { label: 'Planned End', width: 92 },
    { label: 'Actual Start', width: 92 },
    { label: 'Actual End', width: 92 },
    { label: 'Status', width: 100 },
    { label: '%', width: 40 },
];

// ═══ GanttChart — GanttChartPanel birebir ═══
function GanttChart({ tasks, from, to, hoursPerDay }: {
    tasks: RgTask[];
    from: string;
    to: string;
    hoursPerDay: number;
}) {
    const [dayPx, setDayPx] = useState(DEF_DAY_PX);

    // ── Görünüm aralığı (SetTasks birebir) ──
    const today = startOfToday();
    const viewStart = snapToMonday(from ? parseIso(from) : addDays(today, -14));
    const viewEnd = to ? parseIso(to) : addDays(today, 30);
    const totalDays = Math.max(1, dayDiff(viewStart, viewEnd) + 1);
    const chartW = totalDays * dayPx;
    const rowsH = tasks.length * ROW_H;

    const xOf = (d: Date) => dayDiff(viewStart, d) * dayPx;

    // ── Ay etiketleri + ay ayraçları (DrawHeader birebir) ──
    const months: { label: string; x: number }[] = [];
    const monthDividers: number[] = [];
    {
        let m = new Date(viewStart.getFullYear(), viewStart.getMonth(), 1);
        const endExcl = addDays(viewEnd, 1);
        while (m < endExcl) {
            const next = addMonths(m, 1);
            const segStart = m < viewStart ? viewStart : m;
            const segEnd = next < endExcl ? next : endExcl;
            const x = xOf(segStart);
            const w = xOf(segEnd) - x;
            if (w > 10) {
                months.push({
                    label: `${m.toLocaleString('en-US', { month: 'short' })} ${m.getFullYear()}`,
                    x,
                });
            }
            if (m > viewStart) monthDividers.push(xOf(m));
            m = next;
        }
    }

    // ── Pazartesi işaretleri ──
    const mondays: { day: number; x: number }[] = [];
    {
        let d = new Date(viewStart);
        while (d <= viewEnd) {
            mondays.push({ day: d.getDate(), x: xOf(d) });
            d = addDays(d, 7);
        }
    }

    const todayX = xOf(today);
    const todayVisible = todayX >= 0 && todayX <= chartW;

    return (
        <View>
            {/* Zoom (mobil uyarlama: Ctrl+tekerlek yerine −/+; aynı sınırlar/adım) */}
            <View style={styles.zoomRow}>
                <TouchableOpacity style={styles.zoomBtn}
                    onPress={() => setDayPx(p => Math.max(MIN_DAY_PX, p - 3))}>
                    <Text style={styles.zoomBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.zoomLbl}>{dayPx} px/day</Text>
                <TouchableOpacity style={styles.zoomBtn}
                    onPress={() => setDayPx(p => Math.min(MAX_DAY_PX, p + 3))}>
                    <Text style={styles.zoomBtnText}>＋</Text>
                </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row' }}>
                {/* Sol kolon: görev adı + status · % (sabit) */}
                <View style={{ width: LEFT_COL_WIDTH }}>
                    <View style={[styles.gCorner, { height: HEADER_H }]}>
                        <Text style={styles.gCornerText}>Task</Text>
                    </View>
                    {tasks.map((t, i) => {
                        const displayName = t.name.length > 24 ? t.name.substring(0, 22) + '…' : t.name;
                        return (
                            <View key={t.id} style={[styles.gNameCell, { height: ROW_H }, i % 2 === 1 && styles.gRowAlt]}>
                                <Text style={styles.gNm} numberOfLines={1}>{displayName}</Text>
                                <Text style={[styles.gSt, { color: ganttStatusColor(t.status) }]} numberOfLines={1}>
                                    {t.status} · {t.percent}%
                                </Text>
                            </View>
                        );
                    })}
                </View>

                {/* Zaman ekseni: yatay kaydırmalı chart */}
                <ScrollView horizontal showsHorizontalScrollIndicator style={{ flex: 1 }}>
                    <View style={{ width: chartW, height: HEADER_H + rowsH }}>
                        {/* Header */}
                        <View style={[styles.gHeader, { width: chartW, height: HEADER_H }]}>
                            {months.map((mo, i) => (
                                <Text key={i} style={[styles.gMonth, { left: mo.x + 4 }]}>{mo.label}</Text>
                            ))}
                            {monthDividers.map((x, i) => (
                                <View key={i} style={[styles.gMDiv, { left: x, height: HEADER_H }]} />
                            ))}
                            {mondays.map((w, i) => (
                                <Text key={i} style={[styles.gWk, { left: w.x + 2, top: HEADER_MONTH_H }]}>{w.day}</Text>
                            ))}
                        </View>

                        {/* Haftalık grid çizgileri (tüm satırlar boyunca) */}
                        {mondays.map((w, i) => (
                            <View key={i} style={[styles.gWLine, { left: w.x, top: HEADER_H, height: rowsH }]} />
                        ))}

                        {/* Satırlar + barlar */}
                        {tasks.map((t, i) => {
                            const rowTop = HEADER_H + i * ROW_H;
                            const plannedY = (ROW_H - PLANNED_BAR_H - ACTUAL_BAR_H - BAR_GAP) / 2;
                            const actualY = plannedY + PLANNED_BAR_H + BAR_GAP;
                            const actCol = actualBarColor(t);
                            return (
                                <View key={t.id}
                                    style={[styles.gRow, { top: rowTop, width: chartW, height: ROW_H }, i % 2 === 1 && styles.gRowAlt]}>
                                    {/* Planlı bar */}
                                    {t.plannedStart && t.plannedEnd && (() => {
                                        const bx = xOf(parseIso(t.plannedStart));
                                        const bw = xOf(addDays(parseIso(t.plannedEnd), 1)) - bx;
                                        if (bw <= 1) return null;
                                        return (
                                            <View style={[styles.gBar, {
                                                left: bx, top: plannedY, width: bw, height: PLANNED_BAR_H,
                                                backgroundColor: C_PLANNED,
                                            }]} />
                                        );
                                    })()}
                                    {/* Gerçekleşen segment bar'ları */}
                                    {t.segments.map((seg, si) => {
                                        const bx = xOf(parseIso(seg.date));
                                        const bw = Math.max(3, (seg.hours / hoursPerDay) * dayPx);
                                        return (
                                            <View key={si} style={[styles.gBar, {
                                                left: bx, top: actualY, width: bw, height: ACTUAL_BAR_H,
                                                backgroundColor: actCol,
                                            }]} />
                                        );
                                    })}
                                </View>
                            );
                        })}

                        {/* Today çizgisi (DrawTodayLine birebir — turuncu kesikli) */}
                        {todayVisible && rowsH > 0 && (
                            <View style={[styles.gToday, { left: todayX, top: HEADER_H, height: rowsH }]}>
                                <Text style={styles.gTodayLbl}>Today</Text>
                            </View>
                        )}
                    </View>
                </ScrollView>
            </View>

            {/* Legend şeridi (DrawLegend birebir) */}
            <View style={styles.legend}>
                <View style={[styles.lSw, { backgroundColor: C_PLANNED }]} /><Text style={styles.lTxt}>Planned</Text>
                <View style={[styles.lSw, { backgroundColor: C_ACTUAL_ONTIME }]} /><Text style={styles.lTxt}>Actual (on time)</Text>
                <View style={[styles.lSw, { backgroundColor: C_ACTUAL_DELAYED }]} /><Text style={styles.lTxt}>Actual (delayed)</Text>
                <View style={[styles.lSw, { backgroundColor: C_ACTUAL_EARLY }]} /><Text style={styles.lTxt}>Actual (early)</Text>
                <View style={styles.lToday} /><Text style={styles.lTxt}>Today</Text>
            </View>
        </View>
    );
}

// ── Seçim modalı ──
function PickerModal({ visible, items, selectedId, onClose, onPick }: {
    visible: boolean; items: { id: number; name: string }[]; selectedId: number | null;
    onClose: () => void; onPick: (id: number) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={[styles.modalBox, { maxHeight: 420, paddingHorizontal: 0, paddingVertical: 6 }]}>
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

// ── Ay takvimi tarih seçici ──
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
    const isoOf = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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
                    const isSel = isoOf(d) === initial;
                    return (
                        <View key={i} style={styles.calCell}>
                            <TouchableOpacity style={[styles.calDay, isSel && styles.calDaySel]} onPress={() => onPick(isoOf(d))}>
                                <Text style={[styles.calDayText, isSel && styles.calDaySelText]}>{d.getDate()}</Text>
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// Renkler web ReportByGantChart.css birebir
const styles = StyleSheet.create({
    rbg: { flex: 1, backgroundColor: '#f0f2f7' },
    rbgContent: { paddingBottom: 24 },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    title: { fontSize: 14, fontWeight: '700', color: '#1f3a6e' },
    lbl: { fontSize: 12, color: '#374151' },
    loadingLbl: { fontSize: 11, color: '#6b7280' },
    btn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 6 },
    btnText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    btnDim: { opacity: 0.5 },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 6, flex: 1, minWidth: 120,
    },
    selectText: { fontSize: 12, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 11, color: '#6b7280', marginLeft: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },

    datebar: {
        flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    dlabel: { fontSize: 11, fontWeight: '700', color: '#6b7280' },
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
    dateBtnText: { fontSize: 12, color: '#111827' },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, margin: 8, overflow: 'hidden' },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 10, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6', backgroundColor: '#fff' },
    gridRowAlt: { backgroundColor: '#f8f9fa' },
    gridRowSel: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 10, color: '#374151', paddingVertical: 8, paddingHorizontal: 4 },

    zoomRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8,
        paddingHorizontal: 8, paddingVertical: 6,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    zoomBtn: {
        width: 30, height: 30, borderRadius: 6, borderWidth: 1, borderColor: '#d1d5db',
        backgroundColor: '#f9fafb', alignItems: 'center', justifyContent: 'center',
    },
    zoomBtnText: { fontSize: 16, color: '#374151', fontWeight: '700' },
    zoomLbl: { fontSize: 11, color: '#6b7280' },

    gCorner: {
        backgroundColor: '#f8f9fc', justifyContent: 'flex-end',
        borderBottomWidth: 1, borderBottomColor: '#d7dce8',
        borderRightWidth: 1, borderRightColor: '#e4e7f0',
        paddingHorizontal: 8, paddingBottom: 4,
    },
    gCornerText: { fontSize: 11, fontWeight: '700', color: '#1f3a6e' },
    gNameCell: {
        justifyContent: 'center', paddingHorizontal: 8,
        borderBottomWidth: 1, borderBottomColor: '#eef0f6',
        borderRightWidth: 1, borderRightColor: '#e4e7f0',
        backgroundColor: '#fff',
    },
    gNm: { fontSize: 11, fontWeight: '600', color: '#323338' },
    gSt: { fontSize: 9, marginTop: 2 },
    gRowAlt: { backgroundColor: '#f8f9fa' },

    gHeader: {
        position: 'absolute', top: 0, left: 0,
        backgroundColor: '#f8f9fc',
        borderBottomWidth: 1, borderBottomColor: '#d7dce8',
    },
    gMonth: { position: 'absolute', top: 4, fontSize: 11, fontWeight: '700', color: '#1f3a6e' },
    gMDiv: { position: 'absolute', top: 0, width: 1, backgroundColor: '#c9d2e0' },
    gWk: { position: 'absolute', fontSize: 9, color: '#676879' },
    gWLine: { position: 'absolute', width: 1, backgroundColor: '#edf0f5' },

    gRow: {
        position: 'absolute', left: 0,
        borderBottomWidth: 1, borderBottomColor: '#eef0f6',
    },
    gBar: { position: 'absolute', borderRadius: 2 },
    gToday: {
        position: 'absolute', width: 2, backgroundColor: C_TODAY,
        opacity: 0.9,
    },
    gTodayLbl: {
        position: 'absolute', top: 2, left: 4, fontSize: 9, color: C_TODAY, fontWeight: '700',
        width: 40,
    },

    legend: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 8, paddingVertical: 8,
        borderTopWidth: 1, borderTopColor: '#e4e7f0',
    },
    lSw: { width: 14, height: 10, borderRadius: 2, marginLeft: 8 },
    lTxt: { fontSize: 10, color: '#374151' },
    lToday: { width: 14, height: 2, backgroundColor: C_TODAY, marginLeft: 8 },

    status: {
        backgroundColor: '#f8f9fc', borderTopWidth: 1, borderTopColor: '#e4e7f0',
        paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 8,
    },
    statusText: { fontSize: 10, color: '#676879' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 13, color: '#111827' },
    pickerItemTextSel: { color: '#2563eb', fontWeight: '700' },

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

export default ReportByGantChartScreen;
