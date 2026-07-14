// Web pages/Meetings.tsx birebir (masaüstü ucMeetings + FormMeetingNotes klonu).
// Mevcut API: /api/meetings/* (liste, save, delete, notes, employees, import)
//
// Birebir korunanlar:
// - Proje filtresi "(All Projects)" (ID=0) + Show Finished Projects (işaretliyken
//   notlar read-only açılır; filtredeki proje listede yoksa All'a döner)
// - Grid: Meeting Name · Date · Project · Summary/Note · Open Notes; yeni satır
//   ID=-1, Date=today, Project=seçili/ilk (DefaultValuesNeeded)
// - Save Changes yalnız değişen satırları gönderir; kirliyken "Save Changes *";
//   sonuç mesajları birebir (fail/success kombinasyonları)
// - Delete Selected: "Selected rows and their associated meeting notes will be
//   deleted! Are you sure?"; kaydetmeden not açma: "You cannot open meeting
//   notes without saving the meeting."
// - Engineer: grid read-only, Save/Delete gizli, notlar read-only
// - Meeting Notes modalı (FormMeetingNotes): Note/Type/Responsible/Due Date;
//   boş metin ve Action+sorumsuz satır uyarıları birebir; silme onayı;
//   Import From Excel (kolonlar B=Text, C=Type, D=Responsible, E=DueDate,
//   başlık satırı atlanır; Excel seri tarih dönüşümü dahil) ve sonuç mesajları
// Mobil uyarlama: DGV boş satırı yerine "+ Add" butonu (aynı varsayılanlarla);
// select → modal liste; tarih → takvim modalı; dosya → expo-document-picker;
// alert/confirm → Alert.alert.

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
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { apiGet, apiFetch } from '../api';
import type { UserInfo } from '../auth';

interface IdName { id: number; name: string }
interface MeetingDto { id: number; name: string | null; date: string; projectId: number; note: string | null }
interface MeetingsPayload { projects: IdName[]; meetings: MeetingDto[] }
interface SaveResult { fail: number; message: string; success: number }
interface NoteDto { id: number; meetingId: number; text: string; type: string | null; responsible: string | null; dueDate: string | null }
interface NotesSaveResult { updateFail: number; updateMessage: string; updateSuccess: number; insertFail: number; insertMessage: string; insertSuccess: number }
interface ImportResult { existingAssignment: boolean; noResponsible: boolean; existingNotes: boolean; noResponsibleNote: boolean }

interface Row { uid: number; id: number; name: string; date: string; projectId: number; note: string; changed: boolean }
interface NoteRow { uid: number; id: number; meetingId: number; text: string; type: string; responsible: string; dueDate: string; changed: boolean }

const NOTE_TYPES = ['Action', 'Decision', 'Information'];

function today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toDateStr(v: string | null): string {
    return v ? v.substring(0, 10) : '';
}
function confirmAsync(message: string, title = '!'): Promise<boolean> {
    return new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: 'No', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Yes', onPress: () => resolve(true) },
        ]);
    });
}

let uidSeq = 1;
const nextUid = () => uidSeq++;

interface Props {
    user: UserInfo;
}

function MeetingsScreen({ user }: Props) {
    // Engineer rolü read-only erişim alır (_isEngineer birebir).
    const isEngineer = (user.status ?? '') === 'Engineer';

    const [projects, setProjects] = useState<IdName[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [projectFilter, setProjectFilter] = useState(0);        // 0 = (All Projects)
    const [showFinished, setShowFinished] = useState(false);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [notesFor, setNotesFor] = useState<{ meetingId: number; projectId: number; readOnly: boolean } | null>(null);

    const [filterPickerOpen, setFilterPickerOpen] = useState(false);
    const [rowProjPicker, setRowProjPicker] = useState<number | null>(null);   // uid
    const [rowDatePicker, setRowDatePicker] = useState<number | null>(null);   // uid

    const dirty = rows.some((r) => r.changed);

    // loadProjectCombobox + loadMeetingListview birebir
    const reload = useCallback((finished: boolean) => {
        apiGet<MeetingsPayload>(`/api/meetings?finished=${finished}`)
            .then((p) => {
                setProjects(p.projects);
                setRows(p.meetings.map((m) => ({
                    uid: nextUid(), id: m.id, name: m.name ?? '', date: toDateStr(m.date),
                    projectId: m.projectId, note: m.note ?? '', changed: false,
                })));
                setSelected(new Set());
                setProjectFilter((f) => (f !== 0 && !p.projects.some((x) => x.id === f) ? 0 : f));
            })
            .catch((e) => setError(e.message));
    }, []);

    useEffect(() => { reload(showFinished); }, [reload, showFinished]);

    // applyProjectFilter birebir
    const visible = useMemo(
        () => (projectFilter === 0 ? rows : rows.filter((r) => r.projectId === projectFilter)),
        [rows, projectFilter]);

    function setField(uid: number, patch: Partial<Row>) {
        setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch, changed: true } : r)));
    }

    // DefaultValuesNeeded birebir (ID=-1, Project=seçili/ilk, Date=today)
    function addNewRow() {
        const defaultProjectId = projectFilter !== 0 ? projectFilter : (projects[0]?.id ?? 0);
        setRows((prev) => [...prev, {
            uid: nextUid(), id: -1, name: '', date: today(),
            projectId: defaultProjectId, note: '', changed: true,
        }]);
    }

    function toggleSel(uid: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
    }

    // btnSave_Click birebir
    async function saveChanges() {
        const updateData = rows.filter((r) => r.changed).map((r) => ({
            id: r.id, name: r.name, date: r.date || today(), projectId: r.projectId, note: r.note,
        }));
        const res = await apiFetch('/api/meetings/save', { method: 'POST', body: JSON.stringify(updateData) });
        if (!res.ok) { Alert.alert('', 'FAILED TO UPDATE MEETING RECORDS! PLEASE CHECK VALUES!'); return; }
        const updated = await res.json() as SaveResult;

        if (updated.fail === 0) {
            Alert.alert('', 'The meeting records were updated successfully.');
        } else if (updated.fail !== -1) {
            if (updated.success !== 0) {
                Alert.alert('', `${updated.message}${updated.fail} - Meeting record failed to update. \nThe other ${updated.success} meeting records were updated successfully.`);
            } else {
                Alert.alert('', `${updated.message}${updated.fail} - Meeting record failed to update.`);
            }
        } else {
            Alert.alert('', 'FAILED TO UPDATE MEETING RECORDS! PLEASE CHECK VALUES!');
        }
        reload(showFinished);
    }

    // btnDelete_Click birebir
    async function deleteSelected() {
        if (selected.size === 0) { Alert.alert('', 'Please select rows to delete!'); return; }
        if (!(await confirmAsync('Selected rows and their associated meeting notes will be deleted! Are you sure?'))) return;

        const meetingIds = rows.filter((r) => selected.has(r.uid)).map((r) => r.id);
        await apiFetch('/api/meetings/delete', { method: 'POST', body: JSON.stringify(meetingIds) });
        reload(showFinished);
    }

    // adgvMeeting_CellContentClick (Open Notes) birebir
    function openNotes(r: Row) {
        if (r.id === -1) {
            Alert.alert('', 'You cannot open meeting notes without saving the meeting.');
            return;
        }
        setNotesFor({ meetingId: r.id, projectId: r.projectId, readOnly: showFinished || isEngineer });
    }

    function onShowFinishedChange(checked: boolean) {
        setShowFinished(checked);
        setProjectFilter(0);
    }

    const readOnlyGrid = isEngineer;
    const projName = (id: number) => projects.find(p => p.id === id)?.name ?? '';

    return (
        <ScrollView style={styles.mt} contentContainerStyle={styles.mtContent}>
            {/* pnlHeader */}
            <View style={styles.header}><Text style={styles.headerText}>Meetings</Text></View>

            {/* Toolbar */}
            <View style={styles.toolbar}>
                <Text style={styles.cardTitle}>Meeting List</Text>
            </View>
            <View style={styles.toolbar}>
                <Text style={styles.lbl}>Project</Text>
                <TouchableOpacity style={styles.select} onPress={() => setFilterPickerOpen(true)}>
                    <Text style={styles.selectText} numberOfLines={1}>
                        {projectFilter === 0 ? '(All Projects)' : projName(projectFilter)}
                    </Text>
                    <Text style={styles.selectCaret}>▾</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.cbRow} onPress={() => onShowFinishedChange(!showFinished)}>
                    <View style={[styles.cbBox, showFinished && styles.cbBoxOn]}>
                        {showFinished && <Text style={styles.cbTick}>✓</Text>}
                    </View>
                    <Text style={styles.cbLabel}>Show Finished Projects</Text>
                </TouchableOpacity>
            </View>

            {error && <Text style={styles.error}>{error}</Text>}

            {/* Grid */}
            <View style={styles.card}>
                <ScrollView horizontal showsHorizontalScrollIndicator>
                    <View>
                        <View style={styles.gridHeadRow}>
                            <Text style={[styles.gridHeadCell, { width: 30 }]}></Text>
                            <Text style={[styles.gridHeadCell, { width: 150 }]}>Meeting Name</Text>
                            <Text style={[styles.gridHeadCell, { width: 100 }]}>Date</Text>
                            <Text style={[styles.gridHeadCell, { width: 130 }]}>Project</Text>
                            <Text style={[styles.gridHeadCell, { width: 170 }]}>Summary / Note</Text>
                            <Text style={[styles.gridHeadCell, { width: 90 }]}>Details</Text>
                        </View>
                        {visible.length === 0 && readOnlyGrid && (
                            <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                        )}
                        {visible.map((r) => (
                            <View key={r.uid} style={[styles.gridRow, selected.has(r.uid) && styles.rowSel]}>
                                <TouchableOpacity style={{ width: 30, alignItems: 'center' }} onPress={() => toggleSel(r.uid)}>
                                    <View style={[styles.cbBox, selected.has(r.uid) && styles.cbBoxOn]}>
                                        {selected.has(r.uid) && <Text style={styles.cbTick}>✓</Text>}
                                    </View>
                                </TouchableOpacity>
                                <View style={{ width: 150 }}>
                                    <TextInput style={[styles.cellInput, readOnlyGrid && styles.cellRO]}
                                        editable={!readOnlyGrid} value={r.name}
                                        onChangeText={(t) => setField(r.uid, { name: t })} />
                                </View>
                                <TouchableOpacity style={{ width: 100 }} disabled={readOnlyGrid}
                                    onPress={() => setRowDatePicker(r.uid)}>
                                    <Text style={styles.cellDate}>{r.date || '—'}</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={{ width: 130 }} disabled={readOnlyGrid}
                                    onPress={() => setRowProjPicker(r.uid)}>
                                    <Text style={styles.cellDate} numberOfLines={1}>
                                        {projects.some(p => p.id === r.projectId) ? projName(r.projectId) : ''}
                                        {' ▾'}
                                    </Text>
                                </TouchableOpacity>
                                <View style={{ width: 170 }}>
                                    <TextInput style={[styles.cellInput, readOnlyGrid && styles.cellRO]}
                                        editable={!readOnlyGrid} value={r.note}
                                        onChangeText={(t) => setField(r.uid, { note: t })} />
                                </View>
                                <TouchableOpacity style={{ width: 90 }} onPress={() => openNotes(r)}>
                                    <Text style={styles.openNotes}>Open Notes</Text>
                                </TouchableOpacity>
                            </View>
                        ))}
                    </View>
                </ScrollView>
                {/* DGV yeni-satırı karşılığı — Engineer'da yok */}
                {!readOnlyGrid && (
                    <TouchableOpacity style={styles.addRowBtn} onPress={addNewRow}>
                        <Text style={styles.addRowText}>＋ Add Meeting</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Footer — Engineer'da gizli */}
            {!isEngineer && (
                <View style={styles.toolbar}>
                    <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}>
                        <Text style={styles.btnText}>Delete Selected</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnSave, dirty && styles.btnSaveDirty]} onPress={saveChanges}>
                        <Text style={styles.btnText}>{dirty ? 'Save Changes *' : 'Save Changes'}</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Proje filtre seçimi */}
            <PickerModal visible={filterPickerOpen}
                items={[{ id: 0, name: '(All Projects)' }, ...projects]}
                selectedId={projectFilter}
                onClose={() => setFilterPickerOpen(false)}
                onPick={(id) => { setProjectFilter(id); setFilterPickerOpen(false); }} />

            {/* Satır proje seçimi */}
            <PickerModal visible={rowProjPicker != null} items={projects}
                selectedId={rows.find(r => r.uid === rowProjPicker)?.projectId ?? null}
                onClose={() => setRowProjPicker(null)}
                onPick={(id) => {
                    if (rowProjPicker != null) setField(rowProjPicker, { projectId: id });
                    setRowProjPicker(null);
                }} />

            {/* Satır tarih seçimi */}
            <Modal visible={rowDatePicker != null} transparent animationType="fade"
                onRequestClose={() => setRowDatePicker(null)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setRowDatePicker(null)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker
                            initial={rows.find(r => r.uid === rowDatePicker)?.date || today()}
                            onPick={(d) => {
                                if (rowDatePicker != null) setField(rowDatePicker, { date: d });
                                setRowDatePicker(null);
                            }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            {notesFor && (
                <MeetingNotesModal meetingId={notesFor.meetingId} projectId={notesFor.projectId}
                    readOnly={notesFor.readOnly} onClose={() => setNotesFor(null)} />
            )}
        </ScrollView>
    );
}

// ═══ FormMeetingNotes birebir (modal) ═══
function MeetingNotesModal({ meetingId, projectId, readOnly, onClose }:
    { meetingId: number; projectId: number; readOnly: boolean; onClose: () => void }) {

    const [notes, setNotes] = useState<NoteRow[]>([]);
    const [employees, setEmployees] = useState<string[]>([]);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [importing, setImporting] = useState(false);

    const [typePicker, setTypePicker] = useState<number | null>(null);        // uid
    const [respPicker, setRespPicker] = useState<number | null>(null);        // uid
    const [duePicker, setDuePicker] = useState<number | null>(null);          // uid

    const dirty = notes.some((n) => n.changed);

    const load = useCallback(() => {
        apiGet<NoteDto[]>(`/api/meetings/${meetingId}/notes`).then((list) => {
            setNotes(list.map((n) => ({
                uid: nextUid(), id: n.id, meetingId: n.meetingId, text: n.text ?? '',
                type: n.type ?? '', responsible: n.responsible ?? '', dueDate: toDateStr(n.dueDate), changed: false,
            })));
            setSelected(new Set());
        }).catch(() => setNotes([]));
    }, [meetingId]);

    // FormMeetingNotes_Load: ResponsibleLoad + dgvLoad
    useEffect(() => {
        apiGet<string[]>('/api/meetings/employees').then(setEmployees).catch(() => setEmployees([]));
        load();
    }, [load]);

    function setField(uid: number, patch: Partial<NoteRow>) {
        setNotes((prev) => prev.map((n) => (n.uid === uid ? { ...n, ...patch, changed: true } : n)));
    }

    // DefaultValuesNeeded: ID=-1, MeetingID=meetingId
    function addNewRow() {
        setNotes((prev) => [...prev, {
            uid: nextUid(), id: -1, meetingId, text: '', type: '', responsible: '', dueDate: '', changed: true,
        }]);
    }

    function toggleSel(uid: number) {
        setSelected((prev) => { const n = new Set(prev); if (n.has(uid)) n.delete(uid); else n.add(uid); return n; });
    }

    // btnSave_Click birebir
    async function saveChanges() {
        const updateData: NoteRow[] = [];
        const newRecords: NoteRow[] = [];
        let emptyText = false;
        let invalidCount = 0;

        for (const n of notes) {
            if (!n.changed) continue;
            if (!n.text.trim()) { emptyText = true; continue; }
            if (n.type === 'Action' && !n.responsible.trim()) { invalidCount++; continue; }
            if (n.id === -1) newRecords.push(n); else updateData.push(n);
        }
        if (emptyText) Alert.alert('', 'Records with empty text could not be saved.');
        if (invalidCount > 0) Alert.alert('', "The following rows have 'Action' as Type but no Responsible");

        const dto = (n: NoteRow) => ({
            id: n.id, meetingId: n.meetingId, text: n.text, type: n.type,
            responsible: n.responsible, dueDate: n.dueDate || null,
        });
        const res = await apiFetch('/api/meetings/notes/save', {
            method: 'POST',
            body: JSON.stringify({ projectId, updates: updateData.map(dto), inserts: newRecords.map(dto) }),
        });
        if (!res.ok) { Alert.alert('', 'FAILED TO UPDATE OR INSERT MEETING NOTES! PLEASE CHECK VALUES!'); return; }
        const r = await res.json() as NotesSaveResult;

        if (r.updateFail === 0 && r.insertFail === 0) {
            Alert.alert('', 'The meeting notes were updated and added successfully.');
        } else if (r.updateFail !== -1 || r.insertFail !== -1) {
            Alert.alert('', `${r.updateFail} updates failed, ${r.insertFail} inserts failed.`);
        } else {
            Alert.alert('', 'FAILED TO UPDATE OR INSERT MEETING NOTES! PLEASE CHECK VALUES!');
        }
        load();
    }

    // btnDelete_Click birebir
    async function deleteSelected() {
        if (selected.size === 0) { Alert.alert('', 'Please select rows to delete!'); return; }
        if (!(await confirmAsync('Selected rows will be deleted! Are you sure?'))) return;

        const ids = notes.filter((n) => selected.has(n.uid)).map((n) => n.id);
        if (ids.length > 0) {
            await apiFetch('/api/meetings/notes/delete', { method: 'POST', body: JSON.stringify(ids) });
            load();
        } else {
            Alert.alert('', 'No valid rows selected for deletion.');
        }
    }

    // btnImportFromExcel_Click birebir — kolonlar B/C/D/E, başlık satırı atlanır
    async function importFromExcel() {
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
            const wb = XLSX.read(b64, { type: 'base64', cellDates: true });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

            const toDate = (v: unknown): string | null => {
                if (v == null) return null;
                if (v instanceof Date && !isNaN(v.getTime()))
                    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
                if (typeof v === 'number') { // Excel seri tarihi (masaüstü epoku birebir)
                    const d = new Date(1900, 0, 1);
                    d.setDate(d.getDate() + v - 2);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
                const p = new Date(String(v));
                return isNaN(p.getTime()) ? null : `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
            };

            const rows = grid.slice(1).map((row) => ({
                text: String(row?.[1] ?? ''),
                type: String(row?.[2] ?? ''),
                responsible: String(row?.[3] ?? ''),
                dueDate: toDate(row?.[4]),
            }));

            const res = await apiFetch(`/api/meetings/${meetingId}/import`, {
                method: 'POST', body: JSON.stringify({ projectId, rows }),
            });
            if (!res.ok) return;
            const r = await res.json() as ImportResult;

            if (r.existingAssignment) Alert.alert('', 'Duplicate Assignments were not saved. All other records have been successfully processed.');
            if (r.noResponsible) Alert.alert('', 'Action records without a responsible person were not saved.');
            if (r.existingNotes) Alert.alert('', 'Duplicate Meeting Notes were not saved. All other records have been successfully processed.');

            load();
            Alert.alert('', 'Excel Notes added!');
        } finally {
            setImporting(false);
        }
    }

    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose}>
            <View style={styles.modalOverlay}>
                <View style={[styles.modalBox, { maxHeight: '92%' }]}>
                    {/* pnlHeader */}
                    <View style={styles.mtnHeader}>
                        <Text style={styles.mtnHeaderText}>Meeting Notes</Text>
                        <TouchableOpacity onPress={onClose}><Text style={styles.mtnClose}>✕</Text></TouchableOpacity>
                    </View>

                    {/* Toolbar (readOnly'de gizli) */}
                    {!readOnly && (
                        <View style={[styles.toolbar, { paddingHorizontal: 0 }]}>
                            <TouchableOpacity style={[styles.btnImport, importing && { opacity: 0.5 }]}
                                disabled={importing} onPress={importFromExcel}>
                                <Text style={styles.btnText}>{importing ? 'Importing...' : 'Import From Excel'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.btnDelete} onPress={deleteSelected}>
                                <Text style={styles.btnText}>Delete Selected</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btnSave, dirty && styles.btnSaveDirty]} onPress={saveChanges}>
                                <Text style={styles.btnText}>{dirty ? 'Save Changes *' : 'Save Changes'}</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    <ScrollView>
                        <ScrollView horizontal showsHorizontalScrollIndicator>
                            <View>
                                <View style={styles.gridHeadRow}>
                                    <Text style={[styles.gridHeadCell, { width: 30 }]}></Text>
                                    <Text style={[styles.gridHeadCell, { width: 190 }]}>Note</Text>
                                    <Text style={[styles.gridHeadCell, { width: 100 }]}>Type</Text>
                                    <Text style={[styles.gridHeadCell, { width: 130 }]}>Responsible</Text>
                                    <Text style={[styles.gridHeadCell, { width: 100 }]}>Due Date</Text>
                                </View>
                                {notes.length === 0 && readOnly && (
                                    <View style={styles.gridRow}><Text style={styles.gridNone}>(none)</Text></View>
                                )}
                                {notes.map((n) => (
                                    <View key={n.uid} style={[styles.gridRow, selected.has(n.uid) && styles.rowSel]}>
                                        <TouchableOpacity style={{ width: 30, alignItems: 'center' }} onPress={() => toggleSel(n.uid)}>
                                            <View style={[styles.cbBox, selected.has(n.uid) && styles.cbBoxOn]}>
                                                {selected.has(n.uid) && <Text style={styles.cbTick}>✓</Text>}
                                            </View>
                                        </TouchableOpacity>
                                        <View style={{ width: 190 }}>
                                            <TextInput style={[styles.cellInput, readOnly && styles.cellRO]}
                                                editable={!readOnly} value={n.text} multiline
                                                onChangeText={(t) => setField(n.uid, { text: t })} />
                                        </View>
                                        <TouchableOpacity style={{ width: 100 }} disabled={readOnly}
                                            onPress={() => setTypePicker(n.uid)}>
                                            <Text style={styles.cellDate}>{n.type || '—'} ▾</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={{ width: 130 }} disabled={readOnly}
                                            onPress={() => setRespPicker(n.uid)}>
                                            {/* Stale/inaktif sorumlular masaüstündeki gibi boş görünür */}
                                            <Text style={styles.cellDate} numberOfLines={1}>
                                                {employees.includes(n.responsible) ? n.responsible : ''} ▾
                                            </Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity style={{ width: 100 }} disabled={readOnly}
                                            onPress={() => setDuePicker(n.uid)}>
                                            <Text style={styles.cellDate}>{n.dueDate || '—'}</Text>
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        </ScrollView>
                        {!readOnly && (
                            <TouchableOpacity style={styles.addRowBtn} onPress={addNewRow}>
                                <Text style={styles.addRowText}>＋ Add Note</Text>
                            </TouchableOpacity>
                        )}
                    </ScrollView>

                    {/* Type seçimi */}
                    <StrPickerModal visible={typePicker != null} items={NOTE_TYPES}
                        selected={notes.find(n => n.uid === typePicker)?.type ?? ''}
                        onClose={() => setTypePicker(null)}
                        onPick={(t) => {
                            if (typePicker != null) setField(typePicker, { type: t });
                            setTypePicker(null);
                        }} />
                    {/* Responsible seçimi */}
                    <StrPickerModal visible={respPicker != null} items={employees}
                        selected={notes.find(n => n.uid === respPicker)?.responsible ?? ''}
                        onClose={() => setRespPicker(null)}
                        onPick={(u) => {
                            if (respPicker != null) setField(respPicker, { responsible: u });
                            setRespPicker(null);
                        }} />
                    {/* Due Date seçimi */}
                    <Modal visible={duePicker != null} transparent animationType="fade"
                        onRequestClose={() => setDuePicker(null)}>
                        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setDuePicker(null)}>
                            <View style={styles.modalBox}>
                                <CalendarPicker
                                    initial={notes.find(n => n.uid === duePicker)?.dueDate || today()}
                                    onPick={(d) => {
                                        if (duePicker != null) setField(duePicker, { dueDate: d });
                                        setDuePicker(null);
                                    }} />
                            </View>
                        </TouchableOpacity>
                    </Modal>
                </View>
            </View>
        </Modal>
    );
}

// ── Seçim modalları ──
function PickerModal({ visible, items, selectedId, onClose, onPick }: {
    visible: boolean; items: { id: number; name: string }[]; selectedId: number | null;
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
function StrPickerModal({ visible, items, selected, onClose, onPick }: {
    visible: boolean; items: string[]; selected: string;
    onClose: () => void; onPick: (s: string) => void;
}) {
    return (
        <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={onClose}>
                <View style={styles.pickerBox}>
                    <ScrollView>
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

// Renkler web Meetings.css birebir (koyu header, mavi kirli Save, kırmızı Delete)
const styles = StyleSheet.create({
    mt: { flex: 1, backgroundColor: '#f0f2f7' },
    mtContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    toolbar: {
        flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8,
        paddingHorizontal: 10, paddingVertical: 6,
    },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    lbl: { fontSize: 12, color: '#374151' },
    error: { color: '#b91c1c', paddingHorizontal: 10, marginBottom: 6 },

    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, flex: 1, minWidth: 130,
    },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },

    cbRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    cbLabel: { fontSize: 12, color: '#374151' },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, margin: 8 },
    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 4 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6', paddingVertical: 2 },
    rowSel: { backgroundColor: '#eef2ff' },
    gridNone: { fontSize: 11, fontStyle: 'italic', color: '#afb4c3', padding: 8 },
    cellInput: {
        borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 4, backgroundColor: '#fff',
        paddingHorizontal: 6, paddingVertical: 4, fontSize: 11, color: '#111827', margin: 2,
    },
    cellRO: { backgroundColor: '#f3f4f6', color: '#6b7280' },
    cellDate: { fontSize: 11, color: '#111827', paddingHorizontal: 6, paddingVertical: 8 },
    openNotes: { color: '#0073ea', fontSize: 11, fontWeight: '700', textAlign: 'center' },

    addRowBtn: { padding: 10, alignItems: 'center', borderTopWidth: 1, borderTopColor: '#eef0f6' },
    addRowText: { color: '#0073ea', fontSize: 12, fontWeight: '700' },

    btnDelete: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnSave: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnSaveDirty: { backgroundColor: '#0073ea' },
    btnImport: { backgroundColor: '#6473f0', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    mtnHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    mtnHeaderText: { fontSize: 14, fontWeight: '700', color: '#111827' },
    mtnClose: { fontSize: 16, color: '#6b7280', padding: 4 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 12 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    pickerBox: { backgroundColor: '#fff', borderRadius: 8, maxHeight: 420, width: '100%', paddingVertical: 6 },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 14, color: '#111827' },
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

export default MeetingsScreen;
