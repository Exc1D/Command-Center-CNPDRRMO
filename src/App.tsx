import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "./lib/store";
import { EvacuationCenterAPI, HazardAPI } from "./lib/api";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";
import DangerMap from "./components/Map";
import { DropTagModal, PopUpCard, PinModal } from "./components/Modals";
import { EditHazardModal } from "./components/EditHazardModal";
import { EvacuationCenterModal } from "./components/EvacuationCenterModal";
import { EvacuationCenterCard } from "./components/EvacuationCenterCard";
import { PlanningOverlay, PlanningSidebar } from "./components/PlanningUI";
import { usePlanningStore } from "./lib/planningStore";
import { monitorSummary } from "./lib/utils";
import { PlanningAPI } from "./lib/planningApi";
import { PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

const AnalyticsPanel = lazy(() => import('./components/AnalyticsPanel').then(module => ({ default: module.AnalyticsPanel })));

export default function App() {
  const {
    setHazards,
    setEvacuationCenters,
    setMapAuthorized,
    isMapAuthorized,
    isAnalyticsOpen,
    setAnalyticsOpen,
    syncState,
    clearSyncError,
  } = useStore();
  const [sidebarOpen,setSidebarOpen] = useState(true);
  const planning = usePlanningStore();

  useEffect(() => {
    fetch('/api/session').then(response => response.json()).then(data => setMapAuthorized(data.valid === true)).catch(() => {});
  }, [setMapAuthorized]);

  useEffect(() => {
    const refresh = async () => {
      try {
        if (isMapAuthorized) {
          await HazardAPI.syncPending();
          await EvacuationCenterAPI.syncPending();
          try { await PlanningAPI.syncPending(usePlanningStore.getState().sessionId); } catch { /* cached drafts remain available */ }
        }
        const [hazards, centers] = await Promise.all([HazardAPI.getAllHazards(), EvacuationCenterAPI.getAllCenters()]);
        setHazards(hazards);
        setEvacuationCenters(centers);
      } catch (error) {
        console.error("Failed to refresh operational data:", error);
      }
    };
    refresh();

    // ponytail: every open screen polls every 15 s while visible; move to server-sent events if hosting leaves serverless.
    const refreshIfVisible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(refreshIfVisible, 15_000);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [isMapAuthorized, setEvacuationCenters, setHazards]);

  return (
    <div data-mode={planning.isPlanningMode ? "planning" : "monitor"} className="app-shell w-full h-screen bg-surface text-on-surface font-sans overflow-hidden flex flex-col relative">
      {/* Sync Error Banner */}
      {syncState.lastSyncError && (
        <div role="alert" className="absolute top-20 left-1/2 -translate-x-1/2 z-[1000] bg-white/90 backdrop-blur-xl text-on-error-container px-5 py-3 rounded-2xl shadow-panel flex items-center gap-4 min-w-[300px]">
          <span className="flex-1 text-sm font-medium">
            {syncState.lastSyncError}
          </span>
          <button
            onClick={clearSyncError}
            aria-label="Dismiss sync error"
            className="p-1 hover:bg-error/20 rounded"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <header className="app-header h-[64px] shrink-0 flex items-center justify-between px-6 z-[60] relative">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative w-10 h-10 shrink-0 flex items-center justify-center bg-white rounded-[10px] overflow-hidden ring-[0.5px] ring-black/10">
            <img
              src="/PDRRMO.jpg"
              alt="PDRRMO Logo"
              className="w-10 h-10 object-contain bg-surface-container-lowest"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add("fallback-logo");
              }}
            />
            <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-[10px] text-center leading-none text-tertiary [.fallback-logo_&]:flex hidden">
              PDRRMO
              <br />
              CN
            </span>
          </div>
          <div className="min-w-0">
            <h1 className="text-[17px] font-display font-semibold tracking-tight text-on-surface leading-tight">
              Command Center
            </h1>
            <p className="text-xs text-on-surface/55 truncate">
              Camarines Norte Provincial DRRMO
            </p>
          </div>
        </div>
        <div className="header-actions flex items-center gap-3">
          <button
            onClick={() => setAnalyticsOpen(!isAnalyticsOpen)}
            aria-label="View Analytics"
            aria-pressed={isAnalyticsOpen}
            className="nav-text-button"
          >
            Analytics
          </button>
          <button
            onClick={() => {
              if (planning.isPlanningMode) {
                if (planning.dirty && !confirm('Discard unsaved planning changes?')) return;
                const scenario = planning.history?.present;
                if (scenario && planning.lockAcquired) PlanningAPI.releaseLock(scenario.id, planning.sessionId).catch(() => {});
                if (planning.dirty) {
                  const saved = planning.scenarios.find(item => item.id === scenario?.id);
                  saved ? planning.load(saved) : planning.newBoard();
                }
                planning.exit();
              } else {
                planning.enter();
                setAnalyticsOpen(false);
              }
            }}
            role="switch"
            aria-label="Planning mode"
            aria-checked={planning.isPlanningMode}
            aria-describedby="monitor-mode-hint planning-mode-hint"
            title={planning.isPlanningMode ? 'Switch to monitoring' : 'Switch to planning'}
            className="mode-switch"
          >
            <span className="mode-label mode-label-monitor"><strong>Monitor</strong><small id="monitor-mode-hint">View incidents</small></span>
            <span className="mode-switch-track" aria-hidden="true"><span /></span>
            <span className="mode-label mode-label-planning"><strong>Planning</strong><small id="planning-mode-hint">Build a response</small></span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex overflow-hidden">
        <div className="sidebar-rail" data-open={sidebarOpen} data-planning={planning.isPlanningMode}>
          <div id="map-sidebar" className="sidebar-panel" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
            <ErrorBoundary fallback={<div className="h-full flex items-center justify-center bg-surface-container text-tertiary">Sidebar failed</div>}>
              {planning.isPlanningMode ? <PlanningSidebar /> : <Sidebar />}
            </ErrorBoundary>
          </div>
          <button
            className="sidebar-toggle"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-controls="map-sidebar"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(open => !open)}
          >
            {sidebarOpen ? <PanelLeftClose size={20} aria-hidden="true" /> : <PanelLeftOpen size={20} aria-hidden="true" />}
          </button>
        </div>
        <section className="flex-1 min-w-0 relative bg-surface flex items-center justify-center overflow-hidden">
          <ErrorBoundary
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-surface text-tertiary">
                Map failed
              </div>
            }
          >
          <DangerMap />
          </ErrorBoundary>
          {!planning.isPlanningMode && <MonitorSummary />}
          <PopUpCard />
          <ErrorBoundary
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-surface text-tertiary">
                Analytics failed
              </div>
            }
          >
          {isAnalyticsOpen && <Suspense fallback={null}><AnalyticsPanel /></Suspense>}
          </ErrorBoundary>
          {planning.isPlanningMode && <PlanningOverlay />}
        </section>
      </main>

      <DropTagModal />
      <PinModal />
      <EditHazardModal />
      <EvacuationCenterModal />
      <EvacuationCenterCard />
    </div>
  );
}

function MonitorSummary() {
  const hazards = useStore(state => state.hazards);
  const centers = useStore(state => state.evacuationCenters);
  const summary = monitorSummary(hazards, centers);
  const items = [
    ['Incidents logged', summary.incidents.toLocaleString()],
    ['Roads not passable', summary.roadsClosed.toLocaleString()],
    ['Centers open', `${summary.openCenters} of ${summary.totalCenters}`],
    ['Evacuees inside now', `${summary.personsNow.toLocaleString()} persons · ${summary.familiesNow.toLocaleString()} families`],
  ];
  return (
    <dl aria-label="Province summary" className="absolute top-3 left-16 z-[450] flex flex-wrap gap-2 max-w-[calc(100%-8rem)] pointer-events-none">
      {items.map(([label, value]) => (
        <div key={label} className="bg-surface-container-lowest/95 border border-outline-variant/45 rounded-xl px-3 py-2 shadow-panel">
          <dt className="text-[11px] text-on-surface/60">{label}</dt>
          <dd className="text-sm font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
