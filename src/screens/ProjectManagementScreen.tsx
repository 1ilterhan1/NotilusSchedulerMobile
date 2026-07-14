// Web pages/ProjectManagement.tsx birebir (masaüstü ucProjectManagement klonu).
// Mevcut API: /api/projectmanagement/* (config, lookups, projects, works,
// import, export/txt, project-links, ...)
//
// Birebir korunanlar:
// - Proje seçimi + Show Completed; config görünürlük bayrakları (Phase/
//   Discipline/DrawingNo/Resource/IsStarted/ActivationId) ve gün/saat birimi
// - New Work formu: doğrulama mesajları birebir ("Please Enter Name",
//   "Please Enter Estimated Duration", sayı kontrolü, Folder/Discipline seçimi,
//   "Start date cannot be later than end date!"), 409 overwrite onayı
// - Bulk Import: Add/Update Existing vs Update Existing Only; Excel şablonu;
//   içe aktarım kolon eşleme kuralları birebir; sonuç mesajı Added/Updated/Skipped
// - İş listesi: arama (ad+drawingNo) + Phase/Discipline/Resource filtreleri,
//   kolon başlığına dokununca sıralama (▲/▼), çoklu seçim
// - Mark Completed / Started, More (Not-Completed/Not-Started/Delete — PME
//   Delete göremez), silme onayı metni birebir
// - Project menüsü: Add / Edit / Delete / Set (Not) Completed
// - Edit Project: Project Details + Link to NotilusWeight sekmesi (pending
//   link değişiklikleri, EffectiveYachtIdFor/EffectiveSchedulerIdForYacht,
//   taşıma onayı metni, Save sırası: önce linkler) — masaüstü birebir
// - Update Work modalı (single & bulk: bulk yalnız Phase/Discipline)
// - Export TXT (MS Project) ve Export Excel — dosya + paylaşım sayfası
// Mobil uyarlama: menüler modal liste; Ctrl+tık yerine dokunuş = seçim aç/kapa;
// çift tık/sağ tık yerine uzun basış = Update Work; dosya seçimi
// expo-document-picker; alert/confirm → Alert.alert.

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
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { apiGet, apiFetch } from '../api';
import type { IdName, PmConfig, PmLookups, PmProject, PmWork, TxtExportRow } from '../types';

function todayInput(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toDateInput(iso: string | null): string {
    return iso ? iso.substring(0, 10) : '';
}
function fmtDisplayDate(iso: string | null): string {
    if (!iso) return '';
    const s = iso.substring(0, 10);
    const [y, m, d] = s.split('-');
    return d && m && y ? `${d}.${m}.${y}` : '';
}
function confirmAsync(message: string, title = '!'): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}
async function saveAndShareFile(content: string, fname: string, mime: string, base64 = false) {
    const uri = `${FileSystem.cacheDirectory}${fname}`;
    await FileSystem.writeAsStringAsync(uri, content,
        base64 ? { encoding: FileSystem.EncodingType.Base64 } : undefined);
    if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: mime, dialogTitle: fname });
    }
}
async function saveAndShareXlsx(wb: XLSX.WorkBook, fname: string) {
    const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    await saveAndShareFile(b64, fname,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true);
}

const UNASSIGNED = -1;

function ProjectManagementScreen() {
    const [config, setConfig] = useState<PmConfig | null>(null);
    const [lookups, setLookups] = useState<PmLookups | null>(null);

    const [projects, setProjects] = useState<PmProject[]>([]);
    const [showCompleted, setShowCompleted] = useState(false);
    const [projectId, setProjectId] = useState<number | null>(null);

    const [works, setWorks] = useState<PmWork[]>([]);
    const [loadingWorks, setLoadingWorks] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Filtreler
    const [search, setSearch] = useState('');
    const [filterPhase, setFilterPhase] = useState(0);
    const [filterDiscipline, setFilterDiscipline] = useState(0);
    const [filterResource, setFilterResource] = useState(0);

    // Sıralama
    const [sortCol, setSortCol] = useState<string | null>(null);
    const [sortAsc, setSortAsc] = useState(true);

    // Seçim
    const [selected, setSelected] = useState<Set<number>>(new Set());

    // Drawer
    const [drawer, setDrawer] = useState<'none' | 'newwork' | 'bulk'>('none');

    // Add Work form
    const [awName, setAwName] = useState('');
    const [awDrawingNo, setAwDrawingNo] = useState('');
    const [awFolderId, setAwFolderId] = useState<number | null>(null);
    const [awDisciplineId, setAwDisciplineId] = useState<number | null>(null);
    const [awStart, setAwStart] = useState(todayInput());
    const [awEnd, setAwEnd] = useState(todayInput());
    const [awEstimate, setAwEstimate] = useState('');
    const [awResourceId, setAwResourceId] = useState<number>(UNASSIGNED);
    const [awActivationId, setAwActivationId] = useState('');
    const [awIsStarted, setAwIsStarted] = useState(true);
    const [awType, setAwType] = useState<'Scope' | 'Additional'>('Scope');

    // Bulk import
    const [importMode, setImportMode] = useState<'addupdate' | 'updateonly'>('addupdate');

    // Menüler / modallar
    const [menu, setMenu] = useState<'none' | 'project' | 'more' | 'export'>('none');
    const [addProjectOpen, setAddProjectOpen] = useState(false);
    const [editProjectOpen, setEditProjectOpen] = useState(false);
    const [updateWork, setUpdateWork] = useState<{ mode: 'single' | 'bulk'; ids: number[] } | null>(null);

    // Seçim modalları
    const [picker, setPicker] = useState<
        'none' | 'project' | 'fPhase' | 'fDiscipline' | 'fResource'
        | 'awFolder' | 'awDiscipline' | 'awResource'>('none');
    const [datePick, setDatePick] = useState<'awStart' | 'awEnd' | null>(null);

    const isPME = config?.userStatus === 'PME';

    // ── İlk yükleme: config + lookups ──
    useEffect(() => {
        apiGet<PmConfig>('/api/projectmanagement/config').then(setConfig).catch((e) => setError(e.message));
        apiGet<PmLookups>('/api/projectmanagement/lookups').then((l) => {
            setLookups(l);
            setAwFolderId(l.folders[0]?.id ?? null);
            setAwDisciplineId(l.disciplines[0]?.id ?? null);
        }).catch((e) => setError(e.message));
    }, []);

    // ── Projeler ──
    useEffect(() => {
        apiGet<PmProject[]>(`/api/projectmanagement/projects?completed=${showCompleted}`)
            .then((ps) => {
                setProjects(ps);
                setProjectId((cur) => (cur && ps.some((p) => p.id === cur) ? cur : ps[0]?.id ?? null));
            })
            .catch((e) => setError(e.message));
    }, [showCompleted]);

    // ── İşler ──
    function reloadWorks(pid = projectId) {
        if (pid == null) { setWorks([]); return; }
        setLoadingWorks(true);
        apiGet<PmWork[]>(`/api/projectmanagement/works?projectId=${pid}`)
            .then((w) => setWorks(w))
            .catch((e) => setError(e.message))
            .finally(() => setLoadingWorks(false));
    }
    useEffect(() => { reloadWorks(projectId); setSelected(new Set()); /* eslint-disable-next-line */ }, [projectId]);

    function reloadProjects(keepId?: number) {
        return apiGet<PmProject[]>(`/api/projectmanagement/projects?completed=${showCompleted}`).then((ps) => {
            setProjects(ps);
            setProjectId((cur) => {
                const want = keepId ?? cur;
                return want && ps.some((p) => p.id === want) ? want : ps[0]?.id ?? null;
            });
        });
    }

    // ── Birim dönüşümleri (csAppConfig birebir) ──
    const hpd = config?.hoursPerDay ?? 9;
    const inHours = config?.durationInHours ?? false;
    const dbToDisplay = (v: number) => (inHours ? v * hpd : v);
    const displayToDb = (v: number) => (inHours ? v / hpd : v);

    // ── Filtrelenmiş + sıralanmış işler (web birebir) ──
    const visibleWorks = useMemo(() => {
        const q = search.trim().toLowerCase();
        let list = works.filter((w) =>
            (filterPhase === 0 || w.folderId === filterPhase) &&
            (filterDiscipline === 0 || w.disciplineId === filterDiscipline) &&
            (filterResource === 0 || (w.resourceId ?? -999) === filterResource) &&
            (q === '' ||
                (w.name ?? '').toLowerCase().includes(q) ||
                (w.drawingNo ?? '').toLowerCase().includes(q)));

        if (sortCol) {
            const dir = sortAsc ? 1 : -1;
            list = [...list].sort((a, b) => {
                const get = (w: PmWork): string | number => {
                    switch (sortCol) {
                        case 'folder': return w.folder ?? '';
                        case 'discipline': return w.discipline ?? '';
                        case 'drawingNo': return w.drawingNo ?? '';
                        case 'name': return w.name ?? '';
                        case 'estimate': return dbToDisplay(w.estimatedDuration);
                        case 'start': return w.startDate ?? '';
                        case 'end': return w.endDate ?? '';
                        case 'completed': return w.completed ? 1 : 0;
                        case 'resource': return w.resource ?? '';
                        case 'started': return w.isStarted ? 1 : 0;
                        case 'activation': return w.activationId ?? '';
                        default: return '';
                    }
                };
                const av = get(a), bv = get(b);
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                return String(av).localeCompare(String(bv)) * dir;
            });
        }
        return list;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [works, search, filterPhase, filterDiscipline, filterResource, sortCol, sortAsc, inHours, hpd]);

    function toggleSort(col: string) {
        if (sortCol === col) setSortAsc((a) => !a);
        else { setSortCol(col); setSortAsc(true); }
    }
    const sortMark = (col: string) => (sortCol === col ? (sortAsc ? ' ▲' : ' ▼') : '');

    // Mobil: dokunuş = seçim aç/kapa (masaüstü Ctrl+tık karşılığı)
    function toggleSelect(id: number) {
        setSelected((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    }
    // Uzun basış = Update Work (masaüstü çift tık / sağ tık → Update)
    function onRowLongPress(id: number) {
        const ids = selected.has(id) ? [...selected] : [id];
        if (!selected.has(id)) setSelected(new Set([id]));
        setUpdateWork({ mode: ids.length > 1 ? 'bulk' : 'single', ids });
    }

    // ═══ İş ekle (btnAddWork_Click birebir) ═══
    async function addWork(overwrite = false) {
        setError(null);
        if (!awName.trim()) { Alert.alert('', 'Please Enter Name'); return; }
        if (!awEstimate.trim()) { Alert.alert('', 'Please Enter Estimated Duration'); return; }
        const num = Number(awEstimate.replace(',', '.'));
        if (Number.isNaN(num)) { Alert.alert('', 'Please Enter A Numeric Value For Estimated Duration'); return; }
        if (cfgFolder && !awFolderId) { Alert.alert('', 'Please select a Folder!'); return; }
        if (cfgDiscipline && !awDisciplineId) { Alert.alert('', 'Please select a Discipline!'); return; }
        if (awStart && awEnd && awStart > awEnd) { Alert.alert('', 'Start date cannot be later than end date!'); return; }

        const body = {
            projectId,
            name: awName,
            drawingNo: awDrawingNo,
            folderId: awFolderId ?? 0,
            disciplineId: awDisciplineId ?? 0,
            estimatedDays: displayToDb(num),
            startDate: awStart || null,
            endDate: awEnd || null,
            resourceId: awResourceId,
            isStarted: awIsStarted,
            activationId: awActivationId,
            type: awType,
            overwrite,
        };
        const res = await apiFetch('/api/projectmanagement/works', { method: 'POST', body: JSON.stringify(body) });
        if (res.status === 409) {
            const b = await res.json();
            if (await confirmAsync(b.message)) return addWork(true);
            return;
        }
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        const r = await res.json();
        setAwName(''); setAwDrawingNo(''); setAwEstimate(''); setAwActivationId('');
        reloadWorks();
        Alert.alert('', r.message);
    }

    // ═══ İş sil (DeleteSelectedWorks birebir) ═══
    async function deleteSelectedWorks() {
        const ids = [...selected];
        if (ids.length === 0) { Alert.alert('', 'Please select work(s) to delete!'); return; }
        if (!(await confirmAsync('Related Assignments, WorkAffords, Quality Assurance Reports will be deleted! Do you want to continue?'))) return;
        const res = await apiFetch('/api/projectmanagement/works/delete', { method: 'POST', body: JSON.stringify({ workIds: ids }) });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        setSelected(new Set()); reloadWorks();
        Alert.alert('', 'Selected work(s) deleted!');
    }

    // ═══ Tamamlandı / başladı işaretle ═══
    async function setWorksCompleted(completed: boolean) {
        const ids = [...selected];
        if (ids.length === 0) { Alert.alert('', 'Please select work(s) from the list!'); return; }
        const res = await apiFetch('/api/projectmanagement/works/status', { method: 'POST', body: JSON.stringify({ workIds: ids, completed }) });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        reloadWorks();
    }
    async function setWorksStarted(started: boolean) {
        const ids = [...selected];
        if (ids.length === 0) { Alert.alert('', 'Please select work(s) from the list!'); return; }
        const res = await apiFetch('/api/projectmanagement/works/started', { method: 'POST', body: JSON.stringify({ workIds: ids, started }) });
        if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
        reloadWorks();
    }

    // ═══ Proje: sil / tamamla ═══
    async function deleteProject() {
        if (projectId == null) return;
        if (!(await confirmAsync('Delete this project?'))) return;
        const res = await apiFetch(`/api/projectmanagement/projects/${projectId}`, { method: 'DELETE' });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Failed to delete the project!'); return; }
        await reloadProjects();
        Alert.alert('', b?.message ?? 'Project deleted!');
    }
    async function setProjectCompletion(isComplete: boolean) {
        if (projectId == null) return;
        const res = await apiFetch(`/api/projectmanagement/projects/${projectId}/completion`, { method: 'POST', body: JSON.stringify({ isComplete }) });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
        await reloadProjects();
        Alert.alert('', b?.message);
    }

    // ═══ Export TXT (MS Project) ═══
    async function exportTxt() {
        if (projectId == null) return;
        const rows = await apiGet<TxtExportRow[]>(`/api/projectmanagement/export/txt?projectId=${projectId}`);
        const lines = ['Task name (&WBS),Start Date,Deadline,Duration,Resource Name'];
        for (const r of rows) lines.push(`${r.taskName};${r.startDate};${r.deadline};${r.duration};${r.assignedTo}`);
        await saveAndShareFile(lines.join('\r\n'), 'MSProjectExport.txt', 'text/plain');
    }

    // ═══ Export Excel ═══
    async function exportExcel() {
        try {
            const estHeader = inHours ? 'Budget (Hours)' : 'Estimated Days';
            const header: string[] = ['Phase', 'Discipline', 'Drawing Number', 'Name', estHeader, 'Start Date', 'End Date', 'Completed', 'Resource', 'Is Started'];
            if (cfgActivation) header.push('ActivationId');
            const data: (string | number)[][] = [header];
            for (const w of visibleWorks) {
                const row: (string | number)[] = [
                    w.folder ?? '', w.discipline ?? '', w.drawingNo ?? '', w.name ?? '',
                    dbToDisplay(w.estimatedDuration),
                    toDateInput(w.startDate), toDateInput(w.endDate),
                    w.completed ? 'yes' : 'no', w.resource ?? '',
                    w.isStarted === true ? 'Yes' : w.isStarted === false ? 'No' : '',
                ];
                if (cfgActivation) row.push(w.activationId ?? '');
                data.push(row);
            }
            const ws = XLSX.utils.aoa_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Works');
            await saveAndShareXlsx(wb, 'ProjectWorks.xlsx');
        } catch (e: any) { Alert.alert('', e.message ?? 'Export failed'); }
    }

    // ═══ Şablon indir ═══
    async function downloadTemplate() {
        try {
            const estHeader = inHours ? 'Budget (Hours)' : 'Estimated Days';
            const header = ['Phase', 'Discipline', 'Drawing Number', 'Drawing Name', estHeader, 'Start Date', 'End Date', 'Completed', 'Resource', 'Is Started'];
            const ws = XLSX.utils.aoa_to_sheet([header]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Template');
            await saveAndShareXlsx(wb, 'WorkImportTemplate.xlsx');
            Alert.alert('', 'The import template has been downloaded successfully.');
        } catch (e: any) { Alert.alert('', e.message ?? 'Download failed'); }
    }

    // ═══ Excel'den yükle (Bulk Import birebir — dosya expo-document-picker ile) ═══
    async function pickAndUploadExcel() {
        try {
            const pick = await DocumentPicker.getDocumentAsync({
                type: [
                    'application/vnd.ms-excel',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.ms-excel.sheet.macroEnabled.12',
                ],
                copyToCacheDirectory: true,
            });
            if (pick.canceled || !pick.assets?.[0]) return;
            const b64 = await FileSystem.readAsStringAsync(pick.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
            const wb = XLSX.read(b64, { type: 'base64', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
            if (rows.length === 0) { Alert.alert('', 'No rows found in the file.'); return; }

            const pickCol = (r: any, ...keys: string[]) => {
                for (const k of Object.keys(r)) {
                    const kl = k.trim().toLowerCase();
                    if (keys.some((x) => kl === x.toLowerCase())) return r[k];
                }
                return '';
            };
            const toIso = (v: any): string | null => {
                if (!v) return null;
                if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
                const s = String(v).trim(); return s ? s.substring(0, 10) : null;
            };
            const mapped = rows.map((r) => {
                const estRaw = pickCol(r, 'Budget (Hours)', 'Estimated Days', 'Budget(Hours)', 'EstimatedDays', 'Estimate', 'Budget');
                const est = Number(String(estRaw).replace(',', '.')) || 0;
                const completedRaw = String(pickCol(r, 'Completed')).trim().toLowerCase();
                return {
                    folderName: String(pickCol(r, 'Phase', 'FolderName', 'Folder')).trim(),
                    disciplineName: String(pickCol(r, 'Discipline')).trim(),
                    drawingNo: String(pickCol(r, 'Drawing Number', 'DrawingNo', 'Drawing No')).trim() || null,
                    name: String(pickCol(r, 'Drawing Name', 'Name', 'WorkName')).trim(),
                    estimatedDays: displayToDb(est),
                    startDate: toIso(pickCol(r, 'Start Date', 'StartDate')),
                    endDate: toIso(pickCol(r, 'End Date', 'EndDate')),
                    completed: completedRaw === 'yes' || completedRaw === 'true' || completedRaw === '1',
                    jdoc: String(pickCol(r, 'JDOC')).trim() || null,
                    wbs: String(pickCol(r, 'WBS')).trim() || null,
                    sheet: String(pickCol(r, 'Sheet')).trim() || null,
                    title: String(pickCol(r, 'Title')).trim() || null,
                    subtitle: String(pickCol(r, 'Subtitle')).trim() || null,
                };
            });

            const body = {
                projectId,
                addOrUpdate: importMode === 'addupdate',
                updateExistingOnly: importMode === 'updateonly',
                rows: mapped,
            };
            const res = await apiFetch('/api/projectmanagement/works/import', { method: 'POST', body: JSON.stringify(body) });
            if (!res.ok) { const b = await res.json().catch(() => null); Alert.alert('', b?.message ?? `Error ${res.status}`); return; }
            const r = await res.json();
            reloadWorks();
            Alert.alert('', `Works added!\nAdded: ${r.added}, Updated: ${r.updated}, Skipped: ${r.skipped}`);
        } catch (e: any) { Alert.alert('', e.message ?? 'Import failed'); }
    }

    // ── Config görünürlük bayrakları (setVisibilities birebir) ──
    const cfgFolder = config?.folderIsVisibleForProjects ?? true;
    const cfgDiscipline = config?.disciplineIsVisibleForWorkEntry ?? true;
    const cfgDrawing = config?.showDrawingNumberInWorklist ?? false;
    const cfgResource = config?.resourceIsVisible ?? false;
    const cfgStarted = config?.checkStartedJobForWorks ?? false;
    const cfgActivation = config?.activationIdIsVisibleForProjectManagement ?? true;
    const estLabel = inHours ? 'Budget(hours)' : 'Est. Days';
    const estColHeader = inHours ? 'Budget(hours)' : 'EstimatedDuration(Days)';
    const nameColHeader = cfgDrawing ? 'DrawingName' : 'WorkName';

    const currentProject = projects.find((p) => p.id === projectId);
    const selectedWork = updateWork && updateWork.mode === 'single'
        ? works.find((w) => w.id === updateWork.ids[0]) ?? null : null;

    const filterName = (list: IdName[] | undefined, id: number) =>
        id === 0 ? 'No Filter' : (list?.find(x => x.id === id)?.name ?? 'No Filter');

    // Kolonlar (config'e göre)
    const COLS: { key: string; label: string; width: number }[] = [
        ...(cfgFolder ? [{ key: 'folder', label: 'Phase', width: 100 }] : []),
        ...(cfgDiscipline ? [{ key: 'discipline', label: 'Discipline', width: 90 }] : []),
        ...(cfgDrawing ? [{ key: 'drawingNo', label: 'Drawing Number', width: 110 }] : []),
        { key: 'name', label: nameColHeader, width: 160 },
        { key: 'estimate', label: estColHeader, width: 110 },
        { key: 'start', label: 'Start Date', width: 86 },
        { key: 'end', label: 'End Date', width: 86 },
        { key: 'completed', label: 'Completed', width: 76 },
        ...(cfgResource ? [{ key: 'resource', label: 'Resource', width: 90 }] : []),
        ...(cfgStarted ? [{ key: 'started', label: 'Is Started', width: 70 }] : []),
        ...(cfgActivation ? [{ key: 'activation', label: 'Activation ID', width: 100 }] : []),
    ];

    function cellValue(w: PmWork, key: string): string {
        switch (key) {
            case 'folder': return w.folder ?? '';
            case 'discipline': return w.discipline ?? '';
            case 'drawingNo': return w.drawingNo ?? '';
            case 'name': return w.name ?? '';
            case 'estimate': return String(dbToDisplay(w.estimatedDuration));
            case 'start': return fmtDisplayDate(w.startDate);
            case 'end': return fmtDisplayDate(w.endDate);
            case 'completed': return w.completed ? 'Yes' : 'No';
            case 'resource': return w.resource ?? '';
            case 'started': return w.isStarted === true ? 'Yes' : w.isStarted === false ? 'No' : '';
            case 'activation': return w.activationId ?? '';
            default: return '';
        }
    }

    return (
        <ScrollView style={styles.pm} contentContainerStyle={styles.pmContent}>
            <Text style={styles.h1}>Project Management</Text>
            {error && <Text style={styles.error}>{error}</Text>}

            {/* ── Toolbar ── */}
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Project</Text>
                <TouchableOpacity style={styles.select} onPress={() => setPicker('project')}>
                    <Text style={styles.selectText} numberOfLines={1}>{currentProject?.name ?? '—'}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
                <Checkbox checked={showCompleted} onChange={setShowCompleted} label="Show Completed" />
            </View>
            <View style={styles.toolbar}>
                <TouchableOpacity style={drawer === 'newwork' ? styles.btnOpen : styles.btnPrimary}
                    onPress={() => setDrawer((d) => (d === 'newwork' ? 'none' : 'newwork'))}>
                    <Text style={styles.btnPrimaryText}>{drawer === 'newwork' ? '✕  Close Form' : '+  New Work'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={drawer === 'bulk' ? styles.btnOpen : styles.btnWhite}
                    onPress={() => setDrawer((d) => (d === 'bulk' ? 'none' : 'bulk'))}>
                    <Text style={drawer === 'bulk' ? styles.btnPrimaryText : styles.btnWhiteText}>
                        {drawer === 'bulk' ? '✕  Close Import' : 'Bulk Import'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnWhite} onPress={() => setMenu('project')}>
                    <Text style={styles.btnWhiteText}>Project ▾</Text>
                </TouchableOpacity>
            </View>

            {/* ── New Work drawer ── */}
            {drawer === 'newwork' && (
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>NEW WORK</Text>
                    <View style={styles.cardBody}>
                        <FieldRow label="Name">
                            <TextInput style={styles.input} value={awName} onChangeText={setAwName} />
                        </FieldRow>
                        {cfgDrawing && (
                            <FieldRow label="Drawing No">
                                <TextInput style={styles.input} value={awDrawingNo} onChangeText={setAwDrawingNo} />
                            </FieldRow>
                        )}
                        {cfgFolder && (
                            <FieldRow label="Phase">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('awFolder')}>
                                    <Text style={styles.selectText} numberOfLines={1}>
                                        {lookups?.folders.find(f => f.id === awFolderId)?.name ?? '—'}
                                    </Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        {cfgDiscipline && (
                            <FieldRow label="Discipline">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('awDiscipline')}>
                                    <Text style={styles.selectText} numberOfLines={1}>
                                        {lookups?.disciplines.find(d => d.id === awDisciplineId)?.name ?? '—'}
                                    </Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        <FieldRow label="Start Date">
                            <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('awStart')}>
                                <Text style={styles.dateBtnText}>{awStart}</Text>
                            </TouchableOpacity>
                        </FieldRow>
                        <FieldRow label="End Date">
                            <TouchableOpacity style={styles.dateBtn} onPress={() => setDatePick('awEnd')}>
                                <Text style={styles.dateBtnText}>{awEnd}</Text>
                            </TouchableOpacity>
                        </FieldRow>
                        <FieldRow label={estLabel}>
                            <TextInput style={styles.input} value={awEstimate} onChangeText={setAwEstimate} keyboardType="numeric" />
                        </FieldRow>
                        {cfgResource && (
                            <FieldRow label="Resource">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('awResource')}>
                                    <Text style={styles.selectText} numberOfLines={1}>
                                        {awResourceId === UNASSIGNED ? '-- Unassigned --'
                                            : lookups?.resources.find(r => r.id === awResourceId)?.name ?? '—'}
                                    </Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        {cfgActivation && (
                            <FieldRow label="Activation Id">
                                <TextInput style={styles.input} value={awActivationId} onChangeText={setAwActivationId} />
                            </FieldRow>
                        )}
                        <View style={styles.row3}>
                            {cfgStarted && <Checkbox checked={awIsStarted} onChange={setAwIsStarted} label="Is Started" />}
                            <Radio checked={awType === 'Scope'} onPress={() => setAwType('Scope')} label="Scope" />
                            <Radio checked={awType === 'Additional'} onPress={() => setAwType('Additional')} label="Additional" />
                        </View>
                        <TouchableOpacity style={[styles.btnPrimary, { marginTop: 10 }]} onPress={() => addWork()}>
                            <Text style={styles.btnPrimaryText}>Add Work</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {/* ── Bulk Import drawer ── */}
            {drawer === 'bulk' && (
                <View style={styles.card}>
                    <Text style={styles.cardTitle}>BULK IMPORT FROM EXCEL</Text>
                    <View style={styles.cardBody}>
                        <View style={styles.row3}>
                            <Radio checked={importMode === 'addupdate'} onPress={() => setImportMode('addupdate')} label="Add / Update Existing" />
                            <Radio checked={importMode === 'updateonly'} onPress={() => setImportMode('updateonly')} label="Update Existing Only" />
                        </View>
                        <View style={[styles.row3, { marginTop: 10 }]}>
                            <TouchableOpacity style={styles.btnPrimary} onPress={pickAndUploadExcel}>
                                <Text style={styles.btnPrimaryText}>Upload from Excel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnWhite} onPress={downloadTemplate}>
                                <Text style={styles.btnWhiteText}>Download Template</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            )}

            {/* ── Filtreler ── */}
            <View style={styles.card}>
                <View style={styles.cardBody}>
                    <FieldRow label="Search">
                        <TextInput style={styles.input} value={search} onChangeText={setSearch}
                            autoCapitalize="none" autoCorrect={false} />
                    </FieldRow>
                    {cfgFolder && (
                        <FieldRow label="Phase">
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('fPhase')}>
                                <Text style={styles.selectText} numberOfLines={1}>{filterName(lookups?.folders, filterPhase)}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                        </FieldRow>
                    )}
                    {cfgDiscipline && (
                        <FieldRow label="Discipline">
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('fDiscipline')}>
                                <Text style={styles.selectText} numberOfLines={1}>{filterName(lookups?.disciplines, filterDiscipline)}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                        </FieldRow>
                    )}
                    {cfgResource && (
                        <FieldRow label="Resource">
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('fResource')}>
                                <Text style={styles.selectText} numberOfLines={1}>{filterName(lookups?.resources, filterResource)}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                        </FieldRow>
                    )}
                </View>
            </View>

            {/* ── Work list ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>WORK ITEMS {selected.size > 0 ? `(${selected.size} selected)` : ''}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            {COLS.map((c) => (
                                <TouchableOpacity key={c.key} style={{ width: c.width }} onPress={() => toggleSort(c.key)}>
                                    <Text style={styles.gridHeadCell}>{c.label}{sortMark(c.key)}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                        {loadingWorks ? (
                            <View style={styles.gridRow}><Text style={styles.gridNone}>Loading…</Text></View>
                        ) : visibleWorks.length === 0 ? (
                            <View style={styles.gridRow}><Text style={styles.gridNone}>No records found.</Text></View>
                        ) : visibleWorks.map((w) => (
                            <TouchableOpacity key={w.id}
                                style={[styles.gridRow, selected.has(w.id) && styles.rowSel]}
                                onPress={() => toggleSelect(w.id)}
                                onLongPress={() => onRowLongPress(w.id)}>
                                {COLS.map((c) => (
                                    c.key === 'completed' ? (
                                        <View key={c.key} style={{ width: c.width }}>
                                            <Text style={[styles.badge, w.completed ? styles.badgeYes : styles.badgeNo]}>
                                                {w.completed ? 'Yes' : 'No'}
                                            </Text>
                                        </View>
                                    ) : (
                                        <Text key={c.key} style={[styles.gridCell, { width: c.width }]}
                                            numberOfLines={c.key === 'name' ? 2 : 1}>
                                            {cellValue(w, c.key)}
                                        </Text>
                                    )
                                ))}
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            </View>

            {/* ── Footer ── */}
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.btnGreen} onPress={() => setWorksCompleted(true)}>
                    <Text style={styles.btnPrimaryText}>Mark Completed</Text>
                </TouchableOpacity>
                {cfgStarted && (
                    <TouchableOpacity style={styles.btnPrimary} onPress={() => setWorksStarted(true)}>
                        <Text style={styles.btnPrimaryText}>Mark Started</Text>
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.btnWhite} onPress={() => setMenu('more')}>
                    <Text style={styles.btnWhiteText}>More ▾</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btnWhite} onPress={() => setMenu('export')}>
                    <Text style={styles.btnWhiteText}>Export ▾</Text>
                </TouchableOpacity>
            </View>

            {/* ── Menü modalları ── */}
            <MenuModal visible={menu === 'project'} onClose={() => setMenu('none')}
                items={[
                    { label: '+ Add Project', onPress: () => { setMenu('none'); setAddProjectOpen(true); } },
                    { label: 'Edit Project…', onPress: () => { setMenu('none'); if (projectId != null) setEditProjectOpen(true); } },
                    { label: 'Delete Project', danger: true, onPress: () => { setMenu('none'); deleteProject(); } },
                    { label: 'Set Completed', onPress: () => { setMenu('none'); setProjectCompletion(true); } },
                    { label: 'Set Not Completed', onPress: () => { setMenu('none'); setProjectCompletion(false); } },
                ]} />
            <MenuModal visible={menu === 'more'} onClose={() => setMenu('none')}
                items={[
                    { label: 'Mark Not-Completed', onPress: () => { setMenu('none'); setWorksCompleted(false); } },
                    ...(cfgStarted ? [{ label: 'Mark Not-Started', onPress: () => { setMenu('none'); setWorksStarted(false); } }] : []),
                    ...(!isPME ? [{ label: 'Delete Selected', danger: true, onPress: () => { setMenu('none'); deleteSelectedWorks(); } }] : []),
                ]} />
            <MenuModal visible={menu === 'export'} onClose={() => setMenu('none')}
                items={[
                    { label: 'Export to TXT (MS Project)', onPress: () => { setMenu('none'); exportTxt(); } },
                    { label: 'Export to Excel', onPress: () => { setMenu('none'); exportExcel(); } },
                ]} />

            {/* ── Seçim modalları ── */}
            <PickerModal visible={picker === 'project'} items={projects} selectedId={projectId}
                onClose={() => setPicker('none')}
                onPick={(id) => { setPicker('none'); setProjectId(id); }} />
            <PickerModal visible={picker === 'fPhase' || picker === 'fDiscipline' || picker === 'fResource'}
                items={[{ id: 0, name: 'No Filter' },
                    ...(picker === 'fPhase' ? lookups?.folders ?? []
                        : picker === 'fDiscipline' ? lookups?.disciplines ?? []
                        : lookups?.resources ?? [])]}
                selectedId={picker === 'fPhase' ? filterPhase : picker === 'fDiscipline' ? filterDiscipline : filterResource}
                onClose={() => setPicker('none')}
                onPick={(id) => {
                    if (picker === 'fPhase') setFilterPhase(id);
                    else if (picker === 'fDiscipline') setFilterDiscipline(id);
                    else setFilterResource(id);
                    setPicker('none');
                }} />
            <PickerModal visible={picker === 'awFolder' || picker === 'awDiscipline' || picker === 'awResource'}
                items={picker === 'awResource'
                    ? [{ id: UNASSIGNED, name: '-- Unassigned --' }, ...(lookups?.resources ?? [])]
                    : picker === 'awFolder' ? lookups?.folders ?? [] : lookups?.disciplines ?? []}
                selectedId={picker === 'awFolder' ? awFolderId : picker === 'awDiscipline' ? awDisciplineId : awResourceId}
                onClose={() => setPicker('none')}
                onPick={(id) => {
                    if (picker === 'awFolder') setAwFolderId(id);
                    else if (picker === 'awDiscipline') setAwDisciplineId(id);
                    else setAwResourceId(id);
                    setPicker('none');
                }} />

            {/* ── Tarih seçici ── */}
            <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker initial={datePick === 'awStart' ? awStart : awEnd}
                            onPick={(d) => {
                                if (datePick === 'awStart') {
                                    setAwStart(d);
                                    if (awEnd < d) setAwEnd(d);   // web birebir
                                } else if (d >= awStart) {
                                    setAwEnd(d);   // web: min={awStart}
                                }
                                setDatePick(null);
                            }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ── Add Project ── */}
            {addProjectOpen && (
                <AddProjectModal onClose={() => setAddProjectOpen(false)}
                    onCreated={async (newId) => { setAddProjectOpen(false); await reloadProjects(newId); }} />
            )}

            {/* ── Edit Project ── */}
            {editProjectOpen && projectId != null && currentProject && (
                <EditProjectModal
                    project={currentProject}
                    onClose={() => setEditProjectOpen(false)}
                    onSaved={async () => { setEditProjectOpen(false); await reloadProjects(projectId); }} />
            )}

            {/* ── Update Work ── */}
            {updateWork && (
                <UpdateWorkModal
                    mode={updateWork.mode}
                    work={selectedWork}
                    ids={updateWork.ids}
                    lookups={lookups}
                    cfg={{ cfgFolder, cfgDiscipline, cfgDrawing, cfgResource, cfgStarted, cfgActivation, inHours }}
                    dbToDisplay={dbToDisplay}
                    displayToDb={displayToDb}
                    onClose={() => setUpdateWork(null)}
                    onSaved={() => { setUpdateWork(null); reloadWorks(); }} />
            )}
        </ScrollView>
    );
}

// ═══ Add Project modal (FormAddProject birebir) ═══
function AddProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
    const [name, setName] = useState('');
    async function create() {
        if (!name.trim()) { Alert.alert('', 'Please enter a project name!'); return; }
        const res = await apiFetch('/api/projectmanagement/projects', { method: 'POST', body: JSON.stringify({ name }) });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
        onCreated(b.id);
    }
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={styles.modalBox}>
                    <Text style={styles.modalHead}>Add Project</Text>
                    <Text style={styles.cardTitle}>PROJECT DETAILS</Text>
                    <FieldRow label="Project Name">
                        <TextInput style={styles.input} autoFocus value={name} onChangeText={setName}
                            onSubmitEditing={create} />
                    </FieldRow>
                    <Text style={styles.hint}>Enter a unique name for this project</Text>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnWhite} onPress={onClose}>
                            <Text style={styles.btnWhiteText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnGreen} onPress={create}>
                            <Text style={styles.btnPrimaryText}>Create Project</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

// ═══ Edit Project modal (FormEditProject birebir: Details + Link to NotilusWeight) ═══
interface LinkDto { schedulerId: number; weightId: number | null }
interface LinksPayload { projects: { id: number; name: string }[]; yachts: { id: number; name: string }[]; links: LinkDto[] }

export function EditProjectModal({ project, initialTab = 'details', onClose, onSaved }:
    { project: PmProject; initialTab?: 'details' | 'link'; onClose: () => void; onSaved: () => void }) {
    const [tab, setTab] = useState<'details' | 'link'>(initialTab);
    const [name, setName] = useState(project.name);
    const [dashboard, setDashboard] = useState(project.isDashboardVisible !== false);

    const [linkData, setLinkData] = useState<LinksPayload | null>(null);
    // Bekleyen değişiklikler (Save'de uygulanır). null = "unlink".
    const [pending, setPending] = useState<Record<number, number | null>>({});
    const [selSched, setSelSched] = useState<number>(project.id);
    const [selYacht, setSelYacht] = useState<number>(0);

    useEffect(() => {
        apiGet<LinksPayload>('/api/projectmanagement/project-links')
            .then(setLinkData)
            .catch(() => { Alert.alert('', 'Could not load linking data.'); setLinkData({ projects: [], yachts: [], links: [] }); });
    }, []);

    // EffectiveYachtIdFor birebir
    function effectiveYachtIdFor(schedulerId: number): number | null {
        if (schedulerId in pending) return pending[schedulerId];
        const existing = linkData?.links.find((pl) => pl.schedulerId === schedulerId);
        return existing?.weightId ?? null;
    }
    // EffectiveSchedulerIdForYacht birebir
    function effectiveSchedulerIdForYacht(yachtId: number): number | null {
        for (const [k, v] of Object.entries(pending)) {
            if (v === yachtId) return Number(k);
        }
        const existing = linkData?.links.find((pl) =>
            pl.weightId === yachtId && pl.schedulerId != null && !(pl.schedulerId in pending));
        return existing?.schedulerId ?? null;
    }

    // BtnLink_Click birebir
    async function linkSelected() {
        if (selSched <= 0 || selYacht <= 0) return;
        const prevSched = effectiveSchedulerIdForYacht(selYacht);
        const next = { ...pending };
        if (prevSched != null && prevSched !== selSched) {
            const prevName = linkData?.projects.find((p) => p.id === prevSched)?.name ?? `(project #${prevSched})`;
            if (!(await confirmAsync(`This analytics project is already linked to "${prevName}".\n\nDo you want to move the link to the project selected on the left?`))) return;
            next[prevSched] = null;
        }
        next[selSched] = selYacht;
        setPending(next);
    }
    // BtnUnlink_Click birebir
    function unlinkProject() {
        if (selSched <= 0) return;
        setPending({ ...pending, [selSched]: null });
    }

    async function save() {
        if (!name.trim()) { Alert.alert('', 'Please enter a project name.'); setTab('details'); return; }

        // BtnSave_Click birebir: önce link değişiklikleri, hata olursa modal açık kalır
        const changes = Object.entries(pending).map(([k, v]) => ({ schedulerId: Number(k), weightId: v }));
        if (changes.length > 0) {
            const lr = await apiFetch('/api/projectmanagement/project-links', {
                method: 'PUT', body: JSON.stringify({ changes }),
            });
            if (!lr.ok) {
                const lb = await lr.json().catch(() => null);
                Alert.alert('', 'Could not save project link changes:\n' + (lb?.message ?? `Error ${lr.status}`));
                return;
            }
        }

        const res = await apiFetch(`/api/projectmanagement/projects/${project.id}`, {
            method: 'PUT', body: JSON.stringify({ name, isDashboardVisible: dashboard }),
        });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
        Alert.alert('', 'Project updated successfully!');
        onSaved();
    }

    const curYachtId = effectiveYachtIdFor(project.id);
    const curYachtName = curYachtId != null
        ? (linkData?.yachts.find((y) => y.id === curYachtId)?.name ?? `(yacht #${curYachtId})`)
        : null;
    const unlinkEnabled = selSched > 0 && effectiveYachtIdFor(selSched) != null;

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '92%' }]}>
                    <Text style={styles.modalHead}>Edit Project</Text>
                    <View style={styles.tabbar}>
                        <TouchableOpacity style={[styles.tab, tab === 'details' && styles.tabActive]} onPress={() => setTab('details')}>
                            <Text style={[styles.tabText, tab === 'details' && styles.tabTextActive]}>Project Details</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.tab, tab === 'link' && styles.tabActive]} onPress={() => setTab('link')}>
                            <Text style={[styles.tabText, tab === 'link' && styles.tabTextActive]}>Link to NotilusWeight</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView>
                        {tab === 'details' && (
                            <View>
                                <Text style={styles.cardTitle}>PROJECT DETAILS</Text>
                                <FieldRow label="Project Name">
                                    <TextInput style={styles.input} value={name} onChangeText={setName} />
                                </FieldRow>
                                <FieldRow label="Show in Dashboard">
                                    <Checkbox checked={dashboard} onChange={setDashboard} label="Visible in Project Summary" />
                                </FieldRow>
                                <Text style={styles.hint}>When unchecked, this project won't appear in the Dashboard.</Text>
                            </View>
                        )}
                        {tab === 'link' && (
                            <View>
                                <Text style={styles.cardTitle}>MANUAL PROJECT MAPPING</Text>
                                <Text style={[styles.linkBanner, curYachtId == null && styles.linkBannerMuted]}>
                                    {linkData == null
                                        ? 'Loading current link...'
                                        : curYachtId != null
                                            ? `Current link:  this project <-> ${curYachtName}`
                                            : 'Current link:  this project is not yet linked to any analytics project.'}
                                </Text>

                                <Text style={styles.linkPanelHead}>Scheduler Projects (this company)</Text>
                                <View style={styles.linkList}>
                                    <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                                        {(linkData?.projects ?? []).map((p) => {
                                            const yId = effectiveYachtIdFor(p.id);
                                            const yName = yId != null ? linkData?.yachts.find((y) => y.id === yId)?.name : null;
                                            return (
                                                <TouchableOpacity key={p.id}
                                                    style={[styles.linkRow, selSched === p.id && styles.linkRowSel]}
                                                    onPress={() => setSelSched(p.id)}>
                                                    <Text style={styles.linkName} numberOfLines={1}>{p.name}</Text>
                                                    <Text style={yId != null ? styles.linked : styles.unlinked} numberOfLines={1}>
                                                        {yId != null ? 'Linked' + (yName ? ' -> ' + yName : '') : 'Not linked'}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                </View>

                                <Text style={styles.linkPanelHead}>NotilusAnalytics Projects</Text>
                                <View style={styles.linkList}>
                                    <ScrollView style={{ maxHeight: 160 }} nestedScrollEnabled>
                                        {linkData != null && linkData.yachts.length === 0 && (
                                            <View style={styles.linkRow}>
                                                <Text style={styles.linkName}>(No analytics projects found for this company)</Text>
                                            </View>
                                        )}
                                        {(linkData?.yachts ?? []).map((y) => {
                                            const sId = effectiveSchedulerIdForYacht(y.id);
                                            const sName = sId != null ? linkData?.projects.find((p) => p.id === sId)?.name : null;
                                            return (
                                                <TouchableOpacity key={y.id}
                                                    style={[styles.linkRow, selYacht === y.id && styles.linkRowSel]}
                                                    onPress={() => setSelYacht(y.id)}>
                                                    <Text style={styles.linkName} numberOfLines={1}>{y.name || '(unnamed)'}</Text>
                                                    <Text style={sId != null ? styles.linked : styles.unlinked} numberOfLines={1}>
                                                        {sId != null ? 'Linked' + (sName ? ' <- ' + sName : '') : 'Available'}
                                                    </Text>
                                                </TouchableOpacity>
                                            );
                                        })}
                                    </ScrollView>
                                </View>

                                <Text style={styles.hint}>Select one project from each side, then click Link.</Text>
                                <View style={styles.row3}>
                                    <TouchableOpacity
                                        style={[styles.btnPrimary, !(selSched > 0 && selYacht > 0) && styles.btnDim]}
                                        disabled={!(selSched > 0 && selYacht > 0)} onPress={linkSelected}>
                                        <Text style={styles.btnPrimaryText}>Link Selected -&gt;</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.btnDanger, !unlinkEnabled && styles.btnDim]}
                                        disabled={!unlinkEnabled} onPress={unlinkProject}>
                                        <Text style={styles.btnPrimaryText}>Unlink Project</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnWhite} onPress={onClose}>
                            <Text style={styles.btnWhiteText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnPrimary} onPress={save}>
                            <Text style={styles.btnPrimaryText}>Save Changes</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

// ═══ Update Work modal (FormUpdateWork — single & bulk, birebir) ═══
interface CfgFlags {
    cfgFolder: boolean; cfgDiscipline: boolean; cfgDrawing: boolean;
    cfgResource: boolean; cfgStarted: boolean; cfgActivation: boolean; inHours: boolean;
}
function UpdateWorkModal({ mode, work, ids, lookups, cfg, dbToDisplay, displayToDb, onClose, onSaved }: {
    mode: 'single' | 'bulk'; work: PmWork | null; ids: number[]; lookups: PmLookups | null;
    cfg: CfgFlags; dbToDisplay: (v: number) => number; displayToDb: (v: number) => number;
    onClose: () => void; onSaved: () => void;
}) {
    const bulk = mode === 'bulk';
    const [folderId, setFolderId] = useState<number>(work?.folderId ?? lookups?.folders[0]?.id ?? 0);
    const [disciplineId, setDisciplineId] = useState<number>(work?.disciplineId ?? lookups?.disciplines[0]?.id ?? 0);
    const [drawingNo, setDrawingNo] = useState(work?.drawingNo ?? '');
    const [name, setName] = useState(work?.name ?? '');
    const [activationId, setActivationId] = useState(work?.activationId ?? '');
    const [estimate, setEstimate] = useState(work ? String(dbToDisplay(work.estimatedDuration)) : '');
    const [start, setStart] = useState(toDateInput(work?.startDate ?? null) || todayInput());
    const [end, setEnd] = useState(toDateInput(work?.endDate ?? null) || todayInput());
    const [resourceId, setResourceId] = useState<number>(work?.resourceId ?? UNASSIGNED);
    const [type, setType] = useState<'Scope' | 'Additional'>(work?.type === 'Additional' ? 'Additional' : 'Scope');
    const [completed, setCompleted] = useState(work?.completed ?? false);
    const [isStarted, setIsStarted] = useState(work?.isStarted ?? false);

    const [picker, setPicker] = useState<'none' | 'folder' | 'discipline' | 'resource'>('none');
    const [datePick, setDatePick] = useState<'start' | 'end' | null>(null);

    const estLabel = cfg.inHours ? 'Budget (hours)' : 'Estimated Duration (days)';

    async function save() {
        if (bulk) {
            const res = await apiFetch('/api/projectmanagement/works/bulk-phase-discipline', {
                method: 'PUT', body: JSON.stringify({ workIds: ids, folderId, disciplineId }),
            });
            const b = await res.json().catch(() => null);
            if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
            Alert.alert('', 'Selected works updated!'); onSaved(); return;
        }
        if (!name.trim()) { Alert.alert('', 'Please enter a name.'); return; }
        if (!estimate.trim()) { Alert.alert('', 'Please enter the estimated duration.'); return; }
        const num = Number(estimate.replace(',', '.'));
        if (Number.isNaN(num)) { Alert.alert('', 'Estimated duration must be a valid number.'); return; }
        const body = {
            name, drawingNo, folderId, disciplineId,
            estimatedDays: displayToDb(num),
            startDate: start || null, endDate: end || null,
            resourceId, isStarted, completed, type, activationId,
        };
        const res = await apiFetch(`/api/projectmanagement/works/${ids[0]}`, { method: 'PUT', body: JSON.stringify(body) });
        const b = await res.json().catch(() => null);
        if (!res.ok) { Alert.alert('', b?.message ?? 'Error'); return; }
        Alert.alert('', 'Work updated!'); onSaved();
    }

    const lookupName = (list: IdName[] | undefined, id: number, fallback = '—') =>
        list?.find(x => x.id === id)?.name ?? fallback;

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '92%' }]}>
                    <Text style={styles.modalHead}>{bulk ? 'Bulk Update Work' : 'Update Work'}</Text>
                    <ScrollView>
                        <Text style={styles.cardTitle}>WORK DETAILS</Text>
                        {cfg.cfgFolder && (
                            <FieldRow label="Phase">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('folder')}>
                                    <Text style={styles.selectText} numberOfLines={1}>{lookupName(lookups?.folders, folderId)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        {cfg.cfgDiscipline && (
                            <FieldRow label="Discipline">
                                <TouchableOpacity style={styles.select} onPress={() => setPicker('discipline')}>
                                    <Text style={styles.selectText} numberOfLines={1}>{lookupName(lookups?.disciplines, disciplineId)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        {cfg.cfgDrawing && (
                            <FieldRow label="Drawing Number">
                                <TextInput style={[styles.input, bulk && styles.inputDisabled]} editable={!bulk}
                                    value={drawingNo} onChangeText={setDrawingNo} />
                            </FieldRow>
                        )}
                        <FieldRow label="Name">
                            <TextInput style={[styles.input, bulk && styles.inputDisabled]} editable={!bulk}
                                value={name} onChangeText={setName} />
                        </FieldRow>
                        {cfg.cfgActivation && (
                            <FieldRow label="Activation ID">
                                <TextInput style={[styles.input, bulk && styles.inputDisabled]} editable={!bulk}
                                    value={activationId} onChangeText={setActivationId} />
                            </FieldRow>
                        )}
                        <FieldRow label={estLabel}>
                            <TextInput style={[styles.input, bulk && styles.inputDisabled]} editable={!bulk}
                                value={estimate} onChangeText={setEstimate} keyboardType="numeric" />
                        </FieldRow>
                        <FieldRow label="Start Date">
                            <TouchableOpacity style={[styles.dateBtn, bulk && styles.btnDim]} disabled={bulk}
                                onPress={() => setDatePick('start')}>
                                <Text style={styles.dateBtnText}>{start}</Text>
                            </TouchableOpacity>
                        </FieldRow>
                        <FieldRow label="End Date">
                            <TouchableOpacity style={[styles.dateBtn, bulk && styles.btnDim]} disabled={bulk}
                                onPress={() => setDatePick('end')}>
                                <Text style={styles.dateBtnText}>{end}</Text>
                            </TouchableOpacity>
                        </FieldRow>
                        {cfg.cfgResource && (
                            <FieldRow label="Resource">
                                <TouchableOpacity style={[styles.select, bulk && styles.btnDim]} disabled={bulk}
                                    onPress={() => setPicker('resource')}>
                                    <Text style={styles.selectText} numberOfLines={1}>
                                        {resourceId === UNASSIGNED ? '-- Unassigned --' : lookupName(lookups?.resources, resourceId)}
                                    </Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                            </FieldRow>
                        )}
                        <FieldRow label="Type">
                            <ToggleGroup value={type === 'Scope'} on="Scope" off="Additional" disabled={bulk}
                                onChange={(v) => setType(v ? 'Scope' : 'Additional')} />
                        </FieldRow>
                        <FieldRow label="Completed">
                            <ToggleGroup value={completed} on="Yes" off="No" disabled={bulk} onChange={setCompleted} />
                        </FieldRow>
                        {cfg.cfgStarted && (
                            <FieldRow label="Is Started">
                                <ToggleGroup value={isStarted} on="Yes" off="No" disabled={bulk} onChange={setIsStarted} />
                            </FieldRow>
                        )}
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnWhite} onPress={onClose}>
                            <Text style={styles.btnWhiteText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnGreen} onPress={save}>
                            <Text style={styles.btnPrimaryText}>Save Changes</Text>
                        </TouchableOpacity>
                    </View>

                    <PickerModal visible={picker !== 'none'}
                        items={picker === 'resource'
                            ? [{ id: UNASSIGNED, name: '-- Unassigned --' }, ...(lookups?.resources ?? [])]
                            : picker === 'folder' ? lookups?.folders ?? [] : lookups?.disciplines ?? []}
                        selectedId={picker === 'folder' ? folderId : picker === 'discipline' ? disciplineId : resourceId}
                        onClose={() => setPicker('none')}
                        onPick={(id) => {
                            if (picker === 'folder') setFolderId(id);
                            else if (picker === 'discipline') setDisciplineId(id);
                            else setResourceId(id);
                            setPicker('none');
                        }} />
                    <Modal visible={datePick != null} transparent animationType="fade" onRequestClose={() => setDatePick(null)}>
                        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDatePick(null)}>
                            <View style={styles.modalBox}>
                                <CalendarPicker initial={datePick === 'start' ? start : end}
                                    onPick={(d) => {
                                        if (datePick === 'start') {
                                            setStart(d);
                                            if (end < d) setEnd(d);
                                        } else if (d >= start) {
                                            setEnd(d);
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

// ── Küçük yardımcı bileşenler ──
function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <View style={styles.fieldBody}>{children}</View>
        </View>
    );
}
function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
    return (
        <TouchableOpacity style={styles.cbRow} onPress={() => onChange(!checked)}>
            <View style={[styles.cbBox, checked && styles.cbBoxOn]}>
                {checked && <Text style={styles.cbTick}>✓</Text>}
            </View>
            <Text style={styles.cbLabel}>{label}</Text>
        </TouchableOpacity>
    );
}
function Radio({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
    return (
        <TouchableOpacity style={styles.cbRow} onPress={onPress}>
            <View style={[styles.radioDot, checked && styles.radioDotOn]} />
            <Text style={styles.cbLabel}>{label}</Text>
        </TouchableOpacity>
    );
}
function ToggleGroup({ value, on, off, onChange, disabled }: {
    value: boolean; on: string; off: string; onChange: (v: boolean) => void; disabled?: boolean;
}) {
    return (
        <View style={styles.toggleGroup}>
            <TouchableOpacity style={[styles.toggleBtn, value && styles.toggleBtnOn, disabled && styles.btnDim]}
                disabled={disabled} onPress={() => onChange(true)}>
                <Text style={[styles.toggleBtnText, value && styles.toggleBtnTextOn]}>{on}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggleBtn, !value && styles.toggleBtnOn, disabled && styles.btnDim]}
                disabled={disabled} onPress={() => onChange(false)}>
                <Text style={[styles.toggleBtnText, !value && styles.toggleBtnTextOn]}>{off}</Text>
            </TouchableOpacity>
        </View>
    );
}
function MenuModal({ visible, items, onClose }: {
    visible: boolean; onClose: () => void;
    items: { label: string; danger?: boolean; onPress: () => void }[];
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={[styles.modalBox, { paddingHorizontal: 0, paddingVertical: 6 }]}>
                    {items.map((it, i) => (
                        <TouchableOpacity key={i} style={styles.pickerItem} onPress={it.onPress}>
                            <Text style={[styles.pickerItemText, it.danger && { color: '#e2445c' }]}>{it.label}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </TouchableOpacity>
        </Modal>
    );
}
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

// Renkler web ProjectManagement.css birebir
const styles = StyleSheet.create({
    pm: { flex: 1, backgroundColor: '#f0f2f7' },
    pmContent: { padding: 8, paddingBottom: 24 },
    h1: { fontSize: 20, fontWeight: '700', color: '#111827', paddingHorizontal: 8, paddingVertical: 8 },
    error: { color: '#b91c1c', paddingHorizontal: 8, marginBottom: 6 },

    toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 8, marginBottom: 8 },
    lbl: { fontSize: 12, color: '#374151' },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, flex: 1, minWidth: 120,
    },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },
    dateBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7, alignSelf: 'flex-start' },
    dateBtnText: { fontSize: 12, color: '#111827' },
    input: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: '#111827',
    },
    inputDisabled: { backgroundColor: '#f3f4f6', color: '#9ca3af' },

    btnPrimary: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnGreen: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnDanger: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnOpen: { backgroundColor: '#6b7280', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnPrimaryText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnWhite: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#f9fafb', paddingHorizontal: 12, paddingVertical: 8 },
    btnWhiteText: { fontSize: 12, color: '#374151', fontWeight: '600' },
    btnDim: { opacity: 0.5 },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, marginHorizontal: 8, marginBottom: 8 },
    cardTitle: {
        fontSize: 12, fontWeight: '700', color: '#1f3a6e',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardBody: { padding: 10 },

    fieldRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 8 },
    fieldLabel: { width: 110, fontSize: 12, color: '#374151' },
    fieldBody: { flex: 1 },
    hint: { fontSize: 10, color: '#9ca3af', marginBottom: 6, marginLeft: 118 },
    row3: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },

    cbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    cbLabel: { fontSize: 12, color: '#374151' },
    radioDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: '#9ca3af', backgroundColor: '#fff' },
    radioDotOn: { borderColor: '#2563eb', backgroundColor: '#2563eb' },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 10, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    rowSel: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 10, color: '#374151', paddingVertical: 8, paddingHorizontal: 4 },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    badge: { fontSize: 10, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, textAlign: 'center', overflow: 'hidden', marginHorizontal: 4 },
    badgeYes: { backgroundColor: '#d1fae5', color: '#037f4c' },
    badgeNo: { backgroundColor: '#e8ebf2', color: '#4b5563' },

    tabbar: { flexDirection: 'row', marginBottom: 10, gap: 6 },
    tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 6, backgroundColor: '#e8ebf2' },
    tabActive: { backgroundColor: '#2563eb' },
    tabText: { fontSize: 12, fontWeight: '700', color: '#4b5563' },
    tabTextActive: { color: '#fff' },

    linkBanner: { fontSize: 12, color: '#1f3a6e', backgroundColor: '#eef4ff', borderRadius: 6, padding: 8, marginVertical: 8 },
    linkBannerMuted: { color: '#6b7280', backgroundColor: '#f3f4f6' },
    linkPanelHead: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', marginTop: 8, marginBottom: 4 },
    linkList: { borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 6 },
    linkRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 8, paddingHorizontal: 8,
        borderBottomWidth: 1, borderBottomColor: '#eef0f6', gap: 8,
    },
    linkRowSel: { backgroundColor: '#eef2ff' },
    linkName: { fontSize: 12, color: '#111827', flex: 1 },
    linked: { fontSize: 10, color: '#037f4c', fontWeight: '700', flexShrink: 1 },
    unlinked: { fontSize: 10, color: '#9ca3af', flexShrink: 1 },

    toggleGroup: { flexDirection: 'row', gap: 6 },
    toggleBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff' },
    toggleBtnOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    toggleBtnText: { fontSize: 11, color: '#374151', fontWeight: '600' },
    toggleBtnTextOn: { color: '#fff' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 16 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 10 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },

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

export default ProjectManagementScreen;
