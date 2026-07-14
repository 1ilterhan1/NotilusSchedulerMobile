// Web pages/UserManagement.tsx birebir (masaüstü ucUserManagement klonu).
// Mevcut API: /api/usermanagement/* (init, user/{id}, create, update,
// set-active, relations...)
//
// 4 sekme: Current Users / Add User / Edit User / Hierarchy.
// Masaüstü quirk'leri birebir korunur:
// - Delete/Set Inactive admin kontrolü listedeki AD kolonuna bakar
//   ("Administrator" adlı kullanıcı atlanır)
// - Delete de masaüstünde isActive=false yapar
// - loadUsers sonrası Edit/Master comboları İLK elemana döner
// - Edit'te Admin/DM ise Can Assign zorla işaretli gelir
// - Edit şifresi boş gelir; boş bırakılırsa mevcut korunur
// - saveEdit sonrası oturumun canAssign'ı güncellenir (csAppConfig.UserCanAssign)
// - Hiyerarşi doğrulaması getHierarchyLevel birebir ("Relation is not valid!")
// - Tüm mesaj metinleri birebir
// Mobil uyarlama: sekmeler yatay; select → modal liste; alert → Alert.alert;
// yan yana kartlar dikey akışta.

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
import { apiGet, apiFetch } from '../api';
import { getAuth, setAuth } from '../auth';
import type {
    UmActiveUser, UmAddRelationResult, UmDiscipline, UmInit, UmRelation,
    UmUserDetail, UmUserRow,
} from '../types';

const STATUS_OPTIONS = ['Engineer', 'TeamLeader', 'DesignManager', 'Specialist', 'PME'];
const TABS = ['Current Users', 'Add User', 'Edit User', 'Hierarchy'] as const;

async function apiPost<T = unknown>(url: string, body: unknown): Promise<T | null> {
    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
}

// getHierarchyLevel birebir
function getHierarchyLevel(status: string): number {
    switch (status) {
        case 'Engineer': return 1;
        case 'TeamLeader': return 2;
        case 'Specialist': return 2;
        case 'PME': return 2;
        case 'DesignManager': return 3;
        case 'Administrator': return 4;
        default: return 1;
    }
}

function UserManagementScreen() {
    const [tab, setTab] = useState(0);

    // ── init verileri ──
    const [users, setUsers] = useState<UmUserRow[]>([]);
    const [activeEmployees, setActiveEmployees] = useState<UmActiveUser[]>([]);
    const [disciplines, setDisciplines] = useState<UmDiscipline[]>([]);

    // ── TAB 1 ──
    const [selUsers, setSelUsers] = useState<Set<number>>(new Set());

    // ── TAB 2 ──
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [customId, setCustomId] = useState('');
    const [status, setStatus] = useState('');
    const [addDiscSel, setAddDiscSel] = useState<number | ''>('');
    const [addDiscList, setAddDiscList] = useState<UmDiscipline[]>([]);
    const [addDiscListSel, setAddDiscListSel] = useState<number | null>(null);

    // ── TAB 3 ──
    const [editUserId, setEditUserId] = useState<number | null>(null);
    const [editPassword, setEditPassword] = useState('');
    const [editCustomId, setEditCustomId] = useState('');
    const [editStatus, setEditStatus] = useState('');
    const [editCanAssign, setEditCanAssign] = useState(false);
    const [editDiscSel, setEditDiscSel] = useState<number | ''>('');
    const [editDiscList, setEditDiscList] = useState<UmDiscipline[]>([]);
    const [editDiscListSel, setEditDiscListSel] = useState<number | null>(null);

    // ── TAB 4 ──
    const [masterId, setMasterId] = useState<number | null>(null);
    const [childId, setChildId] = useState<number | null>(null);
    const [childOptions, setChildOptions] = useState<UmActiveUser[]>([]);
    const [relations, setRelations] = useState<UmRelation[]>([]);
    const [selRelations, setSelRelations] = useState<Set<number>>(new Set());

    // Seçim modalları
    const [picker, setPicker] = useState<
        'none' | 'status' | 'addDisc' | 'editUser' | 'editStatus' | 'editDisc' | 'master' | 'child'>('none');

    const bootRef = useRef(false);

    // ── cbEditSelectUser_SelectedIndexChanged birebir ──
    async function loadEditUser(userId: number) {
        try {
            const d = await apiGet<UmUserDetail>(`/api/usermanagement/user/${userId}`);
            setEditPassword(d.password);
            setEditCustomId(d.customId);
            setEditStatus(d.status);
            // Admin/DM ise checkbox zorla işaretli — birebir
            setEditCanAssign(d.status === 'Administrator' || d.status === 'DesignManager' ? true : d.canAssign);
            setEditDiscList(d.disciplines);
            setEditDiscListSel(null);
        } catch { /* sessiz */ }
    }

    // ── updateMasterUserFields birebir ──
    async function refreshMaster(mid: number, actives: UmActiveUser[]) {
        try {
            const rels = await apiGet<UmRelation[]>(`/api/usermanagement/relations/${mid}`);
            setRelations(rels);
            setSelRelations(new Set());
            const childIds = rels.map(r => r.childId);
            const opts = actives.filter(u => !childIds.includes(u.id) && u.id !== mid);
            setChildOptions(opts);
            setChildId(opts[0]?.id ?? null);
        } catch { /* yoksay */ }
    }

    // ── loadUsers birebir ──
    async function loadUsers() {
        const init = await apiGet<UmInit>('/api/usermanagement/init');
        setUsers(init.users);
        setActiveEmployees(init.activeEmployees);
        setDisciplines(init.disciplines);
        setSelUsers(new Set());

        // WinForms DataSource bağlanınca comboların İLK elemanı seçilir — birebir
        setAddDiscSel(init.disciplines[0]?.id ?? '');
        setEditDiscSel(init.disciplines[0]?.id ?? '');

        const firstEdit = init.users[0]?.id ?? null;
        setEditUserId(firstEdit);
        if (firstEdit != null) await loadEditUser(firstEdit);

        const firstMaster = init.activeEmployees[0]?.id ?? null;
        setMasterId(firstMaster);
        if (firstMaster != null) await refreshMaster(firstMaster, init.activeEmployees);
    }

    useEffect(() => {
        if (bootRef.current) return;
        bootRef.current = true;
        loadUsers().catch(() => { /* yoksay */ });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ═══ TAB 1: Current Users ═══
    function toggleUser(id: number) {
        setSelUsers(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    // btnSetActiveUsers_Click birebir (admin kontrolü YOK)
    async function setActiveUsers() {
        if (selUsers.size === 0) { Alert.alert('', 'Please select user(s)!'); return; }
        await apiPost('/api/usermanagement/set-active', { ids: [...selUsers], active: true });
        await loadUsers();
    }

    // btnSetInactiveUsers_Click birebir
    async function setInactiveUsers() {
        if (selUsers.size === 0) { Alert.alert('', 'Please select user(s)!'); return; }
        const recIds: number[] = [];
        let hasAdmin = false;
        for (const id of selUsers) {
            const u = users.find(x => x.id === id);
            if (!u) continue;
            if (u.name.toLowerCase() === 'administrator') { hasAdmin = true; continue; }
            recIds.push(id);
        }
        if (hasAdmin) Alert.alert('', 'Admin users cannot be deactivated!');
        if (recIds.length === 0) return;
        await apiPost('/api/usermanagement/set-active', { ids: recIds, active: false });
        await loadUsers();
    }

    // btnDeleteSelectedUsers_Click birebir — masaüstünde de isActive=false yapar
    async function deleteUsers() {
        if (selUsers.size === 0) { Alert.alert('', 'Please select user(s)!'); return; }
        const recIds: number[] = [];
        let hasAdmin = false;
        for (const id of selUsers) {
            const u = users.find(x => x.id === id);
            if (!u) continue;
            if (u.name.toLowerCase() === 'administrator') { hasAdmin = true; continue; }
            recIds.push(id);
        }
        if (hasAdmin) Alert.alert('', 'Admin users cannot be deleted!');
        if (recIds.length === 0) return;
        await apiPost('/api/usermanagement/set-active', { ids: recIds, active: false });
        await loadUsers();
    }

    // ═══ TAB 2: Add User ═══
    function addDiscipline() {
        if (addDiscSel === '') return;
        if (addDiscList.some(d => d.id === addDiscSel)) {
            Alert.alert('', 'Selected discipline is already added for the user!');
            return;
        }
        const d = disciplines.find(x => x.id === addDiscSel);
        if (d) setAddDiscList(prev => [...prev, d]);
    }
    function removeDiscipline() {
        if (addDiscListSel != null) {
            setAddDiscList(prev => prev.filter(d => d.id !== addDiscListSel));
            setAddDiscListSel(null);
        } else Alert.alert('', 'Nothing Selected');
    }
    async function createUser() {
        if (!name.trim()) { Alert.alert('', 'Please enter a name for new user!'); return; }
        if (!password.trim()) { Alert.alert('', 'Please enter a password for new user!'); return; }
        if (!status.trim()) { Alert.alert('', 'Please select a status for new user!'); return; }

        await apiPost('/api/usermanagement/create', {
            name, password, status,
            customId, disciplineIds: addDiscList.map(d => d.id),
        });
        await loadUsers();
        // cleanNewUserFields birebir
        setName(''); setPassword(''); setCustomId(''); setStatus('');
        setAddDiscList([]); setAddDiscListSel(null);
        Alert.alert('', 'User created successfully');
    }

    // ═══ TAB 3: Edit User ═══
    function onSelectEditUser(id: number) {
        setEditUserId(id);
        loadEditUser(id);
    }
    function editAddDiscipline() {
        if (editDiscSel === '') return;
        if (editDiscList.some(d => d.id === editDiscSel)) {
            Alert.alert('', 'Selected discipline is already in the list!');
            return;
        }
        const d = disciplines.find(x => x.id === editDiscSel);
        if (d) setEditDiscList(prev => [...prev, d]);
    }
    function editRemoveDiscipline() {
        if (editDiscListSel != null) {
            setEditDiscList(prev => prev.filter(d => d.id !== editDiscListSel));
            setEditDiscListSel(null);
        } else Alert.alert('', 'Nothing Selected');
    }
    async function saveEdit() {
        if (editUserId == null) return;
        // btnEditUserSaveChanges_Click birebir
        const selUser = users.find(u => u.id === editUserId);
        if (selUser && selUser.name.toLowerCase() === 'administrator') {
            Alert.alert('', "The 'Administrator' account cannot be edited!");
            return;
        }

        await apiPost('/api/usermanagement/update', {
            id: editUserId,
            password: editPassword,
            customId: editCustomId,
            status: editStatus,
            canAssign: editCanAssign,
            disciplineIds: editDiscList.map(d => d.id),
        });

        // csAppConfig.UserCanAssign birebir — oturum bilgisi güncellenir
        const auth = await getAuth();
        if (auth) await setAuth({ ...auth, user: { ...auth.user, canAssign: editCanAssign } });

        await loadUsers();
        Alert.alert('', 'User updated successfully!');
    }

    // ═══ TAB 4: Hierarchy ═══
    function onSelectMaster(id: number) {
        setMasterId(id);
        refreshMaster(id, activeEmployees);
    }
    function toggleRelation(id: number) {
        setSelRelations(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }
    // btnAddRelation_Click + hierarchyIsValid birebir
    async function addRelation() {
        if (masterId == null) { Alert.alert('', 'Please select a master!'); return; }
        if (childId == null) { Alert.alert('', 'Please select a child!'); return; }
        if (masterId === childId) { Alert.alert('', 'Please select different master!'); return; }

        const masterStatus = activeEmployees.find(u => u.id === masterId)?.status ?? '';
        const childStatus = activeEmployees.find(u => u.id === childId)?.status ?? '';
        if (!(getHierarchyLevel(masterStatus) > getHierarchyLevel(childStatus))) {
            Alert.alert('', 'Relation is not valid!');
            return;
        }

        const result = await apiPost<UmAddRelationResult>('/api/usermanagement/relations',
            { masterId, childId });
        await refreshMaster(masterId, activeEmployees);
        if (result?.alreadyExist) Alert.alert('', 'Selected hierarchy is already created!');
    }
    // btnDeleteSelectedRelations_Click birebir
    async function deleteRelations() {
        if (selRelations.size === 0) { Alert.alert('', 'Please select child(s) to delete!'); return; }
        await apiPost('/api/usermanagement/relations/delete', { hierarchyIds: [...selRelations] });
        if (masterId != null) await refreshMaster(masterId, activeEmployees);
    }

    const masterName = activeEmployees.find(u => u.id === masterId)?.name;
    const discName = (id: number | '') => disciplines.find(d => d.id === id)?.name ?? '—';

    return (
        <ScrollView style={styles.um} contentContainerStyle={styles.umContent}>
            {/* Header (pnlHeader — sabit koyu) */}
            <View style={styles.header}><Text style={styles.headerText}>User Management</Text></View>

            {/* TabControl */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsWrap}>
                <View style={styles.tabs}>
                    {TABS.map((t, i) => (
                        <TouchableOpacity key={t} style={[styles.tab, tab === i && styles.tabActive]}
                            onPress={() => setTab(i)}>
                            <Text style={[styles.tabText, tab === i && styles.tabTextActive]}>{t}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            {/* ═══ TAB 1: CURRENT USERS ═══ */}
            {tab === 0 && (
                <View style={styles.card}>
                    <View style={styles.toolbarRow}>
                        <Text style={styles.cardTitle}>Active Users</Text>
                    </View>
                    <View style={styles.btnRow}>
                        <TouchableOpacity style={styles.btnGreen} onPress={setActiveUsers}>
                            <Text style={styles.btnText}>Set Active</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnAmber} onPress={setInactiveUsers}>
                            <Text style={styles.btnText}>Set Inactive</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.btnRed} onPress={deleteUsers}>
                            <Text style={styles.btnText}>Delete Selected</Text>
                        </TouchableOpacity>
                    </View>
                    <ScrollView horizontal showsHorizontalScrollIndicator>
                        <View>
                            <View style={styles.gridHeadRow}>
                                <Text style={[styles.gridHeadCell, { width: 160 }]}>Name</Text>
                                <Text style={[styles.gridHeadCell, { width: 110 }]}>Status</Text>
                                <Text style={[styles.gridHeadCell, { width: 80 }]}>Can Assign</Text>
                                <Text style={[styles.gridHeadCell, { width: 64 }]}>Is Active</Text>
                                <Text style={[styles.gridHeadCell, { width: 90 }]}>Custom ID</Text>
                            </View>
                            {users.map(u => (
                                <TouchableOpacity key={u.id}
                                    style={[styles.gridRow, selUsers.has(u.id) && styles.rowSel]}
                                    onPress={() => toggleUser(u.id)}>
                                    <Text style={[styles.gridCell, { width: 160 }]} numberOfLines={1}>{u.name}</Text>
                                    <Text style={[styles.gridCell, { width: 110 }]} numberOfLines={1}>{u.status}</Text>
                                    {/* CanAssign.ToString() birebir → True/False */}
                                    <Text style={[styles.gridCell, { width: 80 }]}>{u.canAssign ? 'True' : 'False'}</Text>
                                    <Text style={[styles.gridCell, { width: 64 }]}>{u.isActive ? 'Yes' : 'No'}</Text>
                                    <Text style={[styles.gridCell, { width: 90 }]} numberOfLines={1}>{u.customId}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </ScrollView>
                </View>
            )}

            {/* ═══ TAB 2: ADD USER ═══ */}
            {tab === 1 && (
                <>
                    <View style={styles.card}>
                        <Text style={styles.cardHeader}>Create New User</Text>
                        <View style={styles.formBody}>
                            <Text style={styles.flabel}>Name</Text>
                            <TextInput style={styles.input} value={name} onChangeText={setName} autoCapitalize="none" />
                            <Text style={styles.flabel}>Password</Text>
                            <TextInput style={styles.input} value={password} onChangeText={setPassword} autoCapitalize="none" />
                            <Text style={styles.flabel}>Custom ID</Text>
                            <TextInput style={styles.input} value={customId} onChangeText={setCustomId} autoCapitalize="none" />
                            <Text style={styles.flabel}>Status</Text>
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('status')}>
                                <Text style={styles.selectText}>{status || '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btnPrimaryGreen, { marginTop: 12 }]} onPress={createUser}>
                                <Text style={styles.btnText}>Create User</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.card}>
                        <Text style={styles.cardHeader}>Assigned Disciplines</Text>
                        <View style={styles.formBody}>
                            <View style={styles.discPicker}>
                                <TouchableOpacity style={[styles.select, { flex: 1 }]} onPress={() => setPicker('addDisc')}>
                                    <Text style={styles.selectText}>{discName(addDiscSel)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.btnBlue} onPress={addDiscipline}>
                                    <Text style={styles.btnText}>Add</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.discList}>
                                <Text style={styles.gridHeadCell}>Added Disciplines</Text>
                                {addDiscList.map(d => (
                                    <TouchableOpacity key={d.id}
                                        style={[styles.gridRow, addDiscListSel === d.id && styles.rowSel]}
                                        onPress={() => setAddDiscListSel(addDiscListSel === d.id ? null : d.id)}>
                                        <Text style={styles.gridCell}>{d.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <TouchableOpacity style={[styles.btnRed, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={removeDiscipline}>
                                <Text style={styles.btnText}>Remove Selected</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </>
            )}

            {/* ═══ TAB 3: EDIT USER ═══ */}
            {tab === 2 && (
                <>
                    <View style={styles.card}>
                        <Text style={styles.cardHeader}>Edit Existing User</Text>
                        <View style={styles.formBody}>
                            <Text style={styles.flabel}>Select User</Text>
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('editUser')}>
                                <Text style={styles.selectText}>{users.find(u => u.id === editUserId)?.name ?? '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                            <Text style={styles.flabel}>Password</Text>
                            <TextInput style={styles.input} value={editPassword} onChangeText={setEditPassword}
                                autoCapitalize="none" placeholder="Leave blank to keep current password"
                                placeholderTextColor="#9ca3af" />
                            <Text style={styles.flabel}>Custom ID</Text>
                            <TextInput style={styles.input} value={editCustomId} onChangeText={setEditCustomId} autoCapitalize="none" />
                            <Text style={styles.flabel}>Status</Text>
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('editStatus')}>
                                <Text style={styles.selectText}>{editStatus || '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.cbRow} onPress={() => setEditCanAssign(!editCanAssign)}>
                                <View style={[styles.cbBox, editCanAssign && styles.cbBoxOn]}>
                                    {editCanAssign && <Text style={styles.cbTick}>✓</Text>}
                                </View>
                                <Text style={styles.cbLabel}>Can Assign</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btnPrimaryGreen, { marginTop: 12 }]} onPress={saveEdit}>
                                <Text style={styles.btnText}>Save Changes</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.card}>
                        <Text style={styles.cardHeader}>Assigned Disciplines</Text>
                        <View style={styles.formBody}>
                            <View style={styles.discPicker}>
                                <TouchableOpacity style={[styles.select, { flex: 1 }]} onPress={() => setPicker('editDisc')}>
                                    <Text style={styles.selectText}>{discName(editDiscSel)}</Text>
                                    <Text style={styles.selectCaret}>▾</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={styles.btnBlue} onPress={editAddDiscipline}>
                                    <Text style={styles.btnText}>Add</Text>
                                </TouchableOpacity>
                            </View>
                            <View style={styles.discList}>
                                <Text style={styles.gridHeadCell}>Added Disciplines</Text>
                                {editDiscList.map(d => (
                                    <TouchableOpacity key={d.id}
                                        style={[styles.gridRow, editDiscListSel === d.id && styles.rowSel]}
                                        onPress={() => setEditDiscListSel(editDiscListSel === d.id ? null : d.id)}>
                                        <Text style={styles.gridCell}>{d.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </View>
                            <TouchableOpacity style={[styles.btnRed, { marginTop: 10, alignSelf: 'flex-start' }]} onPress={editRemoveDiscipline}>
                                <Text style={styles.btnText}>Remove Selected</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </>
            )}

            {/* ═══ TAB 4: HIERARCHY ═══ */}
            {tab === 3 && (
                <>
                    <View style={styles.card}>
                        <Text style={styles.cardHeader}>Create New Relation</Text>
                        <View style={styles.formBody}>
                            <Text style={styles.flabel}>Master</Text>
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('master')}>
                                <Text style={styles.selectText}>{masterName ?? '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                            <Text style={styles.flabel}>Child</Text>
                            <TouchableOpacity style={styles.select} onPress={() => setPicker('child')}>
                                <Text style={styles.selectText}>{childOptions.find(u => u.id === childId)?.name ?? '—'}</Text>
                                <Text style={styles.selectCaret}>▾</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btnPrimaryBlue, { marginTop: 12 }]} onPress={addRelation}>
                                <Text style={styles.btnText}>Add Relation</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <View style={styles.card}>
                        <View style={styles.toolbarRow}>
                            <Text style={styles.cardTitle}>
                                {masterName ? `Users Under ${masterName}` : 'Users Under Administration'}
                            </Text>
                        </View>
                        <View style={styles.btnRow}>
                            <TouchableOpacity style={styles.btnRed} onPress={deleteRelations}>
                                <Text style={styles.btnText}>Delete Selected</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.gridHeadRow}>
                            <Text style={[styles.gridHeadCell, { flex: 1.6 }]}>Name</Text>
                            <Text style={[styles.gridHeadCell, { flex: 1 }]}>Status</Text>
                        </View>
                        {relations.map(r => (
                            <TouchableOpacity key={r.hierarchyId}
                                style={[styles.gridRow, selRelations.has(r.hierarchyId) && styles.rowSel]}
                                onPress={() => toggleRelation(r.hierarchyId)}>
                                <Text style={[styles.gridCell, { flex: 1.6 }]} numberOfLines={1}>{r.childName}</Text>
                                <Text style={[styles.gridCell, { flex: 1 }]} numberOfLines={1}>{r.childStatus}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </>
            )}

            {/* ═══ Seçim modalları ═══ */}
            {/* Status (Add) */}
            <StrPickerModal visible={picker === 'status'} items={STATUS_OPTIONS} selected={status}
                onClose={() => setPicker('none')}
                onPick={(s) => { setStatus(s); setPicker('none'); }} />
            {/* Status (Edit) */}
            <StrPickerModal visible={picker === 'editStatus'} items={STATUS_OPTIONS} selected={editStatus}
                onClose={() => setPicker('none')}
                onPick={(s) => { setEditStatus(s); setPicker('none'); }} />
            {/* Disiplinler */}
            <IdPickerModal visible={picker === 'addDisc' || picker === 'editDisc'}
                items={disciplines}
                selectedId={picker === 'addDisc' ? (addDiscSel === '' ? null : addDiscSel) : (editDiscSel === '' ? null : editDiscSel)}
                onClose={() => setPicker('none')}
                onPick={(id) => {
                    if (picker === 'addDisc') setAddDiscSel(id); else setEditDiscSel(id);
                    setPicker('none');
                }} />
            {/* Edit user */}
            <IdPickerModal visible={picker === 'editUser'} items={users} selectedId={editUserId}
                onClose={() => setPicker('none')}
                onPick={(id) => { setPicker('none'); onSelectEditUser(id); }} />
            {/* Master / Child */}
            <IdPickerModal visible={picker === 'master'} items={activeEmployees} selectedId={masterId}
                onClose={() => setPicker('none')}
                onPick={(id) => { setPicker('none'); onSelectMaster(id); }} />
            <IdPickerModal visible={picker === 'child'} items={childOptions} selectedId={childId}
                onClose={() => setPicker('none')}
                onPick={(id) => { setChildId(id); setPicker('none'); }} />
        </ScrollView>
    );
}

// ── Seçim modalları ──
function IdPickerModal({ visible, items, selectedId, onClose, onPick }: {
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
                    {items.map((s) => (
                        <TouchableOpacity key={s}
                            style={[styles.pickerItem, s === selected && styles.pickerItemSel]}
                            onPress={() => onPick(s)}>
                            <Text style={[styles.pickerItemText, s === selected && styles.pickerItemTextSel]}>{s}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </TouchableOpacity>
        </Modal>
    );
}

// Renkler web UserManagement.css birebir (koyu header, yeşil/amber/kırmızı/mavi butonlar)
const styles = StyleSheet.create({
    um: { flex: 1, backgroundColor: '#f0f2f7' },
    umContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },

    tabsWrap: { flexGrow: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    tabs: { flexDirection: 'row' },
    tab: { paddingHorizontal: 16, paddingVertical: 10 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: '#2563eb' },
    tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
    tabTextActive: { color: '#2563eb' },

    card: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d7dce8', borderRadius: 2, margin: 8 },
    cardHeader: {
        fontSize: 12, fontWeight: '700', color: '#1f3a6e',
        paddingHorizontal: 10, paddingVertical: 8,
        borderBottomWidth: 1, borderBottomColor: '#e4e7f0',
    },
    cardTitle: { fontSize: 13, fontWeight: '700', color: '#2d3748' },
    toolbarRow: { paddingHorizontal: 10, paddingTop: 8 },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 10, paddingVertical: 8 },
    formBody: { padding: 10 },

    flabel: { fontSize: 12, color: '#374151', marginTop: 8, marginBottom: 4 },
    input: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 8, paddingVertical: 7, fontSize: 13, color: '#111827',
    },
    select: {
        flexDirection: 'row', alignItems: 'center',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 8,
    },
    selectText: { fontSize: 13, color: '#111827', flex: 1 },
    selectCaret: { fontSize: 12, color: '#6b7280', marginLeft: 6 },

    btnGreen: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
    btnAmber: { backgroundColor: '#f59e0b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
    btnRed: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 7 },
    btnBlue: { backgroundColor: '#0073ea', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 8 },
    btnPrimaryGreen: { backgroundColor: '#037f4c', borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
    btnPrimaryBlue: { backgroundColor: '#0073ea', borderRadius: 6, paddingVertical: 10, alignItems: 'center' },
    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    cbRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    cbLabel: { fontSize: 12, color: '#374151' },

    discPicker: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    discList: { borderWidth: 1, borderColor: '#e4e7f0', borderRadius: 6, marginTop: 8 },

    gridHeadRow: { flexDirection: 'row', backgroundColor: '#f8f9fc', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    gridHeadCell: { fontSize: 11, fontWeight: '700', color: '#1f3a6e', paddingVertical: 6, paddingHorizontal: 6 },
    gridRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eef0f6' },
    rowSel: { backgroundColor: '#eef2ff' },
    gridCell: { fontSize: 11, color: '#374151', paddingVertical: 8, paddingHorizontal: 6 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    pickerBox: { backgroundColor: '#fff', borderRadius: 8, maxHeight: 420, width: '100%', paddingVertical: 6 },
    pickerItem: { paddingVertical: 11, paddingHorizontal: 16 },
    pickerItemSel: { backgroundColor: '#eef2ff' },
    pickerItemText: { fontSize: 14, color: '#111827' },
    pickerItemTextSel: { color: '#2563eb', fontWeight: '700' },
});

export default UserManagementScreen;
