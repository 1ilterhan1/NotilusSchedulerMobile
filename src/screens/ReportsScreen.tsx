// Web pages/Reports.tsx birebir (masaüstü ucReports klonu).
// Üstte TabControl; sekme adları masaüstüyle aynı:
//   ByProject1  → ReportByPhase      (henüz klonlanmadı — placeholder)
//   ByProject2  → ReportByProject    (henüz klonlanmadı — placeholder)
//   ByPerson    → ReportByPerson     (henüz klonlanmadı — placeholder)
//   ByDate      → ReportByDate       ✓
//   ByGantChart → ReportByGantChart  (henüz klonlanmadı — placeholder)
//
// setTabsForUser birebir: DesignManager / Administrator / PME veya CompanyID 13
// dışındaki kullanıcılar sadece ByPerson sekmesini görür.
// Görünümler ilk açılışta oluşturulur, sekme değişince canlı tutulur (web
// visited-set / masaüstü _views cache karşılığı).
// sessionStorage (csAppConfig.reportTab) karşılığı: uygulama oturumu boyunca
// yaşayan modül değişkeni.

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { apiGet } from '../api';
import type { UserInfo } from '../auth';
import type { PmConfig } from '../types';
import ReportByDateScreen from './ReportByDateScreen';
import ReportByGantChartScreen from './ReportByGantChartScreen';
import ReportByPersonScreen from './ReportByPersonScreen';
import ReportByPhaseScreen from './ReportByPhaseScreen';
import ReportByProjectScreen from './ReportByProjectScreen';

const ALL_TABS = ['ByProject1', 'ByProject2', 'ByPerson', 'ByDate', 'ByGantChart'];

// csAppConfig.reportTab karşılığı (oturum boyunca son seçili sekme)
let savedTab: string | null = null;

interface Props {
    user: UserInfo;
    initialProjectId?: number | null;
}

// setTabsForUser birebir
function computeTabs(status: string, companyId: number): string[] {
    const s = (status || '').trim().toLowerCase();
    const privileged = s === 'designmanager' || s === 'administrator' || s === 'pme' || companyId === 13;
    return privileged ? ALL_TABS : ['ByPerson'];
}

function ReportsScreen({ user, initialProjectId = null }: Props) {
    const [tabs, setTabs] = useState<string[]>(() =>
        computeTabs(user.status ?? '', user.companyId ?? 0));

    // SelectSavedTab birebir: kayıtlı sekme varsa onu seç; Dashboard'dan proje
    // ile gelindiyse ByProject2 açılır.
    const [active, setActive] = useState<string>(() => {
        const t = computeTabs(user.status ?? '', user.companyId ?? 0);
        if (initialProjectId != null && t.includes('ByProject2')) return 'ByProject2';
        return savedTab && t.includes(savedTab) ? savedTab : t[0];
    });
    const [visited, setVisited] = useState<Set<string>>(() => new Set([active]));

    // Sunucudan rolü taze çek (web birebir: PmConfig.userStatus)
    useEffect(() => {
        (async () => {
            try {
                const cfg = await apiGet<PmConfig>('/api/projectmanagement/config');
                const t = computeTabs(cfg.userStatus, user.companyId ?? 0);
                setTabs(t);
                setActive(prev => {
                    if (t.includes(prev)) return prev;
                    if (initialProjectId != null && t.includes('ByProject2')) return 'ByProject2';
                    const next = savedTab && t.includes(savedTab) ? savedTab : t[0];
                    setVisited(v => (v.has(next) ? v : new Set(v).add(next)));
                    return next;
                });
            } catch { /* yoksay — mevcut kullanıcı bilgisiyle devam */ }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function selectTab(key: string) {
        setActive(key);
        savedTab = key;   // csAppConfig.reportTab = key
        setVisited(prev => {
            if (prev.has(key)) return prev;
            const next = new Set(prev);
            next.add(key);
            return next;
        });
    }

    function renderPane(key: string) {
        switch (key) {
            case 'ByProject1': return <ReportByPhaseScreen />;
            case 'ByProject2': return <ReportByProjectScreen initialProjectId={initialProjectId} />;
            case 'ByPerson': return <ReportByPersonScreen />;
            case 'ByDate': return <ReportByDateScreen />;
            case 'ByGantChart': return <ReportByGantChartScreen />;
            default:
                return (
                    <View style={styles.pending}>
                        <Text style={styles.pendingText}>
                            This report screen hasn't been added to the mobile app yet.
                        </Text>
                    </View>
                );
        }
    }

    return (
        <View style={styles.rpt}>
            {/* TabControl */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsWrap}>
                <View style={styles.tabs}>
                    {tabs.map(t => (
                        <TouchableOpacity key={t}
                            style={[styles.tab, active === t && styles.tabActive]}
                            onPress={() => selectTab(t)}>
                            <Text style={[styles.tabText, active === t && styles.tabTextActive]}>{t}</Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </ScrollView>

            {/* TabPage içerikleri — ziyaret edilenler mount kalır */}
            <View style={styles.body}>
                {tabs.filter(t => visited.has(t)).map(t => (
                    <View key={t} style={[styles.pane, active !== t && styles.paneHidden]}>
                        {renderPane(t)}
                    </View>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    rpt: { flex: 1, backgroundColor: '#f0f2f7' },
    tabsWrap: { flexGrow: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#e4e7f0' },
    tabs: { flexDirection: 'row' },
    tab: { paddingHorizontal: 16, paddingVertical: 10 },
    tabActive: { borderBottomWidth: 2, borderBottomColor: '#2563eb' },
    tabText: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
    tabTextActive: { color: '#2563eb' },
    body: { flex: 1 },
    pane: { flex: 1 },
    paneHidden: { display: 'none' },
    pending: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    pendingText: { fontSize: 13, color: '#6b7280', textAlign: 'center' },
    pendingSub: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
});

export default ReportsScreen;
