// Web pages/Settings.tsx birebir (masaüstü ucSettings klonu).
// Mevcut API: /api/settings/* (GET config, PUT bool, PUT workhours,
// POST/DELETE specialdays, POST specialdays/turkish-holidays, POST logo,
// POST backup). YENİ API YAZILMAZ.
//
// Birebir korunanlar (ucSettings / SettingsController):
// - checkBox_CheckedChanged → toggleBool: her kutu değişiminde anında DB'ye
//   yazılır; hata olursa geri alınır ("Setting could not be saved.")
// - rbtnWorkListAccordingToAssignment/Works → setWorkList (tek WorkListAccToAssign)
// - theme_CheckedChanged → setThemeMode (src/theme.ts): KULLANICIYA ÖZEL (masaüstü
//   Properties.Settings / web localStorage 'ApplicationTheme'). Redundant yazma
//   atlanır; değişim AppTheme.ThemeChanged gibi tüm kabuğu (üst bar + drawer +
//   içerik zemini) CANLI boyar (useThemeDark/useThemeColors).
// - unit_CheckedChanged → setUnit: "Duration unit updated..." mesajı birebir
// - btnSaveWorkHours_Click → saveWorkHours: 1–24 doğrulaması + başarı mesajı birebir
// - cboxRefreshTime / nudDataRefresh → yerel kullanıcı ayarı (AsyncStorage, aynı
//   key'ler: DataRefreshTime / DataTimeForRefresh)
// - btnAddSpecialDay_Click (upsert + formu sıfırla) / btnRemoveSpecialDay_Click
//   ("Select a day in the list to remove.") / btnAddTurkishHolidays_Click (mesaj birebir)
// - btnUploadLogo_Click → logo yükleme (FormData; başarı mesajı birebir)
// - btnBackupNow_Click → XML üretimi (masaüstü Documents'a yazar; mobilde dosya
//   paylaşım sayfası açılır); LastBackupDate/Path yerel saklanır
//
// Mobil uyarlama (mevcut ekranlarla tutarlı):
// - Tek kolon dikey akış; select → PickerModal; tarih → takvim modalı
//   (FlatDatePicker karşılığı, işaretli günler kırmızı); alert → Alert.alert
// - localStorage → AsyncStorage; dosya seçimi → expo-document-picker;
//   dosya yazma/paylaşım → expo-file-system/legacy + expo-sharing

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
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { apiFetch, apiGet } from '../api';
import { useThemeDark, setThemeMode } from '../theme';

interface SpecialDay { date: string; name: string | null; isHalfDay: boolean }

interface SettingsDto {
    departmentIsVisibleForAssignments: boolean;
    priorityIsVisibleForAssignments: boolean;
    allWorkAffordsVisibleForDesignManager: boolean;
    disciplineIsVisibleForWorkEntry: boolean;
    folderIsVisibleForProjects: boolean;
    showDrawingNumberInWorklist: boolean;
    resourceIsVisible: boolean;
    checkStartedJobForWorks: boolean;
    revisionIsVisibleForWorkEntry: boolean;
    activationIdIsVisibleForProjectManagement: boolean;
    workListAccToAssign: boolean;
    showDurationInHours: boolean;
    companyDayWorkHour: number;
    specialDays: SpecialDay[];
}

// Properties.Settings karşılığı (kullanıcıya özel yerel ayarlar) — web LS key'leri birebir
const LS_REFRESH_ACTIVE = 'DataRefreshTime';
const LS_REFRESH_VALUE = 'DataTimeForRefresh';
const LS_BACKUP_DATE = 'LastBackupDate';
const LS_BACKUP_PATH = 'LastBackupPath';
// Tema kullanıcıya özel: tek kaynak src/theme.ts (setThemeMode/useThemeDark).
// theme_CheckedChanged + AppTheme.SetMode karşılığı orada; burada yalnız tüketilir.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOWS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DOWS_S = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function pad2(n: number) { return n < 10 ? '0' + n : String(n); }
function toIso(d: Date) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fromIso(s: string) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
/** "dd MMM yyyy" (masaüstü liste satırı 1. satır formatı) */
function fmtDate(d: Date) { return `${pad2(d.getDate())} ${MONTHS_S[d.getMonth()]} ${d.getFullYear()}`; }
/** "dddd" — haftanın günü tam adı */
function fmtDow(d: Date) { return DOWS[(d.getDay() + 6) % 7]; }
/** 0.## — lblUnitHoursDesc'teki work-hour biçimi */
function fmtHours(v: number) { return String(Math.round(v * 100) / 100); }

// ── FlatDatePicker birebir: takvim popup'ı, işaretli günler kırmızı (AlertDates) ──
function FlatDatePicker({ value, onChange, alertDates }: {
    value: string; onChange: (iso: string) => void; alertDates: Set<string>;
}) {
    const [open, setOpen] = useState(false);
    return (
        <View style={{ flex: 1 }}>
            <TouchableOpacity style={styles.fdpBtn} onPress={() => setOpen(true)}>
                <Text style={styles.fdpBtnText}>{fmtDate(fromIso(value))}</Text>
                <Text style={styles.fdpIco}>▾</Text>
            </TouchableOpacity>
            <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
                <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setOpen(false)}>
                    <View style={styles.modalBox}>
                        <CalendarPicker
                            initial={value}
                            alertDates={alertDates}
                            onPick={(iso) => { onChange(iso); setOpen(false); }} />
                    </View>
                </TouchableOpacity>
            </Modal>
        </View>
    );
}

// ── Ay takvimi tarih seçici (MeetingsScreen deseni + AlertDates kırmızı çerçeve) ──
function CalendarPicker({ initial, onPick, alertDates }: {
    initial: string; onPick: (isoDate: string) => void; alertDates?: Set<string>;
}) {
    const init = new Date(initial + 'T00:00:00');
    const [month, setMonth] = useState<Date>(() =>
        isNaN(init.getTime()) ? new Date() : new Date(init.getFullYear(), init.getMonth(), 1));

    const y = month.getFullYear(), m = month.getMonth();
    const startDow = (new Date(y, m, 1).getDay() + 6) % 7;
    const days = new Date(y, m + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startDow; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(y, m, d));
    const isoOf = (d: Date) => toIso(d);
    const todayIso = toIso(new Date());

    return (
        <View>
            <View style={styles.calHead}>
                <TouchableOpacity style={styles.calNav} onPress={() => setMonth(new Date(y, m - 1, 1))}>
                    <Text style={styles.calNavText}>‹</Text>
                </TouchableOpacity>
                <Text style={styles.calTitle}>{MONTHS[m]} {y}</Text>
                <TouchableOpacity style={styles.calNav} onPress={() => setMonth(new Date(y, m + 1, 1))}>
                    <Text style={styles.calNavText}>›</Text>
                </TouchableOpacity>
            </View>
            <View style={styles.calGrid}>
                {DOWS_S.map((d) => (
                    <View key={d} style={styles.calCell}><Text style={styles.calDow}>{d}</Text></View>
                ))}
                {cells.map((d, i) => {
                    if (!d) return <View key={i} style={styles.calCell} />;
                    const iso = isoOf(d);
                    const isSel = iso === initial;
                    const isAlert = alertDates?.has(iso) ?? false;
                    const isToday = iso === todayIso;
                    return (
                        <View key={i} style={styles.calCell}>
                            <TouchableOpacity
                                style={[styles.calDay, isAlert && styles.calDayAlert, isToday && styles.calDayToday, isSel && styles.calDaySel]}
                                onPress={() => onPick(iso)}>
                                <Text style={[styles.calDayText, isSel && styles.calDaySelText]}>{d.getDate()}</Text>
                            </TouchableOpacity>
                        </View>
                    );
                })}
            </View>
        </View>
    );
}

// ── Yerleşik checkbox satırı ──
function CheckRow({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
    return (
        <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
            <View style={[styles.cbBox, checked && styles.cbBoxOn]}>
                {checked && <Text style={styles.cbTick}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{label}</Text>
        </TouchableOpacity>
    );
}

// ── Yerleşik radio satırı (+ açıklama) ──
function RadioRow({ checked, label, desc, onSelect }: {
    checked: boolean; label: string; desc: string; onSelect: () => void;
}) {
    return (
        <>
            <TouchableOpacity style={styles.radioRow} onPress={onSelect} activeOpacity={0.7}>
                <View style={[styles.radioOuter, checked && styles.radioOuterOn]}>
                    {checked && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.radioLabel}>{label}</Text>
            </TouchableOpacity>
            <Text style={styles.radioDesc}>{desc}</Text>
        </>
    );
}

function SettingsScreen() {
    const [s, setS] = useState<SettingsDto | null>(null);
    const [loadError, setLoadError] = useState(false);

    // ── Data Refresh (Properties.Settings karşılığı AsyncStorage) ──
    const [refreshActive, setRefreshActive] = useState(false);
    const [refreshValue, setRefreshValue] = useState('0');

    // ── Tema (kullanıcıya özel; masaüstü rbtnThemeDark/Light karşılığı) ──
    // Tek kaynak: src/theme.ts. Radyolar setThemeMode ile yazar; değişim tüm
    // kabuğu canlı boyar (AppTheme.ThemeChanged karşılığı).
    const themeDark = useThemeDark();

    // ── Backup bilgisi ──
    const [backupDate, setBackupDate] = useState('-');
    const [backupPath, setBackupPath] = useState('-');
    const [backingUp, setBackingUp] = useState(false);

    // ── Special days form ──
    const [sdDate, setSdDate] = useState(() => toIso(new Date()));  // dtpSpecialDay.Value = Today
    const [sdName, setSdName] = useState('');
    const [sdHalf, setSdHalf] = useState(false);
    const [sdSelected, setSdSelected] = useState<string | null>(null);

    // ── Work hours ──
    const [workHours, setWorkHours] = useState('9');

    const uploadingLogo = useRef(false);

    // ucSettings_Load birebir
    useEffect(() => {
        (async () => {
            try {
                const dto = await apiGet<SettingsDto>('/api/settings');
                setS(dto);
                // nudWorkHours.Value = clamp(companyDayWorkHour, 1, 24)
                let wh = dto.companyDayWorkHour;
                if (wh < 1) wh = 1;
                if (wh > 24) wh = 24;
                setWorkHours(fmtHours(wh));
            } catch (e) {
                console.error('[Settings] load failed', e);
                setLoadError(true);
                Alert.alert('', 'Settings could not be loaded.');
            }
        })();
        // Yerel kullanıcı ayarlarını AsyncStorage'dan yükle (web'de sync localStorage)
        (async () => {
            const active = (await AsyncStorage.getItem(LS_REFRESH_ACTIVE)) === 'true';
            setRefreshActive(active);
            // masaüstü: cboxRefreshTime unchecked ise nud değeri 0 ve pasif
            if (!active) { setRefreshValue('0'); }
            else {
                const v = parseInt((await AsyncStorage.getItem(LS_REFRESH_VALUE)) ?? '0', 10);
                setRefreshValue(String(isNaN(v) ? 0 : v));
            }
            setBackupDate((await AsyncStorage.getItem(LS_BACKUP_DATE)) ?? '-');
            setBackupPath((await AsyncStorage.getItem(LS_BACKUP_PATH)) ?? '-');
        })();
    }, []);

    // ── checkBox_CheckedChanged birebir: her kutu anında DB'ye yazılır ──
    async function toggleBool(name: keyof SettingsDto & string, settingName: string, checked: boolean) {
        if (!s) return;
        setS({ ...s, [name]: checked });
        try {
            const res = await apiFetch('/api/settings/bool', {
                method: 'PUT',
                body: JSON.stringify({ name: settingName, value: checked }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch {
            setS(prev => prev ? { ...prev, [name]: !checked } : prev); // geri al
            Alert.alert('', 'Setting could not be saved.');
        }
    }

    // ── Work List radio'ları: assignment=true / works=false (tek ayar) ──
    async function setWorkList(accToAssign: boolean) {
        if (!s || s.workListAccToAssign === accToAssign) return;
        setS({ ...s, workListAccToAssign: accToAssign });
        try {
            const res = await apiFetch('/api/settings/bool', {
                method: 'PUT',
                body: JSON.stringify({ name: 'WorkListAccToAssign', value: accToAssign }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch {
            setS(prev => prev ? { ...prev, workListAccToAssign: !accToAssign } : prev);
            Alert.alert('', 'Setting could not be saved.');
        }
    }

    // ── unit_CheckedChanged birebir ──
    async function setUnit(showHours: boolean) {
        if (!s || s.showDurationInHours === showHours) return;  // redundant DB write yok
        setS({ ...s, showDurationInHours: showHours });
        try {
            const res = await apiFetch('/api/settings/bool', {
                method: 'PUT',
                body: JSON.stringify({ name: 'ShowDurationInHours', value: showHours }),
            });
            if (!res.ok) throw new Error(String(res.status));
            Alert.alert('', 'Duration unit updated. Open or reopen a report to see Budget and Actual in ' +
                (showHours ? 'hours.' : 'days.'));
        } catch {
            setS(prev => prev ? { ...prev, showDurationInHours: !showHours } : prev);
            Alert.alert('', 'Setting could not be saved.');
        }
    }

    // ── btnSaveWorkHours_Click birebir ──
    async function saveWorkHours() {
        if (!s) return;
        const newWorkHour = parseFloat(workHours);
        if (isNaN(newWorkHour) || newWorkHour < 1 || newWorkHour > 24) {
            Alert.alert('', 'Work hours must be between 1 and 24.');
            return;
        }
        if (s.companyDayWorkHour === newWorkHour) return;   // redundant DB write yok
        try {
            const res = await apiFetch('/api/settings/workhours', {
                method: 'PUT',
                body: JSON.stringify({ value: newWorkHour }),
            });
            if (!res.ok) throw new Error(String(res.status));
            setS({ ...s, companyDayWorkHour: newWorkHour });
            Alert.alert('', 'Work hours per day updated to ' + fmtHours(newWorkHour) +
                '. Reopen a report to apply the new conversion.');
        } catch {
            Alert.alert('', 'Setting could not be saved.');
        }
    }

    // ── cboxRefreshTime / nudDataRefresh birebir (yerel kullanıcı ayarı) ──
    async function toggleRefresh(checked: boolean) {
        setRefreshActive(checked);
        await AsyncStorage.setItem(LS_REFRESH_ACTIVE, String(checked));
        if (!checked) {
            setRefreshValue('0');
            await AsyncStorage.setItem(LS_REFRESH_VALUE, '0');
        }
    }
    async function changeRefreshValue(v: string) {
        let n = parseInt(v, 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > 99999) n = 99999;   // nudDataRefresh.Maximum = 99999
        setRefreshValue(String(n));
        await AsyncStorage.setItem(LS_REFRESH_VALUE, String(n));
    }

    // ── btnAddSpecialDay_Click birebir (upsert + formu sıfırla) ──
    async function addSpecialDay() {
        if (!s) return;
        try {
            const res = await apiFetch('/api/settings/specialdays', {
                method: 'POST',
                body: JSON.stringify({ date: sdDate, name: sdName.trim() || null, isHalfDay: sdHalf }),
            });
            if (!res.ok) throw new Error(String(res.status));
            const days = await res.json() as SpecialDay[];
            setS({ ...s, specialDays: days });
            // Reset the input row for the next entry
            setSdName('');
            setSdHalf(false);
        } catch {
            Alert.alert('', 'Special day could not be saved.');
        }
    }

    // ── btnRemoveSpecialDay_Click birebir ──
    async function removeSpecialDay() {
        if (!s) return;
        if (!sdSelected) {
            Alert.alert('', 'Select a day in the list to remove.');
            return;
        }
        try {
            const res = await apiFetch('/api/settings/specialdays/' + sdSelected, { method: 'DELETE' });
            if (!res.ok) throw new Error(String(res.status));
            const days = await res.json() as SpecialDay[];
            setS({ ...s, specialDays: days });
            setSdSelected(null);
        } catch {
            Alert.alert('', 'Special day could not be removed.');
        }
    }

    // ── btnAddTurkishHolidays_Click birebir (seçili tarihin yılı) ──
    async function addTurkishHolidays() {
        if (!s) return;
        const year = fromIso(sdDate).getFullYear();
        try {
            const res = await apiFetch('/api/settings/specialdays/turkish-holidays?year=' + year, { method: 'POST' });
            if (!res.ok) throw new Error(String(res.status));
            const body = await res.json() as { added: number; days: SpecialDay[] };
            setS({ ...s, specialDays: body.days });
            Alert.alert('', body.added + ' Turkish official holiday(s) added for ' + year + '.\n' +
                'Includes Ramazan and Kurban Bayramı (computed from the lunar calendar). ' +
                'Religious-holiday dates may differ by a day from the official calendar ' +
                'in some years, so please double-check them.');
        } catch {
            Alert.alert('', 'Turkish holidays could not be added.');
        }
    }

    // ── btnUploadLogo_Click birebir (mobil: document-picker → FormData) ──
    async function uploadLogo() {
        if (uploadingLogo.current) return;
        try {
            const pick = await DocumentPicker.getDocumentAsync({
                type: ['image/jpeg', 'image/png', 'image/bmp'],
                copyToCacheDirectory: true,
            });
            if (pick.canceled || !pick.assets?.[0]) return;
            uploadingLogo.current = true;

            const asset = pick.assets[0];
            const fd = new FormData();
            // React Native FormData dosya eki: { uri, name, type }
            fd.append('file', {
                uri: asset.uri,
                name: asset.name,
                type: asset.mimeType ?? 'application/octet-stream',
            } as any);

            const res = await apiFetch('/api/settings/logo', { method: 'POST', body: fd });
            if (!res.ok) {
                const b = await res.json().catch(() => null);
                Alert.alert('', b?.message ?? `Error ${res.status}`);
                return;
            }
            Alert.alert('', 'The company logo has been updated successfully.');
        } catch {
            Alert.alert('', 'The logo could not be uploaded.');
        } finally {
            uploadingLogo.current = false;
        }
    }

    // ── btnBackupNow_Click birebir: XML üret + paylaş + bilgiyi güncelle ──
    // (masaüstü Documents\SchedulerBackups'a yazıp klasörü açar; web tarayıcı
    //  indirir; mobilde dosya cache'e yazılıp paylaşım sayfası açılır.)
    async function backupNow() {
        setBackingUp(true);
        try {
            const res = await apiFetch('/api/settings/backup', { method: 'POST' });
            if (!res.ok) { Alert.alert('', `Error ${res.status}`); return; }

            const cd = res.headers.get('Content-Disposition') ?? '';
            const mm = /filename="?([^";]+)"?/i.exec(cd);
            const fileName = mm?.[1] ?? `Scheduler_Backup_${Date.now()}.xml`;

            const xml = await res.text();
            const uri = `${FileSystem.cacheDirectory}${fileName}`;
            await FileSystem.writeAsStringAsync(uri, xml, { encoding: FileSystem.EncodingType.UTF8 });
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(uri, { mimeType: 'application/xml', dialogTitle: fileName });
            }

            // Properties.Settings.LastBackupDate / LastBackupPath karşılığı
            const now = new Date();
            const dateStr = `${pad2(now.getDate())}.${pad2(now.getMonth() + 1)}.${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
            await AsyncStorage.setItem(LS_BACKUP_DATE, dateStr);
            await AsyncStorage.setItem(LS_BACKUP_PATH, fileName);
            setBackupDate(dateStr);
            setBackupPath(fileName);

            Alert.alert('', 'Backup created successfully.');
        } catch {
            Alert.alert('', 'Backup failed.');
        } finally {
            setBackingUp(false);
        }
    }

    if (!s) {
        return (
            <ScrollView style={[styles.set, { backgroundColor: themeDark ? '#f0f2f7' : '#f7f8fc' }]} contentContainerStyle={styles.setContent}>
                <View style={styles.header}>
                    <Text style={styles.headerText}>Settings</Text>
                    <Text style={styles.headerSub}>Configure preferences, data refresh, backup and company branding</Text>
                </View>
                <Text style={styles.loading}>{loadError ? 'Settings could not be loaded.' : 'Loading…'}</Text>
            </ScrollView>
        );
    }

    const markedDates = new Set(s.specialDays.map(d => d.date));
    const count = s.specialDays.length;

    // Hours açıklaması şirketin gerçek work-hour değeriyle (lblUnitHoursDesc)
    const hoursDesc = 'Durations are converted using the company work-hour value (' +
        fmtHours(s.companyDayWorkHour) + 'h/day).';

    return (
        <ScrollView style={styles.set} contentContainerStyle={styles.setContent}>
            {/* pnlHeader */}
            <View style={styles.header}>
                <Text style={styles.headerText}>Settings</Text>
                <Text style={styles.headerSub}>Configure preferences, data refresh, backup and company branding</Text>
            </View>

            {/* ── cardDisplay ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Display Preferences</Text>
                <Text style={styles.cardSub}>Toggle which columns and panels are visible across the app.</Text>
                <View style={styles.sep} />
                <CheckRow checked={s.departmentIsVisibleForAssignments} label="Show Department on assignments"
                    onToggle={() => toggleBool('departmentIsVisibleForAssignments', 'DepartmentIsVisibleForAssignments', !s.departmentIsVisibleForAssignments)} />
                <CheckRow checked={s.priorityIsVisibleForAssignments} label="Show Priority on assignments"
                    onToggle={() => toggleBool('priorityIsVisibleForAssignments', 'PriorityIsVisibleForAssignments', !s.priorityIsVisibleForAssignments)} />
                <CheckRow checked={s.allWorkAffordsVisibleForDesignManager} label="Design Manager sees all work"
                    onToggle={() => toggleBool('allWorkAffordsVisibleForDesignManager', 'AllWorkAffordsVisibleForDesignManager', !s.allWorkAffordsVisibleForDesignManager)} />
                <CheckRow checked={s.disciplineIsVisibleForWorkEntry} label="Show Discipline on work entry"
                    onToggle={() => toggleBool('disciplineIsVisibleForWorkEntry', 'DisciplineIsVisibleForWorkEntry', !s.disciplineIsVisibleForWorkEntry)} />
                <CheckRow checked={s.folderIsVisibleForProjects} label="Show Phase on projects"
                    onToggle={() => toggleBool('folderIsVisibleForProjects', 'FolderIsVisibleForProjects', !s.folderIsVisibleForProjects)} />
                <CheckRow checked={s.showDrawingNumberInWorklist} label="Show Drawing No. in worklist"
                    onToggle={() => toggleBool('showDrawingNumberInWorklist', 'ShowDrawingNumberInWorklist', !s.showDrawingNumberInWorklist)} />
                <CheckRow checked={s.resourceIsVisible} label="Show Resource panel"
                    onToggle={() => toggleBool('resourceIsVisible', 'ResourceIsVisible', !s.resourceIsVisible)} />
                <CheckRow checked={s.checkStartedJobForWorks} label="Require started-job check"
                    onToggle={() => toggleBool('checkStartedJobForWorks', 'CheckStartedJobForWorks', !s.checkStartedJobForWorks)} />
                <CheckRow checked={s.activationIdIsVisibleForProjectManagement} label="Show WorkId in Project Mgmt"
                    onToggle={() => toggleBool('activationIdIsVisibleForProjectManagement', 'ActivationIdIsVisibleForProjectManagement', !s.activationIdIsVisibleForProjectManagement)} />
                <CheckRow checked={s.revisionIsVisibleForWorkEntry} label="Show Revision checkbox"
                    onToggle={() => toggleBool('revisionIsVisibleForWorkEntry', 'RevisionIsVisibleForWorkEntry', !s.revisionIsVisibleForWorkEntry)} />
            </View>

            {/* ── cardWorkList ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Work List Behaviour</Text>
                <Text style={styles.cardSub}>Choose what the work list shows to each user.</Text>
                <View style={styles.sep} />
                <RadioRow checked={s.workListAccToAssign} label="Show only items assigned to the user"
                    desc="Only items that are directly assigned to the user will appear in their work list."
                    onSelect={() => setWorkList(true)} />
                <RadioRow checked={!s.workListAccToAssign} label="Show the full work list (all items)"
                    desc="All company work items are visible to the user, regardless of assignment."
                    onSelect={() => setWorkList(false)} />
            </View>

            {/* ── cardTheme ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Appearance</Text>
                <Text style={styles.cardSub}>Choose between a clean light theme and the classic dark theme.</Text>
                <View style={styles.sep} />
                <RadioRow checked={!themeDark} label="Light theme"
                    desc="Clean white sidebar with the brand teal accent. Easier on the eyes in well-lit offices."
                    onSelect={() => setThemeMode(false)} />
                <RadioRow checked={themeDark} label="Dark theme"
                    desc="The original navy sidebar layout."
                    onSelect={() => setThemeMode(true)} />
            </View>

            {/* ── cardSpecialDays ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Special Days</Text>
                <Text style={styles.cardSub}>Mark company holidays and other non-working days. These are treated like weekends and excluded from missing-hour calculations.</Text>
                <View style={styles.sep} />
                <View style={styles.sdInputRow}>
                    <FlatDatePicker value={sdDate} onChange={setSdDate} alertDates={markedDates} />
                    <TouchableOpacity style={styles.checkRow} onPress={() => setSdHalf(!sdHalf)} activeOpacity={0.7}>
                        <View style={[styles.cbBox, sdHalf && styles.cbBoxOn]}>
                            {sdHalf && <Text style={styles.cbTick}>✓</Text>}
                        </View>
                        <Text style={styles.checkLabel}>Half day  (½ target)</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.sdHint}>LABEL  (OPTIONAL)</Text>
                <View style={styles.sdNameRow}>
                    <TextInput style={styles.sdName} value={sdName} onChangeText={setSdName} />
                    <TouchableOpacity style={styles.btnAdd} onPress={addSpecialDay}>
                        <Text style={styles.btnText}>Add</Text>
                    </TouchableOpacity>
                </View>
                <Text style={[styles.sdHint, styles.sdCaption]}>
                    {count === 0 ? 'MARKED DAYS' : `MARKED DAYS  (${count})`}
                </Text>
                <View style={styles.sdList}>
                    {count === 0 && (
                        <Text style={styles.sdEmpty}>No special days yet — pick a date and press Add.</Text>
                    )}
                    {s.specialDays.map((d, i) => {
                        const dt = fromIso(d.date);
                        const name = d.name && d.name.trim()
                            ? d.name
                            : (d.isHalfDay ? 'Half day' : 'Public holiday');
                        const sel = sdSelected === d.date;
                        return (
                            <TouchableOpacity key={d.date}
                                style={[styles.sdItem, i % 2 === 0 ? styles.sdItemEven : styles.sdItemOdd, sel && styles.sdItemSel]}
                                onPress={() => setSdSelected(d.date)}>
                                <View style={[styles.sdAccent, d.isHalfDay && styles.sdAccentHalf]} />
                                <View style={{ flex: 1 }}>
                                    <View style={styles.sdLine1}>
                                        <Text style={styles.sdDate}>{fmtDate(dt)}</Text>
                                        <Text style={styles.sdDow}>{fmtDow(dt)}</Text>
                                        {d.isHalfDay && <Text style={styles.sdPill}>½ HALF DAY</Text>}
                                    </View>
                                    <Text style={styles.sdName2} numberOfLines={1}>{name}</Text>
                                </View>
                            </TouchableOpacity>
                        );
                    })}
                </View>
                <View style={styles.sdBtnRow}>
                    <TouchableOpacity style={styles.btnRemove} onPress={removeSpecialDay}>
                        <Text style={styles.btnText}>Remove</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.btnPrimary} onPress={addTurkishHolidays}>
                        <Text style={styles.btnText}>Add Turkish official holidays</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* ── cardRefresh ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Data Refresh</Text>
                <Text style={styles.cardSub}>Enable automatic polling and set the refresh interval.</Text>
                <View style={styles.sep} />
                <CheckRow checked={refreshActive} label="Enable automatic data refresh"
                    onToggle={() => toggleRefresh(!refreshActive)} />
                <View style={styles.refreshRow}>
                    <TextInput style={[styles.num, !refreshActive && styles.numDisabled]}
                        keyboardType="number-pad" editable={refreshActive}
                        value={refreshValue} onChangeText={changeRefreshValue} />
                    <Text style={styles.unitLbl}>seconds</Text>
                </View>
            </View>

            {/* ── cardBackup ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Backup</Text>
                <Text style={styles.cardSub}>Export company data to an XML file. Opens the share sheet when done.</Text>
                <View style={styles.sep} />
                <Text style={styles.infoCap}>LAST BACKUP DATE</Text>
                <Text style={styles.infoVal}>{backupDate}</Text>
                <Text style={styles.infoCap}>BACKUP LOCATION</Text>
                <Text style={styles.infoVal}>{backupPath}</Text>
                <TouchableOpacity style={[styles.btnPrimary, styles.btnBackup, backingUp && styles.btnDisabled]}
                    onPress={backupNow} disabled={backingUp}>
                    <Text style={styles.btnText}>{backingUp ? 'Backing up…' : 'Backup now'}</Text>
                </TouchableOpacity>
            </View>

            {/* ── cardLogo ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Company Logo</Text>
                <Text style={styles.cardSub}>Upload a PNG, JPG or BMP file.</Text>
                <View style={styles.sep} />
                <Text style={styles.logoDesc}>The logo appears in the top-left corner of every screen and in exported reports.</Text>
                <TouchableOpacity style={styles.btnSave} onPress={uploadLogo}>
                    <Text style={styles.btnText}>Upload logo...</Text>
                </TouchableOpacity>
            </View>

            {/* ── cardUnits ── */}
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Duration Units</Text>
                <Text style={styles.cardSub}>Choose how Budget and Actual durations are shown in the reports.</Text>
                <View style={styles.sep} />
                <RadioRow checked={!s.showDurationInHours} label="Days"
                    desc="Budget and Actual columns are labelled and displayed in days."
                    onSelect={() => setUnit(false)} />
                <RadioRow checked={s.showDurationInHours} label="Hours"
                    desc={hoursDesc}
                    onSelect={() => setUnit(true)} />
                <View style={styles.sep} />
                <View style={styles.whRow}>
                    <Text style={styles.whTitle}>Work hours per day</Text>
                    <TextInput style={styles.whNum} keyboardType="decimal-pad"
                        value={workHours} onChangeText={setWorkHours} />
                    <Text style={styles.unitLbl}>h / day</Text>
                    <TouchableOpacity style={[styles.btnSave, { marginLeft: 'auto' }]} onPress={saveWorkHours}>
                        <Text style={styles.btnText}>Save</Text>
                    </TouchableOpacity>
                </View>
                <Text style={styles.whNote}>Changing this value does not retroactively recalculate the stored day-equivalent of previously saved works — it only applies to future entries.</Text>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    set: { flex: 1, backgroundColor: '#f0f2f7' },
    setContent: { paddingBottom: 24 },
    header: { backgroundColor: '#1e2433', paddingHorizontal: 14, paddingVertical: 12 },
    headerText: { color: '#e5e7eb', fontSize: 15, fontWeight: '700' },
    headerSub: { color: '#9aa5b8', fontSize: 11, marginTop: 3 },
    loading: { color: '#676879', fontSize: 12, padding: 14 },

    card: {
        backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8ebf2', borderRadius: 6,
        margin: 8, padding: 14,
    },
    cardTitle: { fontSize: 14, fontWeight: '700', color: '#1f3a6e' },
    cardSub: { fontSize: 11, color: '#676879', marginTop: 3 },
    sep: { height: 1, backgroundColor: '#e8ebf2', marginVertical: 10 },

    checkRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 8 },
    cbBox: { width: 18, height: 18, borderWidth: 1.5, borderColor: '#9ca3af', borderRadius: 3, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    cbBoxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    cbTick: { color: '#fff', fontSize: 12, fontWeight: '700' },
    checkLabel: { fontSize: 13, color: '#323338', flex: 1 },

    radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 8 },
    radioOuter: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#9ca3af', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
    radioOuterOn: { borderColor: '#2563eb' },
    radioInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#2563eb' },
    radioLabel: { fontSize: 13, color: '#323338', flex: 1 },
    radioDesc: { fontSize: 11, color: '#676879', marginLeft: 26, marginBottom: 8 },

    // Special days
    sdInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sdHint: { fontSize: 10, fontWeight: '700', color: '#8a90a2', letterSpacing: 0.5, marginTop: 12 },
    sdCaption: { marginTop: 14 },
    sdNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    sdName: {
        flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827',
    },
    sdList: { marginTop: 6, borderWidth: 1, borderColor: '#e8ebf2', borderRadius: 6, overflow: 'hidden' },
    sdEmpty: { fontSize: 12, fontStyle: 'italic', color: '#afb4c3', padding: 12 },
    sdItem: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: '#e8ebf2', paddingVertical: 6, paddingRight: 10 },
    sdItemEven: { backgroundColor: '#fff' },
    sdItemOdd: { backgroundColor: '#fafbff' },
    sdItemSel: { backgroundColor: '#e0eaff' },
    sdAccent: { width: 3, backgroundColor: '#1f3a6e', marginRight: 11, borderRadius: 2 },
    sdAccentHalf: { backgroundColor: '#c17808' },
    sdLine1: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    sdDate: { fontSize: 13, fontWeight: '700', color: '#1f3a6e' },
    sdDow: { fontSize: 11, color: '#676879' },
    sdPill: { fontSize: 9, fontWeight: '700', color: '#c17808', backgroundColor: '#fef3db', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
    sdName2: { fontSize: 11, color: '#676879', marginTop: 2 },
    sdBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 },

    // Refresh
    refreshRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
    num: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827', width: 110,
    },
    numDisabled: { backgroundColor: '#f3f4f6', color: '#9ca3af' },
    unitLbl: { fontSize: 12, color: '#676879' },

    // Backup / logo info
    infoCap: { fontSize: 10, fontWeight: '700', color: '#8a90a2', letterSpacing: 0.5, marginTop: 8 },
    infoVal: { fontSize: 13, color: '#323338', marginTop: 2 },
    logoDesc: { fontSize: 12, color: '#676879', marginBottom: 10 },

    // Work hours
    whRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    whTitle: { fontSize: 13, fontWeight: '600', color: '#323338' },
    whNum: {
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 7, fontSize: 13, color: '#111827', width: 70,
    },
    whNote: { fontSize: 11, color: '#676879', marginTop: 10 },

    // Buttons
    btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
    btnAdd: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8 },
    btnRemove: { backgroundColor: '#e2445c', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8 },
    btnPrimary: { backgroundColor: '#2563eb', borderRadius: 6, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
    btnBackup: { marginTop: 12, alignSelf: 'flex-start' },
    btnSave: { backgroundColor: '#037f4c', borderRadius: 6, paddingHorizontal: 16, paddingVertical: 8, alignSelf: 'flex-start' },
    btnDisabled: { opacity: 0.5 },

    // FlatDatePicker button
    fdpBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        borderWidth: 1, borderColor: '#d1d5db', borderRadius: 6, backgroundColor: '#fff',
        paddingHorizontal: 10, paddingVertical: 8,
    },
    fdpBtnText: { fontSize: 13, color: '#111827' },
    fdpIco: { fontSize: 12, color: '#6b7280', marginLeft: 6 },

    // Modal + calendar
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center', padding: 12 },
    modalBox: { backgroundColor: '#fff', borderRadius: 8, padding: 14, width: '100%' },
    calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    calNav: { paddingHorizontal: 12, paddingVertical: 4 },
    calNavText: { fontSize: 18, color: '#374151' },
    calTitle: { fontSize: 13, fontWeight: '700', color: '#111827' },
    calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    calCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 2 },
    calDow: { fontSize: 10, fontWeight: '700', color: '#6b7280', paddingVertical: 2 },
    calDay: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
    calDayAlert: { borderColor: '#e2445c' },
    calDayToday: { borderColor: '#2563eb' },
    calDaySel: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
    calDayText: { fontSize: 12, color: '#374151' },
    calDaySelText: { color: '#fff', fontWeight: '700' },
});

export default SettingsScreen;
