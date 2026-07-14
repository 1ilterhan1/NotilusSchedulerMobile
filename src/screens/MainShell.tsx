// Web App.tsx shell birebir mobil karşılığı:
// - Sidebar yerine üst bar + soldan açılan menü (drawer). Menü sırası,
//   etiketler, yetki kuralları (navVisibility) ve aktif satır rengi web/masaüstü
//   birebir. (Segoe MDL2 ikonları mobilde yok; şimdilik yalnızca etiket.)
// - btnDashboard_Click birebir: Engineer → EngineerDashboard, diğerleri → Dashboard.
// - Alt kısımda kullanıcı adı + Logout (sidebar-footer birebir).

import { useState } from 'react';
import {
    Modal,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import type { UserInfo } from '../auth';
import { NAV_ITEMS, navVisibility, type Page } from '../navigation';
import { useThemeColors } from '../theme';
import AdministrationScreen from './AdministrationScreen';
import ApprovalsScreen from './ApprovalsScreen';
import DashboardScreen from './DashboardScreen';
import EngineerDashboardScreen from './EngineerDashboardScreen';
import InventoryScreen from './InventoryScreen';
import MeetingsScreen from './MeetingsScreen';
import MyAssignmentsScreen from './MyAssignmentsScreen';
import PlaceholderScreen from './PlaceholderScreen';
import ProjectManagementScreen from './ProjectManagementScreen';
import QualityAssuranceScreen from './QualityAssuranceScreen';
import ReportsScreen from './ReportsScreen';
import SettingsScreen from './SettingsScreen';
import UserManagementScreen from './UserManagementScreen';
import WorkEntryScreen from './WorkEntryScreen';

interface Props {
    user: UserInfo;
    onLogout: () => void;
}

function MainShell({ user, onLogout }: Props) {
    const [page, setPage] = useState<Page>('dashboard');
    const [menuOpen, setMenuOpen] = useState(false);
    // Web App.tsx birebir: Dashboard'da projeye çift tık → Reports (By Project)
    const [reportProjectId, setReportProjectId] = useState<number | null>(null);

    // AppTheme birebir: tema değişince kabuk canlı boyanır (ThemeChanged karşılığı)
    const c = useThemeColors();

    // setButtonsForUser birebir — rol/şirket bazlı menü görünürlüğü
    const nav = navVisibility(user);
    const visibleItems = NAV_ITEMS.filter((i) => nav[i.id]);
    const activeLabel = NAV_ITEMS.find((i) => i.id === page)?.label ?? '';

    function renderPage() {
        // btnDashboard_Click birebir: Engineer → ucEngineerDashboard, diğerleri → ucDashboard
        if (page === 'dashboard') {
            return user.status === 'Engineer'
                ? <EngineerDashboardScreen />
                : <DashboardScreen onOpenProjectReport={(id) => { setReportProjectId(id); setPage('reports'); }} />;
        }
        if (page === 'workentry') {
            return <WorkEntryScreen user={user} />;
        }
        if (page === 'approvals') {
            return <ApprovalsScreen />;
        }
        if (page === 'myassignments') {
            return <MyAssignmentsScreen user={user} />;
        }
        if (page === 'projects') {
            return <ProjectManagementScreen />;
        }
        if (page === 'usermanagement') {
            return <UserManagementScreen />;
        }
        if (page === 'meetings') {
            return <MeetingsScreen user={user} />;
        }
        if (page === 'settings') {
            return <SettingsScreen />;
        }
        if (page === 'inventory') {
            return <InventoryScreen />;
        }
        if (page === 'qa') {
            return <QualityAssuranceScreen />;
        }
        if (page === 'administration') {
            return <AdministrationScreen />;
        }
        // Web App.tsx birebir: <Reports key={...} initialProjectId={...} />
        if (page === 'reports') {
            return <ReportsScreen key={reportProjectId ?? -1} user={user} initialProjectId={reportProjectId} />;
        }
        return <PlaceholderScreen title={activeLabel} />;
    }

    return (
        <SafeAreaView style={[styles.shell, { backgroundColor: c.contentBg }]}>
            {/* Üst bar: hamburger + aktif sayfa başlığı */}
            <View style={[styles.topbar, { backgroundColor: c.topbarBg, borderBottomColor: c.topbarBorder }]}>
                <TouchableOpacity style={styles.hamburger} onPress={() => setMenuOpen(true)}>
                    <Text style={[styles.hamburgerText, { color: c.topbarText }]}>☰</Text>
                </TouchableOpacity>
                <Text style={[styles.topbarTitle, { color: c.topbarText }]}>{activeLabel}</Text>
            </View>

            <View style={[styles.content, { backgroundColor: c.contentBg }]}>{renderPage()}</View>

            {/* Soldan açılan menü — web sidebar birebir (renkler AppTheme koyu tema) */}
            <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
                <View style={styles.overlay}>
                    <View style={[styles.sidebar, { backgroundColor: c.sidebarBg, borderRightColor: c.sidebarBorder }]}>
                        <View style={[styles.brand, { borderBottomColor: c.sidebarBorder }]}>
                            <Text style={[styles.brandText, { color: c.brandText }]}>Notilus Scheduler</Text>
                        </View>
                        <ScrollView style={styles.navList}>
                            {visibleItems.map((item) => (
                                <TouchableOpacity
                                    key={item.id}
                                    style={[styles.navItem, page === item.id && { backgroundColor: c.navActiveBg }]}
                                    onPress={() => {
                                        // Web navBtn('reports') birebir: menüden Reports'a girince proje filtresi sıfırlanır
                                        if (item.id === 'reports') setReportProjectId(null);
                                        setPage(item.id); setMenuOpen(false);
                                    }}
                                >
                                    <Text style={[styles.navLabel, { color: page === item.id ? c.navLabelActive : c.navLabel },
                                        page === item.id && styles.navLabelActive]}>
                                        {item.label}
                                    </Text>
                                    {page === item.id && <Text style={[styles.navChevron, { color: c.chevron }]}>›</Text>}
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <View style={[styles.sidebarFooter, { borderTopColor: c.sidebarBorder }]}>
                            <Text style={[styles.userName, { color: c.userName }]}>{user.name}</Text>
                            <TouchableOpacity style={[styles.btnLogout, { backgroundColor: c.logoutBg, borderColor: c.logoutBorder }]} onPress={onLogout}>
                                <Text style={[styles.btnLogoutText, { color: c.logoutText }]}>Logout</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <Pressable style={styles.overlayRest} onPress={() => setMenuOpen(false)} />
                </View>
            </Modal>
        </SafeAreaView>
    );
}

// Renkler web App.css / AppTheme koyu tema birebir:
// SidebarBg #1e2433, SidebarBorder #2d374b, SidebarText #b9c3d7,
// SidebarActiveBg #2d374e, içerik zemini #f3f4f6.
const styles = StyleSheet.create({
    shell: { flex: 1, backgroundColor: '#f3f4f6' },
    topbar: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#1e2433',
        paddingHorizontal: 12, paddingVertical: 10,
        borderBottomWidth: 1, borderBottomColor: '#2d374b',
    },
    hamburger: { padding: 6, marginRight: 8 },
    hamburgerText: { color: '#e5e7eb', fontSize: 20 },
    topbarTitle: { color: '#e5e7eb', fontSize: 16, fontWeight: '600' },
    content: { flex: 1 },
    overlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.4)' },
    overlayRest: { flex: 1 },
    sidebar: {
        width: 260, backgroundColor: '#1e2433',
        borderRightWidth: 1, borderRightColor: '#2d374b',
    },
    brand: {
        paddingVertical: 18, paddingHorizontal: 20,
        borderBottomWidth: 1, borderBottomColor: '#2d374b',
    },
    brandText: { color: '#e5e7eb', fontSize: 16, fontWeight: '700' },
    navList: { flex: 1 },
    navItem: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 12, paddingHorizontal: 20,
    },
    navItemActive: { backgroundColor: '#2d374e' },
    navLabel: { color: '#b9c3d7', fontSize: 14 },
    navLabelActive: { color: '#fff', fontWeight: '600' },
    navChevron: { color: '#fff', fontSize: 16 },
    sidebarFooter: {
        padding: 14, borderTopWidth: 1, borderTopColor: '#2d374b',
    },
    userName: { fontSize: 13, color: '#e5e7eb', marginBottom: 8, fontWeight: '600' },
    btnLogout: {
        padding: 8, backgroundColor: '#2d3748', borderWidth: 1, borderColor: '#4b5563',
        borderRadius: 6, alignItems: 'center',
    },
    btnLogoutText: { color: '#c8d2e6', fontSize: 13, fontWeight: '600' },
});

export default MainShell;
