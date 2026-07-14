// Web pages/ReportByPerson.tsx birebir (masaüstü ucReportByPerson klonu).
// Mevcut API: /api/reportbyperson/{init,data,export,tevziat}
//
// Birebir korunanlar:
// - Açılış: kayıtlı reportUser (csAppConfig.reportUser — oturum boyunca modül
//   değişkeni) listede varsa o, yoksa ilk kullanıcı; ilk rapor bugün-30/bugün
// - Kişi/tarih değişimi endDate'e +1 gün ekler (plusOne=true), preset
//   butonları EKLEMEZ (plusOne=false) — masaüstü birebir
// - Tarihler tersse "Check dates!" (picker değeri korunur, fetch atlanır)
// - 4 KPI kart (Total Work Hours / Projects Worked / Work Entries / Range)
// - Project Distribution (liste + pasta, Copy Table), Works Done by Person,
//   User Overview (all users in range), Missing Work Entries (Missing Hours
//   kırmızı kalın) — dört tabloda da Copy Table (başlıksız, tab-ayrılmış,
//   "Table copied!")
// - Export Excel (CreatePersonReport birebir: tarih doğrulaması "Please check
//   selected dates!", 14 kolon, kişi başlığı + sıralı satırlar + Grand Total,
//   dosya adı) ve Users Export Dist. Sheet (yalnız showTevziat/CompanyID 13,
//   CreateTevziatReport birebir) — xlsx + paylaşım sayfası
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
import Svg, { Circle, Path } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { apiGet } from '../api';
import type { RppData, RppExport, RppInit, RppTevziat } from '../types';

// csAppConfig.reportUser karşılığı (oturum boyunca seçili kişi)
let savedReportUser = 0;

function todayInput(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDaysInput(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

function ReportByPersonScreen() {
    const [users, setUsers] = useState<RppInit['users']>([]);
    const [showTevziat, setShowTevziat] = useState(false);
    const [employeeId, setEmployeeId] = useState<number | null>(null);

    // Masaüstü varsayılanları: start = bugün - 30, end = bugün
    const [startDate, setStartDate] = useState<string>(addDaysInput(-30));
    const [endDate, setEndDate] = useState<string>(todayInput());

    const [data, setData] = useState<RppData | null>(null);
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [tevziatBusy, setTevziatBusy] = useState(false);
    const [userPickerOpen, setUserPickerOpen] = useState(false);
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);
    const bootRef = useRef(false);

    // ── Açılış: LoadInitialDataAsync birebir ──
    useEffect(() => {
        if (bootRef.current) return;
        bootRef.current = true;
        (async () => {
            try {
                const init = await apiGet<RppInit>('/api/reportbyperson/init');
                setUsers(init.users);
                setShowTevziat(init.showTevziat);

                const pick = (savedReportUser > 0 && init.users.some(u => u.id === savedReportUser))
                    ? savedReportUser
                    : (init.users[0]?.id ?? null);
                setEmployeeId(pick);
                if (pick != null) await fetchData(pick, addDaysInput(-30), todayInput());
            } catch { /* yoksay */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── updateChartsAndTables karşılığı (plusOne birebir) ──
    async function fetchData(empId: number, startArg: string, endArg: string, plusOne = true) {
        setLoading(true);
        try {
            const qs = `employeeId=${empId}&start=${startArg}&end=${endArg}&plusOne=${plusOne}`;
            const d = await apiGet<RppData>(`/api/reportbyperson/data?${qs}`);
            setData(d);
        } finally {
            setLoading(false);
        }
    }

    // ── cbSelectUser_SelectedIndexChanged birebir ──
    function onSelectUser(id: number) {
        setEmployeeId(id);
        savedReportUser = id;   // csAppConfig.reportUser
        fetchData(id, startDate, endDate);
    }

    // ── dateTimePicker_ValueChanged birebir ──
    function onStart(v: string) {
        setStartDate(v);
        if (v > endDate) { Alert.alert('', 'Check dates!'); return; }
        if (employeeId == null) return;
        fetchData(employeeId, v, endDate);
    }
    function onEnd(v: string) {
        setEndDate(v);
        if (startDate > v) { Alert.alert('', 'Check dates!'); return; }
        if (employeeId == null) return;
        fetchData(employeeId, startDate, v);
    }

    // ── setDateTimes birebir (plusOne=false) ──
    function preset(dayValue: number) {
        const s = addDaysInput(dayValue);
        const e = todayInput();
        setStartDate(s);
        setEndDate(e);
        if (employeeId != null) fetchData(employeeId, s, e, false);
    }

    // ── Copy Table (csStringHandler.CopyListView birebir) ──
    async function copyRows(rows: string[][]) {
        const text = rows.map(r => r.join('\t') + '\t').join('\r\n') + '\r\n';
        await Clipboard.setStringAsync(text);
        Alert.alert('', 'Table copied!');
    }
    function copyProjects() {
        if (!data) return;
        copyRows(data.projects.map(p => [p.project, String(p.hours), p.percentage]));
    }
    function copyWorks() {
        if (!data) return;
        copyRows(data.works.map(w => [w.phase, w.discipline, w.project, w.drawingNo, w.work, String(w.hours), w.date]));
    }
    function copyOverview() {
        if (!data) return;
        copyRows(data.usersOverview.map(u => [u.name, String(u.hours)]));
    }
    function copyWarns() {
        if (!data) return;
        copyRows(data.warnUsers.map(w => [w.date, w.user, w.enteredHours, w.missingHours]));
    }

    // ── Export Excel (CreatePersonReport birebir) ──
    async function exportExcel() {
        setExporting(true);
        try {
            // getPersonReportData doğrulaması birebir
            if (startDate > todayInput() || startDate > endDate) {
                Alert.alert('', 'Please check selected dates!');
                return;
            }

            const rep = await apiGet<RppExport>(`/api/reportbyperson/export?start=${startDate}&end=${endDate}`);

            const fmtDec = (v: number) => v.toFixed(2);
            const pct = (v: number) => v.toFixed(2) + '%';

            const aoa: (string | number)[][] = [];
            aoa.push([`Date : ${rep.startDate} - ${rep.endDate}`, 'Metric:Hours']);
            aoa.push([]);
            aoa.push([
                'Person', 'Project', 'Folder', 'Drawing Number', 'Work', 'Estimated',
                'Actual in Selected Date', 'Actual in Selected Date Percentage',
                'Actual Cumulative', 'Actual Cumulative Percentage',
                'Variance Cumulative', 'Percentage of Variance Cumulative',
                'Actual Cumulative Of Person', 'Actual Cumulative Percentage Of Person',
            ]);

            let grandTotal = 0;
            for (const pair of rep.pairs) {
                const sumSel = pair.items.reduce((s, i) => s + i.actualSelectedDate, 0);
                grandTotal += sumSel;
                aoa.push([pair.person, '', '', '', fmtDec(sumSel)]);

                const sorted = [...pair.items].sort((a, b) =>
                    a.projectName.localeCompare(b.projectName) || a.workName.localeCompare(b.workName));
                for (const it of sorted) {
                    aoa.push([
                        '', it.projectName, it.folderName, it.drawingNo, it.workName,
                        fmtDec(it.estimated), fmtDec(it.actualSelectedDate),
                        pct(it.actualSelectedDatePercentage),
                        fmtDec(it.actualCumulative), pct(it.actualCumulativePercentage),
                        fmtDec(it.variance), pct(it.variancePercentage),
                        pct(it.actualCumulativeOfPerson),
                        pct(it.actualCumulativePercentageOfPerson),
                    ]);
                }
            }

            aoa.push(['Grand Total', '', '', '', '', fmtDec(grandTotal)]);

            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'WorksByUsers');
            const fname = `PersonBasedReport_${rep.startDate}_${rep.endDate}_Metric-Hours.xlsx`
                .replace(/[\\/:*?"<>|]/g, '_');
            await saveAndShareXlsx(wb, fname);

            Alert.alert('', `Excel report successfully created.\n\nSaved as:\n${fname}`);
        } catch (e: any) {
            Alert.alert('', 'An error occurred while exporting the Excel file.\n\n' + (e?.message ?? ''));
        } finally {
            setExporting(false);
        }
    }

    // ── Users Export Dist. Sheet (CreateTevziatReport birebir) ──
    async function exportTevziat() {
        setTevziatBusy(true);
        try {
            if (startDate > endDate) {
                Alert.alert('', 'Please check selected dates!');
                return;
            }

            const t = await apiGet<RppTevziat>(`/api/reportbyperson/tevziat?start=${startDate}&end=${endDate}`);

            if (t.rows.length === 0) {
                Alert.alert('', 'No work records found for the selected date range.');
                return;
            }

            const aoa: (string | number)[][] = [[
                'Emp No', 'Work Type', 'Prj Name', 'Prj Seg', 'Task Number',
                'Task Name', 'WorkDate', 'Work Desc', 'Work Place', 'Work Hours', 'Trans To Hr',
            ]];
            for (const r of t.rows) {
                aoa.push([
                    r.empNo, 'Proje', r.projectName, r.projectName, r.activationId,
                    r.workName, r.workDate, '', '', r.hours.toFixed(2), 'H',
                ]);
            }

            const ws = XLSX.utils.aoa_to_sheet(aoa);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Tevziat');
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            const fname = `TevziatBilgileri_${t.startDate}_${t.endDate}_${stamp}.xlsx`
                .replace(/[\\/:*?"<>|]/g, '_');
            await saveAndShareXlsx(wb, fname);

            Alert.alert('', `Tevziat Excel report successfully created.\n\nSaved as:\n${fname}`);
        } catch (e: any) {
            Alert.alert('', 'An error occurred while exporting the Tevziat Excel file.\n\n' + (e?.message ?? ''));
        } finally {
            setTevziatBusy(false);
        }
    }

    // ── KPI kartları (masaüstü sırası ve renkleri birebir) ──
    const kpi = data?.kpi;
    const kpiCards = [
        { title: 'Total Work Hours', value: kpi ? String(kpi.totalWorkHours) : '—', accent: '#0073ea' },
        { title: 'Projects Worked', value: kpi ? String(kpi.projectsCount) : '—', accent: '#1f3a6e' },
        { title: 'Work Entries', value: kpi ? String(kpi.worksCount) : '—', accent: '#6473f0' },
        { title: 'Range (Days)', value: kpi ? String(kpi.daysInRange) : '—', accent: '#037f4c' },
    ];

    const hasChartData = !!data && data.chartValues.some(v => v > 0);
    const currentUser = users.find(u => u.id === employeeId);

    return (
        <ScrollView style={styles.rpp} contentContainerStyle={styles.rppContent}>
            {/* Header */}
            <View style={styles.header}><Text style={styles.headerText}>Reports — Person</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.section}>Person Report</Text>
                <Text style={styles.loadingLbl}>{loading ? 'Loading…' : ''}</Text>
                {showTevziat && (
                    <TouchableOpacity style={[styles.btnPrimary, tevziatBusy && styles.btnDim]}
                        onPress={exportTevziat} disabled={tevziatBusy}>
                        <Text style={styles.btnPrimaryText}>{tevziatBusy ? 'Please Wait' : 'Users Export Dist. Sheet'}</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={[styles.btnPrimary, exporting && styles.btnDim]}
                    onPress={exportExcel} disabled={exporting}>
                    <Text style={styles.btnPrimaryText}>{exporting ? 'Please Wait' : 'Export Excel'}</Text>
                </TouchableOpacity>
            </View>

            {/* Filter bar */}
            <View style={styles.filter}>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>Person:</Text>
                    <TouchableOpacity style={[styles.select, users.length === 0 && styles.btnDim]}
                        disabled={users.length === 0} onPress={() => setUserPickerOpen(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{currentUser?.name ?? '—'}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>From:</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('start')}>
                        <Text style={styles.dateBtnText}>{startDate}</Text>
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

            {/* Project Distribution */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Project Distribution</Text>
                    <TouchableOpacity style={styles.btn} onPress={copyProjects}>
                        <Text style={styles.btnText}>Copy Table</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.cardBody}>
                    <View style={styles.tHeadRow}>
                        <Text style={[styles.tHeadCell, { flex: 2 }]}>Project</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Work Hours</Text>
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
                    <View style={styles.chartBody}>
                        {hasChartData ? (
                            <PieChart labels={data!.chartLabels} values={data!.chartValues} />
                        ) : (
                            <Text style={styles.chartEmpty}>
                                No work entries for the selected person and date range.
                            </Text>
                        )}
                    </View>
                </View>
            </View>

            {/* Works Done by Person */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Works Done by Person</Text>
                    <TouchableOpacity style={styles.btn} onPress={copyWorks}>
                        <Text style={styles.btnText}>Copy Table</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.cardBody}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.tHeadRow}>
                                {WORKS_COLS.map((c, i) => (
                                    <Text key={i} style={[styles.tHeadCellW, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {!data || data.works.length === 0 ? (
                                <Text style={styles.tEmpty}>No data</Text>
                            ) : data.works.map((w, i) => (
                                <View key={i} style={styles.tRow}>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[0].width }]} numberOfLines={1}>{w.phase}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[1].width }]} numberOfLines={1}>{w.discipline}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[2].width }]} numberOfLines={1}>{w.project}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[3].width }]} numberOfLines={1}>{w.drawingNo}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[4].width }]} numberOfLines={2}>{w.work}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[5].width }]}>{String(w.hours)}</Text>
                                    <Text style={[styles.tCellW, { width: WORKS_COLS[6].width }]}>{w.date}</Text>
                                </View>
                            ))}
                        </View>
                    </ScrollView>
                </View>
            </View>

            {/* User Overview */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>User Overview (all users in range)</Text>
                    <TouchableOpacity style={styles.btn} onPress={copyOverview}>
                        <Text style={styles.btnText}>Copy Table</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.cardBody}>
                    <View style={styles.tHeadRow}>
                        <Text style={[styles.tHeadCell, { flex: 2 }]}>Name</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Work Hours</Text>
                    </View>
                    {!data || data.usersOverview.length === 0 ? (
                        <Text style={styles.tEmpty}>No data</Text>
                    ) : data.usersOverview.map((u, i) => (
                        <View key={i} style={styles.tRow}>
                            <Text style={[styles.tCell, { flex: 2 }]} numberOfLines={1}>{u.name}</Text>
                            <Text style={[styles.tCell, { flex: 1 }]}>{String(u.hours)}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {/* Missing Work Entries */}
            <View style={styles.card}>
                <View style={styles.cardHead}>
                    <Text style={styles.cardTitle}>Missing Work Entries</Text>
                    <TouchableOpacity style={styles.btn} onPress={copyWarns}>
                        <Text style={styles.btnText}>Copy Table</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.cardBody}>
                    <View style={styles.tHeadRow}>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Date</Text>
                        <Text style={[styles.tHeadCell, { flex: 1.4 }]}>User</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Entered Hours</Text>
                        <Text style={[styles.tHeadCell, { flex: 1 }]}>Missing Hours</Text>
                    </View>
                    {!data || data.warnUsers.length === 0 ? (
                        <Text style={styles.tEmpty}>No data</Text>
                    ) : data.warnUsers.map((w, i) => (
                        <View key={i} style={styles.tRow}>
                            <Text style={[styles.tCell, { flex: 1 }]}>{w.date}</Text>
                            <Text style={[styles.tCell, { flex: 1.4 }]} numberOfLines={1}>{w.user}</Text>
                            <Text style={[styles.tCell, { flex: 1 }]}>{w.enteredHours}</Text>
                            {/* Missing Hours — masaüstünde kırmızı + kalın */}
                            <Text style={[styles.tCell, styles.warnMissing, { flex: 1 }]}>{w.missingHours}</Text>
                        </View>
                    ))}
                </View>
            </View>

            {/* Kişi seçimi */}
            <PickerModal visible={userPickerOpen} items={users} selectedId={employeeId}
                onClose={() => setUserPickerOpen(false)}
                onPick={(id) => { setUserPickerOpen(false); onSelectUser(id); }} />

            {/* Tarih seçici */}
            <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker initial={datePick === 'start' ? startDate : endDate}
                            onPick={(d) => {
                                const t = datePick;
                                setDatePick(null);
                                if (t === 'start') onStart(d); else onEnd(d);
                            }} />
                    </View>
                </TouchableOpacity>
            </Modal>
        </ScrollView>
    );
}

const WORKS_COLS = [
    { label: 'Phase', width: 100 },
    { label: 'Discipline', width: 90 },
    { label: 'Project', width: 100 },
    { label: 'Drawing No.', width: 90 },
    { label: 'Work', width: 150 },
    { label: 'Hours', width: 52 },
    { label: 'Date', width: 84 },
];

// ═══ Pasta grafik — masaüstü chTotalWork birebir ═══
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
        return <Text style={styles.chartEmpty}>No data available</Text>;
    }

    const size = 130, r = 56, cx = size / 2, cy = size / 2;

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
                {active.length === 1 ? (
                    <Circle cx={cx} cy={cy} r={r} fill={active[0].color} />
                ) : (
                    segs.map((s, i) => <Path key={i} d={s.path} fill={s.color} />)
                )}
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

// Renkler web ReportByPerson.css birebir
const styles = StyleSheet.create({
    rpp: { flex: 1, backgroundColor: '#f0f2f7' },
    rppContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    section: { fontSize: 13, fontWeight: '700', color: '#2d3748', flex: 1 },
    loadingLbl: { fontSize: 11, color: '#6b7280' },
    btn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 5 },
    btnText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    btnPrimary: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnPrimaryText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    btnDim: { opacity: 0.5 },

    filter: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    frow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
    flabel: { fontSize: 11, fontWeight: '700', color: '#6b7280' },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 6, flex: 1, minWidth: 140,
    },
    selectText: { fontSize: 12, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 11, color: '#6b7280', marginLeft: 4 },
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
    cardHead: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748', flexShrink: 1 },
    cardBody: { padding: 8 },
    chartBody: { alignItems: 'center', marginTop: 8 },
    chartEmpty: { fontSize: 12, color: '#9ca3af', padding: 10, textAlign: 'center' },

    tHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    tHeadCell: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 5, paddingHorizontal: 4 },
    tHeadCellW: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 5, paddingHorizontal: 4 },
    tRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    tCell: { fontSize: 11, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    tCellW: { fontSize: 11, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    tEmpty: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    warnMissing: { color: '#dc143c', fontWeight: '700' },

    pieWrap: { alignItems: 'center' },
    pieLegend: { marginTop: 10, alignSelf: 'stretch' },
    legendRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 },
    sw: { width: 12, height: 12, borderRadius: 2 },
    legendTxt: { fontSize: 12, color: '#374151', flex: 1 },

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

export default ReportByPersonScreen;
