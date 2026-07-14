// Web types.ts'ten birebir — mobil ekranlar klonlandıkça ilgili tipler eklenir.

// ── Dashboard (ucDashboard) ──
export interface Overview { activeProjects: number; totalWorks: number; inProgress: number; overdue: number; pendingApprovals: number; avgCompletion: number; }
export interface ProjectKpi { id: number; name: string; total: number; done: number; inProgress: number; overdue: number; pendingApprovals: number; completionPercent: number; actualHours: number; estimatedHours: number; }
export interface FocusRow { workId: number; workName: string; projectName: string; startDate: string | null; endDate: string | null; budgetHours: number; actualHours: number; }
export interface DashboardData { overview: Overview; projects: ProjectKpi[]; startingThisWeek: FocusRow[]; dueThisWeek: FocusRow[]; weeklyHours: number[]; workloadLabels: string[]; }

// ── Work Entry (ucWorkEntry) ──
export interface WeProject { id: number; name: string; isComplete: boolean; }
export interface WeConfig { disciplineIsVisibleForWorkEntry: boolean; showDrawingNumberInWorklist: boolean; revisionIsVisibleForWorkEntry: boolean; workListAccToAssign: boolean; hoursPerDay: number; }
export interface WeWork { workId: number; discipline: string; drawingNo: string | null; name: string; estimatedHours: number; currentTotalHours: number; isStarted: boolean; }
export interface WeFolder { folder: string; works: WeWork[]; }
export interface WeAfford { id: number; project: string; folder: string; work: string; detail: string | null; hours: number; status: string; rejectDetail: string | null; }
export interface WeCalendar { boldDates: string[]; alertDates: string[]; }

// ── Reports (ucReports) ──
export interface PmConfig { disciplineIsVisibleForWorkEntry: boolean; folderIsVisibleForProjects: boolean; showDrawingNumberInWorklist: boolean; resourceIsVisible: boolean; checkStartedJobForWorks: boolean; activationIdIsVisibleForProjectManagement: boolean; durationInHours: boolean; hoursPerDay: number; userStatus: string; }
export interface RbdProjectRow { project: string; hours: number; percentage: string; }
export interface RbdData { projects: RbdProjectRow[]; chartLabels: string[]; chartValues: number[]; totalWorkHours: number; }

// ── Project Management (ucProjectManagement) ──
export interface PmProject { id: number; name: string; isComplete: boolean; isDashboardVisible: boolean | null; }
export interface PmWork { id: number; folder: string; folderId: number; discipline: string; disciplineId: number; drawingNo: string | null; name: string | null; estimatedDuration: number; startDate: string | null; endDate: string | null; completed: boolean; resource: string; resourceId: number | null; isStarted: boolean | null; activationId: string | null; type: string | null; }
export interface TxtExportRow { taskName: string; startDate: string; deadline: string; duration: number; assignedTo: string; }

// ── Reports → Project (ucReportByProject) ──
export interface RpInit { projects: RpProjectItem[]; metric: string; hoursPerDay: number; durationInHours: boolean; }
export interface RpWorkRow { phase: string; discipline: string; work: string; estimated: string; actual: string; efficiency: string; status: string; workId: number; }
export interface RpKpi { efficiency: string; totalActual: string; totalWorks: number; completedWorks: number; }
export interface RpBarItem { name: string; estimated: number; actual: number; }
export interface RpReportData { rows: RpWorkRow[]; kpi: RpKpi; bars: RpBarItem[]; donutLabels: string[]; donutValues: number[]; firstEntry: string; startDate: string; endDate: string; }
export interface RpBreakdownRow { phase: string; discipline: string; work: string; user: string; workingPercent: string; duration: string; }
export interface RpWorkBreakdown { breakdown: RpBreakdownRow[]; donutLabels: string[]; donutValues: number[]; bars: RpBarItem[]; }
export interface RpDetails { projectName: string; workName: string; items: RpAffordDetail[]; }
export interface RpExportEmpItem { employee: string; actualSelectedDate: number; actualSelectedDatePercentage: number; actualCumulative: number; actualCumulativePercentage: number; isRevision: boolean; }
export interface RpExportWorkGroup { workName: string; folderName: string; estimated: number; items: RpExportEmpItem[]; }
export interface RpExport { projectName: string; startDate: string; endDate: string; metric: string; groups: RpExportWorkGroup[]; }

// ── Reports → Phase (ucReportByPhase) ──
export interface IdName { id: number; name: string; }
export interface PmLookups { folders: IdName[]; disciplines: IdName[]; resources: IdName[]; }
export interface RpProjectItem { id: number; name: string; isComplete: boolean; }
export interface RpAffordDetail { detail: string | null; hours: number; date: string; personName: string; status: string | null; }
export interface RphInit { projects: RpProjectItem[]; durationInHours: boolean; hoursPerDay: number; resourceIsVisible: boolean; userStatus: string; }
export interface RphWorkRow {
    workId: number; activationId: string; phase: string; discipline: string; drawingNo: string; name: string;
    estimated: number; actual: number; plannedCompPer: number; actualComp: number; estDurFromActual: number;
    startDate: string; endDate: string; resource: string; status: string;
    folderId: number; disciplineId: number; resourceId: number | null;
    type: string | null; completedFlag: boolean; isStarted: boolean | null;
    startIso: string; endIso: string; estimatedDb: number;
}
export interface RphOverall { planned: number; actual: number; efficiency: string; }
export interface RphChartPoint { label: string; planned: number; actual: number; actualMode: number; }
export interface RphPhaseChart { title: string; groups: RphChartPoint[]; }
export interface RphData {
    rows: RphWorkRow[]; projectStart: string; overall: RphOverall;
    summary: RphChartPoint[]; phaseCharts: RphPhaseChart[];
    phases: IdName[]; disciplines: IdName[]; resources: IdName[]; filterDate: string;
}
export interface RphDetails { projectName: string; workName: string; items: RpAffordDetail[]; }
export interface RphTevziatRow { empNo: string; projectName: string; activationId: string; workName: string; workDate: string; hours: number; }
export interface RphTevziat { startDate: string; endDate: string; rows: RphTevziatRow[]; }

// ── Reports → Gantt (ucReportByGantChart) ──
export interface RgSegment { date: string; hours: number; }
export interface RgTask {
    id: number; name: string; category: string;
    plannedStart: string | null; plannedEnd: string | null;
    actualStart: string | null; actualEnd: string | null;
    status: string; percent: number; segments: RgSegment[];
}
export interface RgInit { projects: RpProjectItem[]; hoursPerDay: number; }
export interface RgData { tasks: RgTask[]; hoursPerDay: number; }

// ── Reports → Person (ucReportByPerson) ──
export interface RppUser { id: number; name: string; }
export interface RppInit { users: RppUser[]; activeUserNames: string[]; showTevziat: boolean; }
export interface RppProjectRow { project: string; hours: number; percentage: string; }
export interface RppWorkRow { phase: string; discipline: string; project: string; drawingNo: string; work: string; hours: number; date: string; }
export interface RppOverviewRow { name: string; hours: number; }
export interface RppWarnRow { date: string; user: string; enteredHours: string; missingHours: string; }
export interface RppKpi { totalWorkHours: number; projectsCount: number; worksCount: number; daysInRange: number; }
export interface RppData {
    projects: RppProjectRow[]; chartLabels: string[]; chartValues: number[];
    works: RppWorkRow[]; usersOverview: RppOverviewRow[]; warnUsers: RppWarnRow[]; kpi: RppKpi;
}
export interface RppExportItem {
    projectName: string; folderName: string; drawingNo: string; workName: string;
    estimated: number; actualSelectedDate: number; actualSelectedDatePercentage: number;
    actualCumulative: number; actualCumulativePercentage: number;
    variance: number; variancePercentage: number;
    actualCumulativeOfPerson: number; actualCumulativePercentageOfPerson: number;
}
export interface RppExportPerson { person: string; items: RppExportItem[]; }
export interface RppExport { startDate: string; endDate: string; pairs: RppExportPerson[]; }
export interface RppTevziatRow { empNo: string; projectName: string; activationId: string; workName: string; workDate: string; hours: number; }
export interface RppTevziat { startDate: string; endDate: string; rows: RppTevziatRow[]; }

// ── My Assignments (ucAssignment) ──
export interface MyAssignmentRow { id: number; projectId: number; project: string; workId: number | null; workName: string | null; assignedBy: string | null; assignedTo: string | null; controller: string | null; priority: number; deadline: string | null; status: string | null; hasDetail: boolean; hasNewMessage: boolean; }
export interface MyAssignmentsDto { works: MyAssignmentRow[]; controls: MyAssignmentRow[]; priorityIsVisible: boolean; }
export interface WorkDetailDto { email: string | null; description: string | null; }
export interface MessageDto { ownerName: string; ownerStatus: string | null; text: string | null; date: string; mine: boolean; }

// ── User Management (ucUserManagement) ──
export interface UmUserRow { id: number; name: string; status: string; canAssign: boolean; isActive: boolean; customId: string; }
export interface UmActiveUser { id: number; name: string; status: string; }
export interface UmDiscipline { id: number; name: string; }
export interface UmInit { users: UmUserRow[]; activeEmployees: UmActiveUser[]; disciplines: UmDiscipline[]; }
export interface UmUserDetail { id: number; password: string; status: string; customId: string; canAssign: boolean; disciplines: UmDiscipline[]; }
export interface UmRelation { hierarchyId: number; childId: number; childName: string; childStatus: string; }
export interface UmAddRelationResult { alreadyExist: boolean; }

// ── Pending Approvals (ucApproveWork) ──
export interface ApprovalRow { id: number; date: string; user: string; project: string; folder: string; work: string; detail: string | null; hours: number; revision: boolean; overwork: boolean; startDate: string | null; endDate: string | null; status: string | null; rejectDetail: string | null; }
