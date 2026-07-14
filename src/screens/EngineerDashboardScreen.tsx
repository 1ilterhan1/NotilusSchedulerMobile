// Web pages/EngineerDashboard.tsx birebir (masaüstü ucEngineerDashboard klonu).
// Status == "Engineer" olan kullanıcının kişisel dashboard'u.
// GET /api/engineerdashboard (mevcut API, EngineerDashboardController).
//
// İçerik masaüstü/web ile birebir:
//   - 5 KPI (Today's/This Week compliance renklerine göre boyanır)
//   - Hour Compliance — Last 30 Working Days (eksik günler, yarım gün ½)
//   - My Active Assignments (durum şeridi + ilerleme çubuğu)
//   - This Week — Daily Hours (7 bar, kesikli hedef çizgisi, bugün mavi
//     çerçeve, çalışılmayan günler soluk)
//   - Project Time Distribution — Last 30 Days (yığılmış bar + lejant)
// Mobil uyarlama: iki kolon yerine tek kolon dikey akış (sol kolon önce).

import { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import { apiGet } from '../api';

// ── Palet (masaüstü proje tasarım sistemi birebir) ──
const C = {
    green: '#037f4c',
    red: '#e2445c',
    redBg: '#fff0f3',
    orange: '#f59e0b',
    blue: '#0073ea',
    purple: '#8b5cf6',
    teal: '#06b6d4',
    indigo: '#6366f1',
    pink: '#ec4899',
    muted: '#676879',
    text: '#323338',
    navy: '#1f3a6e',
    track: '#ebedf3',
    altRow: '#fafbff',
    weekendBar: '#a0aac3',
};

// KPI meta: (Başlık, varsayılan accent) — masaüstü KPI_META birebir
const KPI_META = [
    { title: "TODAY'S HOURS", accent: C.blue },     // compliance'a göre yeniden boyanır
    { title: 'THIS WEEK', accent: C.indigo },
    { title: 'ACTIVE WORKS', accent: C.teal },
    { title: 'HOURS THIS MONTH', accent: C.purple },
    { title: 'REJECTED AFFORDS', accent: C.red },
];

// Proje dağılımı paleti (masaüstü sırasıyla aynı)
const DIST_PALETTE = [C.blue, C.green, C.orange, C.purple, C.teal, C.indigo, C.pink, C.red];

interface MissingDay { date: string; logged: number; target: number; isHalfDay: boolean; }
interface ProjectDist { name: string; hours: number; }
interface AssignmentRow {
    workName: string; projectName: string; status: string; deadline: string | null;
    loggedHours: number; estHours: number; percent: number;
}
interface EngineerDashboardData {
    dailyTargetHours: number;
    todayHours: number;
    weekHours: number;
    monthHours: number;
    activeWorks: number;
    rejectedCount: number;
    dailyWeek: number[];
    weekLabels: string[];
    weekExpected: number[];
    weekMonday: string;
    missingDays: MissingDay[];
    projectDist: ProjectDist[];
    assignments: AssignmentRow[];
}

// "0.#" formatı birebir (8.5 → "8.5", 8.0 → "8")
function fmt(v: number): string {
    return String(Math.round(v * 10) / 10);
}

// "ddd, MMM dd" (en-US) — masaüstü eksik gün satırı formatı
function fmtDayLong(iso: string): string {
    const d = new Date(iso + 'T00:00:00');
    const wd = d.toLocaleString('en-US', { weekday: 'short' });
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return `${wd}, ${mon} ${String(d.getDate()).padStart(2, '0')}`;
}

// "MMM dd" — atama deadline formatı
function fmtDue(iso: string): string {
    const d = new Date(iso);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return `${mon} ${String(d.getDate()).padStart(2, '0')}`;
}

// Masaüstü ColorForDaily / ColorForWeekly birebir
function colorForTarget(hours: number, target: number): string {
    if (hours >= target) return C.green;
    if (hours >= target * 0.6) return C.orange;
    return C.red;
}

function EngineerDashboardScreen() {
    const [data, setData] = useState<EngineerDashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        apiGet<EngineerDashboardData>('/api/engineerdashboard')
            .then((d) => { if (!cancelled) setData(d); })
            .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Unknown error'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const target = data?.dailyTargetHours ?? 8.5;
    const weeklyTarget = target * 5;

    // ── KPI değerleri + renkleri (masaüstü SetKpi çağrıları birebir) ──
    const kpis: { value: string; sub: string; color: string | null }[] = data ? [
        { value: fmt(data.todayHours), sub: `/ ${fmt(target)} h today`, color: colorForTarget(data.todayHours, target) },
        { value: fmt(data.weekHours), sub: `/ ${fmt(weeklyTarget)} h this week`, color: colorForTarget(data.weekHours, weeklyTarget) },
        { value: String(data.activeWorks), sub: data.activeWorks === 1 ? 'assignment open' : 'assignments open', color: null },
        { value: fmt(data.monthHours), sub: 'hours logged this month', color: null },
        { value: String(data.rejectedCount), sub: data.rejectedCount > 0 ? 'need re-submission' : 'all clear', color: null },
    ] : KPI_META.map(() => ({ value: '—', sub: '', color: null }));

    // ── Hour compliance özeti (masaüstü _lblMissingSummary birebir) ──
    const missing = data?.missingDays ?? [];
    const totalMissing = missing.reduce((s, m) => s + Math.max(0, m.target - m.logged), 0);
    const summaryOk = missing.length === 0;
    const summaryText = summaryOk
        ? '✔  On track — all recent days meet target'
        : `⚠  ${missing.length} day(s) under target  •  ${fmt(totalMissing)} h missing`;

    return (
        <ScrollView style={styles.dash} contentContainerStyle={styles.dashContent}>
            {/* Header */}
            <View style={styles.header}>
                <Text style={styles.h1}>Dashboard</Text>
                <Text style={styles.sub}>
                    {loading ? 'Loading your dashboard data…'
                        : error ? 'Could not load dashboard data.'
                        : 'Your personal workload snapshot — track daily hours, assignments and project time'}
                </Text>
                <Text style={styles.date}>{dateStr}</Text>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}
            {loading && <ActivityIndicator style={{ marginVertical: 20 }} color="#2563eb" />}

            {/* KPI satırı (5 kart, sol accent bar + değer + alt yazı) */}
            <View style={styles.kpiRow}>
                {KPI_META.map((m, i) => (
                    <View key={i} style={[styles.kpiCard, { borderLeftColor: kpis[i].color ?? m.accent }]}>
                        <Text style={styles.kpiTitle}>{m.title}</Text>
                        <Text style={[styles.kpiValue, kpis[i].color ? { color: kpis[i].color! } : null]}>
                            {kpis[i].value}
                        </Text>
                        <Text style={styles.kpiSub}>{kpis[i].sub}</Text>
                    </View>
                ))}
            </View>

            {/* Hour Compliance — Last 30 Working Days */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Hour Compliance  —  Last 30 Working Days</Text>
                </View>
                {data && (
                    <Text style={[styles.missingSummary, { color: summaryOk ? C.green : C.red }]}>
                        {summaryText}
                    </Text>
                )}
                <View style={styles.cardBody}>
                    {missing.length === 0 ? (
                        <View style={styles.complianceEmpty}>
                            <Text style={{ color: C.green, fontWeight: '700', fontSize: 13 }}>
                                All logged days in the scan window meet the {fmt(target)} h target.
                            </Text>
                            <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                                Nothing to fix — keep going!
                            </Text>
                        </View>
                    ) : (
                        missing.map((m, i) => (
                            <View key={m.date}
                                style={[styles.missRow, { backgroundColor: i % 2 === 0 ? C.redBg : C.altRow }]}>
                                <View style={styles.missBar} />
                                <Text style={styles.missDate}>
                                    {fmtDayLong(m.date)}{m.isHalfDay ? '  ½' : ''}
                                </Text>
                                <Text style={styles.missLogged}>Logged: {fmt(m.logged)} h</Text>
                                <Text style={styles.missMissing}>
                                    {fmt(Math.max(0, m.target - m.logged))} h missing
                                </Text>
                            </View>
                        ))
                    )}
                </View>
            </View>

            {/* My Active Assignments */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>My Active Assignments</Text>
                </View>
                <View style={styles.cardBody}>
                    {(data?.assignments ?? []).length === 0 ? (
                        <Text style={styles.empty}>No active assignments.</Text>
                    ) : (
                        data!.assignments.map((a, i) => <AssignmentItem key={i} a={a} alt={i % 2 === 1} />)
                    )}
                </View>
            </View>

            {/* This Week — Daily Hours */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>
                        This Week  —  Daily Hours  (target {fmt(target)} h / day)
                    </Text>
                </View>
                <View style={styles.cardBody}>
                    <WeekHoursChart
                        values={data?.dailyWeek ?? [0, 0, 0, 0, 0, 0, 0]}
                        labels={data?.weekLabels ?? ['', '', '', '', '', '', '']}
                        expected={data?.weekExpected ?? [0, 0, 0, 0, 0, 0, 0]}
                        target={target}
                        weekMonday={data?.weekMonday ?? null}
                    />
                </View>
            </View>

            {/* Project Time Distribution */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Project Time Distribution  —  Last 30 Days</Text>
                </View>
                <View style={styles.cardBody}>
                    <ProjectDistPanel data={data?.projectDist ?? []} />
                </View>
            </View>
        </ScrollView>
    );
}

// ── AssignmentListPanel birebir: durum şeridi + ad + alt satır + ilerleme çubuğu ──
function AssignmentItem({ a, alt }: { a: AssignmentRow; alt: boolean }) {
    const statusCol = a.status === 'In Progress' ? C.blue : a.status === 'Pending' ? C.orange : C.muted;
    let name = a.workName ?? '';
    if (name.length > 52) name = name.substring(0, 50) + '…';
    const deadline = a.deadline ? `  •  Due ${fmtDue(a.deadline)}` : '';
    const pct = Math.max(0, Math.min(100, a.percent));
    const fill = pct >= 80 ? C.green : pct >= 50 ? C.orange : C.red;
    const hrs = a.estHours > 0
        ? `${fmt(a.loggedHours)} / ${fmt(a.estHours)} h`
        : `${fmt(a.loggedHours)} h`;

    return (
        <View style={[styles.asgRow, alt && { backgroundColor: C.altRow }]}>
            <View style={[styles.asgStripe, { backgroundColor: statusCol }]} />
            <View style={styles.asgMain}>
                <Text style={styles.asgName}>{name}</Text>
                <Text style={styles.asgSub}>{a.projectName}  •  {a.status}{deadline}</Text>
                <View style={styles.asgProgress}>
                    <View style={styles.asgTrack}>
                        {pct > 0 && <View style={[styles.asgFill, { width: `${pct}%`, backgroundColor: fill }]} />}
                    </View>
                    <Text style={styles.asgHrs}>{hrs}</Text>
                    <Text style={[styles.asgPct, { color: fill }]}>{pct}%</Text>
                </View>
            </View>
        </View>
    );
}

// ── WeekHoursChart birebir: 7 bar (Pzt..Paz) + kesikli hedef çizgisi ──
//  Bugün mavi çerçeveli; çalışılmayan günler (hafta sonu / tam tatil) soluk.
function WeekHoursChart({ values, labels, expected, target, weekMonday }: {
    values: number[]; labels: string[]; expected: number[]; target: number;
    weekMonday: string | null;
}) {
    const W = 520, H = 240;
    const PAD_L = 40, PAD_R = 14, PAD_T = 16, PAD_B = 36;
    const areaW = W - PAD_L - PAD_R;
    const areaH = H - PAD_T - PAD_B;

    const maxVal = Math.max(target * 1.2, ...values, 1);
    const n = values.length;
    const barW = Math.max(12, (areaW - (n - 1) * 12) / n);
    const gap = n > 1 ? (areaW - barW * n) / (n - 1) : 0;

    // Bugünün hafta içi indexi (Pzt=0)
    let todayIdx = -1;
    if (weekMonday) {
        const mon = new Date(weekMonday + 'T00:00:00');
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const diff = Math.round((today.getTime() - mon.getTime()) / 86400000);
        if (diff >= 0 && diff < 7) todayIdx = diff;
    }

    const yFor = (v: number) => PAD_T + areaH - (v / maxVal) * areaH;
    const yTarget = yFor(target);
    const ticks = 4;

    return (
        <Svg width="100%" height={240} viewBox={`0 0 ${W} ${H}`}>
            {/* Y ekseni gridleri */}
            {Array.from({ length: ticks + 1 }, (_, t) => {
                const v = (maxVal * t) / ticks;
                const y = yFor(v);
                return (
                    <G key={t}>
                        <Line x1={PAD_L} y1={y} x2={PAD_L + areaW} y2={y} stroke="#f0f2f7" />
                        <SvgText x={PAD_L - 32} y={y + 3} fontSize={9} fill={C.muted}>{`${Math.round(v)}h`}</SvgText>
                    </G>
                );
            })}

            {/* Barlar */}
            {values.map((v, i) => {
                const bx = PAD_L + i * (barW + gap);
                const barH = (v / maxVal) * areaH;
                const by = PAD_T + areaH - barH;
                const dayExpected = expected[i] ?? 0;
                const isWeekend = dayExpected <= 0;      // çalışılmayan gün → soluk
                const isToday = i === todayIdx;
                const hitsTarget = isWeekend || v >= dayExpected - 0.001;
                const barCol = isWeekend ? C.weekendBar : hitsTarget ? C.green : C.orange;
                return (
                    <G key={i}>
                        <Rect x={bx} y={PAD_T} width={barW} height={areaH} fill={C.track} />
                        {barH > 1 && <Rect x={bx} y={by} width={barW} height={barH} fill={barCol} />}
                        {isToday && (
                            <Rect x={bx - 1} y={PAD_T - 1} width={barW + 2} height={areaH + 2}
                                fill="none" stroke={C.blue} strokeWidth={2} />
                        )}
                        {v > 0 && (
                            <SvgText x={bx + barW / 2} y={Math.max(PAD_T + 8, by - 4)}
                                textAnchor="middle" fontSize={10} fontWeight="bold" fill={barCol}>
                                {fmt(v)}
                            </SvgText>
                        )}
                        <SvgText x={bx + barW / 2} y={PAD_T + areaH + 16} textAnchor="middle"
                            fontSize={10}
                            fill={isToday ? C.blue : C.text}
                            fontWeight={isToday ? 'bold' : 'normal'}>
                            {labels[i] ?? ''}
                        </SvgText>
                    </G>
                );
            })}

            {/* Hedef çizgisi (kesikli kırmızı) */}
            <Line x1={PAD_L} y1={yTarget} x2={PAD_L + areaW} y2={yTarget}
                stroke={C.red} strokeWidth={1.5} strokeDasharray="5 4" />
            <SvgText x={PAD_L + areaW - 70} y={yTarget - 5} fontSize={10} fill={C.red}>
                {`Target ${fmt(target)}h`}
            </SvgText>

            {/* Taban çizgisi */}
            <Line x1={PAD_L} y1={PAD_T + areaH} x2={PAD_L + areaW} y2={PAD_T + areaH} stroke="#d7dce8" />
        </Svg>
    );
}

// ── ProjectDistPanel birebir: yatay yığılmış bar + toplam + lejant listesi ──
function ProjectDistPanel({ data }: { data: ProjectDist[] }) {
    if (data.length === 0) {
        return <Text style={[styles.empty, { fontWeight: '700' }]}>No work hours logged in the last 30 days.</Text>;
    }
    const total = Math.max(data.reduce((s, x) => s + x.hours, 0), 1e-9);
    return (
        <View>
            <View style={styles.distBar}>
                {data.map((p, i) => {
                    const w = (p.hours / total) * 100;
                    if (w < 0.2) return null;
                    return (
                        <View key={i}
                            style={{ width: `${w}%`, backgroundColor: DIST_PALETTE[i % DIST_PALETTE.length] }} />
                    );
                })}
            </View>
            <Text style={styles.distTotal}>Total: {fmt(total)} h</Text>
            <View>
                {data.map((p, i) => {
                    const name = p.name.length > 34 ? p.name.substring(0, 32) + '…' : p.name;
                    const pct = Math.round((p.hours / total) * 100);
                    return (
                        <View key={i} style={[styles.distRow, i % 2 === 1 && { backgroundColor: C.altRow }]}>
                            <View style={[styles.distDot, { backgroundColor: DIST_PALETTE[i % DIST_PALETTE.length] }]} />
                            <Text style={styles.distName} numberOfLines={1}>{name}</Text>
                            <Text style={styles.distHrs}>{fmt(p.hours)} h</Text>
                            <Text style={styles.distPct}>{pct}%</Text>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// Renkler web EngineerDashboard.css / masaüstü paleti birebir
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
    kpiSub: { fontSize: 10, color: C.muted, marginTop: 2 },

    card: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderRadius: 2, marginBottom: 10,
    },
    cardHead: {
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    missingSummary: {
        fontSize: 11, fontWeight: '700',
        paddingHorizontal: 10, paddingTop: 6,
    },
    cardBody: { padding: 8 },
    empty: { fontSize: 12, color: '#9ca3af', padding: 8 },

    complianceEmpty: { padding: 8 },
    missRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 6, paddingHorizontal: 6, marginBottom: 2,
    },
    missBar: { width: 3, alignSelf: 'stretch', backgroundColor: C.red, marginRight: 8 },
    missDate: { flex: 1.2, fontSize: 11, fontWeight: '600', color: C.text },
    missLogged: { flex: 1, fontSize: 11, color: C.muted },
    missMissing: { fontSize: 11, fontWeight: '700', color: C.red },

    asgRow: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 2 },
    asgStripe: { width: 3, alignSelf: 'stretch', marginRight: 8, borderRadius: 1 },
    asgMain: { flex: 1 },
    asgName: { fontSize: 12, fontWeight: '700', color: C.text },
    asgSub: { fontSize: 11, color: C.muted, marginTop: 1 },
    asgProgress: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
    asgTrack: {
        flex: 1, height: 7, backgroundColor: C.track, borderRadius: 4, overflow: 'hidden',
        marginRight: 8,
    },
    asgFill: { height: 7, borderRadius: 4 },
    asgHrs: { fontSize: 10, color: C.muted, marginRight: 8 },
    asgPct: { fontSize: 10, fontWeight: '700', width: 34, textAlign: 'right' },

    distBar: {
        flexDirection: 'row', height: 18, borderRadius: 4, overflow: 'hidden',
        backgroundColor: C.track, marginBottom: 6,
    },
    distTotal: { fontSize: 11, fontWeight: '700', color: C.navy, marginBottom: 6 },
    distRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 5, paddingHorizontal: 4,
    },
    distDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
    distName: { flex: 1, fontSize: 11, color: C.text },
    distHrs: { fontSize: 11, color: C.muted, marginRight: 10 },
    distPct: { fontSize: 11, fontWeight: '700', color: C.text, width: 36, textAlign: 'right' },
});

export default EngineerDashboardScreen;
