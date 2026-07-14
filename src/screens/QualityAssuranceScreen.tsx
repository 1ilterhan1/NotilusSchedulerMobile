// Web pages/QualityAssurance.tsx birebir (masaüstü ucQAReport klonu) — 2 sekme:
//  • Report (ucQaReportTabPage + FormCreateQAReport + FormReportItem): proje bazlı
//    tamamlanmış QA raporları, Create Report modalı, uzun basış → Report Items,
//    Delete Selected (yalnızca raporu oluşturan silebilir).
//  • Checklist (ucQaChecklistTabPage + FormItemsChecklist): checklist konuları
//    (subject) yönetimi, uzun basış → Items Checklist (Add/Copy/Paste/Delete).
// Mevcut API: /api/qualityassurance/* (YENİ API YAZILMAZ). Tüm mesaj metinleri birebir.
//
// Mobil uyarlama (mevcut ekranlarla tutarlı):
// - Sekme kabı Inventory ile aynı; select → PickerModal; çift tık → uzun basış;
//   alert/confirm → Alert.alert; tablolar yatay ScrollView; pano → expo-clipboard;
//   sekme zemini temaya duyarlı, başlık navy.

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
import * as Clipboard from 'expo-clipboard';
import { apiGet, apiFetch } from '../api';
import { useThemeDark } from '../theme';
import type { IdName } from '../types';

interface QaReportRow { id: number; workName: string; subjectName: string; userName: string; date: string }
interface QaReportItemRow { itemName: string; isControlled: boolean; note: string | null }

let qaUid = 1;
const nextUid = () => qaUid++;

function confirmAsync(message: string, title = ''): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}

const TABS = ['Report', 'Checklist'] as const;
type Tab = typeof TABS[number];

// ═════════════════════════════════════════════════════════════════════════════
//  Ortak: id/name seçim modalı
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
                        {items.length === 0 && <Text style={styles.pickerEmpty}>(none)</Text>}
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

// ═════════════════════════════════════════════════════════════════════════════
//  SEKME KABI (ucQAReport)
// ═════════════════════════════════════════════════════════════════════════════
function QualityAssuranceScreen() {
    const dark = useThemeDark();
    const [tab, setTab] = useState<Tab>('Report');
    const [opened, setOpened] = useState<Set<Tab>>(new Set<Tab>(['Report']));

    function openTab(t: Tab) {
        setTab(t);
        setOpened((prev) => (prev.has(t) ? prev : new Set(prev).add(t)));
    }

    return (
        <View style={[styles.qa, { backgroundColor: dark ? '#f0f2f7' : '#f7f8fc' }]}>
            <View style={styles.tabs}>
                {TABS.map((t) => (
                    <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => openTab(t)}>
                        <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            {opened.has('Report') && (
                <View style={[styles.page, { display: tab === 'Report' ? 'flex' : 'none' }]}>
                    <ReportTab />
                </View>
            )}
            {opened.has('Checklist') && (
                <View style={[styles.page, { display: tab === 'Checklist' ? 'flex' : 'none' }]}>
                    <ChecklistTab />
                </View>
            )}
        </View>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  REPORT SEKMESİ (ucQaReportTabPage)
// ═════════════════════════════════════════════════════════════════════════════
function ReportTab() {
    const [projects, setProjects] = useState<IdName[]>([]);
    const [projectId, setProjectId] = useState<number | null>(null);
    const [reports, setReports] = useState<QaReportRow[]>([]);
    const [selectedId, setSelectedId] = useState<number | null>(null);   // MultiSelect=false
    const [projPicker, setProjPicker] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const [openReport, setOpenReport] = useState<number | null>(null);

    useEffect(() => {
        apiGet<IdName[]>('/api/qualityassurance/projects').then((p) => {
            setProjects(p);
            setProjectId((prev) => prev ?? (p[0]?.id ?? null));
        }).catch(() => setProjects([]));
    }, []);

    const reload = useCallback(() => {
        if (projectId == null) { setReports([]); return; }
        apiGet<QaReportRow[]>(`/api/qualityassurance/reports?projectId=${projectId}`)
            .then((r) => { setReports(r); setSelectedId(null); })
            .catch(() => setReports([]));
    }, [projectId]);

    useEffect(reload, [reload]);

    const projectName = projects.find((p) => p.id === projectId)?.name ?? '';
    // UpdateProjectHint birebir
    const hint = !projectName.trim()
        ? 'Long-press a row to open the report details.'
        : `${reports.length} report(s) found for '${projectName}'. Long-press a row to open details.`;

    // btnDeleteSelectedReports_Click birebir
    async function deleteSelected() {
        if (selectedId == null) { Alert.alert('', 'Please select a report to delete.'); return; }
        const res = await apiFetch('/api/qualityassurance/reports/delete', {
            method: 'POST', body: JSON.stringify({ id: selectedId }),
        });
        if (res.ok) {
            const b = await res.json() as { deleted: boolean };
            if (!b.deleted) Alert.alert('', 'Reports can be deleted only by the user who created them.');
        }
        reload();
    }

    // btnCreateReport_Click birebir
    function createReport() {
        if (projectId == null) { Alert.alert('', 'Please select a project first.'); return; }
        setShowCreate(true);
    }

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}><Text style={styles.headerText}>Completed QA Reports</Text>
                <Text style={styles.headerSub}>Review completed QA reports by project.</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Project Filter</Text>
                <TouchableOpacity style={styles.select} onPress={() => setProjPicker(true)}>
                    <Text style={styles.selectText} numberOfLines={1}>{projectName || '—'}</Text>
                    <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.toolbar}>
                <TouchableOpacity style={styles.btnGreen} onPress={createReport}><Text style={styles.btnText}>Create Report</Text></TouchableOpacity>
            </View>

            {/* Report History */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Report History</Text>
                <Text style={styles.hint}>{hint}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            <Text style={[styles.gridHeadCell, { width: 220 }]}>Work</Text>
                            <Text style={[styles.gridHeadCell, { width: 150 }]}>Checklist</Text>
                            <Text style={[styles.gridHeadCell, { width: 120 }]}>Checked By</Text>
                            <Text style={[styles.gridHeadCell, { width: 150 }]}>Date</Text>
                        </View>
                        {reports.length === 0 && <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>}
                        {reports.map((r) => (
                            <TouchableOpacity key={r.id} style={[styles.gridRow, selectedId === r.id && styles.rowSel]}
                                onPress={() => setSelectedId(r.id)} onLongPress={() => setOpenReport(r.id)}>
                                <Text style={[styles.gridCell, { width: 220 }]} numberOfLines={1}>{r.workName}</Text>
                                <Text style={[styles.gridCell, { width: 150 }]} numberOfLines={1}>{r.subjectName}</Text>
                                <Text style={[styles.gridCell, { width: 120 }]} numberOfLines={1}>{r.userName}</Text>
                                <Text style={[styles.gridCell, { width: 150 }]} numberOfLines={1}>{new Date(r.date).toLocaleString()}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
                <View style={styles.cardFoot}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                </View>
            </View>

            <PickerModal visible={projPicker} items={projects} selectedId={projectId}
                onClose={() => setProjPicker(false)} onPick={(id) => { setProjectId(id); setProjPicker(false); }} />

            {showCreate && projectId != null && (
                <CreateReportModal initialProjectId={projectId} onClose={() => { setShowCreate(false); reload(); }} />
            )}
            {openReport != null && (
                <ReportItemsModal reportId={openReport} onClose={() => setOpenReport(null)} />
            )}
        </ScrollView>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  FormCreateQAReport MODALI
// ═════════════════════════════════════════════════════════════════════════════
interface CreateRow { uid: number; itemTypeId: number | null; itemName: string; note: string; isControlled: boolean }

function CreateReportModal({ initialProjectId, onClose }: { initialProjectId: number; onClose: () => void }) {
    const [projects, setProjects] = useState<IdName[]>([]);
    const [projectId, setProjectId] = useState<number | null>(initialProjectId);
    const [works, setWorks] = useState<IdName[]>([]);
    const [workId, setWorkId] = useState<number | null>(null);
    const [subjects, setSubjects] = useState<IdName[]>([]);
    const [subjectId, setSubjectId] = useState<number | null>(null);
    const [rows, setRows] = useState<CreateRow[]>([]);

    const [projPicker, setProjPicker] = useState(false);
    const [workPicker, setWorkPicker] = useState(false);
    const [subjPicker, setSubjPicker] = useState(false);

    // loadProjectsAndSubjects birebir
    useEffect(() => {
        apiGet<IdName[]>('/api/qualityassurance/projects').then(setProjects).catch(() => setProjects([]));
        apiGet<IdName[]>('/api/qualityassurance/subjects').then((s) => {
            setSubjects(s);
            setSubjectId(s[0]?.id ?? null);
        }).catch(() => setSubjects([]));
    }, []);

    // loadWorks birebir
    useEffect(() => {
        if (projectId == null) { setWorks([]); setWorkId(null); return; }
        apiGet<IdName[]>(`/api/qualityassurance/works?projectId=${projectId}`).then((w) => {
            setWorks(w);
            setWorkId(w[0]?.id ?? null);
        }).catch(() => setWorks([]));
    }, [projectId]);

    // loadItemTypes birebir (Note boş, Is Controlled false başlar)
    useEffect(() => {
        if (subjectId == null) { setRows([]); return; }
        apiGet<IdName[]>(`/api/qualityassurance/subjects/${subjectId}/items`).then((items) => {
            setRows(items.map((it) => ({
                uid: nextUid(), itemTypeId: it.id, itemName: it.name, note: '', isControlled: false,
            })));
        }).catch(() => setRows([]));
    }, [subjectId]);

    const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? '';
    const workName = works.find((w) => w.id === workId)?.name ?? '';
    const projName = projects.find((p) => p.id === projectId)?.name ?? '';
    const hint = !subjectName.trim()
        ? 'Review checklist items, notes, and control decisions here.'
        : `${rows.length} checklist item(s) loaded for '${subjectName}'. Review notes and control decisions here.`;

    function setField(uid: number, patch: Partial<CreateRow>) {
        setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
    }
    // DGV yeni-satırı: elle eklenen satırlar ItemTypeID'siz → kayıtta yeni item type oluşur
    function addNewRow() {
        setRows((prev) => [...prev, { uid: nextUid(), itemTypeId: null, itemName: '', note: '', isControlled: false }]);
    }

    // btnSave_Click + controlValues birebir
    async function saveReport() {
        if (projectId == null) { Alert.alert('', 'Please select a project!'); return; }
        if (subjectId == null) { Alert.alert('', 'Please select a subject!'); return; }
        if (workId == null) { Alert.alert('', 'Please select a work item!'); return; }

        const res = await apiFetch('/api/qualityassurance/reports/create', {
            method: 'POST',
            body: JSON.stringify({
                projectId, subjectId, workId,
                rows: rows.map((r) => ({ itemTypeId: r.itemTypeId, itemName: r.itemName, note: r.note, isControlled: r.isControlled })),
            }),
        });
        if (!res.ok) return;
        Alert.alert('', 'Report created successfully!');
        onClose();
    }

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '92%' }]}>
                    <View style={styles.modalHeadRow}>
                        <Text style={styles.modalHead}>Create QA Report</Text>
                        <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                    </View>

                    {/* Report Settings */}
                    <Text style={styles.cardTitle}>Report Settings</Text>
                    <Text style={styles.hint}>Choose the report context.</Text>
                    <Text style={styles.fieldLbl}>Project</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setProjPicker(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{projName || '—'}</Text><Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    <Text style={styles.fieldLbl}>Work</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setWorkPicker(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{workName || '—'}</Text><Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>
                    <Text style={styles.fieldLbl}>Checklist</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setSubjPicker(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{subjectName || '—'}</Text><Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>

                    {/* Checklist Items */}
                    <Text style={[styles.cardTitle, { marginTop: 12 }]}>Checklist Items</Text>
                    <Text style={styles.hint}>{hint}</Text>
                    <ScrollView style={{ maxHeight: 360 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View>
                                <View style={styles.gridHeadRow}>
                                    <Text style={[styles.gridHeadCell, { width: 220 }]}>Item Name</Text>
                                    <Text style={[styles.gridHeadCell, { width: 200 }]}>Note</Text>
                                    <Text style={[styles.gridHeadCell, { width: 90 }]}>Is Controlled</Text>
                                </View>
                                {rows.map((r) => (
                                    <View key={r.uid} style={styles.gridRow}>
                                        <View style={{ width: 220 }}>
                                            <TextInput style={styles.cellInput} value={r.itemName}
                                                onChangeText={(t) => setField(r.uid, { itemName: t })} />
                                        </View>
                                        <View style={{ width: 200 }}>
                                            <TextInput style={styles.cellInput} value={r.note}
                                                onChangeText={(t) => setField(r.uid, { note: t })} />
                                        </View>
                                        <TouchableOpacity style={{ width: 90, alignItems: 'center' }}
                                            onPress={() => setField(r.uid, { isControlled: !r.isControlled })}>
                                            <View style={[styles.cbBox, r.isControlled && styles.cbBoxOn]}>
                                                {r.isControlled && <Text style={styles.cbTick}>✓</Text>}
                                            </View>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        </ScrollView>
                        <TouchableOpacity style={styles.addRowBtn} onPress={addNewRow}>
                            <Text style={styles.addRowText}>＋ Add Item</Text>
                        </TouchableOpacity>
                    </ScrollView>

                    <View style={styles.modalActions}>
                        <TouchableOpacity style={styles.btnGreen} onPress={saveReport}><Text style={styles.btnText}>Save Report</Text></TouchableOpacity>
                    </View>

                    <PickerModal visible={projPicker} items={projects} selectedId={projectId}
                        onClose={() => setProjPicker(false)} onPick={(id) => { setProjectId(id); setProjPicker(false); }} />
                    <PickerModal visible={workPicker} items={works} selectedId={workId}
                        onClose={() => setWorkPicker(false)} onPick={(id) => { setWorkId(id); setWorkPicker(false); }} />
                    <PickerModal visible={subjPicker} items={subjects} selectedId={subjectId}
                        onClose={() => setSubjPicker(false)} onPick={(id) => { setSubjectId(id); setSubjPicker(false); }} />
                </View>
            </View>
        </Modal>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  FormReportItem MODALI (Report Items)
// ═════════════════════════════════════════════════════════════════════════════
function ReportItemsModal({ reportId, onClose }: { reportId: number; onClose: () => void }) {
    const [items, setItems] = useState<QaReportItemRow[]>([]);

    useEffect(() => {
        apiGet<QaReportItemRow[]>(`/api/qualityassurance/reports/${reportId}/items`)
            .then(setItems).catch(() => setItems([]));
    }, [reportId]);

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '85%' }]}>
                    <View style={styles.modalHeadRow}>
                        <Text style={styles.modalHead}>Report Items</Text>
                        <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                    </View>
                    <Text style={styles.itemsCount}>{items.length === 1 ? '1 item' : `${items.length} items`}</Text>
                    <ScrollView style={{ maxHeight: 480 }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View>
                                <View style={styles.gridHeadRow}>
                                    <Text style={[styles.gridHeadCell, { width: 220 }]}>Name</Text>
                                    <Text style={[styles.gridHeadCell, { width: 200 }]}>Note</Text>
                                    <Text style={[styles.gridHeadCell, { width: 90 }]}>Controlled</Text>
                                </View>
                                {items.length === 0 && <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>}
                                {items.map((it, i) => (
                                    <View key={i} style={styles.gridRow}>
                                        <Text style={[styles.gridCell, { width: 220 }]}>{it.itemName}</Text>
                                        <Text style={[styles.gridCell, { width: 200 }]}>{it.note}</Text>
                                        <View style={{ width: 90, alignItems: 'center', justifyContent: 'center' }}>
                                            <Text style={[styles.pill, it.isControlled ? styles.pillYes : styles.pillNo]}>
                                                {it.isControlled ? 'Yes' : 'No'}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </ScrollView>
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  CHECKLIST SEKMESİ (ucQaChecklistTabPage)
// ═════════════════════════════════════════════════════════════════════════════
function ChecklistTab() {
    const [subjects, setSubjects] = useState<IdName[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [newSubject, setNewSubject] = useState('');
    const [search, setSearch] = useState('');
    const [openChecklist, setOpenChecklist] = useState<{ subjectId: number; name: string } | null>(null);

    const reload = useCallback(() => {
        apiGet<IdName[]>('/api/qualityassurance/subjects').then((s) => {
            setSubjects(s);
            setSelected(new Set());
        }).catch(() => setSubjects([]));
    }, []);

    useEffect(reload, [reload]);

    // ApplySubjectFilter birebir
    const visible = useMemo(() => {
        const t = search.trim().toLowerCase();
        if (!t) return subjects;
        return subjects.filter((s) => (s.name ?? '').toLowerCase().includes(t));
    }, [subjects, search]);

    // UpdateSubjectHint birebir
    const hint = search.trim()
        ? `${visible.length} subject(s) match '${search.trim().toLowerCase()}'. Long-press a subject to manage its checklist items.`
        : `${visible.length} subject(s) available. Long-press a subject to manage its checklist items.`;

    // btnAddSubject_Click + controlNewSubject birebir
    async function addSubject() {
        if (!newSubject.trim()) { Alert.alert('', 'Please enter a subject name!'); return; }
        const name = newSubject.trim();
        const res = await apiFetch('/api/qualityassurance/subjects', { method: 'POST', body: JSON.stringify({ name }) });
        if (res.status === 409) { Alert.alert('', `There is already a subject named '${name}'!`); return; }
        if (!res.ok) return;
        reload();
        setNewSubject('');
        Alert.alert('', 'New subject added successfully!');
    }

    // btnDeleteSubjects_Click + userIsSure birebir
    async function deleteSubjects() {
        if (selected.size === 0) { Alert.alert('', 'Please select at least one subject.'); return; }
        if (!(await confirmAsync('The subject and its historical checklist items will be deleted. Are you sure?'))) return;
        await apiFetch('/api/qualityassurance/subjects/delete', { method: 'POST', body: JSON.stringify([...selected]) });
        reload();
        Alert.alert('', 'Subject(s) deleted successfully');
    }

    function toggleSel(id: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }

    return (
        <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={styles.header}><Text style={styles.headerText}>Checklist Subjects</Text>
                <Text style={styles.headerSub}>Create and manage checklist subjects used in QA reports.</Text></View>

            <View style={styles.toolbar}>
                <Text style={styles.lbl}>New Subject</Text>
                <TextInput style={styles.search} value={newSubject} onChangeText={setNewSubject}
                    onSubmitEditing={addSubject} returnKeyType="done" />
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Search</Text>
                <TextInput style={styles.search} value={search} onChangeText={setSearch} />
                <TouchableOpacity style={styles.btnGreen} onPress={addSubject}><Text style={styles.btnText}>Add Subject</Text></TouchableOpacity>
            </View>

            <View style={styles.card}>
                <Text style={styles.cardTitle}>Subject Library</Text>
                <Text style={styles.hint}>{hint}</Text>
                <View style={styles.list}>
                    {visible.length === 0 && <Text style={styles.gridNone}>(none)</Text>}
                    {visible.map((s) => (
                        <TouchableOpacity key={s.id} style={[styles.listItem, selected.has(s.id) && styles.rowSel]}
                            onPress={() => toggleSel(s.id)} onLongPress={() => setOpenChecklist({ subjectId: s.id, name: s.name })}>
                            <Text style={styles.listItemText}>{s.name}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
                <View style={styles.cardFoot}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteSubjects}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                </View>
            </View>

            {openChecklist && (
                <ItemsChecklistModal subjectId={openChecklist.subjectId} subjectName={openChecklist.name}
                    onClose={() => setOpenChecklist(null)} />
            )}
        </ScrollView>
    );
}

// ═════════════════════════════════════════════════════════════════════════════
//  FormItemsChecklist MODALI (Checklist)
// ═════════════════════════════════════════════════════════════════════════════
function ItemsChecklistModal({ subjectId, subjectName, onClose }:
    { subjectId: number; subjectName: string; onClose: () => void }) {
    const [subjects, setSubjects] = useState<IdName[]>([]);
    const [currentSubjectId, setCurrentSubjectId] = useState(subjectId);
    const [items, setItems] = useState<IdName[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [newItem, setNewItem] = useState('');
    const [subjPicker, setSubjPicker] = useState(false);
    void subjectName;

    useEffect(() => {
        apiGet<IdName[]>('/api/qualityassurance/subjects').then(setSubjects).catch(() => setSubjects([]));
    }, []);

    const loadItems = useCallback(() => {
        apiGet<IdName[]>(`/api/qualityassurance/subjects/${currentSubjectId}/items`).then((it) => {
            setItems(it);
            setSelected(new Set());
        }).catch(() => setItems([]));
    }, [currentSubjectId]);

    useEffect(loadItems, [loadItems]);

    // btnAddItem_Click + controlNewItem birebir
    async function addItem() {
        if (!newItem.trim()) { Alert.alert('', 'Please enter an item name!'); return; }
        const res = await apiFetch('/api/qualityassurance/items', {
            method: 'POST', body: JSON.stringify({ subjectId: currentSubjectId, name: newItem }),
        });
        if (res.status === 409) { Alert.alert('', `There is already an item named '${newItem}'!`); return; }
        if (!res.ok) return;
        setNewItem('');
        loadItems();
        Alert.alert('', 'Item added successfully!');
    }

    // btnDeleteItems_Click birebir (masaüstünde onay sorulmaz)
    async function deleteItems() {
        const ids = items.filter((i) => selected.has(i.id)).map((i) => i.id);
        await apiFetch('/api/qualityassurance/items/delete', { method: 'POST', body: JSON.stringify(ids) });
        loadItems();
        Alert.alert('', 'Item(s) deleted successfully!');
    }

    // btnCopy_Click birebir — tüm item adları panoya
    async function copyItems() {
        const text = items.map((i) => i.name).join('\r\n') + (items.length > 0 ? '\r\n' : '');
        try { await Clipboard.setStringAsync(text); } catch { /* pano erişimi reddedildi */ }
        Alert.alert('', 'Table copied!');
    }

    // btnPaste_Click birebir — pano satırları yeni item olur (mükerrer kontrolü yok)
    async function pasteItems() {
        let clipboardText = '';
        try { clipboardText = await Clipboard.getStringAsync(); } catch { /* pano erişimi yok */ }
        if (!clipboardText.trim()) { Alert.alert('', 'Clipboard is empty!'); return; }
        const lines = clipboardText.split(/\r\n|\n/).filter((l) => l.trim().length > 0);
        await apiFetch('/api/qualityassurance/items/paste', {
            method: 'POST', body: JSON.stringify({ subjectId: currentSubjectId, lines }),
        });
        loadItems();
        Alert.alert('', 'Items pasted successfully!');
    }

    function toggleSel(id: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    }

    const currentName = subjects.find((s) => s.id === currentSubjectId)?.name ?? '';

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '90%' }]}>
                    <View style={styles.modalHeadRow}>
                        <Text style={styles.modalHead}>Checklist</Text>
                        <TouchableOpacity onPress={onClose}><Text style={styles.modalClose}>✕</Text></TouchableOpacity>
                    </View>

                    <Text style={styles.fieldLbl}>Checklist</Text>
                    <TouchableOpacity style={styles.select} onPress={() => setSubjPicker(true)}>
                        <Text style={styles.selectText} numberOfLines={1}>{currentName || '—'}</Text><Text style={styles.selectCaret}>▾</Text>
                    </TouchableOpacity>

                    <View style={[styles.toolbar, { paddingHorizontal: 0 }]}>
                        <TextInput style={styles.search} value={newItem} onChangeText={setNewItem}
                            onSubmitEditing={addItem} returnKeyType="done" />
                        <TouchableOpacity style={styles.btnBlue} onPress={addItem}><Text style={styles.btnText}>Add</Text></TouchableOpacity>
                    </View>

                    <ScrollView style={[styles.list, { maxHeight: 360 }]}>
                        {items.length === 0 && <Text style={styles.gridNone}>(none)</Text>}
                        {items.map((it) => (
                            <TouchableOpacity key={it.id} style={[styles.listItem, selected.has(it.id) && styles.rowSel]}
                                onPress={() => toggleSel(it.id)}>
                                <Text style={styles.listItemText}>{it.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </ScrollView>

                    <View style={[styles.modalActions, { justifyContent: 'flex-start' }]}>
                        <TouchableOpacity style={styles.btnLight} onPress={copyItems}><Text style={styles.btnLightText}>Copy</Text></TouchableOpacity>
                        <TouchableOpacity style={styles.btnLight} onPress={pasteItems}><Text style={styles.btnLightText}>Paste</Text></TouchableOpacity>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity style={styles.btnDelete} onPress={deleteItems}><Text style={styles.btnText}>Delete Selected</Text></TouchableOpacity>
                    </View>

                    <PickerModal visible={subjPicker} items={subjects} selectedId={currentSubjectId}
                        onClose={() => setSubjPicker(false)} onPick={(id) => { setCurrentSubjectId(id); setSubjPicker(false); }} />
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    qa: { flex: 1 },
    tabs: { flexDirection: 'row', backgroundColor: '#1e2433' },
    tab: { paddingVertical: 11, paddingHorizontal: 18, borderBottomWidth: 3, borderBottomColor: 'transparent' },
    tabActive: { borderBottomColor: '#4c8bf5', backgroundColor: '#2d374b' },
    tabText: { color: '#b9c3d7', fontSize: 12, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    page: { flex: 1 },

    body: { flex: 1 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#9aa5b8', fontSize: 11, marginTop: 3 },

    toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingVertical: 6 },
    lbl: { fontSize: 12, color: '#374151' },
    select: {
        flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6,
        backgroundColor: '#fff', paddingHorizontal: 10, paddingVertical: 8, flex: 1, minWidth: 150,
    },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },
    search: {
        flex: 1, minWidth: 150, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827',
    },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 4, margin: 8, padding: 10 },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#1f3a6e' },
    hint: { fontSize: 11, color: '#676879', marginTop: 3, marginBottom: 8 },
    cardFoot: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 6 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6', paddingVertical: 2 },
    gridCell: { fontSize: 11, color: '#111827', paddingHorizontal: 6, paddingVertical: 8 },
    rowSel: { backgroundColor: '#eef2ff' },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    cellInput: {
        borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 4, backgroundColor: '#fff',
        paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, color: '#111827', margin: 2,
    },

    list: { borderWidth: 1, borderColor: '#e8ebf2', borderRadius: 6, overflow: 'hidden', marginTop: 2 },
    listItem: { paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    listItemText: { fontSize: 13, color: '#323338' },

    addRowBtn: { padding: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eef0f6' },
    addRowText: { color: '#0073ea', fontSize: 12, fontWeight: '700' },

    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },

    pill: { fontSize: 10, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
    pillYes: { color: '#037f4c', backgroundColor: '#dcfce7' },
    pillNo: { color: '#9ca3af', backgroundColor: '#f1f5f9' },

    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnGreen: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnBlue: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnDelete: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnLight: { backgroundColor: '#eef1f7', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 9 },
    btnLightText: { color: '#374151', fontSize: 12, fontWeight: '700' },

    // Modallar
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 12 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    modalHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    modalHead: { fontSize: 14, fontWeight: '700', color: '#111827' },
    modalClose: { fontSize: 16, color: '#6b7280', padding: 4 },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
    fieldLbl: { fontSize: 11, fontWeight: '700', color: '#8a90a2', letterSpacing: 0.3, marginTop: 8, marginBottom: 3 },
    itemsCount: { fontSize: 11, color: '#676879', marginBottom: 6 },

    pickerBox: { backgroundColor: '#fff', borderRadius: 8, maxHeight: 420, width: '100%', paddingVertical: 6 },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 14, color: '#111827' },
    pickerItemTextSel: { color: '#2563eb', fontWeight: '700' },
    pickerEmpty: { fontSize: 13, fontStyle: 'italic', color: '#afb4c3', padding: 14 },
});

export default QualityAssuranceScreen;
