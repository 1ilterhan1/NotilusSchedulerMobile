// ── FormMainPanel.setVisibilities / setButtonsForUser birebir ──
// Web App.tsx navVisibility fonksiyonunun aynısı.
// state = DesignManager | TeamLeader | Specialist | Administrator | PME
// Boş status → hiçbir menü görünmez.

import type { UserInfo } from './auth';

export type Page = 'dashboard' | 'projects' | 'workentry' | 'approvals' | 'myassignments' | 'assignments' | 'reports' | 'settings' | 'usermanagement'
    | 'meetings' | 'inventory' | 'qa' | 'administration';

export function navVisibility(user: UserInfo): Record<Page, boolean> {
    const status = user.status ?? '';
    const companyId = user.companyId ?? 0;
    const canAssign = user.canAssign ?? false;
    if (!status.trim()) {
        return {
            dashboard: false, approvals: false, workentry: false, myassignments: false,
            projects: false, reports: false, usermanagement: false, assignments: false, settings: false,
            meetings: false, inventory: false, qa: false, administration: false,
        };
    }
    const state = status === 'DesignManager' || status === 'TeamLeader'
        || status === 'Specialist' || status === 'Administrator' || status === 'PME';
    const dmOrAdmin = status === 'DesignManager' || status === 'Administrator';
    // btnQAReport / btnInventory / btnMeeting: yalnızca CompanyID 2, 13, 5
    const company2135 = companyId === 2 || companyId === 13 || companyId === 5;
    return {
        dashboard: true,                                                  // btnDashboard
        approvals: state,                                                 // btnPendingApprovals
        workentry: true,                                                  // btnWorkEntry
        myassignments: true,                                              // btnAssignments
        projects: dmOrAdmin || status === 'PME',                          // btnProjectManagement
        reports: status !== 'Engineer' || companyId === 13,               // btnReports
        usermanagement: dmOrAdmin,                                        // btnUserManagement
        assignments: canAssign || dmOrAdmin,                              // btnAssignmentManagement
        settings: dmOrAdmin,                                              // btnSettings
        meetings: company2135,                                            // btnMeeting
        inventory: company2135,                                           // btnInventory
        qa: (canAssign || dmOrAdmin) && company2135,                      // btnQAReport
        administration: dmOrAdmin,                                        // btnFolderManagement
    };
}

// Menü sırası ve etiketler masaüstü FormMainPanel / web sidebar birebir
export const NAV_ITEMS: { id: Page; label: string }[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'approvals', label: 'Pending Approvals' },
    { id: 'workentry', label: 'Work Entry' },
    { id: 'myassignments', label: 'Assignments' },
    { id: 'projects', label: 'Add/Update Project' },
    { id: 'reports', label: 'Reports' },
    { id: 'usermanagement', label: 'User Management' },
    { id: 'assignments', label: 'Assignment Management' },
    { id: 'settings', label: 'Settings' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'qa', label: 'Quality Assurance' },
    { id: 'administration', label: 'Administration' },
];
