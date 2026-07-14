// Web pages/ReportByDate.tsx birebir (masaüstü ucReportByDate klonu).
// Mevcut API: GET /api/reportbydate/data?start=&end=
//
// Birebir korunanlar:
// - Açılışta veri YÜKLENMEZ (masaüstü Load'da updateChart çağrılmaz): KPI "—",
//   grafik ve tablo boş
// - From/To tarihleri (varsayılan: bugün-30 / bugün); start > end → "Check dates!"
//   ve grafik yenilenmez (değer picker'da kalır)
// - Last Week / Last Month / Last Year presetleri (setDateTimes birebir)
// - Tek KPI: Total Work Hours (mavi şerit)
// - Work Distribution by Project pasta grafiği (aynı palet, legend), tek proje
//   → tam daire; Project Breakdown tablosu (Project/Hours/Percentage)
// - Copy Table: her satır "hücre\t" + CRLF, boş tabloda boş metin; "Table copied!"
// Mobil uyarlama: tarih seçimi takvim modalı; alert yerine Alert.alert;
// pano için expo-clipboard.

import { useState } from 'react';
import {
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { apiGet } from '../api';
import type { RbdData } from '../types';

function todayInput(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysInput(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function isoOf(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ReportByDateScreen() {
    // Masaüstü varsayılanları: dateTimePicker1 = bugün - 30, dateTimePicker2 = bugün
    const [startDate, setStartDate] = useState<string>(addDaysInput(-30));
    const [endDate, setEndDate] = useState<string>(todayInput());

    const [data, setData] = useState<RbdData | null>(null);
    const [loading, setLoading] = useState(false);
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);

    // ── updateChart karşılığı ──
    async function fetchData(startArg: string, endArg: string) {
        setLoading(true);
        try {
            const qs = `start=${startArg}&end=${endArg}`;
            const d = await apiGet<RbdData>(`/api/reportbydate/data?${qs}`);
            setData(d);
        } finally {
            setLoading(false);
        }
    }

    // ── dateTimePicker1_ValueChanged birebir ──
    function onStart(v: string) {
        setStartDate(v);
        if (v > endDate) { Alert.alert('', 'Check dates!'); return; }
        fetchData(v, endDate);
    }

    // ── dateTimePicker2_ValueChanged birebir ──
    function onEnd(v: string) {
        setEndDate(v);
        if (startDate > v) { Alert.alert('', 'Check dates!'); return; }
        fetchData(startDate, v);
    }

    // ── setDateTimes birebir ──
    function preset(dayValue: number) {
        const s = addDaysInput(dayValue);
        const e = todayInput();
        setStartDate(s);
        setEndDate(e);
        fetchData(s, e);
    }

    // ── btnCopyTable_Click birebir ──
    async function copyTable() {
        const rows = data?.projects ?? [];
        const text = rows
            .map(p => [p.project, String(p.hours), p.percentage].join('\t') + '\t')
            .join('\r\n') + '\r\n';
        await Clipboard.setStringAsync(rows.length === 0 ? '' : text);
        Alert.alert('', 'Table copied!');
    }

    // KPI: masaüstü açılış değeri "—"
    const kpiValue = data ? String(data.totalWorkHours) : '—';
    const hasChartData = !!data && data.chartValues.some(v => v > 0);

    return (
        <ScrollView style={styles.rbd} contentContainerStyle={styles.rbdContent}>
            {/* Header (BuildHeader: koyu zemin, "Reports — Date") */}
            <View style={styles.header}><Text style={styles.headerText}>Reports — Date</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.section}>Date Report</Text>
                <Text style={styles.loadingLbl}>{loading ? 'Loading…' : ''}</Text>
                <TouchableOpacity style={styles.btn} onPress={copyTable}>
                    <Text style={styles.btnText}>Copy Table</Text>
                </TouchableOpacity>
            </View>

            {/* Filter bar */}
            <View style={styles.filter}>
                <Text style={styles.flabel}>From:</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('start')}>
                    <Text style={styles.dateBtnText}>{startDate}</Text>
                </TouchableOpacity>
                <Text style={styles.flabel}>To:</Text>
                <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('end')}>
                    <Text style={styles.dateBtnText}>{endDate}</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.presets}>
                <TouchableOpacity style={styles.preset} onPress={() => preset(-7)}><Text style={styles.presetText}>Last Week</Text></TouchableOpacity>
                <TouchableOpacity style={styles.preset} onPress={() => preset(-30)}><Text style={styles.presetText}>Last Month</Text></TouchableOpacity>
                <TouchableOpacity style={styles.preset} onPress={() => preset(-365)}><Text style={styles.presetText}>Last Year</Text></TouchableOpacity>
            </View>

            {/* KPI strip */}
            <View style={styles.kpis}>
                <View style={[styles.kpi, { borderLeftColor: '#0073ea' }]}>
                    <Text style={styles.kpiVal}>{kpiValue}</Text>
                    <Text style={styles.kpiTitle}>Total Work Hours</Text>
                </View>
            </View>

            {/* Pasta grafik kartı */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Work Distribution by Project</Text>
                <View style={styles.chartBody}>
                    {loading ? (
                        <Text style={styles.chartLoading}>Loading…</Text>
                    ) : hasChartData ? (
                        <PieChart labels={data!.chartLabels} values={data!.chartValues} />
                    ) : (
                        <View style={styles.chartBlank} />
                    )}
                </View>
            </View>

            {/* Proje kırılım kartı */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Project Breakdown</Text>
                <View style={styles.tableWrap}>
                    <View style={styles.tHeadRow}>
                        <Text style={[styles.tHeadCell, { flex: 2 }]}>Project</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Hours</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Percentage</Text>
                    </View>
                    {!data || data.projects.length === 0 ? (
                        <Text style={styles.tEmpty}>No data</Text>
                    ) : data.projects.map((p, i) => (
                        <View key={i} style={styles.tRow}>
                            <Text style={[styles.tCell, { flex: 2 }]} numberOfLines={1}>{p.project}</Text>
                            <Text style={[styles.tCell, { flex: 1 }]}>{String(p.hours)}</Text>
                            <Text style={[styles.tCell, { flex: 1 }]}>{p.percentage}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {/* Tarih seçici modalı */}
            <Modal visible={datePick != null} transparent animationType="fade"
                onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker
                            initial={datePick === 'start' ? startDate : endDate}
                            onPick={(d) => {
                                const t = datePick;
                                setDatePick(null);
                                if (t === 'start') onStart(d); else onEnd(d);
                            }}
                        />
                    </View>
                </TouchableOpacity>
            </Modal>
        </ScrollView>
    );
}

// ── Pasta grafik — masaüstü chTotalWork / web PieChart birebir ──
const PIE_PALETTE = ['#0073ea', '#037f4c', '#ff8c00', '#6473f0', '#00c3aa', '#dc3912', '#dc143c', '#0099cc'];

function PieChart({ labels, values }: { labels: string[]; values: number[] }) {
    const total = values.reduce((s, v) => s + v, 0);
    const active: { label: string; value: number; color: string }[] = [];
    let ci = 0;
    for (let i = 0; i < Math.min(labels.length, values.length); i++) {
        if (values[i] > 0) {
            active.push({ label: labels[i], value: values[i], color: PIE_PALETTE[ci % PIE_PALETTE.length] });
            ci++;
        }
    }
    if (total === 0 || active.length === 0) {
        return <View style={styles.chartBlank} />;
    }

    const size = 220, r = 96, cx = size / 2, cy = size / 2;

    // Tek dilim (tek proje) — tam daire
    if (active.length === 1) {
        return (
            <View style={styles.pieWrap}>
                <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <Circle cx={cx} cy={cy} r={r} fill={active[0].color} />
                </Svg>
                <View style={styles.pieLegend}>
                    <View style={styles.legendRow}>
                        <View style={[styles.sw, { backgroundColor: active[0].color }]} />
                        <Text style={styles.legendTxt} numberOfLines={1}>{active[0].label}</Text>
                    </View>
                </View>
            </View>
        );
    }

    let angle = -90;
    const segs = active.map((a) => {
        const sweep = (a.value / total) * 360;
        const s = polar(cx, cy, r, angle);
        const e = polar(cx, cy, r, angle + sweep);
        const large = sweep > 180 ? 1 : 0;
        const path = `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
        angle += sweep;
        return { path, color: a.color };
    });

    return (
        <View style={styles.pieWrap}>
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {segs.map((s, i) => <Path key={i} d={s.path} fill={s.color} />)}
            </Svg>
            <View style={styles.pieLegend}>
                {active.map((a, i) => (
                    <View style={styles.legendRow} key={i}>
                        <View style={[styles.sw, { backgroundColor: a.color }]} />
                        <Text style={styles.legendTxt} numberOfLines={1}>{a.label}</Text>
                    </View>
                ))}
            </View>
        </View>
    );
}
function polar(cx: number, cy: number, r: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
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

// Renkler web ReportByDate.css / masaüstü birebir (header koyu, kpi mavi şerit)
const styles = StyleSheet.create({
    rbd: { flex: 1, backgroundColor: '#f0f2f7' },
    rbdContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    section: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    loadingLbl: { fontSize: 11, color: '#6b7280' },
    btn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 6 },
    btnText: { fontSize: 11, color: '#374151', fontWeight: '600' },

    filter: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingTop: 8, gap: 6, flexWrap: 'wrap' },
    flabel: { fontSize: 12, color: '#374151' },
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
    dateBtnText: { fontSize: 12, color: '#111827' },
    presets: { flexDirection: 'row', paddingHorizontal: 10, paddingTop: 6, gap: 8 },
    preset: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 5 },
    presetText: { fontSize: 11, color: '#374151' },

    kpis: { paddingHorizontal: 10, paddingTop: 10 },
    kpi: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderLeftWidth: 4, borderRadius: 2, padding: 12, width: 220,
    },
    kpiVal: { fontSize: 24, fontWeight: '700', color: '#111827' },
    kpiTitle: { fontSize: 11, color: '#6b7280', marginTop: 2 },

    card: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderRadius: 2, marginHorizontal: 10, marginTop: 10,
    },
    cardTitle: {
        fontSize: 13, fontWeight: '700', color: '#2d3748',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    chartBody: { padding: 10, alignItems: 'center', minHeight: 120 },
    chartLoading: { fontSize: 13, color: '#6b7280', paddingVertical: 40 },
    chartBlank: { minHeight: 100 },

    pieWrap: { alignItems: 'center' },
    pieLegend: { marginTop: 10, alignSelf: 'stretch' },
    legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    sw: { width: 12, height: 12, borderRadius: 2, marginRight: 8 },
    legendTxt: { fontSize: 12, color: '#374151', flex: 1 },

    tableWrap: { padding: 8 },
    tHeadRow: { flexDirection: 'row', backgroundColor: '#f0f2f7', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    tHeadCell: { fontSize: 11, fontWeight: '700', color: '#2d3748', paddingVertical: 5, paddingHorizontal: 4 },
    tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    tCell: { fontSize: 11, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    tEmpty: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 16, width: '100%' },
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

export default ReportByDateScreen;
