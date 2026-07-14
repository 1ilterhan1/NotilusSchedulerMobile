// Web pages/ReportByPhase.tsx birebir (masaüstü ucReportByPhase klonu).
// Mevcut API: /api/reportbyphase/{init,data,save,details,tevziat} +
//             /api/projectmanagement/{config,lookups,works/{id}}
//
// Birebir korunanlar:
// - Açılış: kayıtlı proje (SelectedProjectPhase) aktif listede yoksa Completed
//   listesine sessizce geçilir; kayıtlı As of Date (SelectedFilterDatePhase)
// - View: Show Tables / Graphs — Planned / Graphs — Actual
// - Filtreler: Phase/Discipline/Resource (0 = No Filter; yalnız grid'i süzer,
//   grafikleri değil — ApplyFiltersAndReloadGrid birebir)
// - Grid: Actual % ve Est. from Actual düzenlenebilir (Engineer salt-okunur);
//   hesap formülleri dgvWorks_CellValueChanged birebir; Save Changes dirty'de
//   kırmızı; "Updated successfully." / "Save failed!"
// - Details (FormWorkAffordDetails): Rejected satırlar soluk + Copy Table
// - Satır uzun basış (masaüstü sağ tık, Engineer engelli) → Update
//   (FormUpdateWork birebir: görünürlük bayrakları, fieldsAreValid mesajları,
//   "Work updated!", PUT /api/projectmanagement/works/{id})
// - Users Export Dist. Sheet (tevziat) + Export Excel: aynı kolonlar/sayfalar,
//   dosya adı damgaları birebir (xlsx + paylaşım sayfası)
// - Project Overall metni: "Planned: X%   •   Actual: Y%   •   Efficiency: Z"
// Mobil uyarlama: tablolar/grafikler yatay kaydırmalı; PDF export mobilde
// desteklenmez (Excel kullanın uyarısı); localStorage → AsyncStorage;
// select yerine modal liste; sağ tık yerine uzun basış.

import { useEffect, useRef, useState } from 'react';
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
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { apiGet, apiFetch } from '../api';
import type {
    IdName, PmConfig, PmLookups, RphChartPoint, RphData, RphDetails,
    RphInit, RphTevziat, RphWorkRow,
} from '../types';

// ═══ Yardımcılar (web birebir) ═══
function todayInput(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const n2 = (v: number) => (Number.isFinite(v) ? v : 0).toFixed(2);
const n0dot = (v: number) => String(Math.round((Number.isFinite(v) ? v : 0) * 100) / 100);
const round2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

function fmtDetailDate(iso: string): string {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const day = String(d.getDate()).padStart(2, '0');
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return `${day} ${mon} ${d.getFullYear()}`;
}

// xlsx dosyasını cihaza yazıp paylaşım sayfası açar (masaüstü "kaydet" karşılığı)
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

type ViewMode = 'list' | 'planned' | 'actual';

// Masaüstü Properties.Settings karşılığı (AsyncStorage)
const LS_PROJECT = 'rph_selectedProject';
const LS_DATE = 'rph_filterDate';

// ═══ Ana bileşen ═══
function ReportByPhaseScreen() {
    const [init, setInit] = useState<RphInit | null>(null);
    const [completed, setCompleted] = useState(false);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [filterDate, setFilterDate] = useState<string>(todayInput());

    const [data, setData] = useState<RphData | null>(null);
    const [rows, setRows] = useState<RphWorkRow[]>([]);
    const [dirty, setDirty] = useState(false);
    const [loading, setLoading] = useState(false);

    const [view, setView] = useState<ViewMode>('list');
    const [exportFmt, setExportFmt] = useState<'pdf' | 'excel'>('pdf');
    const [exporting, setExporting] = useState(false);
    const [tevziatBusy, setTevziatBusy] = useState(false);

    const [fPhase, setFPhase] = useState(0);
    const [fDiscipline, setFDiscipline] = useState(0);
    const [fResource, setFResource] = useState(0);

    const [details, setDetails] = useState<RphDetails | null>(null);
    const [selRowId, setSelRowId] = useState<number | null>(null);
    const [updateRow, setUpdateRow] = useState<RphWorkRow | null>(null);

    const [pmConfig, setPmConfig] = useState<PmConfig | null>(null);
    const [pmLookups, setPmLookups] = useState<PmLookups | null>(null);

    // Seçim modalları
    const [projPickerOpen, setProjPickerOpen] = useState(false);
    const [filterPicker, setFilterPicker] = useState<'phase' | 'discipline' | 'resource' | null>(null);
    const [datePickOpen, setDatePickOpen] = useState(false);

    const bootRef = useRef(false);
    const isEngineer = init?.userStatus === 'Engineer';
    const unit = init?.durationInHours ? '(h)' : '(Days)';

    // ── Açılış (ucReportByPhase_Load + LoadInitialDataAsync birebir) ──
    useEffect(() => {
        if (bootRef.current) return;
        bootRef.current = true;
        (async () => {
            try {
                const storedId = Number((await AsyncStorage.getItem(LS_PROJECT)) || '0');
                const storedDate = (await AsyncStorage.getItem(LS_DATE)) || todayInput();
                setFilterDate(storedDate);
                let comp = false;
                let i = await apiGet<RphInit>('/api/reportbyphase/init?completed=false');
                // Aktif proje diğer listedeyse filtreyi sessizce değiştir (masaüstü birebir)
                if (storedId > 0 && !i.projects.some(p => p.id === storedId)) {
                    const alt = await apiGet<RphInit>('/api/reportbyphase/init?completed=true');
                    if (alt.projects.some(p => p.id === storedId)) { i = alt; comp = true; }
                }
                setInit(i);
                setCompleted(comp);
                const pick = (storedId > 0 && i.projects.some(p => p.id === storedId))
                    ? storedId
                    : (i.projects[0]?.id ?? null);
                setProjectId(pick);
                if (pick != null) await fetchData(pick, storedDate);
            } catch { /* yoksay */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Ana veri ──
    async function fetchData(pid: number, date: string) {
        setLoading(true);
        try {
            const d = await apiGet<RphData>(`/api/reportbyphase/data?projectId=${pid}&date=${date}`);
            setData(d);
            setRows(d.rows.map(r => ({ ...r })));
            setDirty(false);
            setSelRowId(null);
        } finally {
            setLoading(false);
        }
    }

    function onSelectProject(id: number) {
        setProjectId(id);
        AsyncStorage.setItem(LS_PROJECT, String(id));
        fetchData(id, filterDate);
    }
    async function onToggleCompleted(next: boolean) {
        setCompleted(next);
        try {
            const i = await apiGet<RphInit>(`/api/reportbyphase/init?completed=${next}`);
            setInit(i);
            const stored = Number((await AsyncStorage.getItem(LS_PROJECT)) || '0');
            const pick = (stored > 0 && i.projects.some(p => p.id === stored))
                ? stored
                : (i.projects[0]?.id ?? null);
            setProjectId(pick);
            if (pick != null) await fetchData(pick, filterDate);
            else { setData(null); setRows([]); }
        } catch { /* yoksay */ }
    }
    function onDateChange(v: string) {
        if (!v) return;
        setFilterDate(v);
        AsyncStorage.setItem(LS_DATE, v);
        if (projectId != null) fetchData(projectId, v);
    }

    // ── Grid filtreleme (yalnız grid — birebir) ──
    const filteredRows = rows.filter(w =>
        (fPhase === 0 || w.folderId === fPhase) &&
        (fDiscipline === 0 || w.disciplineId === fDiscipline) &&
        (fResource === 0 || w.resourceId === fResource));

    // ── Hücre düzenleme (dgvWorks_CellValueChanged birebir) ──
    function onEditEstDur(workId: number, value: number) {
        setRows(prev => prev.map(r => {
            if (r.workId !== workId) return r;
            const actual = r.actual;
            const estimated = value;
            return {
                ...r,
                estDurFromActual: value,
                actualComp: (estimated === 0 ? 0 : actual / estimated) * 100,
            };
        }));
        setDirty(true);
    }
    function onEditActualComp(workId: number, value: number) {
        setRows(prev => prev.map(r => {
            if (r.workId !== workId) return r;
            const actual = r.actual;
            const actualComp = value;
            const budget = r.estimated;
            let estDur: number;
            if (actual <= 0) {
                if (actualComp > 0 && budget > 0) estDur = budget * 100.0 / actualComp;
                else estDur = budget;
            } else if (actualComp <= 0) {
                estDur = budget;
            } else {
                estDur = 100 / (actualComp / actual);
            }
            return { ...r, actualComp: value, estDurFromActual: estDur };
        }));
        setDirty(true);
    }

    // ── Save Changes (btnUpdate_Click birebir) ──
    async function saveChanges() {
        if (projectId == null) return;
        const body = {
            projectId,
            items: rows.map(r => ({
                workId: r.workId,
                estDurFromActual: r.estDurFromActual,
                actualDisplayHours: r.actual,
                actualComp: r.actualComp,
            })),
        };
        const res = await apiFetch('/api/reportbyphase/save', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) { Alert.alert('', 'Save failed!'); return; }
        await fetchData(projectId, filterDate);
        Alert.alert('', 'Updated successfully.');
    }

    // ── Details popup ──
    async function openDetails(workId: number) {
        if (projectId == null) return;
        const d = await apiGet<RphDetails>(`/api/reportbyphase/details?projectId=${projectId}&workId=${workId}&date=${filterDate}`);
        setDetails(d);
    }

    // ── Uzun basış (masaüstü sağ tık — Engineer engelli) → Update ──
    function onRowLongPress(workId: number) {
        if (isEngineer) return;
        setSelRowId(workId);
        Alert.alert('', undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Update', onPress: () => openUpdate(workId) },
        ]);
    }
    async function openUpdate(workId: number) {
        const row = rows.find(r => r.workId === workId);
        if (!row) return;
        try {
            if (!pmConfig) setPmConfig(await apiGet<PmConfig>('/api/projectmanagement/config'));
            if (!pmLookups) setPmLookups(await apiGet<PmLookups>('/api/projectmanagement/lookups'));
        } catch { /* yoksay */ }
        setUpdateRow(row);
    }

    // ═══ EXPORT'lar ═══
    function gridHeadersAndRows(): { headers: string[]; body: (string | number)[][] } {
        const resourceVisible = init?.resourceIsVisible ?? false;
        const headers = [
            'Activation ID', 'Phase', 'Discipline', 'Dwg No', 'Drawing Name',
            `Budget ${unit}`, `Actual ${unit}`, 'Planned %', 'Actual %', 'Est. from Actual',
            'Start', 'End',
            ...(resourceVisible ? ['Resource'] : []),
            'Status',
        ];
        const body = filteredRows.map(r => [
            r.activationId, r.phase, r.discipline, r.drawingNo, r.name,
            n0dot(r.estimated), n2(r.actual), n2(r.plannedCompPer), n2(r.actualComp), n2(r.estDurFromActual),
            r.startDate, r.endDate,
            ...(resourceVisible ? [r.resource] : []),
            r.status,
        ]);
        return { headers, body };
    }

    // Excel (ExportDgvWorksToExcel_Auto birebir): "Works" + "Charts" sayfaları
    async function exportExcel() {
        const { headers, body } = gridHeadersAndRows();
        const wb = XLSX.utils.book_new();
        const wsWorks = XLSX.utils.aoa_to_sheet([headers, ...body]);
        XLSX.utils.book_append_sheet(wb, wsWorks, 'Works');

        const chartAoa: (string | number)[][] = [];
        const actualMode = view === 'actual';
        const pushChart = (title: string, pts: RphChartPoint[]) => {
            chartAoa.push([title]);
            chartAoa.push(['', 'Planned %', 'Actual %']);
            for (const p of pts) chartAoa.push([p.label, round2(p.planned), round2(actualMode ? p.actualMode : p.actual)]);
            chartAoa.push([]);
        };
        pushChart('Engineering Phases Summary', data?.summary ?? []);
        for (const pc of data?.phaseCharts ?? []) pushChart(pc.title, pc.groups);
        const wsCharts = XLSX.utils.aoa_to_sheet(chartAoa);
        XLSX.utils.book_append_sheet(wb, wsCharts, 'Charts');

        const projectName = init?.projects.find(p => p.id === projectId)?.name ?? 'Project';
        const now = new Date();
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        const fname = `${projectName}_${stamp}_WorksReport.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
        await saveAndShareXlsx(wb, fname);
        Alert.alert('', `Works + Charts exported to:\n${fname}`);
    }

    async function doExport() {
        setExporting(true);
        try {
            if (exportFmt === 'pdf') {
                // Mobil uyarlama: PDF export desteklenmiyor (grafik→PNG dönüşümü yok)
                Alert.alert('', 'PDF export is not supported on mobile yet. Please use Excel.');
            } else {
                await exportExcel();
            }
        } catch (e: any) {
            Alert.alert('', 'Export failed!\n\n' + (e?.message ?? ''));
        } finally {
            setExporting(false);
        }
    }

    // btnExportTevziat_Click birebir
    async function exportTevziat() {
        setTevziatBusy(true);
        try {
            const t = await apiGet<RphTevziat>(`/api/reportbyphase/tevziat?date=${filterDate}`);
            if (t.rows.length === 0) {
                Alert.alert('', 'No work records found for the selected month.');
                return;
            }
            const headers = [
                'Emp No', 'Work Type', 'Prj Name', 'Prj Seg',
                'Task Number', 'Task Name', 'WorkDate', 'Work Desc',
                'Work Place', 'Work Hours', 'Trans To Hr',
            ];
            const body = t.rows.map(r => [
                r.empNo, 'Proje', r.projectName, r.projectName,
                r.activationId, r.workName, r.workDate, '', '',
                n2(r.hours), 'H',
            ]);
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet([headers, ...body]);
            XLSX.utils.book_append_sheet(wb, ws, 'Tevziat');
            const now = new Date();
            const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
            const fname = `TevziatBilgileri_${t.startDate}_${t.endDate}_${stamp}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
            await saveAndShareXlsx(wb, fname);
            Alert.alert('', `Tevziat Excel report successfully created.\n\nSaved as:\n${fname}`);
        } catch (e: any) {
            Alert.alert('', 'An error occurred while exporting the Tevziat Excel file.\n\n' + (e?.message ?? ''));
        } finally {
            setTevziatBusy(false);
        }
    }

    // ── Project Overall metni (birebir) ──
    const overallText = data
        ? `Planned: ${Math.round(data.overall.planned)}%   •   Actual: ${Math.round(data.overall.actual)}%   •   Efficiency: ${data.overall.efficiency}`
        : '—';

    const resourceVisible = init?.resourceIsVisible ?? false;
    const graphActualMode = view === 'actual';
    const showSave = view === 'list' && !isEngineer;
    const currentProject = init?.projects.find(p => p.id === projectId);

    const filterName = (list: IdName[] | undefined, id: number) =>
        id === 0 ? 'No Filter' : (list?.find(x => x.id === id)?.name ?? 'No Filter');

    const COLS = [
        { label: 'Activation ID', width: 90 },
        { label: 'Phase', width: 100 },
        { label: 'Discipline', width: 90 },
        { label: 'Dwg No', width: 80 },
        { label: 'Drawing Name', width: 160 },
        { label: `Budget ${unit}`, width: 76 },
        { label: `Actual ${unit}`, width: 76 },
        { label: 'Planned %', width: 72 },
        { label: 'Actual %', width: 84 },
        { label: 'Est. from Actual', width: 92 },
        { label: 'Start', width: 84 },
        { label: 'End', width: 84 },
        ...(resourceVisible ? [{ label: 'Resource', width: 90 }] : []),
        { label: 'Status', width: 86 },
        { label: 'Details', width: 70 },
    ];

    return (
        <ScrollView style={styles.rph} contentContainerStyle={styles.rphContent}>
            {/* Header */}
            <View style={styles.header}><Text style={styles.headerText}>Reports — Phase</Text></View>

            {/* Toolbar: View + Export */}
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>View:</Text>
                <TouchableOpacity style={[styles.toggle, view === 'list' && styles.toggleActive]} onPress={() => setView('list')}>
                    <Text style={[styles.toggleText, view === 'list' && styles.toggleTextActive]}>Show Tables</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggle, view === 'planned' && styles.toggleActive]} onPress={() => setView('planned')}>
                    <Text style={[styles.toggleText, view === 'planned' && styles.toggleTextActive]}>Graphs — Planned</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggle, view === 'actual' && styles.toggleActive]} onPress={() => setView('actual')}>
                    <Text style={[styles.toggleText, view === 'actual' && styles.toggleTextActive]}>Graphs — Actual</Text>
                </TouchableOpacity>
                <Text style={styles.loadingLbl}>{loading ? 'Loading…' : ''}</Text>
            </View>
            <View style={styles.toolbar}>
                <TouchableOpacity style={[styles.btnBlue, tevziatBusy && styles.btnDim]} onPress={exportTevziat} disabled={tevziatBusy}>
                    <Text style={styles.btnBlueText}>{tevziatBusy ? 'Please Wait' : 'Users Export Dist. Sheet'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.radio} onPress={() => setExportFmt('pdf')}>
                    <View style={[styles.radioDot, exportFmt === 'pdf' && styles.radioDotOn]} />
                    <Text style={styles.radioLbl}>PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.radio} onPress={() => setExportFmt('excel')}>
                    <View style={[styles.radioDot, exportFmt === 'excel' && styles.radioDotOn]} />
                    <Text style={styles.radioLbl}>Excel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnBlue, exporting && styles.btnDim]} onPress={doExport} disabled={exporting}>
                    <Text style={styles.btnBlueText}>{exporting ? 'Please Wait' : 'Export'}</Text>
                </TouchableOpacity>
                {showSave && (
                    <TouchableOpacity style={dirty ? styles.btnRed : styles.btnGreen} onPress={saveChanges}>
                        <Text style={styles.btnBlueText}>Save Changes</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Filter bar */}
            <View style={styles.filter}>
                <Text style={styles.flabel}>Project</Text>
                <View style={styles.frow}>
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
                    <Text style={styles.flabel}>Project Start</Text>
                    <Text style={styles.fvalue}>{data?.projectStart ?? '—'}</Text>
                    <Text style={styles.flabel}>As of Date</Text>
                    <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePickOpen(true)}>
                        <Text style={styles.dateBtnText}>{filterDate}</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>Phase</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setFilterPicker('phase')}>
                        <Text style={styles.selectText} numberOfLines={1}>{filterName(data?.phases, fPhase)}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    <Text style={styles.flabel}>Discipline</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setFilterPicker('discipline')}>
                        <Text style={styles.selectText} numberOfLines={1}>{filterName(data?.disciplines, fDiscipline)}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>Resource</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setFilterPicker('resource')}>
                        <Text style={styles.selectText} numberOfLines={1}>{filterName(data?.resources, fResource)}</Text>
                        <Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                </View>
                <View style={styles.frow}>
                    <Text style={styles.flabel}>Project Overall</Text>
                    <Text style={styles.fvalue}>{overallText}</Text>
                </View>
            </View>

            {/* İçerik: tablo VEYA grafikler */}
            {view === 'list' ? (
                <View style={styles.card}>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                {COLS.map((c, i) => (
                                    <Text key={i} style={[styles.gridHeadCell, { width: c.width }]}>{c.label}</Text>
                                ))}
                            </View>
                            {filteredRows.length === 0 ? (
                                <View style={styles.gridRow}><Text style={styles.gridNone}>No data</Text></View>
                            ) : filteredRows.map(r => {
                                let ci = 0;
                                const w = () => COLS[ci++].width;
                                return (
                                    <TouchableOpacity key={r.workId}
                                        style={[styles.gridRow, selRowId === r.workId && styles.rowSel]}
                                        onPress={() => setSelRowId(r.workId)}
                                        onLongPress={() => onRowLongPress(r.workId)}>
                                        <Text style={[styles.gridCell, { width: w() }]} numberOfLines={1}>{r.activationId}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]} numberOfLines={1}>{r.phase}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]} numberOfLines={1}>{r.discipline}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]} numberOfLines={1}>{r.drawingNo}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]} numberOfLines={2}>{r.name}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]}>{n0dot(r.estimated)}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]}>{n2(r.actual)}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]}>{n2(r.plannedCompPer)}</Text>
                                        <View style={{ width: w() }}>
                                            {isEngineer ? (
                                                <Text style={styles.gridCell}>{n2(r.actualComp)}</Text>
                                            ) : (
                                                <EditCell key={`ac-${r.workId}-${round2(r.actualComp)}`}
                                                    value={round2(r.actualComp)}
                                                    onCommit={(v) => { if (v !== round2(r.actualComp)) onEditActualComp(r.workId, v); }} />
                                            )}
                                        </View>
                                        <View style={{ width: w() }}>
                                            {isEngineer ? (
                                                <Text style={styles.gridCell}>{n2(r.estDurFromActual)}</Text>
                                            ) : (
                                                <EditCell key={`ed-${r.workId}-${round2(r.estDurFromActual)}`}
                                                    value={round2(r.estDurFromActual)}
                                                    onCommit={(v) => { if (v !== round2(r.estDurFromActual)) onEditEstDur(r.workId, v); }} />
                                            )}
                                        </View>
                                        <Text style={[styles.gridCell, { width: w() }]}>{r.startDate}</Text>
                                        <Text style={[styles.gridCell, { width: w() }]}>{r.endDate}</Text>
                                        {resourceVisible && (
                                            <Text style={[styles.gridCell, { width: w() }]} numberOfLines={1}>{r.resource}</Text>
                                        )}
                                        <Text style={[styles.gridCell, { width: w() },
                                            r.status === 'Completed' ? styles.stCompleted
                                                : r.status === 'In Progress' ? styles.stProgress : styles.stNone]}>
                                            {r.status}
                                        </Text>
                                        <TouchableOpacity style={{ width: w() }} onPress={() => openDetails(r.workId)}>
                                            <Text style={styles.detailsBtn}>Details →</Text>
                                        </TouchableOpacity>
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
            ) : (
                <View>
                    <ChartCard title="Engineering Phases Summary" points={data?.summary ?? []} actualMode={graphActualMode} />
                    {['Basic Design', 'Basic Engineering', 'Detail Engineering', 'Production Support'].map(t => (
                        <ChartCard key={t} title={t}
                            points={data?.phaseCharts.find(c => c.title === t)?.groups ?? []}
                            actualMode={graphActualMode} />
                    ))}
                </View>
            )}

            {/* Proje seçimi */}
            <PickerModal visible={projPickerOpen} items={init?.projects ?? []} selectedId={projectId}
                onClose={() => setProjPickerOpen(false)}
                onPick={(id) => { setProjPickerOpen(false); onSelectProject(id); }} />

            {/* Filtre seçimleri (0 = No Filter) */}
            <PickerModal visible={filterPicker != null}
                items={[{ id: 0, name: 'No Filter' },
                    ...(filterPicker === 'phase' ? data?.phases ?? []
                        : filterPicker === 'discipline' ? data?.disciplines ?? []
                        : data?.resources ?? [])]}
                selectedId={filterPicker === 'phase' ? fPhase : filterPicker === 'discipline' ? fDiscipline : fResource}
                onClose={() => setFilterPicker(null)}
                onPick={(id) => {
                    if (filterPicker === 'phase') setFPhase(id);
                    else if (filterPicker === 'discipline') setFDiscipline(id);
                    else setFResource(id);
                    setFilterPicker(null);
                }} />

            {/* As of Date */}
            <Modal visible={datePickOpen} transparent animationType="fade" onRequestClose={() => setDatePickOpen(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePickOpen(false)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker initial={filterDate}
                            onPick={(d) => { setDatePickOpen(false); onDateChange(d); }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Details modal */}
            {details && <DetailsModal data={details} onClose={() => setDetails(null)} />}

            {/* Update Work modal */}
            {updateRow && (
                <UpdateWorkModal
                    row={updateRow}
                    cfg={pmConfig}
                    lookups={pmLookups}
                    hoursPerDay={init?.hoursPerDay ?? 9}
                    durationInHours={init?.durationInHours ?? false}
                    onClose={() => setUpdateRow(null)}
                    onSaved={() => {
                        setUpdateRow(null);
                        if (projectId != null) fetchData(projectId, filterDate);
                    }} />
            )}
        </ScrollView>
    );
}

// ── Düzenlenebilir sayı hücresi (web onBlur/Enter commit birebir) ──
function EditCell({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
    const [text, setText] = useState(String(value));
    return (
        <TextInput style={styles.cellEdit} value={text} keyboardType="numeric"
            onChangeText={setText}
            onEndEditing={() => onCommit(parseFloat(text.replace(',', '.')) || 0)} />
    );
}

// ═══ Sütun grafiği — DrawEngineeringSummaryChart / DrawPhaseChart birebir ═══
// Planned = turuncu (#FFA500), Actual = dodgerblue (#1E90FF), Y 0–100% aralık 10
const CHART_W = 1100;
const CHART_H = 420;

function wrapLabel(text: string, max: number): string[] {
    const words = (text || '').split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const w of words) {
        if (line.length + (line ? 1 : 0) + w.length > max && line) {
            lines.push(line);
            line = w;
        } else {
            line = line ? line + ' ' + w : w;
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

function ChartCard({ title, points, actualMode }: {
    title: string; points: RphChartPoint[]; actualMode: boolean;
}) {
    const mL = 52, mR = 16, mT = 44, mB = 64;
    const plotW = CHART_W - mL - mR;
    const plotH = CHART_H - mT - mB;
    const y = (v: number) => mT + plotH * (1 - Math.max(0, Math.min(100, v)) / 100);

    const n = points.length;
    const catW = n > 0 ? plotW / n : plotW;
    const barW = Math.min(44, catW * 0.3);

    const gridLines: number[] = [];
    for (let v = 0; v <= 100; v += 10) gridLines.push(v);

    return (
        <View style={styles.chartCard}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
                <Svg width={CHART_W} height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
                    <Rect x={0.5} y={0.5} width={CHART_W - 1} height={CHART_H - 1} fill="#ffffff" stroke="#e8ebf2" />
                    <SvgText x={CHART_W / 2} y={26} textAnchor="middle" fontSize={16} fontWeight="bold" fill="#1f3a6e">
                        {title}
                    </SvgText>

                    {/* Legend */}
                    <Rect x={CHART_W - 190} y={12} width={12} height={12} fill="#FFA500" />
                    <SvgText x={CHART_W - 174} y={22} fontSize={12} fill="#323338">Planned</SvgText>
                    <Rect x={CHART_W - 106} y={12} width={12} height={12} fill="#1E90FF" />
                    <SvgText x={CHART_W - 90} y={22} fontSize={12} fill="#323338">Actual</SvgText>

                    {/* Y grid */}
                    {gridLines.map(v => (
                        <G key={v}>
                            <Line x1={mL} y1={y(v)} x2={CHART_W - mR} y2={y(v)} stroke="#c8c8c8" strokeWidth={v === 0 ? 1.2 : 0.6} />
                            <SvgText x={mL - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="#676879">{`${v}%`}</SvgText>
                        </G>
                    ))}

                    {/* Barlar */}
                    {points.map((p, i) => {
                        const cx = mL + catW * i + catW / 2;
                        const plannedV = p.planned;
                        const actualV = actualMode ? p.actualMode : p.actual;
                        const px = cx - barW - 3;
                        const ax = cx + 3;
                        const clampP = Math.max(0, Math.min(100, plannedV));
                        const clampA = Math.max(0, Math.min(100, actualV));
                        return (
                            <G key={i}>
                                <Rect x={px} y={y(clampP)} width={barW} height={mT + plotH - y(clampP)} fill="#FFA500" />
                                <SvgText x={px + barW / 2} y={y(clampP) - 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#323338">
                                    {`${Math.round(plannedV)}%`}
                                </SvgText>
                                <Rect x={ax} y={y(clampA)} width={barW} height={mT + plotH - y(clampA)} fill="#1E90FF" />
                                <SvgText x={ax + barW / 2} y={y(clampA) - 4} textAnchor="middle" fontSize={11} fontWeight="bold" fill="#323338">
                                    {`${Math.round(actualV)}%`}
                                </SvgText>
                                {wrapLabel(p.label, 18).map((ln, li) => (
                                    <SvgText key={li} x={cx} y={mT + plotH + 16 + li * 13} textAnchor="middle" fontSize={11} fill="#323338">
                                        {ln}
                                    </SvgText>
                                ))}
                            </G>
                        );
                    })}

                    {points.length === 0 && (
                        <SvgText x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" fontSize={13} fill="#b4b9c8">
                            No data
                        </SvgText>
                    )}
                </Svg>
            </ScrollView>
        </View>
    );
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

function DetailsModal({ data, onClose }: { data: RphDetails; onClose: () => void }) {
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
                        <TouchableOpacity style={styles.btnWhite} onPress={copyTable}>
                            <Text style={styles.btnWhiteText}>Copy Table</Text>
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
                        <TouchableOpacity style={styles.btnWhite} onPress={onClose}>
                            <Text style={styles.btnWhiteText}>← Close</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

// ═══ Update Work modal — FormUpdateWork birebir ═══
function UpdateWorkModal({ row, cfg, lookups, hoursPerDay, durationInHours, onClose, onSaved }: {
    row: RphWorkRow;
    cfg: PmConfig | null;
    lookups: PmLookups | null;
    hoursPerDay: number;
    durationInHours: boolean;
    onClose: () => void;
    onSaved: () => void;
}) {
    const dbToDisplay = (v: number) => durationInHours ? round2(v * hoursPerDay) : round2(v);
    const displayToDb = (v: number) => durationInHours ? v / hoursPerDay : v;

    const [folderId, setFolderId] = useState<number>(row.folderId);
    const [disciplineId, setDisciplineId] = useState<number>(row.disciplineId);
    const [drawingNo, setDrawingNo] = useState(row.drawingNo);
    const [name, setName] = useState(row.name);
    const [activationId, setActivationId] = useState(row.activationId);
    const [estimate, setEstimate] = useState(String(dbToDisplay(row.estimatedDb)));
    const [start, setStart] = useState(row.startIso || todayInput());
    const [end, setEnd] = useState(row.endIso || todayInput());
    const [resourceId, setResourceId] = useState<number>(row.resourceId ?? -1);
    const [type, setType] = useState<'Scope' | 'Additional'>(row.type === 'Additional' ? 'Additional' : 'Scope');
    const [completedW, setCompletedW] = useState(row.completedFlag);
    const [isStarted, setIsStarted] = useState(row.isStarted ?? false);

    const [picker, setPicker] = useState<'folder' | 'discipline' | 'resource' | null>(null);
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);

    const estLabel = durationInHours ? 'Budget (hours)' : 'Estimated Duration (days)';

    const showFolder = cfg?.folderIsVisibleForProjects ?? true;
    const showDiscipline = cfg?.disciplineIsVisibleForWorkEntry ?? true;
    const showDrawing = cfg?.showDrawingNumberInWorklist ?? false;
    const showResource = cfg?.resourceIsVisible ?? false;
    const showStarted = cfg?.checkStartedJobForWorks ?? false;

    async function save() {
        // fieldsAreValid birebir
        if (!name.trim()) { Alert.alert('', 'Please enter a name.'); return; }
        if (!estimate.trim()) { Alert.alert('', 'Please enter the estimated duration.'); return; }
        const num = Number(estimate.replace(',', '.'));
        if (Number.isNaN(num)) { Alert.alert('', 'Estimated duration must be a valid number.'); return; }

        const body = {
            name, drawingNo, folderId, disciplineId,
            estimatedDays: displayToDb(num),
            startDate: start || null, endDate: end || null,
            resourceId, isStarted, completed: completedW, type, activationId,
        };
        const res = await apiFetch(`/api/projectmanagement/works/${row.workId}`, {
            method: 'PUT', body: JSON.stringify(body),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
        Alert.alert('', 'Work updated!');
        onSaved();
    }

    const lookupName = (list: IdName[] | undefined, id: number, fallback = '—') =>
        list?.find(x => x.id === id)?.name ?? fallback;

    function Toggle({ value, on, off, onChange }: { value: boolean; on: string; off: string; onChange: (v: boolean) => void }) {
        return (
            <View style={styles.uwToggle}>
                <TouchableOpacity style={[styles.uwToggleBtn, value && styles.uwToggleOn]} onPress={() => onChange(true)}>
                    <Text style={[styles.uwToggleText, value && styles.uwToggleTextOn]}>{on}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.uwToggleBtn, !value && styles.uwToggleOn]} onPress={() => onChange(false)}>
                    <Text style={[styles.uwToggleText, !value && styles.uwToggleTextOn]}>{off}</Text>
                </TouchableOpacity>
            </View>
        );
    }

    function Row({ label, children }: { label: string; children: React.ReactNode }) {
        return (
            <View style={styles.uwRow}>
                <Text style={styles.uwLabel}>{label}</Text>
                <View style={styles.uwField}>{children}</View>
            </View>
        );
    }

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '90%' }]}>
                    <Text style={styles.modalHead}>Update Work</Text>
                    <ScrollView>
                        <Text style={styles.uwCardHead}>WORK DETAILS</Text>
                        {showFolder && (
                            <Row label="Phase">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('folder')}>
                                    <Text style={styles.selectText} numberOfLines={1}>{lookupName(lookups?.folders, folderId)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </Row>
                        )}
                        {showDiscipline && (
                            <Row label="Discipline">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('discipline')}>
                                    <Text style={styles.selectText} numberOfLines={1}>{lookupName(lookups?.disciplines, disciplineId)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </Row>
                        )}
                        {showDrawing && (
                            <Row label="Drawing Number">
                                <TextInput style={styles.uwInput} value={drawingNo} onChangeText={setDrawingNo} />
                            </Row>
                        )}
                        <Row label="Name">
                            <TextInput style={styles.uwInput} value={name} onChangeText={setName} />
                        </Row>
                        <Row label="Activation ID">
                            <TextInput style={styles.uwInput} value={activationId} onChangeText={setActivationId} />
                        </Row>
                        <Row label={estLabel}>
                            <TextInput style={styles.uwInput} value={estimate} onChangeText={setEstimate} keyboardType="numeric" />
                        </Row>
                        <Row label="Start Date">
                            <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('start')}>
                                <Text style={styles.dateBtnText}>{start}</Text>
                            </TouchableOpacity>
                        </Row>
                        <Row label="End Date">
                            <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('end')}>
                                <Text style={styles.dateBtnText}>{end}</Text>
                            </TouchableOpacity>
                        </Row>
                        {showResource && (
                            <Row label="Resource">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('resource')}>
                                    <Text style={styles.selectText} numberOfLines={1}>
                                        {resourceId === -1 ? '-- Unassigned --' : lookupName(lookups?.resources, resourceId)}
                                    </Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </Row>
                        )}
                        <Row label="Type">
                            <Toggle value={type === 'Scope'} on="Scope" off="Additional"
                                onChange={(v) => setType(v ? 'Scope' : 'Additional')} />
                        </Row>
                        <Row label="Completed">
                            <Toggle value={completedW} on="Yes" off="No" onChange={setCompletedW} />
                        </Row>
                        {showStarted && (
                            <Row label="Is Started">
                                <Toggle value={isStarted} on="Yes" off="No" onChange={setIsStarted} />
                            </Row>
                        )}
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnWhite} onPress={onClose}>
                            <Text style={styles.btnWhiteText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnGreen} onPress={save}>
                            <Text style={styles.btnBlueText}>Save Changes</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Lookup seçim modalları */}
                    <PickerModal visible={picker != null}
                        items={picker === 'resource'
                            ? [{ id: -1, name: '-- Unassigned --' }, ...(lookups?.resources ?? [])]
                            : picker === 'folder' ? lookups?.folders ?? [] : lookups?.disciplines ?? []}
                        selectedId={picker === 'folder' ? folderId : picker === 'discipline' ? disciplineId : resourceId}
                        onClose={() => setPicker(null)}
                        onPick={(id) => {
                            if (picker === 'folder') setFolderId(id);
                            else if (picker === 'discipline') setDisciplineId(id);
                            else setResourceId(id);
                            setPicker(null);
                        }} />
                    <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                            <View style={styles.modalBox}>
                                <CalendarPicker initial={datePick === 'start' ? start : end}
                                    onPick={(d) => {
                                        if (datePick === 'start') {
                                            setStart(d);
                                            // Web birebir: start ileri alınırsa end de çekilir
                                            if (end < d) setEnd(d);
                                        } else {
                                            // Web birebir: end, start'tan önce olamaz (min={start})
                                            if (d >= start) setEnd(d);
                                        }
                                        setDatePick(null);
                                    }} />
                            </View>
                        </TouchableOpacity>
                    </Modal>
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

// Renkler web ReportByPhase.css birebir (header koyu, mavi/yeşil/kırmızı buton
// aileleri, durum renkleri, satır seçimi)
const styles = StyleSheet.create({
    rph: { flex: 1, backgroundColor: '#f0f2f7' },
    rphContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#fff',
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    lbl: { fontSize: 12, color: '#374151' },
    loadingLbl: { fontSize: 11, color: '#6b7280', marginLeft: 6 },
    toggle: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, backgroundColor: '#fff' },
    toggleActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    toggleText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    toggleTextActive: { color: '#fff' },
    btnBlue: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnGreen: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnRed: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    btnBlueText: { color: '#fff', fontSize: 11, fontWeight: '700' },
    btnWhite: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 6 },
    btnWhiteText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    btnDim: { opacity: 0.5 },
    radio: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    radioDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: '#9ca3af', backgroundColor: '#fff' },
    radioDotOn: { borderColor: '#2563eb', backgroundColor: '#2563eb' },
    radioLbl: { fontSize: 12, color: '#374151' },

    filter: { backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    frow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
    flabel: { fontSize: 11, fontWeight: '700', color: '#6b7280' },
    fvalue: { fontSize: 12, color: '#111827', flexShrink: 1 },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 6, flex: 1, minWidth: 110,
    },
    selectText: { fontSize: 12, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 11, color: '#6b7280', marginLeft: 4 },
    checkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 6 },
    dateBtnText: { fontSize: 12, color: '#111827' },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, margin: 8 },
    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 10, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    rowSel: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 10, color: '#374151', paddingVertical: 6, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    cellEdit: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 4, backgroundColor: '#fffbe6',
        paddingHorizontal: 4, paddingVertical: 2, fontSize: 10, color: '#111827', margin: 2,
    },
    stCompleted: { color: '#037f4c', fontWeight: '700' },
    stProgress: { color: '#0073ea', fontWeight: '700' },
    stNone: { color: '#676879' },
    detailsBtn: { color: '#0073ea', fontSize: 10, fontWeight: '700', textAlign: 'center' },

    chartCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, margin: 8 },

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

    uwCardHead: { fontSize: 11, fontWeight: '700', color: '#6b7280', marginBottom: 8 },
    uwRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    uwLabel: { width: 120, fontSize: 12, color: '#374151' },
    uwField: { flex: 1 },
    uwInput: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 6, fontSize: 12, color: '#111827',
    },
    uwToggle: { flexDirection: 'row', gap: 6 },
    uwToggleBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
    uwToggleOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    uwToggleText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    uwToggleTextOn: { color: '#fff' },

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

export default ReportByPhaseScreen;
