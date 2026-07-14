// Web pages/Dashboard.tsx birebir (masaüstü ucDashboard klonu):
// - GET /api/dashboard (mevcut API, DashboardController)
// - 5 KPI kart (KPI_META birebir); proje seçiliyken 1. kart "COMPLETED WORKS"
// - Project Summary: tık = seç/bırak (KPI+gauge proje moduna geçer),
//   çift tık = Reports'a git (masaüstü ProjectDoubleClicked birebir)
// - This Week's Focus: Starting/Due tabloları (aynı kolonlar)
// - Overall Completion gauge (135° başlangıç, 270° süpürme, aynı renk eşikleri)
// - Team Workload — Approved Hours (Last 4 Weeks) bar grafiği
// Mobil uyarlama: iki kolon yerine tek kolon dikey akış; içerik birebir.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Svg, { G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { apiGet } from '../api';
import type { DashboardData, FocusRow, ProjectKpi } from '../types';

// Masaüstü paleti (ProjSummaries index sırasıyla aynı renkler)
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#6366f1', '#ec4899'];

// KPI kart meta (başlık, ikon, accent) — masaüstü KPI_META ile birebir
const KPI_META = [
    { title: 'ACTIVE PROJECTS', icon: '◆', accent: '#06b6d4' },
    { title: 'TOTAL WORKS', icon: '◼', accent: '#3b82f6' },
    { title: 'IN PROGRESS', icon: '◑', accent: '#f59e0b' },
    { title: 'OVERDUE', icon: '!', accent: '#ef4444' },
    { title: 'PENDING APPROVALS', icon: '⚠', accent: '#8b5cf6' },
];

function fmtDate(s: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '—';
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleString('en-US', { month: 'short' });
    const yr = String(d.getFullYear()).slice(-2);
    return `${day} ${mon} ${yr}`;
}

function fmtHours(h: number): string {
    if (!h || h <= 0) return '—';
    return `${Math.round(h * 10) / 10} h`;
}

interface Props {
    onOpenProjectReport?: (projectId: number) => void;
}

function DashboardScreen({ onOpenProjectReport }: Props) {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiGet<DashboardData>('/api/dashboard')
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const selected: ProjectKpi | null = useMemo(
        () => (selectedId != null ? data?.projects.find((p) => p.id === selectedId) ?? null : null),
        [selectedId, data]
    );

    const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    // KPI değerleri: proje seçiliyse proje modu, değilse overview (web birebir)
    const kpiValues: string[] = [];
    const kpiTitles = KPI_META.map((m) => m.title);
    if (data) {
        if (selected) {
            kpiTitles[0] = 'COMPLETED WORKS';
            kpiValues.push(`${selected.done} / ${selected.total}`);
            kpiValues.push(String(selected.total));
            kpiValues.push(String(selected.inProgress));
            kpiValues.push(String(selected.overdue));
            kpiValues.push(String(selected.pendingApprovals));
        } else {
            const o = data.overview;
            kpiValues.push(String(o.activeProjects), String(o.totalWorks),
                String(o.inProgress), String(o.overdue), String(o.pendingApprovals));
        }
    }

    const gaugePct = data
        ? Math.round(selected ? selected.completionPercent : data.overview.avgCompletion)
        : 0;

    const subtitle = selected
        ? `Showing: ${selected.name}  —  click the project again to return to overview`
        : 'Here is a snapshot of your projects today';

    function toggleProject(id: number) {
        setSelectedId((cur) => (cur === id ? null : id));
    }

    return (
        <ScrollView style={styles.dash} contentContainerStyle={styles.dashContent}>
            {/* Header (masaüstü 72px başlık şeridi) */}
            <View style={styles.header}>
                <Text style={styles.h1}>Dashboard</Text>
                <Text style={styles.sub}>
                    {loading ? 'Loading your dashboard data…' : error ? 'Could not load dashboard data.' : subtitle}
                </Text>
                <Text style={styles.date}>{dateStr}</Text>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {loading && <ActivityIndicator style={{ marginVertical: 20 }} color="#2563eb" />}

            {/* KPI row — 5 kart, masaüstü sırası */}
            <View style={styles.kpiRow}>
                {KPI_META.map((m, i) => (
                    <View key={i} style={[styles.kpiCard, { borderLeftColor: m.accent }]}>
                        <Text style={styles.kpiTitle}>{kpiTitles[i]}</Text>
                        <Text style={styles.kpiValue}>{data ? kpiValues[i] : '—'}</Text>
                        <Text style={[styles.kpiIcon, { color: m.accent }]}>{m.icon}</Text>
                    </View>
                ))}
            </View>

            {/* Project Summary */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Project Summary</Text>
                    <Text style={styles.cardHint}>Double-tap a project to see the report</Text>
                </View>
                <View style={styles.cardBody}>
                    {!data || data.projects.length === 0 ? (
                        <Text style={styles.empty}>No active projects found.</Text>
                    ) : (
                        data.projects.map((p, i) => (
                            <ProjectRow
                                key={p.id}
                                p={p}
                                accent={PALETTE[i % PALETTE.length]}
                                selected={selectedId === p.id}
                                onPress={() => toggleProject(p.id)}
                                onDoublePress={() => onOpenProjectReport?.(p.id)}
                            />
                        ))
                    )}
                </View>
            </View>

            {/* This Week's Focus */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>This Week's Focus</Text>
                </View>
                <View style={styles.cardBody}>
                    <FocusSection
                        label={`▶  Starting This Week  (${data?.startingThisWeek.length ?? 0})`}
                        color="#22c55e"
                        rows={data?.startingThisWeek ?? []}
                    />
                    <FocusSection
                        label={`◉  Due This Week  (${data?.dueThisWeek.length ?? 0})`}
                        color="#ef4444"
                        rows={data?.dueThisWeek ?? []}
                    />
                </View>
            </View>

            {/* Overall Completion */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Overall Completion</Text>
                </View>
                <View style={[styles.cardBody, styles.gaugeBody]}>
                    <Gauge percent={gaugePct} />
                </View>
            </View>

            {/* Team Workload */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Team Workload — Approved Hours (Last 4 Weeks)</Text>
                </View>
                <View style={styles.cardBody}>
                    <WorkloadChart
                        values={data?.weeklyHours ?? [0, 0, 0, 0]}
                        labels={data?.workloadLabels ?? ['', '', '', '']}
                    />
                </View>
            </View>
        </ScrollView>
    );
}

// ── Project Summary satırı: iki ilerleme çubuğu (completion + actual/budget) ──
// Web ProjectRow birebir; çift tık masaüstü MouseDoubleClick karşılığı
// (300 ms içinde ikinci dokunuş).
function ProjectRow({ p, accent, selected, onPress, onDoublePress }: {
    p: ProjectKpi; accent: string; selected: boolean;
    onPress: () => void; onDoublePress: () => void;
}) {
    const lastTap = useRef(0);

    function handlePress() {
        const now = Date.now();
        if (now - lastTap.current < 300) {
            lastTap.current = 0;
            onDoublePress();
            return;
        }
        lastTap.current = now;
        onPress();
    }

    const pct1 = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
    const pct1Color = pct1 >= 80 ? '#228B22' : pct1 >= 50 ? '#c87800' : '#c83232';

    const ratio = p.estimatedHours > 0 ? p.actualHours / p.estimatedHours : 0;
    const pct2 = Math.round(ratio * 100);
    const bar2Color = ratio <= 0.8 ? '#06b6d4' : ratio <= 1.0 ? '#f59e0b' : '#ef4444';

    const displayName = p.name.length > 32 ? p.name.substring(0, 30) + '…' : p.name;

    return (
        <TouchableOpacity
            activeOpacity={0.7}
            onPress={handlePress}
            style={[
                styles.projRow,
                selected && { backgroundColor: `${accent}1c`, borderLeftWidth: 3, borderLeftColor: accent },
            ]}
        >
            <View style={[styles.projDot, { backgroundColor: accent }]} />
            <View style={styles.projMain}>
                <Text style={styles.projName}>{displayName}</Text>

                <View style={styles.projLine}>
                    <Text style={styles.projMuted}>{p.done} / {p.total} works completed</Text>
                    <Text style={[styles.projPct, { color: pct1Color }]}>{pct1}%</Text>
                </View>
                <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct1}%`, backgroundColor: accent }]} />
                </View>

                <View style={styles.projLine}>
                    <Text style={styles.projMuted}>Actual: {pct2}% of budget</Text>
                    <Text style={[styles.projPct, { color: bar2Color }]}>{pct2}%</Text>
                </View>
                <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${Math.min(100, pct2)}%`, backgroundColor: bar2Color }]} />
                </View>
            </View>
        </TouchableOpacity>
    );
}

// ── This Week's Focus tablosu — kolonlar masaüstü birebir:
//    Work | Project | Start Date | End Date | Budget | Actual
const FOCUS_COLS = [
    { key: 'work', label: 'Work', width: 160 },
    { key: 'project', label: 'Project', width: 120 },
    { key: 'start', label: 'Start Date', width: 84 },
    { key: 'end', label: 'End Date', width: 84 },
    { key: 'budget', label: 'Budget', width: 68 },
    { key: 'actual', label: 'Actual', width: 64 },
];

function FocusSection({ label, color, rows }: { label: string; color: string; rows: FocusRow[] }) {
    return (
        <View style={styles.focusSection}>
            <Text style={[styles.focusLabel, { color }]}>{label}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator>
                <View>
                    <View style={styles.focusHeadRow}>
                        {FOCUS_COLS.map((c) => (
                            <Text key={c.key} style={[styles.focusHeadCell, { width: c.width }]}>{c.label}</Text>
                        ))}
                    </View>
                    {rows.length === 0 ? (
                        <View style={styles.focusRow}>
                            <Text style={styles.focusNone}>(none)</Text>
                        </View>
                    ) : rows.map((r, i) => (
                        <View key={`${r.workId}-${i}`} style={styles.focusRow}>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[0].width }]} numberOfLines={1}>{r.workName || '(unnamed)'}</Text>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[1].width }]} numberOfLines={1}>{r.projectName || '—'}</Text>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[2].width }]}>{fmtDate(r.startDate)}</Text>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[3].width }]}>{fmtDate(r.endDate)}</Text>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[4].width }]}>{fmtHours(r.budgetHours)}</Text>
                            <Text style={[styles.focusCell, { width: FOCUS_COLS[5].width }]}>{fmtHours(r.actualHours)}</Text>
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
}

// ── Completion gauge (135° başlangıç, 270° süpürme) — web Gauge birebir ──
function Gauge({ percent }: { percent: number }) {
    const size = 200, cx = size / 2, cy = size / 2, r = 74, thick = 20;
    const fillColor = percent >= 80 ? '#22c55e' : percent >= 50 ? '#f59e0b' : '#ef4444';

    const polar = (deg: number) => {
        const rad = (deg * Math.PI) / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    };
    const arc = (startDeg: number, sweep: number) => {
        const s = polar(startDeg), e = polar(startDeg + sweep);
        const large = sweep > 180 ? 1 : 0;
        return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y}`;
    };

    return (
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <Path d={arc(135, 270)} fill="none" stroke="#e4e8f0" strokeWidth={thick} strokeLinecap="round" />
            {percent > 0 && (
                <Path d={arc(135, (270 * percent) / 100)} fill="none" stroke={fillColor} strokeWidth={thick} strokeLinecap="round" />
            )}
            <SvgText x={cx} y={cy - 2} textAnchor="middle" fontSize={34} fontWeight="bold" fill="#1e2433">
                {`${percent}%`}
            </SvgText>
            <SvgText x={cx} y={cy + 22} textAnchor="middle" fontSize={12} fill="#6b7280">
                completion
            </SvgText>
        </Svg>
    );
}

// ── Workload bar chart (4 hafta) — web WorkloadChart birebir ──
function WorkloadChart({ values, labels }: { values: number[]; labels: string[] }) {
    const n = values.length;
    const max = Math.max(1, ...values);
    const W = 360, H = 180, padL = 14, padR = 14, padT = 10, padB = 28;
    const areaW = W - padL - padR, areaH = H - padT - padB;
    const barW = Math.max(6, (areaW - (n - 1) * 8) / n);
    const gap = n > 1 ? (areaW - barW * n) / (n - 1) : 0;

    const fmtVal = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k h` : `${v.toFixed(0)} h`);

    return (
        <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            {values.map((v, i) => {
                const bx = padL + i * (barW + gap);
                const barH = (v / max) * areaH;
                const by = padT + areaH - barH;
                const col = i === n - 1 ? '#3b82f6' : '#6366f1';
                const labelAbove = by - 6;
                const above = labelAbove > padT + 6;
                return (
                    <G key={i}>
                        <Rect x={bx} y={padT} width={barW} height={areaH} fill="#ebedfa" />
                        {barH > 1 && <Rect x={bx} y={by} width={barW} height={barH} fill={col} />}
                        {v > 0 && (
                            <SvgText
                                x={bx + barW / 2} y={above ? labelAbove : by + 12}
                                textAnchor="middle" fontSize={10} fontWeight="bold"
                                fill={above ? col : '#fff'}
                            >
                                {fmtVal(v)}
                            </SvgText>
                        )}
                        <SvgText x={bx + barW / 2} y={padT + areaH + 16} textAnchor="middle" fontSize={10} fill="#676879">
                            {labels[i] ?? ''}
                        </SvgText>
                    </G>
                );
            })}
        </Svg>
    );
}

// Renkler web Dashboard.css / masaüstü paleti birebir:
// zemin #f0f2f7, kart beyaz + #d7dce8 çerçeve, başlık #111827, muted #6b7280
const styles = StyleSheet.create({
    dash: { flex: 1, backgroundColor: '#f0f2f7' },
    dashContent: { padding: 8, paddingBottom: 24 },
    header: { paddingHorizontal: 8, paddingTop: 8, paddingBottom: 12 },
    h1: { fontSize: 20, fontWeight: '700', color: '#111827' },
    sub: { fontSize: 12, color: '#6b7280', marginTop: 2 },
    date: { fontSize: 12, color: '#6b7280', marginTop: 4 },
    error: { color: '#b91c1c', paddingHorizontal: 8, marginBottom: 6 },

    kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
    kpiCard: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderLeftWidth: 5, borderRadius: 2,
        paddingHorizontal: 12, paddingVertical: 10,
        flexGrow: 1, flexBasis: '45%', minHeight: 84,
    },
    kpiTitle: { fontSize: 10, color: '#6b7280' },
    kpiValue: { fontSize: 26, fontWeight: '700', color: '#111827', marginTop: 4 },
    kpiIcon: { position: 'absolute', right: 10, top: 16, fontSize: 22, opacity: 0.35 },

    card: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderRadius: 2, marginBottom: 10,
    },
    cardHead: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748', flexShrink: 1 },
    cardHint: { fontSize: 10, fontStyle: 'italic', color: '#8c94a2', marginLeft: 8, flexShrink: 1 },
    cardBody: { padding: 8 },
    gaugeBody: { alignItems: 'center' },
    empty: { fontSize: 12, color: '#9ca3af', padding: 8 },

    projRow: {
        flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6,
        borderLeftWidth: 3, borderLeftColor: 'transparent',
    },
    projDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4, marginRight: 8 },
    projMain: { flex: 1 },
    projName: { fontSize: 13, fontWeight: '700', color: '#1e2433', marginBottom: 2 },
    projLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
    projMuted: { fontSize: 11, color: '#6b7280' },
    projPct: { fontSize: 11, fontWeight: '700' },
    barTrack: { height: 8, backgroundColor: '#e4e8f0', borderRadius: 4, marginTop: 3, overflow: 'hidden' },
    barFill: { height: 8, borderRadius: 4 },

    focusSection: { marginBottom: 10 },
    focusLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6 },
    focusHeadRow: {
        flexDirection: 'row', backgroundColor: '#f0f2f7',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    focusHeadCell: {
        fontSize: 11, fontWeight: '700', color: '#2d3748',
        paddingVertical: 5, paddingHorizontal: 4,
    },
    focusRow: {
        flexDirection: 'row',
        borderBottomWidth: 1, borderBottomColor: '#eef0f6',
    },
    focusCell: { fontSize: 11, color: '#374151', paddingVertical: 5, paddingHorizontal: 4 },
    focusNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 6 },
});

export default DashboardScreen;
