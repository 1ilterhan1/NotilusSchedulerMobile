// Web pages/Inventory.tsx birebir (masaüstü ucEquipment klonu) — 3 sekme:
//  • Project Equipment (ucEquipmentProject): proje bazlı ekipman gridi,
//    Equipment Name katalog seçimi (lvSearch), Excel Template/Import,
//    Bring Items From NotilusAnalytics, Analytics'e bağlı silme uyarısı (Yes/No/Cancel).
//  • Equipment List (ucEquipmentList): şirket ekipman kataloğu, arama, Filter Columns, Save/Delete.
//  • Equipment System (ucEquipmentSystem): kategori + alt kategori yönetimi.
// Mevcut API: /api/inventory/* (YENİ API YAZILMAZ). Kolon görünürlüğü masaüstü
// Properties.Settings formatıyla birebir AsyncStorage'da tutulur:
// cboxProjEquipFilter (13 bayrak) / cboxEquipmentFilter (10 bayrak).
//
// Mobil uyarlama (mevcut ekranlarla tutarlı):
// - Tablolar yatay ScrollView; select → PickerModal/StrPickerModal;
//   alert/confirm → Alert.alert; Yes/No/Cancel → 3 butonlu Alert.
// - localStorage → AsyncStorage; Excel şablon indirme → expo-file-system downloadAsync
//   + expo-sharing; Import → expo-document-picker + xlsx.
// - Equipment Name katalog önerileri (lvSearch) → aranabilir "Select Equipment"
//   modalı (⌕). Serbest metin girişi de korunur (equipmentId boşsa yeni ekipman).
// - Bring From Analytics link akışı: ProjectManagementScreen'in EditProjectModal'ı
//   (initialTab='link') birebir yeniden kullanılır.

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as XLSX from 'xlsx';
import { apiGet, apiFetch } from '../api';
import { API_BASE_URL } from '../config';
import { getToken } from '../auth';
import { useThemeDark } from '../theme';
import type { IdName, PmProject } from '../types';
import { EditProjectModal } from './ProjectManagementScreen';

// ─── DTO'lar (web birebir) ───
interface SubCat { id: number; name: string; equipmentSystemId: number }
interface EquipmentDto {
    id: number; equipmentSystemId: number; equipmentSubCategoryId: number | null;
    generalDescription: string; brand: string | null; model: string | null; notes: string | null;
    companyId: number; watertightness: string | null; clearOpeningHxB: string | null;
    cutoutHxB: string | null; fireClass: string | null; weight: string | null;
}
interface Catalog { systems: IdName[]; subCategoriesAll: SubCat[]; subCategories: SubCat[]; equipments: EquipmentDto[] }
interface SaveResult { fail: number; message: string; success: number }
interface PeRowDto {
    id: number; quantity: number; category: string; subCategory: string;
    equipmentName: string; brand: string; model: string; notes: string;
    poseNumber: string | null; position: string | null; sillHeightAbFinishedDeck: string | null;
    hasDrawing: boolean; isOrdered: boolean;
    watertightness: string; clearOpeningHxB: string; cutoutHxB: string;
    fireClass: string; weight: string; equipmentId: number; source: string;
}
interface PeSaveResult { aborted: boolean; abortMessage: string | null; flag: boolean; failCount: number; messages: string[] }
interface DeleteCheckResult { linkedCount: number; itemNames: string[] }
interface PeImportResult { equipmentAdded: number; projectEquipmentLinked: number; messages: string[] }
interface BringResult { yachtFound: boolean; equipmentAdded: number; projectEquipmentLinked: number }

let invUid = 1;
const nextUid = () => invUid++;

// ── Kolon görünürlüğü (masaüstü Properties.Settings formatı birebir) ──
async function readFlags(key: string, count: number): Promise<boolean[]> {
    const v = (await AsyncStorage.getItem(key)) ?? '';
    if (v.length !== count) return Array(count).fill(true);
    return [...v].map((c) => c === '1');
}
async function writeFlags(key: string, flags: boolean[]) {
    await AsyncStorage.setItem(key, flags.map((f) => (f ? '1' : '0')).join(''));
}

// ── Onay yardımcıları (MessageBox karşılıkları) ──
function confirmAsync(message: string, title = ''): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}
function yesNoCancelAsync(message: string): Promise<'yes' | 'no' | 'cancel'> {
    return new Promise((resolve) => {
        Alert.alert('NotilusScheduler', message, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve('cancel') },
            { text: 'No', onPress: () => resolve('no') },
            { text: 'Yes', onPress: () => resolve('yes') },
        ]);
    });
}

const PROJ_FILTER_LABELS = ['Brand', 'Model', 'Notes', 'Pose Number', 'Position', 'Sill Height',
    'Has Drawing', 'Is Ordered', 'Watertightness', 'Clear Opening', 'Cutout HxB', 'Fire Class', 'Weight'];
const LIST_FILTER_LABELS = ['Brand', 'Model', 'Notes', 'Watertightness', 'Clear Opening',
    'Cutout HxB', 'Fire Class', 'Weight', 'General Description', 'Equipment Sub Category'];

const TABS = ['Project Equipment', 'Equipment List', 'Equipment System'] as const;
type Tab = typeof TABS[number];

// ═════════════════════════════════════════════════════════════════════════════
//  SEKME KABI (ucEquipment)
// ═════════════════════════════════════════════════════════════════════════════
function InventoryScreen() {
    const dark = useThemeDark();
    const [tab, setTab] = useState<Tab>('Project Equipment');
    // Açılan sekme mount kalır (_views cache birebir)
    const [opened, setOpened] = useState<Set<Tab>>(new Set<Tab>(['Project Equipment']));

    function openTab(t: Tab) {
        setTab(t);
        setOpened((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
    }

    return (
        <View style={[styles.inv, { backgroundColor: dark ? '#f0f2f7' : '#f7f8fc' }]}>
            <View style={styles.tabs}>
                {TABS.map((t) => (
                    <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => openTab(t)}>
                        <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            {opened.has('Project Equipment') && (
                <View style={[styles.page, { display: tab === 'Project Equipment' ? 'flex' : 'none' }]}>
                    <ProjectEquipmentTab />
                </View>
            )}
            {opened.has('Equipment List') && (
                <View style={[styles.page, { display: tab === 'Equipment List' ? 'flex' : 'none' }]}>
                    <EquipmentListTab />
                </View>
            )}
            {opened.has('Equipment System') && (
                <View style={[styles.page, { display: tab === 'Equipment System' ? 'flex' : 'none' }]}>
                    <EquipmentSystemTab />
                </View>
            )}
        </View>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  Ortak: id/name ve string seçim modalları
// ═════════════════════════════════════════════════════════════════════════════
function PickerModal({ visible, items, selectedId, onClose, onPick }: {
    visible: boolean; items: IdName[]; selectedId: number | null;
    onClose: () => void; onPick: (id: number) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.pickerBox}>
                    <ScrollView>
                        {items.map((it) => (
                            <TouchableOpacity key={it.id}
                                style={[styles.pickerItem, it.id === selectedId && styles.pickerItemSel]}
                                onPress={() => onPick(it.id)}>
                                <Text style={[styles.pickerItemText, it.id === selectedId && styles.pickerItemTextSel]}>{it.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}
function StrPickerModal({ visible, items, selected, onClose, onPick }: {
    visible: boolean; items: string[]; selected: string;
    onClose: () => void; onPick: (s: string) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.pickerBox}>
                    <ScrollView>
                        {items.length === 0 && <Text style={styles.pickerEmpty}>(none)</Text>}
                        {items.map((s) => (
                            <TouchableOpacity key={s}
                                style={[styles.pickerItem, s === selected && styles.pickerItemSel]}
                                onPress={() => onPick(s)}>
                                <Text style={[styles.pickerItemText, s === selected && styles.pickerItemTextSel]}>{s}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

// Filter Columns modalı (FormFilterEquipmentList/ProjectEquipment birebir):
// her değişiklik anında AsyncStorage'a yazılır, Save kapatır.
function FilterColumnsModal({ visible, title, labels, flags, onToggle, onClose }: {
    visible: boolean; title: string; labels: string[]; flags: boolean[];
    onToggle: (i: number) => void; onClose: () => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.modalBox} onStartShouldSetResponder={() => true}>
                    <Text style={styles.modalHead}>{title}</Text>
                    <ScrollView style={{ maxHeight: 360 }}>
                        {labels.map((l, i) => (
                            <TouchableOpacity key={l} style={styles.checkRow} onPress={() => onToggle(i)} activeOpacity={0.7}>
                                <View style={[styles.cbBox, flags[i] && styles.cbBoxOn]}>
                                    {flags[i] && <Text style={styles.cbTick}>✓</Text>}
                                </View>
                                <Text style={styles.checkLabel}>{l}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnSave} onPress={onClose}><Text style={styles.btnText}>Save</Text></TouchableOpacity>
                    </View>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

// Equipment Name katalog seçim modalı (lvSearch karşılığı)
function EquipmentPickModal({ visible, catalog, onClose, onPick }: {
    visible: boolean; catalog: Catalog | null; onClose: () => void; onPick: (eq: EquipmentDto) => void;
}) {
    const [term, setTerm] = useState('');
    const items = useMemo(() => {
        if (!catalog) return [];
        const t = term.trim().toLowerCase();
        const base = t
            ? catalog.equipments.filter((e) =>
                (e.generalDescription ?? '').toLowerCase().includes(t) || (e.brand ?? '').toLowerCase().includes(t))
            : catalog.equipments;
        return base.slice(0, 150);
    }, [catalog, term]);

    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={[styles.modalBox, { maxHeight: '85%' }]} onStartShouldSetResponder={() => true}>
                    <Text style={styles.modalHead}>Select Equipment</Text>
                    <TextInput style={styles.search} placeholder="Search…" value={term} onChangeText={setTerm} />
                    <ScrollView style={{ maxHeight: 420, marginTop: 8 }}>
                        {items.length === 0 && <Text style={styles.pickerEmpty}>(none)</Text>}
                        {items.map((eq) => {
                            const sys = catalog?.systems.find((s) => s.id === eq.equipmentSystemId);
                            const sub = catalog?.subCategories.find((s) => s.id === eq.equipmentSubCategoryId);
                            return (
                                <TouchableOpacity key={eq.id} style={styles.eqPick} onPress={() => onPick(eq)}>
                                    <Text style={styles.eqPickName}>{eq.generalDescription}</Text>
                                    <Text style={styles.eqPickSub}>
                                        {(sys?.name ?? '-')}{sub ? ' · ' + sub.name : ''}
                                        {eq.brand ? '  ·  ' + eq.brand : ''}{eq.weight ? '  ·  ' + eq.weight : ''}
                                    </Text>
                                </TouchableOpacity>
                            );
                        })}
                    </ScrollView>
                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnLight} onPress={onClose}><Text style={styles.btnLightText}>Close</Text></TouchableOpacity>
                    </View>
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  PROJECT EQUIPMENT SEKMESİ (ucEquipmentProject)
// ═════════════════════════════════════════════════════════════════════════════
interface PeRow {
    uid: number; id: number; equipmentId: number | null;
    category: string; subCategory: string; equipmentName: string;
    quantity: string; brand: string; model: string; notes: string;
    poseNumber: string; position: string; sillHeight: string;
    hasDrawing: boolean; isOrdered: boolean;
    watertightness: string; clearOpeningHxB: string; cutoutHxB: string;
    fireClass: string; weight: string; source: string; changed: boolean;
}

function ProjectEquipmentTab() {
    const [projects, setProjects] = useState<IdName[]>([]);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [rows, setRows] = useState<PeRow[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState('');
    const [flags, setFlags] = useState<boolean[]>(() => Array(13).fill(true));
    const [showFilter, setShowFilter] = useState(false);
    const [importing, setImporting] = useState(false);
    const [bringing, setBringing] = useState(false);
    const [linkEdit, setLinkEdit] = useState<PmProject | null>(null);

    const [projPicker, setProjPicker] = useState(false);
    const [catPicker, setCatPicker] = useState<number | null>(null);   // uid
    const [subPicker, setSubPicker] = useState<number | null>(null);   // uid
    const [namePicker, setNamePicker] = useState<number | null>(null); // uid

    const dirty = rows.some((r) => r.changed);

    const loadCatalog = useCallback(() => {
        apiGet<Catalog>('/api/inventory/catalog').then(setCatalog).catch(() => setCatalog(null));
    }, []);

    useEffect(() => {
        readFlags('cboxProjEquipFilter', 13).then(setFlags);
        apiGet<IdName[]>('/api/inventory/projects').then((p) => {
            setProjects(p);
            setProjectId((prev) => prev ?? (p[0]?.id ?? null));
        }).catch(() => setProjects([]));
        loadCatalog();
    }, [loadCatalog]);

    // loadProjectEquipmentListview birebir
    const reload = useCallback(() => {
        if (projectId == null) return;
        loadCatalog();
        apiGet<PeRowDto[]>(`/api/inventory/project-equipment?projectId=${projectId}`).then((list) => {
            setRows(list.map((r) => ({
                uid: nextUid(), id: r.id, equipmentId: r.equipmentId,
                category: r.category, subCategory: r.subCategory, equipmentName: r.equipmentName,
                quantity: String(r.quantity), brand: r.brand, model: r.model, notes: r.notes,
                poseNumber: r.poseNumber ?? '', position: r.position ?? '', sillHeight: r.sillHeightAbFinishedDeck ?? '',
                hasDrawing: r.hasDrawing, isOrdered: r.isOrdered,
                watertightness: r.watertightness, clearOpeningHxB: r.clearOpeningHxB, cutoutHxB: r.cutoutHxB,
                fireClass: r.fireClass, weight: r.weight, source: r.source, changed: false,
            })));
            setSelected(new Set());
        }).catch(() => setRows([]));
    }, [projectId, loadCatalog]);

    useEffect(reload, [reload]);

    function setField(uid: number, patch: Partial<PeRow>) {
        setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch, changed: true } : r)));
    }

    // DGV yeni-satırı (AllowUserToAddRows) — EquipmentID boş → kayıtta yeni Equipment
    function addNewRow() {
        setRows((prev) => [...prev, {
            uid: nextUid(), id: 0, equipmentId: null,
            category: '', subCategory: '', equipmentName: '', quantity: '',
            brand: '', model: '', notes: '', poseNumber: '', position: '', sillHeight: '',
            hasDrawing: false, isOrdered: false,
            watertightness: '', clearOpeningHxB: '', cutoutHxB: '', fireClass: '', weight: '',
            source: '', changed: true,
        }]);
    }

    function toggleSel(uid: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
    }

    // ApplySearchFilter birebir (görünür metin kolonları + Quantity)
    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return rows;
        return rows.filter((r) =>
            [r.category, r.subCategory, r.equipmentName, r.brand, r.model, r.notes,
                r.poseNumber, r.position, r.sillHeight, r.watertightness, r.clearOpeningHxB,
                r.cutoutHxB, r.fireClass, r.weight, r.quantity]
                .some((v) => (v ?? '').toLowerCase().includes(term)));
    }, [rows, search]);

    // lvSearch seçimi birebir: seçilen katalog kaydı satırı doldurur
    function pickFromPopup(uid: number, eq: EquipmentDto) {
        const system = catalog?.systems.find((s) => s.id === eq.equipmentSystemId);
        const sub = catalog?.subCategories.find((s) => s.id === eq.equipmentSubCategoryId);
        setField(uid, {
            category: system?.name ?? '', subCategory: sub?.name ?? '',
            equipmentName: eq.generalDescription, brand: eq.brand ?? '', model: eq.model ?? '',
            notes: eq.notes ?? '', watertightness: eq.watertightness ?? '',
            clearOpeningHxB: eq.clearOpeningHxB ?? '', cutoutHxB: eq.cutoutHxB ?? '',
            fireClass: eq.fireClass ?? '', weight: eq.weight ?? '', equipmentId: eq.id,
        });
        setNamePicker(null);
    }

    // SubCategory seçenekleri Category'e göre filtrelenir
    function subOptions(categoryName: string): string[] {
        if (!catalog || !categoryName.trim()) return [];
        const cat = catalog.systems.find((c) => c.name === categoryName);
        if (!cat) return [];
        return [...new Set(catalog.subCategories.filter((sc) => sc.equipmentSystemId === cat.id).map((sc) => sc.name))];
    }

    // btnSave_Click birebir
    async function saveChanges() {
        if (projectId == null) return;
        const body = {
            projectId,
            rows: rows.map((r) => ({
                id: r.id, equipmentId: r.equipmentId,
                equipmentName: r.equipmentName, brand: r.brand, model: r.model, notes: r.notes,
                watertightness: r.watertightness, clearOpeningHxB: r.clearOpeningHxB,
                cutoutHxB: r.cutoutHxB, fireClass: r.fireClass, weight: r.weight,
                category: r.category, subCategory: r.subCategory,
                quantity: parseInt(r.quantity, 10) || 0,
                poseNumber: r.poseNumber, position: r.position, sillHeightAbFinishedDeck: r.sillHeight,
                hasDrawing: r.hasDrawing, isOrdered: r.isOrdered,
            })),
        };
        const res = await apiFetch('/api/inventory/project-equipment/save', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) { Alert.alert('', 'Some records could not be updated! Please check the values.'); return; }
        const result = await res.json() as PeSaveResult;

        if (result.aborted) { Alert.alert('', result.abortMessage ?? ''); return; }

        for (const m of result.messages) Alert.alert('', m);
        if (result.flag) Alert.alert('', 'Some records were not saved due to missing information.');
        if (result.failCount === 0) Alert.alert('', 'All project equipment records have been successfully updated.');
        else Alert.alert('', 'Some records could not be updated! Please check the values.');

        reload();
    }

    async function doDelete(ids: number[], deleteAnalyticsToo: boolean) {
        const res = await apiFetch('/api/inventory/project-equipment/delete', {
            method: 'POST', body: JSON.stringify({ ids, deleteAnalyticsToo }),
        });
        if (res.ok) {
            const b = await res.json().catch(() => null) as { message?: string } | null;
            if (b?.message && b.message !== 'deleted' && b.message !== 'noop') Alert.alert('', b.message);
        }
        reload();
    }

    // btnDelete_Click birebir (Analytics bağlantı kontrolü dahil)
    async function deleteSelected() {
        const selRows = rows.filter((r) => selected.has(r.uid));
        if (selRows.length === 0) { Alert.alert('', 'Please select rows to delete!'); return; }

        const recIds = selRows.filter((r) => r.id > 0).map((r) => r.id);
        if (recIds.length === 0) { Alert.alert('', 'No valid rows to delete.'); return; }

        let linked: DeleteCheckResult = { linkedCount: 0, itemNames: [] };
        {
            const r = await apiFetch('/api/inventory/project-equipment/delete-check', {
                method: 'POST', body: JSON.stringify(recIds),
            });
            if (r.ok) linked = await r.json() as DeleteCheckResult;
        }

        if (linked.linkedCount > 0) {
            let msg = `${linked.linkedCount} of the selected item(s) are linked to Analytics (WeightInfo)`;
            if (linked.itemNames.length > 0) msg += ':\n- ' + linked.itemNames.join('\n- ');
            msg += '\n\nDo you want to delete the linked Analytics item(s) as well?' +
                '\n\nYes      = delete from BOTH Scheduler and Analytics' +
                '\nNo       = delete from Scheduler ONLY (keep Analytics)' +
                '\nCancel = do nothing';
            const r = await yesNoCancelAsync(msg);
            if (r === 'cancel') return;
            await doDelete(recIds, r === 'yes');
            return;
        }

        if (!(await confirmAsync('Selected rows will be deleted! Are you sure?'))) return;
        await doDelete(recIds, false);
    }

    // btnRefresh_Click birebir
    async function refresh() {
        if (dirty && !(await confirmAsync(
            'You have unsaved changes. Refreshing will discard them and reload the latest data from the database.\n\nContinue?'))) {
            return;
        }
        reload();
    }

    // btnExcelTemplate_Click karşılığı — sunucudaki şablon dosyası indirilip paylaşılır
    async function downloadTemplate() {
        try {
            const token = await getToken();
            const fileUri = `${FileSystem.cacheDirectory}ImportProjectEquipmentExcelTemplate.xlsx`;
            const res = await FileSystem.downloadAsync(`${API_BASE_URL}/api/inventory/excel-template`, fileUri,
                token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
            if (res.status !== 200) { Alert.alert('', `Error ${res.status}`); return; }
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(res.uri, {
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    dialogTitle: 'ImportProjectEquipmentExcelTemplate.xlsx',
                });
            }
        } catch {
            Alert.alert('', 'Excel template could not be downloaded.');
        }
    }

    // btnImportFromExcel_Click birebir (kolonlar 0–16)
    async function importFromExcel() {
        if (projectId == null) return;
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
            setImporting(true);

            const b64 = await FileSystem.readAsStringAsync(pick.assets[0].uri, { encoding: FileSystem.EncodingType.Base64 });
            const wb = XLSX.read(b64, { type: 'base64' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

            const s = (v: unknown) => v == null ? '' : String(v);
            const b = (v: unknown) => {
                if (typeof v === 'boolean') return v;
                const t = s(v).trim().toLowerCase();
                return t === 'true' || t === '1' || t === 'yes';
            };
            const importRows = grid.slice(1).map((row) => ({
                category: s(row?.[0]), subCategory: s(row?.[1]), poseNumber: s(row?.[2]),
                generalDescription: s(row?.[3]), position: s(row?.[4]),
                quantity: parseInt(s(row?.[5]), 10) || 0,
                brand: s(row?.[6]), model: s(row?.[7]), notes: s(row?.[8]),
                sillHeightAbFinishedDeck: s(row?.[9]), watertightness: s(row?.[10]),
                clearOpeningHxB: s(row?.[11]), cutoutHxB: s(row?.[12]), fireClass: s(row?.[13]),
                hasDrawing: b(row?.[14]), isOrdered: b(row?.[15]), weight: s(row?.[16]),
            }));

            const res = await apiFetch('/api/inventory/project-equipment/import', {
                method: 'POST', body: JSON.stringify({ projectId, rows: importRows }),
            });
            if (!res.ok) return;
            const r = await res.json() as PeImportResult;

            reload();
            for (const m of r.messages) Alert.alert('', m);
            Alert.alert('', `Import complete.\nEquipment added to catalog: ${r.equipmentAdded}\nLinked to current project: ${r.projectEquipmentLinked}`);
        } finally {
            setImporting(false);
        }
    }

    // btnBringFromAnalytics_Click birebir
    async function bringFromAnalytics() {
        if (projectId == null) { Alert.alert('', 'Please select a project first.'); return; }
        setBringing(true);
        try {
            const res = await apiFetch('/api/inventory/project-equipment/bring-from-analytics', {
                method: 'POST', body: JSON.stringify({ projectId }),
            });
            if (!res.ok) {
                const bdy = await res.json().catch(() => null) as { message?: string } | null;
                Alert.alert('', 'Could not import from NotilusAnalytics: ' + (bdy?.message ?? `Error ${res.status}`));
                return;
            }
            const r = await res.json() as BringResult;

            if (!r.yachtFound) {
                // Link akışı: linklemek istiyor musun? → Edit Project (Link) sekmesi
                const yes = await confirmAsync(
                    'This project has no linked analytics project.\n\nDo you want to link it to a NotilusAnalytics project now?');
                if (!yes || projectId == null) return;
                try {
                    const p = await apiGet<PmProject>(`/api/projectmanagement/projects/${projectId}`);
                    setLinkEdit(p);
                } catch {
                    Alert.alert('', 'Project not found!');
                }
                return;
            }
            if (r.equipmentAdded === 0 && r.projectEquipmentLinked === 0) {
                Alert.alert('', 'The linked analytics project was found, but no new items were imported (either it has no weight items or every item already exists for this project).');
            } else {
                Alert.alert('', 'Import from NotilusAnalytics complete.\nEquipment added to catalog: ' + r.equipmentAdded +
                    '\nLinked to current project: ' + r.projectEquipmentLinked);
            }
            reload();
        } finally {
            setBringing(false);
        }
    }

    async function onFilterToggle(i: number) {
        const next = flags.map((f, j) => (j === i ? !f : f));
        setFlags(next);
        await writeFlags('cboxProjEquipFilter', next);
    }

    const [fBrand, fModel, fNotes, fPose, fPosition, fSill, fHasDrawing, fIsOrdered,
        fWater, fClear, fCutout, fFire, fWeight] = flags;

    const projName = (id: number | null) => projects.find((p) => p.id === id)?.name ?? '';
    const catNames = catalog?.systems.map((s) => s.name) ?? [];

    const catPickerRow = catPicker != null ? rows.find((r) => r.uid === catPicker) : null;
    const subPickerRow = subPicker != null ? rows.find((r) => r.uid === subPicker) : null;

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}><Text style={styles.headerText}>Equipment by Project</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.cardTitle}>Project Equipment</Text>
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Project :</Text>
                <TouchableOpacity style={styles.select} onPress={() => setProjPicker(true)}>
                    <Text style={styles.selectText} numberOfLines={1}>{projName(projectId) || '—'}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Search :</Text>
                <TextInput style={styles.search} value={search} onChangeText={setSearch} />
            </View>
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.btnLight} onPress={refresh}><Text style={styles.btnLightText}>↻ Refresh</Text></TouchableOpacity>
                <TouchableOpacity style={styles.btnLight} onPress={() => setShowFilter(true)}><Text style={styles.btnLightText}>Filter Columns</Text></TouchableOpacity>
                <TouchableOpacity style={styles.btnLight} onPress={downloadTemplate}><Text style={styles.btnLightText}>Excel Template</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btnBlue, importing && styles.btnDisabled]} disabled={importing} onPress={importFromExcel}>
                    <Text style={styles.btnText}>{importing ? 'importing...' : 'Import From Excel'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.btnBlue, bringing && styles.btnDisabled]} disabled={bringing} onPress={bringFromAnalytics}>
                    <Text style={styles.btnText}>{bringing ? 'Importing...' : 'Bring Items From NotilusAnalytics'}</Text>
                </TouchableOpacity>
            </View>

            {/* Grid */}
            <View style={styles.card}>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            <Text style={[styles.gridHeadCell, { width: 34 }]}></Text>
                            <Text style={[styles.gridHeadCell, { width: 140 }]}>Category</Text>
                            <Text style={[styles.gridHeadCell, { width: 140 }]}>Sub Category</Text>
                            <Text style={[styles.gridHeadCell, { width: 190 }]}>Equipment Name</Text>
                            <Text style={[styles.gridHeadCell, { width: 70 }]}>Quantity</Text>
                            {fBrand && <Text style={[styles.gridHeadCell, { width: 110 }]}>Brand</Text>}
                            {fModel && <Text style={[styles.gridHeadCell, { width: 110 }]}>Model</Text>}
                            {fNotes && <Text style={[styles.gridHeadCell, { width: 130 }]}>Notes</Text>}
                            {fPose && <Text style={[styles.gridHeadCell, { width: 100 }]}>Pose Number</Text>}
                            {fPosition && <Text style={[styles.gridHeadCell, { width: 110 }]}>Position</Text>}
                            {fSill && <Text style={[styles.gridHeadCell, { width: 130 }]}>Sill Height Ab Finished Deck</Text>}
                            {fHasDrawing && <Text style={[styles.gridHeadCell, { width: 80 }]}>Has Drawing</Text>}
                            {fIsOrdered && <Text style={[styles.gridHeadCell, { width: 80 }]}>Is Ordered</Text>}
                            {fWater && <Text style={[styles.gridHeadCell, { width: 110 }]}>Watertightness</Text>}
                            {fClear && <Text style={[styles.gridHeadCell, { width: 120 }]}>Clear Opening HxB</Text>}
                            {fCutout && <Text style={[styles.gridHeadCell, { width: 110 }]}>Cutout HxB</Text>}
                            {fFire && <Text style={[styles.gridHeadCell, { width: 90 }]}>Fire Class</Text>}
                            {fWeight && <Text style={[styles.gridHeadCell, { width: 90 }]}>Weight (kg)</Text>}
                        </View>
                        {visible.map((r) => (
                            <View key={r.uid} style={[styles.gridRow, selected.has(r.uid) && styles.rowSel]}>
                                <TouchableOpacity style={{ width: 34, alignItems: 'center' }} onPress={() => toggleSel(r.uid)}>
                                    <View style={[styles.cbBox, selected.has(r.uid) && styles.cbBoxOn]}>
                                        {selected.has(r.uid) && <Text style={styles.cbTick}>✓</Text>}
                                    </View>
                                </TouchableOpacity>
                                <TouchableOpacity style={{ width: 140 }} onPress={() => setCatPicker(r.uid)}>
                                    <Text style={styles.cellPick} numberOfLines={1}>{(catNames.includes(r.category) ? r.category : '') || '—'} ▾</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={{ width: 140 }} onPress={() => setSubPicker(r.uid)}>
                                    <Text style={styles.cellPick} numberOfLines={1}>{(subOptions(r.category).includes(r.subCategory) ? r.subCategory : '') || '—'} ▾</Text>
                                </TouchableOpacity>
                                <View style={{ width: 190, flexDirection: 'row', alignItems: 'center' }}>
                                    <TextInput style={[styles.cellInput, { flex: 1 }]} value={r.equipmentName}
                                        onChangeText={(t) => setField(r.uid, { equipmentName: t })} />
                                    <TouchableOpacity style={styles.nameSearch} onPress={() => setNamePicker(r.uid)}>
                                        <Text style={styles.nameSearchIco}>⌕</Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={{ width: 70 }}>
                                    <TextInput style={styles.cellInput} keyboardType="number-pad" value={r.quantity}
                                        onChangeText={(t) => setField(r.uid, { quantity: t })} />
                                </View>
                                {fBrand && <PeTextCell w={110} v={r.brand} on={(t) => setField(r.uid, { brand: t })} />}
                                {fModel && <PeTextCell w={110} v={r.model} on={(t) => setField(r.uid, { model: t })} />}
                                {fNotes && <PeTextCell w={130} v={r.notes} on={(t) => setField(r.uid, { notes: t })} />}
                                {fPose && <PeTextCell w={100} v={r.poseNumber} on={(t) => setField(r.uid, { poseNumber: t })} />}
                                {fPosition && <PeTextCell w={110} v={r.position} on={(t) => setField(r.uid, { position: t })} />}
                                {fSill && <PeTextCell w={130} v={r.sillHeight} on={(t) => setField(r.uid, { sillHeight: t })} />}
                                {fHasDrawing && <PeCheckCell w={80} v={r.hasDrawing} on={() => setField(r.uid, { hasDrawing: !r.hasDrawing })} />}
                                {fIsOrdered && <PeCheckCell w={80} v={r.isOrdered} on={() => setField(r.uid, { isOrdered: !r.isOrdered })} />}
                                {fWater && <PeTextCell w={110} v={r.watertightness} on={(t) => setField(r.uid, { watertightness: t })} />}
                                {fClear && <PeTextCell w={120} v={r.clearOpeningHxB} on={(t) => setField(r.uid, { clearOpeningHxB: t })} />}
                                {fCutout && <PeTextCell w={110} v={r.cutoutHxB} on={(t) => setField(r.uid, { cutoutHxB: t })} />}
                                {fFire && <PeTextCell w={90} v={r.fireClass} on={(t) => setField(r.uid, { fireClass: t })} />}
                                {fWeight && <PeTextCell w={90} v={r.weight} on={(t) => setField(r.uid, { weight: t })} />}
                            </View>
                        ))}
                    </View>
                </ScrollView>
                <TouchableOpacity style={styles.addRowBtn} onPress={addNewRow}>
                    <Text style={styles.addRowText}>＋ Add Equipment</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.actionbar}>
                <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btnSave, dirty && styles.btnSaveDirty]} onPress={saveChanges}>
                    <Text style={styles.btnText}>{dirty ? 'Save Changes  ●' : 'Save Changes'}</Text>
                </TouchableOpacity>
            </View>

            {/* Modallar */}
            <PickerModal visible={projPicker} items={projects} selectedId={projectId}
                onClose={() => setProjPicker(false)} onPick={(id) => { setProjectId(id); setProjPicker(false); }} />
            <StrPickerModal visible={catPicker != null} items={catNames} selected={catPickerRow?.category ?? ''}
                onClose={() => setCatPicker(null)}
                onPick={(c) => { if (catPicker != null) setField(catPicker, { category: c, subCategory: '' }); setCatPicker(null); }} />
            <StrPickerModal visible={subPicker != null} items={subOptions(subPickerRow?.category ?? '')} selected={subPickerRow?.subCategory ?? ''}
                onClose={() => setSubPicker(null)}
                onPick={(c) => { if (subPicker != null) setField(subPicker, { subCategory: c }); setSubPicker(null); }} />
            <EquipmentPickModal visible={namePicker != null} catalog={catalog}
                onClose={() => setNamePicker(null)}
                onPick={(eq) => { if (namePicker != null) pickFromPopup(namePicker, eq); }} />
            <FilterColumnsModal visible={showFilter} title="Filter Columns" labels={PROJ_FILTER_LABELS}
                flags={flags} onToggle={onFilterToggle} onClose={() => setShowFilter(false)} />

            {linkEdit && (
                <EditProjectModal project={linkEdit} initialTab="link"
                    onClose={() => setLinkEdit(null)}
                    onSaved={() => { setLinkEdit(null); void bringFromAnalytics(); }} />
            )}
        </ScrollView>
    );
}

function PeTextCell({ w, v, on }: { w: number; v: string; on: (t: string) => void }) {
    return (
        <View style={{ width: w }}>
            <TextInput style={styles.cellInput} value={v} onChangeText={on} />
        </View>
    );
}
function PeCheckCell({ w, v, on }: { w: number; v: boolean; on: () => void }) {
    return (
        <TouchableOpacity style={{ width: w, alignItems: 'center' }} onPress={on}>
            <View style={[styles.cbBox, v && styles.cbBoxOn]}>{v && <Text style={styles.cbTick}>✓</Text>}</View>
        </TouchableOpacity>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  EQUIPMENT LIST SEKMESİ (ucEquipmentList)
// ═════════════════════════════════════════════════════════════════════════════
interface EqRow {
    uid: number; id: number; equipmentSystemId: number; equipmentSubCategoryId: number | null;
    generalDescription: string; brand: string; model: string; notes: string; companyId: number;
    watertightness: string; clearOpeningHxB: string; cutoutHxB: string; fireClass: string;
    weight: string; changed: boolean;
}

function EquipmentListTab() {
    const [catalog, setCatalog] = useState<Catalog | null>(null);
    const [rows, setRows] = useState<EqRow[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [search, setSearch] = useState('');
    const [flags, setFlags] = useState<boolean[]>(() => Array(10).fill(true));
    const [showFilter, setShowFilter] = useState(false);
    const [sysPicker, setSysPicker] = useState<number | null>(null);   // uid
    const [subPicker, setSubPicker] = useState<number | null>(null);   // uid

    const dirty = rows.some((r) => r.changed);

    const reload = useCallback(() => {
        apiGet<Catalog>('/api/inventory/catalog').then((c) => {
            setCatalog(c);
            setRows(c.equipments.map((e) => ({
                uid: nextUid(), id: e.id, equipmentSystemId: e.equipmentSystemId,
                equipmentSubCategoryId: e.equipmentSubCategoryId,
                generalDescription: e.generalDescription ?? '', brand: e.brand ?? '', model: e.model ?? '',
                notes: e.notes ?? '', companyId: e.companyId,
                watertightness: e.watertightness ?? '', clearOpeningHxB: e.clearOpeningHxB ?? '',
                cutoutHxB: e.cutoutHxB ?? '', fireClass: e.fireClass ?? '', weight: e.weight ?? '',
                changed: false,
            })));
            setSelected(new Set());
        }).catch(() => { setCatalog(null); setRows([]); });
    }, []);

    useEffect(() => { readFlags('cboxEquipmentFilter', 10).then(setFlags); reload(); }, [reload]);

    function setField(uid: number, patch: Partial<EqRow>) {
        setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch, changed: true } : r)));
    }
    function toggleSel(uid: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
    }

    // ApplyCombinedFilter birebir
    const visible = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) return rows;
        return rows.filter((r) =>
            [r.generalDescription, r.brand, r.model, r.notes, r.watertightness,
                r.clearOpeningHxB, r.cutoutHxB, r.fireClass, r.weight]
                .some((v) => (v ?? '').toLowerCase().includes(term)));
    }, [rows, search]);

    // btnSave_Click birebir
    async function saveChanges() {
        const updateData = rows.filter((r) => r.changed).map((r) => ({
            id: r.id, equipmentSystemId: r.equipmentSystemId, equipmentSubCategoryId: r.equipmentSubCategoryId,
            generalDescription: r.generalDescription, brand: r.brand, model: r.model, notes: r.notes,
            companyId: r.companyId, watertightness: r.watertightness, clearOpeningHxB: r.clearOpeningHxB,
            cutoutHxB: r.cutoutHxB, fireClass: r.fireClass, weight: r.weight,
        }));
        if (updateData.length === 0) { Alert.alert('', 'There are no pending changes to save.'); return; }

        const res = await apiFetch('/api/inventory/equipments/save', { method: 'POST', body: JSON.stringify(updateData) });
        if (!res.ok) { Alert.alert('', 'FAILED TO UPDATE EQUIPMENT RECORDS! PLEASE CHECK VALUES!'); return; }
        const updated = await res.json() as SaveResult;

        if (updated.fail === 0) {
            Alert.alert('', 'The equipment records were updated successfully.');
        } else if (updated.fail !== -1) {
            if (updated.success !== 0) {
                Alert.alert('', `${updated.message}${updated.fail} - Equipment record failed to update \nThe other ${updated.success} equipment records were updated successfully.`);
            } else {
                Alert.alert('', `${updated.message}${updated.fail} - Equipment record failed to update`);
            }
        } else {
            Alert.alert('', 'FAILED TO UPDATE EQUIPMENT RECORDS! PLEASE CHECK VALUES!');
        }
        reload();
    }

    // btnDelete_Click birebir
    async function deleteSelected() {
        if (selected.size === 0) { Alert.alert('', 'Please select rows to delete!'); return; }
        if (await confirmAsync('Selected rows will be deleted! Are you sure?')) {
            const recIds = [...new Set(rows.filter((r) => selected.has(r.uid)).map((r) => r.id))];
            await apiFetch('/api/inventory/equipments/delete', { method: 'POST', body: JSON.stringify(recIds) });
        }
        reload();
    }

    async function onFilterToggle(i: number) {
        const next = flags.map((f, j) => (j === i ? !f : f));
        setFlags(next);
        await writeFlags('cboxEquipmentFilter', next);
    }

    const [fBrand, fModel, fNotes, fWater, fClear, fCutout, fFire, fWeight, fGeneral, fSubCat] = flags;
    const sysName = (id: number) => catalog?.systems.find((s) => s.id === id)?.name ?? '';
    const subName = (id: number | null) => catalog?.subCategoriesAll.find((s) => s.id === id)?.name ?? '';
    const sysPickerRow = sysPicker != null ? rows.find((r) => r.uid === sysPicker) : null;
    const subPickerRow = subPicker != null ? rows.find((r) => r.uid === subPicker) : null;
    const subOptionsFor = (systemId: number): IdName[] =>
        (catalog?.subCategoriesAll.filter((s) => s.equipmentSystemId === systemId).map((s) => ({ id: s.id, name: s.name })) ?? []);

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}><Text style={styles.headerText}>Equipment Library</Text></View>

            <View style={styles.toolbar}>
                <Text style={styles.cardTitle}>Equipments</Text>
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>⌕</Text>
                <TextInput style={styles.search} value={search} onChangeText={setSearch} />
            </View>
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.btnLight} onPress={() => setShowFilter(true)}><Text style={styles.btnLightText}>Filter Columns</Text></TouchableOpacity>
                <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                <TouchableOpacity style={[styles.btnSave, dirty && styles.btnSaveDirty]} onPress={saveChanges}>
                    <Text style={styles.btnText}>{dirty ? 'Save Changes  ●' : 'Save Changes'}</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.card}>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            <Text style={[styles.gridHeadCell, { width: 34 }]}></Text>
                            <Text style={[styles.gridHeadCell, { width: 160 }]}>Equipment System</Text>
                            {fSubCat && <Text style={[styles.gridHeadCell, { width: 160 }]}>Sub-Category</Text>}
                            {fGeneral && <Text style={[styles.gridHeadCell, { width: 160 }]}>General Description</Text>}
                            {fBrand && <Text style={[styles.gridHeadCell, { width: 110 }]}>Brand</Text>}
                            {fModel && <Text style={[styles.gridHeadCell, { width: 110 }]}>Model</Text>}
                            {fNotes && <Text style={[styles.gridHeadCell, { width: 130 }]}>Notes</Text>}
                            {fWater && <Text style={[styles.gridHeadCell, { width: 110 }]}>Watertightness</Text>}
                            {fClear && <Text style={[styles.gridHeadCell, { width: 120 }]}>Clear Opening (HxB)</Text>}
                            {fCutout && <Text style={[styles.gridHeadCell, { width: 110 }]}>Cutout (HxB)</Text>}
                            {fFire && <Text style={[styles.gridHeadCell, { width: 90 }]}>Fire Class</Text>}
                            {fWeight && <Text style={[styles.gridHeadCell, { width: 90 }]}>Weight</Text>}
                        </View>
                        {visible.length === 0 && <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>}
                        {visible.map((r) => (
                            <View key={r.uid} style={[styles.gridRow, selected.has(r.uid) && styles.rowSel]}>
                                <TouchableOpacity style={{ width: 34, alignItems: 'center' }} onPress={() => toggleSel(r.uid)}>
                                    <View style={[styles.cbBox, selected.has(r.uid) && styles.cbBoxOn]}>
                                        {selected.has(r.uid) && <Text style={styles.cbTick}>✓</Text>}
                                    </View>
                                </TouchableOpacity>
                                <TouchableOpacity style={{ width: 160 }} onPress={() => setSysPicker(r.uid)}>
                                    <Text style={styles.cellPick} numberOfLines={1}>
                                        {(catalog?.systems.some((s) => s.id === r.equipmentSystemId) ? sysName(r.equipmentSystemId) : '') || '—'} ▾
                                    </Text>
                                </TouchableOpacity>
                                {fSubCat && (
                                    <TouchableOpacity style={{ width: 160 }} onPress={() => setSubPicker(r.uid)}>
                                        <Text style={styles.cellPick} numberOfLines={1}>
                                            {(catalog?.subCategoriesAll.some((s) => s.id === r.equipmentSubCategoryId) ? subName(r.equipmentSubCategoryId) : '') || '—'} ▾
                                        </Text>
                                    </TouchableOpacity>
                                )}
                                {fGeneral && <PeTextCell w={160} v={r.generalDescription} on={(t) => setField(r.uid, { generalDescription: t })} />}
                                {fBrand && <PeTextCell w={110} v={r.brand} on={(t) => setField(r.uid, { brand: t })} />}
                                {fModel && <PeTextCell w={110} v={r.model} on={(t) => setField(r.uid, { model: t })} />}
                                {fNotes && <PeTextCell w={130} v={r.notes} on={(t) => setField(r.uid, { notes: t })} />}
                                {fWater && <PeTextCell w={110} v={r.watertightness} on={(t) => setField(r.uid, { watertightness: t })} />}
                                {fClear && <PeTextCell w={120} v={r.clearOpeningHxB} on={(t) => setField(r.uid, { clearOpeningHxB: t })} />}
                                {fCutout && <PeTextCell w={110} v={r.cutoutHxB} on={(t) => setField(r.uid, { cutoutHxB: t })} />}
                                {fFire && <PeTextCell w={90} v={r.fireClass} on={(t) => setField(r.uid, { fireClass: t })} />}
                                {fWeight && <PeTextCell w={90} v={r.weight} on={(t) => setField(r.uid, { weight: t })} />}
                            </View>
                        ))}
                    </View>
                </ScrollView>
            </View>

            <PickerModal visible={sysPicker != null} items={catalog?.systems ?? []}
                selectedId={sysPickerRow?.equipmentSystemId ?? null}
                onClose={() => setSysPicker(null)}
                onPick={(id) => { if (sysPicker != null) setField(sysPicker, { equipmentSystemId: id, equipmentSubCategoryId: null }); setSysPicker(null); }} />
            <PickerModal visible={subPicker != null} items={subOptionsFor(subPickerRow?.equipmentSystemId ?? -1)}
                selectedId={subPickerRow?.equipmentSubCategoryId ?? null}
                onClose={() => setSubPicker(null)}
                onPick={(id) => { if (subPicker != null) setField(subPicker, { equipmentSubCategoryId: id }); setSubPicker(null); }} />
            <FilterColumnsModal visible={showFilter} title="Filter Columns" labels={LIST_FILTER_LABELS}
                flags={flags} onToggle={onFilterToggle} onClose={() => setShowFilter(false)} />
        </ScrollView>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  EQUIPMENT SYSTEM SEKMESİ (ucEquipmentSystem)
// ═════════════════════════════════════════════════════════════════════════════
function EquipmentSystemTab() {
    const [systems, setSystems] = useState<IdName[]>([]);
    const [subCats, setSubCats] = useState<SubCat[]>([]);
    const [systemId, setSystemId] = useState(-1);
    const [systemName, setSystemName] = useState<string | null>(null);
    const [subSelected, setSubSelected] = useState<Set<number>>(new Set());
    const [newCategory, setNewCategory] = useState('');
    const [newSubCategory, setNewSubCategory] = useState('');

    const loadSystems = useCallback(() => {
        apiGet<Catalog>('/api/inventory/catalog').then((c) => setSystems(c.systems)).catch(() => setSystems([]));
    }, []);

    useEffect(loadSystems, [loadSystems]);

    function loadSubCategories(id: number) {
        apiGet<SubCat[]>(`/api/inventory/systems/${id}/subcategories`).then((s) => {
            setSubCats(s);
            setSubSelected(new Set());
        }).catch(() => setSubCats([]));
    }

    function selectSystem(s: IdName) {
        setSystemId(s.id);
        setSystemName(s.name);
        loadSubCategories(s.id);
    }

    // btnAdd_Click + controlNewItem birebir
    async function addCategory() {
        if (!newCategory.trim()) { Alert.alert('', 'Please enter an item name!'); return; }
        const name = newCategory.trim();
        const res = await apiFetch('/api/inventory/systems', { method: 'POST', body: JSON.stringify({ name }) });
        if (res.status === 409) { Alert.alert('', `There is already an item named '${name}'!`); return; }
        if (!res.ok) return;
        loadSystems();
        setNewCategory('');
    }

    // btnDelete_Click birebir
    async function deleteCategory() {
        if (systemId === -1) { Alert.alert('', 'Please select rows to delete!'); return; }
        if (await confirmAsync('Selected records and related data (Equipments List and Project Equipments) will be deleted! Are you sure?')) {
            await apiFetch('/api/inventory/systems/delete', { method: 'POST', body: JSON.stringify([systemId]) });
            loadSystems();
        }
        setSubCats([]);
        setSystemId(-1);
        setSystemName(null);
    }

    // button1_Click + controlNewSubItem birebir
    async function addSubCategory() {
        if (systemId === -1) { Alert.alert('', 'Please select a category first!'); return; }
        if (!newSubCategory.trim()) { Alert.alert('', 'Please enter a subcategory name!'); return; }
        const name = newSubCategory.trim();
        const res = await apiFetch('/api/inventory/subcategories', {
            method: 'POST', body: JSON.stringify({ equipmentSystemId: systemId, name }),
        });
        if (res.status === 409) { Alert.alert('', `There is already a subcategory named '${name}'!`); return; }
        if (!res.ok) return;
        loadSubCategories(systemId);
        setNewSubCategory('');
    }

    // btnDeleteSub_Click birebir
    async function deleteSubCategories() {
        if (subSelected.size === 0) { Alert.alert('', 'Please select rows to delete!'); return; }
        if (await confirmAsync('Selected records will be deleted! Are you sure?')) {
            const ids = subCats.filter((s) => subSelected.has(s.id)).map((s) => s.id);
            if (ids.length > 0) {
                await apiFetch('/api/inventory/subcategories/delete', { method: 'POST', body: JSON.stringify(ids) });
                loadSubCategories(systemId);
            } else {
                Alert.alert('', 'No valid rows selected for deletion.');
            }
        }
    }

    function toggleSub(id: number) {
        setSubSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}>
                <Text style={styles.headerText}>Equipment System</Text>
                <Text style={styles.headerSub}>Manage category and subcategory definitions together.</Text>
            </View>

            {/* Kategori kartı */}
            <View style={styles.card}>
                <Text style={styles.sysTitle}>Equipment Category</Text>
                <Text style={styles.sysSub}>Primary equipment groups</Text>
                <View style={styles.sep} />
                <Text style={styles.sysInputLbl}>New category</Text>
                <View style={styles.sysInputRow}>
                    <TextInput style={styles.sysInput} value={newCategory} onChangeText={setNewCategory}
                        onSubmitEditing={addCategory} returnKeyType="done" />
                    <TouchableOpacity style={styles.btnAdd} onPress={addCategory}><Text style={styles.btnText}>Add Category</Text></TouchableOpacity>
                </View>
                <View style={styles.sysList}>
                    {systems.length === 0 && <Text style={styles.gridNone}>(none)</Text>}
                    {systems.map((s) => (
                        <TouchableOpacity key={s.id} style={[styles.sysItem, systemId === s.id && styles.sysItemSel]} onPress={() => selectSystem(s)}>
                            <Text style={styles.sysItemText}>{s.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={styles.sysFooter}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteCategory}><Text style={styles.btnText}>Delete Category</Text></TouchableOpacity>
                </View>
            </View>

            {/* Alt kategori kartı */}
            <View style={styles.card}>
                <Text style={styles.sysTitle}>Equipment Subcategory</Text>
                <Text style={styles.sysSub}>
                    {systemName ? `Subcategories linked to '${systemName}'.` : 'Select a category to manage related subcategories.'}
                </Text>
                <View style={styles.sep} />
                <Text style={styles.sysInputLbl}>New subcategory</Text>
                <View style={styles.sysInputRow}>
                    <TextInput style={styles.sysInput} value={newSubCategory} onChangeText={setNewSubCategory}
                        onSubmitEditing={addSubCategory} returnKeyType="done" />
                    <TouchableOpacity style={styles.btnAdd} onPress={addSubCategory}><Text style={styles.btnText}>Add Subcategory</Text></TouchableOpacity>
                </View>
                <View style={styles.sysList}>
                    {subCats.length === 0 && <Text style={styles.gridNone}>(none)</Text>}
                    {subCats.map((s) => (
                        <TouchableOpacity key={s.id} style={[styles.sysItem, subSelected.has(s.id) && styles.sysItemSel]} onPress={() => toggleSub(s.id)}>
                            <Text style={styles.sysItemText}>{s.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={styles.sysFooter}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteSubCategories}><Text style={styles.btnText}>Delete Subcategory</Text></TouchableOpacity>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    inv: { flex: 1 },
    tabs: { flexDirection: 'row', backgroundColor: '#1e2433' },
    tab: { paddingVertical: 11, paddingHorizontal: 14, borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: '#4c8bf5', backgroundColor: '#2d374b' },
    tabText: { color: '#b9c3d7', fontSize: 12, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    page: { flex: 1 },

    body: { flex: 1 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#9aa5b8', fontSize: 11, marginTop: 3 },

    toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    lbl: { fontSize: 12, color: '#374151' },
    select: {
        flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 7, flex: 1, minWidth: 150,
    },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },
    search: {
        flex: 1, minWidth: 150, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827',
    },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 4, margin: 8, padding: 8 },
    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6', paddingVertical: 2 },
    rowSel: { backgroundColor: '#eef2ff' },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    cellInput: {
        borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 4, backgroundColor: '#fff',
        paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, color: '#111827', margin: 2,
    },
    cellPick: { fontSize: 11, color: '#111827', paddingHorizontal: 6, paddingVertical: 8 },
    nameSearch: { paddingHorizontal: 6, paddingVertical: 4 },
    nameSearchIco: { fontSize: 15, color: '#0073ea' },

    addRowBtn: { padding: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eef0f6' },
    addRowText: { color: '#0073ea', fontSize: 12, fontWeight: '700' },

    actionbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 8, justifyContent: 'flex-end' },
    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnDelete: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnSave: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnSaveDirty: { backgroundColor: '#0073ea' },
    btnBlue: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnAdd: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8 },
    btnLight: { backgroundColor: '#eef1f7', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnLightText: { color: '#374151', fontSize: 12, fontWeight: '700' },
    btnDisabled: { opacity: 0.5 },

    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 10 },
    checkLabel: { fontSize: 13, color: '#323338', flex: 1 },

    // Equipment System kartları
    sysTitle: { fontSize: 14, fontWeight: '700', color: '#1f3a6e' },
    sysSub: { fontSize: 11, color: '#676879', marginTop: 3 },
    sep: { height: 1, backgroundColor: '#e8ebf2', marginVertical: 10 },
    sysInputLbl: { fontSize: 10, fontWeight: '700', color: '#8a90a2', letterSpacing: 0.5, marginBottom: 4 },
    sysInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sysInput: {
        flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827',
    },
    sysList: { marginTop: 10, borderWidth: 1, borderColor: '#e8ebf2', borderRadius: 6, overflow: 'hidden', maxHeight: 260 },
    sysItem: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    sysItemSel: { backgroundColor: '#e0eaff' },
    sysItemText: { fontSize: 13, color: '#323338' },
    sysFooter: { marginTop: 10, alignItems: 'flex-end' },

    // Modallar
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 12 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827', marginBottom: 8 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
    pickerBox: { backgroundColor: '#fff', borderRadius: 8, maxHeight: 420, width: '100%', paddingVertical: 6 },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 14, color: '#111827' },
    pickerItemTextSel: { color: '#2563eb', fontWeight: '700' },
    pickerEmpty: { fontSize: 13, fontStyle: 'italic', color: '#afb4c3', padding: 14 },
    eqPick: { paddingVertical: 10, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    eqPickName: { fontSize: 13, fontWeight: '600', color: '#111827' },
    eqPickSub: { fontSize: 11, color: '#676879', marginTop: 2 },
});

export default InventoryScreen;
