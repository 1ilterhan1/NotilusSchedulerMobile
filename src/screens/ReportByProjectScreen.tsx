// Web pages/ReportByProject.tsx birebir (masaüstü ucReportByProject klonu).
// Mevcut API: /api/reportbyproject/{init,data,work,details,export}
//
// Birebir korunanlar:
// - Açılış: initialProjectId aktif listede yoksa Completed listesi denenir
//   (Dashboard'dan çift tıkla gelme akışı); metric init'ten (Days/Hours)
// - Proje seçimi + Completed; From/To ("Check dates!") + Last Week/Month/Year;
//   proje değişince start otomatik (en eski kayıt)
// - Metric değişince rapor + seçili iş yeniden yüklenir
// - Works Overview: satır tıklaması → iş kırılımı (bar+donut+breakdown);
//   Project Overview checkbox'ı ile genel görünüme dönüş; View → Details
// - Efficiency/Status renkleri (DgvWorks_CellFormatting birebir: ≥100 yeşil,
//   <80 kırmızı; Completed yeşil, In Progress turuncu)
// - 4 KPI kart (Efficiency/Total metric/Works/Completed, aynı accent'ler)
// - Performance (Estimated mavi / Actual yeşil yatay bar), User Distribution
//   (donut + toplam + lejant %), User Breakdown tablosu
// - Copy (sekmeli metin, "Table copied to clipboard!") ve Export Excel
//   (csExcelHandler.CreateProjectReport birebir: başlık satırı, kolonlar,
//   Revision ayrımı, Revision Total + Grand Total, dosya adı) — xlsx +
//   paylaşım sayfası
// Mobil uyarlama: tek kolon; select → modal liste; tarih → takvim modalı;
// alert → Alert.alert; pano → expo-clipboard.

import { useEffect, useRef, useState } from 'react';
import {
    Alert,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { apiGet } from '../api';
import type {
    RpBarItem, RpDetails, RpExport, RpInit, RpReportData, RpWorkBreakdown,
} from '../types';

function todayInput(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysInput(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDetailDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return `${day} ${mon} ${d.getFullYear()}`;
}

async function saveAndShareXlsx(wb: XLSX.WorkBook, fname: string) {
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const uri = `${FileSystem.cacheDirectory}${fname}`;
    await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dialogTitle: fname,
        });
    }
}

interface Props { initialProjectId?: number | null; }

function ReportByProjectScreen({ initialProjectId = null }: Props) {
    const [projects, setProjects] = useState<RpInit['projects']>([]);
    const [completed, setCompleted] = useState(false);
    const [metric, setMetric] = useState<'Days' | 'Hours'>('Days');
    const [projectId, setProjectId] = useState<number | null>(null);

    const [data, setData] = useState<RpReportData | null>(null);
    const [selWork, setSelWork] = useState<RpWorkBreakdown | null>(null);
    const [selWorkId, setSelWorkId] = useState<number | null>(null);

    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>(todayInput());
    const [firstEntry, setFirstEntry] = useState<string>('—');
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);

    const [details, setDetails] = useState<RpDetails | null>(null);
    const [projPickerOpen, setProjPickerOpen] = useState(false);
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);
    const bootRef = useRef(false);

    // ── Açılış: init (proje listesi + metric) ──
    useEffect(() => {
        if (bootRef.current) return;
        bootRef.current = true;
        (async () => {
            try {
                let comp = false;
                let init = await apiGet<RpInit>('/api/reportbyproject/init?completed=false');
                if (initialProjectId != null && !init.projects.some(p => p.id === initialProjectId)) {
                    const compInit = await apiGet<RpInit>('/api/reportbyproject/init?completed=true');
                    if (compInit.projects.some(p => p.id === initialProjectId)) { init = compInit; comp = true; }
                }
                setCompleted(comp);
                setProjects(init.projects);
                const m = (init.metric === 'Hours' ? 'Hours' : 'Days') as 'Days' | 'Hours';
                setMetric(m);
                const pick = (initialProjectId != null && init.projects.some(p => p.id === initialProjectId))
                    ? initialProjectId
                    : (init.projects[0]?.id ?? null);
                setProjectId(pick);
                if (pick != null) await fetchData(pick, m, undefined, todayInput());
            } catch { /* yoksay */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Ana rapor verisi (loadData) ──
    async function fetchData(pid: number, m: string, startArg: string | undefined, endArg: string) {
        setLoading(true);
        setSelWork(null);
        setSelWorkId(null);
        try {
            let qs = `projectId=${pid}&metric=${m}&end=${endArg}`;
            if (startArg) qs += `&start=${startArg}`;
            const d = await apiGet<RpReportData>(`/api/reportbyproject/data?${qs}`);
            setData(d);
            setStartDate(d.startDate);
            setEndDate(d.endDate);
            setFirstEntry(d.firstEntry);
        } finally {
            setLoading(false);
        }
    }

    // ── Satır tıklaması (dgvWorks_CellClick + updateBarChart) ──
    async function fetchWork(workId: number, m = metric) {
        if (projectId == null) return;
        const qs = `projectId=${projectId}&workId=${workId}&metric=${m}&start=${startDate}&end=${endDate}`;
        const w = await apiGet<RpWorkBreakdown>(`/api/reportbyproject/work?${qs}`);
        setSelWork(w);
        setSelWorkId(workId);
    }

    // ── "View" (FormWorkAffordDetails) ──
    async function openDetails(workId: number) {
        if (projectId == null) return;
        const qs = `projectId=${projectId}&workId=${workId}&start=${startDate}&end=${endDate}`;
        const d = await apiGet<RpDetails>(`/api/reportbyproject/details?${qs}`);
        setDetails(d);
    }

    // ── Event handler'lar ──
    function onSelectProject(id: number) {
        setProjectId(id);
        fetchData(id, metric, undefined, endDate);   // start otomatik (en eski)
    }
    async function onToggleCompleted(next: boolean) {
        setCompleted(next);
        try {
            const init = await apiGet<RpInit>(`/api/reportbyproject/init?completed=${next}`);
            setProjects(init.projects);
            const pick = init.projects[0]?.id ?? null;
            setProjectId(pick);
            if (pick != null) await fetchData(pick, metric, undefined, todayInput());
            else { setData(null); setSelWork(null); }
        } catch { /* yoksay */ }
    }
    function onStart(v: string) {
        if (projectId == null) return;
        if (v > endDate) { Alert.alert('', 'Check dates!'); return; }
        setStartDate(v);
        fetchData(projectId, metric, v, endDate);
    }
    function onEnd(v: string) {
        if (projectId == null) return;
        if (startDate && startDate > v) { Alert.alert('', 'Check dates!'); return; }
        setEndDate(v);
        fetchData(projectId, metric, startDate || undefined, v);
    }
    function preset(days: number) {
        if (projectId == null) return;
        const s = addDaysInput(days);
        const e = todayInput();
        fetchData(projectId, metric, s, e);
    }
    async function onMetric(m: 'Days' | 'Hours') {
        if (m === metric || projectId == null) return;
        setMetric(m);
        const wid = selWorkId;
        await fetchData(projectId, m, startDate || undefined, endDate);
        if (wid != null) await fetchWork(wid, m);
    }
    function backToOverview() {
        setSelWork(null);
        setSelWorkId(null);
    }

    // ── Copy (btnCopy_Click birebir) ──
    async function copyTable() {
        if (!data) return;
        const headers = ['Phase', 'Discipline', 'Work', `Estimated (${metric})`, `Actual (${metric})`, 'Efficiency', 'Status'];
        const lines = [headers.join('\t')];
        for (const r of data.rows) {
            lines.push([r.phase, r.discipline, r.work, r.estimated, r.actual, r.efficiency, r.status].join('\t'));
        }
        await Clipboard.setStringAsync(lines.join('\r\n'));
        Alert.alert('', 'Table copied to clipboard!');
    }

    // ── Export Excel (csExcelHandler.CreateProjectReport birebir) ──
    async function exportExcel() {
        if (projectId == null) return;
        setExporting(true);
        try {
            let qs = `projectId=${projectId}&metric=${metric}&end=${endDate}`;
            if (startDate) qs += `&start=${startDate}`;
            const rep = await apiGet<RpExport>(`/api/reportbyproject/export?${qs}`);

            const fmtDec = (v: number) => v.toFixed(2);
            const perc = (r1: number, r2: number) => (r2 ? (100 * r1 / r2).toFixed(2) : '0.00') + '%';

            const aoa: (string | number)[][] = [];
            aoa.push([
                rep.projectName,
                `Date : ${rep.startDate} - ${rep.endDate}`,
                `Metric:${rep.metric}`,
                `First Work Afford Entry Date: ${firstEntry}`,
            ]);
            aoa.push([]);
            aoa.push([
                'Folder', 'Work', 'Employee', 'Estimated', 'Actual in Selected Date',
                'Actual in Selected Date Percentage', 'Actual Cumulative',
                'Actual Cumulative Percentage', 'Variance Cumulative',
                'Percentage of Variance Cumulative',
            ]);

            const appendTable = (
                workTitle: string, folderName: string, estimated: number,
                items: RpExport['groups'][0]['items'],
            ) => {
                const selSum = items.reduce((s, i) => s + i.actualSelectedDate, 0);
                const cumSum = items.reduce((s, i) => s + i.actualCumulative, 0);
                if (items.length === 0) {
                    aoa.push([folderName, workTitle, '', '-', '-', '-', '-', '-', '-', '-']);
                } else {
                    aoa.push([
                        folderName, workTitle, '', fmtDec(estimated), fmtDec(selSum),
                        perc(selSum, estimated), fmtDec(cumSum), perc(cumSum, estimated),
                        fmtDec(estimated - cumSum), perc(estimated - cumSum, estimated),
                    ]);
                }
                for (const it of [...items].sort((a, b) => a.employee.localeCompare(b.employee))) {
                    aoa.push([
                        '', '', it.employee, '', fmtDec(it.actualSelectedDate),
                        it.actualSelectedDatePercentage.toFixed(2) + '%',
                        fmtDec(it.actualCumulative),
                        it.actualCumulativePercentage.toFixed(2) + '%',
                    ]);
                }
            };

            for (const g of rep.groups) {
                const normal = g.items.filter(i => !i.isRevision);
                const rev = g.items.filter(i => i.isRevision);
                appendTable(g.workName, g.folderName, g.estimated, normal);
                if (rev.length > 0) appendTable(`${g.workName} - Revision`, g.folderName, g.estimated, rev);
            }

            const estSum = rep.groups.reduce((s, g) => s + g.estimated, 0);
            const totalRow = (desc: string, onlyRev: boolean) => {
                const src = rep.groups.flatMap(g => g.items.filter(i => onlyRev ? i.isRevision : true));
                const selSum = src.reduce((s, i) => s + i.actualSelectedDate, 0);
                const cumSum = src.reduce((s, i) => s + i.actualCumulative, 0);
                aoa.push([]);
                aoa.push([
                    desc, '', '', fmtDec(estSum), fmtDec(selSum), perc(selSum, estSum),
                    fmtDec(cumSum), perc(cumSum, estSum), fmtDec(estSum - cumSum), perc(estSum - cumSum, estSum),
                ]);
            };
            totalRow('Revision Total', true);
            totalRow('Grand Total', false);

            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'WorksByEmployees');
            const fname = `${rep.projectName}_${rep.startDate}_${rep.endDate}_Metric-${rep.metric}.xlsx`
                .replace(/[\\/:*?"<>|]/g, '_');
            await saveAndShareXlsx(wb, fname);
        } catch (e: any) {
            Alert.alert('', e?.message ?? 'Export failed');
        } finally {
            setExporting(false);
        }
    }

    // ── Görüntülenen grafik/tablo verileri ──
    const bars: RpBarItem[] = selWork ? selWork.bars : (data?.bars ?? []);
    const donutLabels = selWork ? selWork.donutLabels : (data?.donutLabels ?? []);
    const donutValues = selWork ? selWork.donutValues : (data?.donutValues ?? []);
    const breakdown = selWork?.breakdown ?? [];

    const kpi = data?.kpi;
    const kpiCards = [
        { title: 'Efficiency', value: kpi?.efficiency ?? '—', accent: '#0073ea' },
        { title: `Total ${metric}`, value: kpi ? kpi.totalActual : '—', accent: '#1f3a6e' },
        { title: 'Works', value: kpi ? String(kpi.totalWorks) : '—', accent: '#6473f0' },
        { title: 'Completed', value: kpi ? String(kpi.completedWorks) : '—', accent: '#037f4c' },
    ];

    const currentProject = projects.find(p => p.id === projectId);

    return (
        <ScrollView style={styles.rbp} contentContainerStyle={styles.rbpContent}>
            {/* Header */}
            <View style={styles.header}><Text style={styles.headerText}>Reports — Project</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.section}>Project Report</Text>
                <TouchableOpacity style={styles.btn} onPress={copyTable}>
                    <Text style={styles.btnText}>Copy</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnPrimary, exporting && styles.btnDim]} onPress={exportExcel} disabled={exporting}>
                    <Text style={styles.btnPrimaryText}>{exporting ? 'Please Wait…' : 'Export Excel'}</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Metric:</Text>
                <TouchableOpacity style={styles.radio} onPress={() => onMetric('Days')}>
                    <View style={[styles.radioDot, metric === 'Days' && styles.radioDotOn]} />
                    <Text style={styles.radioLbl}>Days</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.radio} onPress={() => onMetric('Hours')}>
                    <View style={[styles.radioDot, metric === 'Hours' && styles.radioDotOn]} />
                    <Text style={styles.radioLbl}>Hours</Text>
                </TouchableOpacity>
                <Text style={styles.loadingLbl}>{loading ? 'Loading…' : ''}</Text>
            </View>

            {/* Filter bar */}
            <View style={styles.filter}>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>Project:</Text>
                    <TouchableOpacity style={[styles.select, loading && styles.btnDim]} disabled={loading}
                        onPress={() => setProjPickerOpen(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{currentProject?.name ?? '—'}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.checkRow} disabled={loading} onPress={() => onToggleCompleted(!completed)}>
                        <View style={[styles.cbBox, completed && styles.cbBoxOn]}>
                            {completed && <Text style={styles.cbTick}>✓</Text>}
                        </View>
                        <Text style={styles.radioLbl}>Completed</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>From:</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('start')}>
                        <Text style={styles.dateBtnText}>{startDate || '—'}</Text>
                    </TouchableOpacity>
                    <Text style={styles.flabel}>To:</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('end')}>
                        <Text style={styles.dateBtnText}>{endDate}</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <TouchableOpacity style={styles.preset} onPress={() => preset(-7)}><Text style={styles.presetText}>Last Week</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.preset} onPress={() => preset(-30)}><Text style={styles.presetText}>Last Month</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.preset} onPress={() => preset(-365)}><Text style={styles.presetText}>Last Year</Text></TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <TouchableOpacity style={styles.checkRow} disabled={selWork == null} onPress={backToOverview}>
                        <View style={[styles.cbBox, selWork == null && styles.cbBoxOn]}>
                            {selWork == null && <Text style={styles.cbTick}>✓</Text>}
                        </View>
                        <Text style={styles.radioLbl}>Project Overview</Text>
                    </TouchableOpacity>
                    <Text style={styles.flabel}>First Entry:</Text>
                    <Text style={styles.fvalue}>{firstEntry}</Text>
                </View>
            </View>

            {/* KPI row */}
            <View style={styles.kpis}>
                {kpiCards.map((c, i) => (
                    <View key={i} style={[styles.kpi, { borderLeftColor: c.accent }]}>
                        <Text style={styles.kpiVal}>{c.value}</Text>
                        <Text style={styles.kpiTitle}>{c.title}</Text>
                    </View>
                ))}
            </View>

            {/* Works Overview */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Works Overview</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            {WORKS_COLS(metric).map((c, i) => (
                                <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                            ))}
                        </View>
                        {!data || data.rows.length === 0 ? (
                            <View style={styles.gridRow}><Text style={styles.gridNone}>No data</Text></View>
                        ) : data.rows.map((r) => (
                            <TouchableOpacity key={r.workId}
                                style={[styles.gridRow, selWorkId === r.workId && styles.rowSel]}
                                onPress={() => fetchWork(r.workId)}>
                                <Text style={[styles.gridCell, { width: 100 }]} numberOfLines={1}>{r.phase}</Text>
                                <Text style={[styles.gridCell, { width: 90 }]} numberOfLines={1}>{r.discipline}</Text>
                                <Text style={[styles.gridCell, { width: 150 }]} numberOfLines={2}>{r.work}</Text>
                                <Text style={[styles.gridCell, { width: 90 }]}>{r.estimated}</Text>
                                <Text style={[styles.gridCell, { width: 80 }]}>{r.actual}</Text>
                                <Text style={[styles.gridCell, { width: 76 }, { color: effColor(r.efficiency) || '#374151' }]}>{r.efficiency}</Text>
                                <Text style={[styles.gridCell, { width: 84 }, { color: statusColor(r.status) }]}>{r.status}</Text>
                                <TouchableOpacity style={{ width: 60 }} onPress={() => openDetails(r.workId)}>
                                    <Text style={styles.viewBtn}>View →</Text>
                                </TouchableOpacity>
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            </View>

            {/* Performance — Estimated vs Actual */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Performance — Estimated vs Actual</Text>
                <View style={styles.cardBody}><BarChart data={bars} /></View>
            </View>

            {/* User Distribution */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>User Distribution</Text>
                <View style={styles.cardBody}><DonutChart labels={donutLabels} values={donutValues} /></View>
            </View>

            {/* User Breakdown */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>User Breakdown</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            {BD_COLS(metric).map((c, i) => (
                                <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                            ))}
                        </View>
                        {breakdown.length === 0 ? (
                            <View style={styles.gridRow}><Text style={styles.gridNone}>Select a work item</Text></View>
                        ) : breakdown.map((b, i) => (
                            <View key={i} style={styles.gridRow}>
                                <Text style={[styles.gridCell, { width: 100 }]} numberOfLines={1}>{b.phase}</Text>
                                <Text style={[styles.gridCell, { width: 90 }]} numberOfLines={1}>{b.discipline}</Text>
                                <Text style={[styles.gridCell, { width: 150 }]} numberOfLines={2}>{b.work}</Text>
                                <Text style={[styles.gridCell, { width: 100 }]} numberOfLines={1}>{b.user}</Text>
                                <Text style={[styles.gridCell, { width: 76 }]}>{b.workingPercent}</Text>
                                <Text style={[styles.gridCell, { width: 110 }]}>{b.duration}</Text>
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </View>

            {/* Proje seçimi */}
            <PickerModal visible={projPickerOpen} items={projects} selectedId={projectId}
                onClose={() => setProjPickerOpen(false)}
                onPick={(id) => { setProjPickerOpen(false); onSelectProject(id); }} />

            {/* Tarih seçici */}
            <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker initial={datePick === 'start' ? (startDate || todayInput()) : endDate}
                            onPick={(d) => {
                                const t = datePick;
                                setDatePick(null);
                                if (t === 'start') onStart(d); else onEnd(d);
                            }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Details popup */}
            {details && <DetailsModal data={details} onClose={() => setDetails(null)} />}
        </ScrollView>
    );
}

const WORKS_COLS = (metric: string) => [
    { label: 'Phase', width: 100 },
    { label: 'Discipline', width: 90 },
    { label: 'Work', width: 150 },
    { label: `Estimated (${metric})`, width: 90 },
    { label: `Actual (${metric})`, width: 80 },
    { label: 'Efficiency', width: 76 },
    { label: 'Status', width: 84 },
    { label: 'Details', width: 60 },
];
const BD_COLS = (metric: string) => [
    { label: 'Phase', width: 100 },
    { label: 'Discipline', width: 90 },
    { label: 'Work', width: 150 },
    { label: 'User', width: 100 },
    { label: 'Working %', width: 76 },
    { label: `Work Duration (${metric})`, width: 110 },
];

// ── Efficiency / Status renkleri (masaüstü DgvWorks_CellFormatting birebir) ──
function effColor(eff: string): string {
    const t = eff.trim();
    if (t === '-' || t === '') return '';
    const n = parseFloat(t.replace('%', ''));
    if (!isNaN(n)) {
        if (n >= 100) return '#037f4c';
        if (n < 80) return '#dc143c';
    }
    return '';
}
function statusColor(status: string): string {
    if (status === 'Completed') return '#037f4c';
    if (status === 'In Progress') return '#ff8c00';
    return '#676879';
}

// ═══ Bar chart — ProjectBarChart birebir (yatay çubuklar) ═══
function BarChart({ data }: { data: RpBarItem[] }) {
    if (!data || data.length === 0) {
        return <Text style={styles.chartEmpty}>Select a work item to see performance details</Text>;
    }
    const maxVal = Math.max(1, ...data.map(d => Math.max(d.estimated, d.actual)));

    return (
        <View>
            <View style={styles.barLegend}>
                <View style={[styles.sw, { backgroundColor: '#0073ea' }]} />
                <Text style={styles.legendLbl}>Estimated</Text>
                <View style={[styles.sw, { backgroundColor: '#037f4c', marginLeft: 16 }]} />
                <Text style={styles.legendLbl}>Actual</Text>
            </View>
            {data.map((d, i) => (
                <View key={i} style={[styles.barRow, i % 2 === 0 && styles.barRowAlt]}>
                    <Text style={styles.barName} numberOfLines={2}>{d.name}</Text>
                    <View style={styles.barTrack}>
                        <View style={styles.barLine}>
                            <View style={[styles.bar, { width: `${(d.estimated / maxVal) * 100}%`, backgroundColor: '#0073ea' }]} />
                            <Text style={styles.barV}>{d.estimated.toFixed(1)}</Text>
                        </View>
                        <View style={styles.barLine}>
                            <View style={[styles.bar, { width: `${(d.actual / maxVal) * 100}%`, backgroundColor: '#037f4c' }]} />
                            <Text style={styles.barV}>{d.actual.toFixed(1)}</Text>
                        </View>
                    </View>
                </View>
            ))}
        </View>
    );
}

// ═══ Donut chart — ProjectDonutChart birebir ═══
const DONUT_PALETTE = ['#0073ea', '#037f4c', '#ff8c00', '#6473f0', '#00c3aa', '#dc3912', '#dc143c', '#0099cc'];

function DonutChart({ labels, values }: { labels: string[]; values: number[] }) {
    const total = values.reduce((s, v) => s + v, 0);
    const active: { label: string; value: number; color: string }[] = [];
    let ci = 0;
    for (let i = 0; i < Math.min(labels.length, values.length); i++) {
        if (values[i] > 0) { active.push({ label: labels[i], value: values[i], color: DONUT_PALETTE[ci % DONUT_PALETTE.length] }); ci++; }
    }
    if (total === 0 || active.length === 0) {
        return <Text style={styles.chartEmpty}>No data available</Text>;
    }

    const size = 120, r = 46, cx = size / 2, cy = size / 2, hole = 30;
    let angle = -90;
    const segs = active.map((a) => {
        const sweep = (a.value / total) * 360;
        const s = polar(cx, cy, r, angle);
        const e = polar(cx, cy, r, angle + sweep);
        const large = sweep > 180 ? 1 : 0;
        // Tek dilim 360° olunca path bozulur; 359.99'a kırp
        const path = `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
        angle += sweep;
        return { path, color: a.color };
    });

    return (
        <View style={styles.donutWrap}>
            <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                {active.length === 1 ? (
                    <Circle cx={cx} cy={cy} r={r} fill={active[0].color} />
                ) : (
                    segs.map((s, i) => <Path key={i} d={s.path} fill={s.color} />)
                )}
                <Circle cx={cx} cy={cy} r={hole} fill="#fff" />
                <SvgText x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight="bold" fill="#1f3a6e">
                    {total.toFixed(1)}
                </SvgText>
            </Svg>
            <View style={styles.donutLegend}>
                {active.map((a, i) => (
                    <View style={styles.legendRow} key={i}>
                        <View style={[styles.sw, { backgroundColor: a.color }]} />
                        <Text style={styles.legendTxt} numberOfLines={1}>{a.label}</Text>
                        <Text style={styles.legendPct}>{Math.round((a.value / total) * 100)}%</Text>
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

// ═══ Details modal — FormWorkAffordDetails birebir ═══
function friendlyStatus(s: string | null): string {
    if (!s) return '—';
    if (/rejected/i.test(s)) return 'Rejected';
    if (/approved/i.test(s)) return 'Approved';
    if (/pending/i.test(s)) return 'Pending';
    return s;
}
function detailStatusColor(s: string | null): string {
    if (!s) return '#676879';
    if (/rejected/i.test(s)) return '#c62828';
    if (/approved/i.test(s)) return '#2e7d32';
    if (/pending/i.test(s)) return '#b07c00';
    return '#676879';
}
function isRejected(s: string | null): boolean {
    return !!s && /rejected/i.test(s);
}

const DETAIL_COLS = [
    { label: 'Details', width: 150 },
    { label: 'Hours', width: 56 },
    { label: 'Date', width: 92 },
    { label: 'Person', width: 100 },
    { label: 'Status', width: 76 },
];

function DetailsModal({ data, onClose }: { data: RpDetails; onClose: () => void }) {
    async function copyTable() {
        const lines = ['Details\tHours\tDate\tPerson\tStatus'];
        for (const it of data.items) {
            lines.push([it.detail ?? '', it.hours.toString(), fmtDetailDate(it.date), it.personName, friendlyStatus(it.status)].join('\t'));
        }
        await Clipboard.setStringAsync(lines.join('\r\n'));
        Alert.alert('', 'Table copied to clipboard.');
    }

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '85%' }]}>
                    <Text style={styles.modalHead}>Work Afford Details</Text>
                    <View style={styles.modalToolbar}>
                        <Text style={styles.modalTtl}>Afford Details</Text>
                        <TouchableOpacity style={styles.btn} onPress={copyTable}>
                            <Text style={styles.btnText}>Copy Table</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.infoRow}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.infoKey}>PROJECT</Text>
                            <Text style={styles.infoVal}>{data.projectName}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.infoKey}>WORK</Text>
                            <Text style={styles.infoVal}>{data.workName}</Text>
                        </View>
                    </View>
                    <ScrollView style={{ maxHeight: 340 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View>
                                <View style={styles.gridHeadRow}>
                                    {DETAIL_COLS.map((c, i) => (
                                        <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                    ))}
                                </View>
                                {data.items.length === 0 ? (
                                    <View style={styles.gridRow}><Text style={styles.gridNone}>No records</Text></View>
                                ) : data.items.map((it, i) => {
                                    const rej = isRejected(it.status);
                                    const fg = rej ? '#676879' : '#323338';
                                    return (
                                        <View key={i} style={[styles.gridRow, rej && { backgroundColor: '#fff5f5' }]}>
                                            <Text style={[styles.gridCell, { width: DETAIL_COLS[0].width, color: fg }]} numberOfLines={2}>{it.detail ?? ''}</Text>
                                            <Text style={[styles.gridCell, { width: DETAIL_COLS[1].width, color: fg }]}>{it.hours.toFixed(2)}</Text>
                                            <Text style={[styles.gridCell, { width: DETAIL_COLS[2].width, color: fg }]}>{fmtDetailDate(it.date)}</Text>
                                            <Text style={[styles.gridCell, { width: DETAIL_COLS[3].width, color: fg }]} numberOfLines={1}>{it.personName}</Text>
                                            <Text style={[styles.gridCell, { width: DETAIL_COLS[4].width, color: detailStatusColor(it.status) }]}>{friendlyStatus(it.status)}</Text>
                                        </View>
                                    );
                                })}
                            </View>
                        </ScrollView>
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btn} onPress={onClose}>
                            <Text style={styles.btnText}>← Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
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

// Renkler web ReportByProject.css birebir
const styles = StyleSheet.create({
    rbp: { flex: 1, backgroundColor: '#f0f2f7' },
    rbpContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    section: { fontSize: 13, fontWeight: '700', color: '#2d3748', flex: 1 },
    lbl: { fontSize: 12, color: '#374151' },
    loadingLbl: { fontSize: 11, color: '#6b7280', marginLeft: 6 },
    btn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 6 },
    btnText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    btnPrimary: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    btnDim: { opacity: 0.5 },
    radio: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    radioDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: '#9ca3af', backgroundColor: '#fff' },
    radioDotOn: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
    radioLbl: { fontSize: 12, color: '#374151' },

    filter: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    frow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
    flabel: { fontSize: 11, fontWeight: '700', color: '#6b7280' },
    fvalue: { fontSize: 12, color: '#111827' },
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
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
    dateBtnText: { fontSize: 12, color: '#111827' },
    preset: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 5 },
    presetText: { fontSize: 11, color: '#374151' },

    kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 8 },
    kpi: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8',
        borderLeftWidth: 4, borderRadius: 2, padding: 10,
        flexGrow: 1, flexBasis: '45%',
    },
    kpiVal: { fontSize: 20, fontWeight: '700', color: '#111827' },
    kpiTitle: { fontSize: 11, color: '#6b7280', marginTop: 2 },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, marginHorizontal: 8, marginBottom: 8 },
    cardTitle: {
        fontSize: 13, fontWeight: '700', color: '#2d3748',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardBody: { padding: 10 },
    chartEmpty: { fontSize: 12, color: '#9ca3af', padding: 12, textAlign: 'center' },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 10, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    rowSel: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 10, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    viewBtn: { color: '#0073ea', fontSize: 10, fontWeight: '700', textAlign: 'center' },

    barLegend: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
    legendLbl: { fontSize: 11, color: '#374151', marginLeft: 4 },
    sw: { width: 12, height: 12, borderRadius: 2 },
    barRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
    barRowAlt: { backgroundColor: '#fafbff' },
    barName: { width: 110, fontSize: 10, color: '#374151', marginRight: 6 },
    barTrack: { flex: 1 },
    barLine: { flexDirection: 'row', alignItems: 'center', marginVertical: 1 },
    bar: { height: 10, borderRadius: 2, minWidth: 2 },
    barV: { fontSize: 9, color: '#676879', marginLeft: 4 },

    donutWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
    donutLegend: { flex: 1, minWidth: 140 },
    legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 },
    legendTxt: { fontSize: 11, color: '#374151', flex: 1 },
    legendPct: { fontSize: 11, fontWeight: '700', color: '#111827' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 10 },
    modalToolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalTtl: { fontSize: 12, fontWeight: '700', color: '#2d3748' },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
    infoRow: {
        flexDirection: 'row', gap: 12, backgroundColor: '#f8f9fc',
        borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 6, padding: 8, marginBottom: 8,
    },
    infoKey: { fontSize: 9, fontWeight: '700', color: '#6b7280' },
    infoVal: { fontSize: 12, color: '#111827', marginTop: 2 },

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

export default ReportByProjectScreen;
