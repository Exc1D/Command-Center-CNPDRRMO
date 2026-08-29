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
import { PlanningOverlay, PlanningSidebar, PublishedPlansControl } from "./components/PlanningUI";
import { usePlanningStore } from "./lib/planningStore";
import { PlanningAPI } from "./lib/planningApi";
import { BarChart2, MapPinned, X } from "lucide-react";

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
  const [isOnline, setIsOnline] = useState(navigator.onLine);
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

    const handleOnline = async () => {
      setIsOnline(true);
      await refresh();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [isMapAuthorized, setEvacuationCenters, setHazards]);

  return (
    <div className="app-shell w-full h-screen bg-surface text-on-surface font-sans overflow-hidden flex flex-col relative">
      {/* Sync Error Banner */}
      {syncState.lastSyncError && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[100] bg-error-container text-on-error-container px-6 py-3 rounded-lg shadow-lg flex items-center gap-4 min-w-[300px]">
          <span className="flex-1 text-sm font-medium">
            {syncState.lastSyncError}
          </span>
          <button
            onClick={clearSyncError}
            className="p-1 hover:bg-error/20 rounded"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <header className="h-[76px] shrink-0 bg-surface-container-lowest border-b border-outline-variant/35 flex items-center justify-between px-6 z-[60] relative">
        <div className="flex items-center gap-4 min-w-0">
          <div className="relative w-12 h-12 shrink-0 flex items-center justify-center bg-surface-container rounded-xl overflow-hidden ring-1 ring-outline-variant/40">
            <img
              src="/PDRRMO.jpg"
              alt="PDRRMO Logo"
              className="w-12 h-12 object-contain bg-surface-container-lowest"
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
            <h1 className="text-xl font-display font-extrabold tracking-tight text-on-surface leading-tight">
              COMMAND CENTER
            </h1>
            <p className="text-xs text-on-surface/60 font-medium truncate">
              Camarines Norte Provincial DRRMO
            </p>
          </div>
          <div className={`ml-3 hidden xl:flex items-center gap-2 rounded-full px-3 h-8 text-xs font-bold ${planning.isPlanningMode ? 'bg-planning-container text-on-planning-container' : 'bg-surface-container text-on-surface/70'}`}>
            {planning.isPlanningMode ? 'Operational planning workspace' : 'Live operational map'}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex flex-col items-end mr-2">
            <span className={`text-xs font-bold ${isOnline ? 'text-success' : 'text-primary'}`}>
              <span aria-hidden="true">●</span> {syncState.isSyncing ? 'Syncing operational data' : isOnline ? 'Online, cache ready' : 'Offline, changes queued'}
            </span>
            <span className="text-[11px] text-on-surface/55 font-medium">
              Map Status: {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <button
            onClick={() => setAnalyticsOpen(!isAnalyticsOpen)}
            aria-label="View Analytics"
            aria-pressed={isAnalyticsOpen}
            className={`h-12 px-5 flex items-center gap-2 transition-colors rounded-xl border text-sm font-bold ${isAnalyticsOpen ? "bg-tertiary text-on-tertiary border-tertiary" : "bg-surface-container-lowest hover:bg-surface-container text-on-surface border-outline-variant/50"}`}
          >
            <BarChart2
              size={19}
              className={isAnalyticsOpen ? "text-on-tertiary" : "text-tertiary"}
            />{" "}
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
            aria-pressed={planning.isPlanningMode}
            className={`h-12 px-5 flex items-center gap-2 rounded-xl text-sm font-bold border transition-colors ${planning.isPlanningMode ? 'bg-planning text-on-planning border-planning hover:bg-planning/90' : 'bg-primary text-on-primary border-primary hover:bg-primary/90'}`}
          >
            <MapPinned size={19} /> {planning.isPlanningMode ? 'Exit Planning' : 'Planning Mode'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <ErrorBoundary
          fallback={
            <div className="flex items-center justify-center w-80 bg-surface-container text-tertiary">
              Sidebar failed
            </div>
          }
        >
          {planning.isPlanningMode ? <PlanningSidebar /> : <Sidebar />}
        </ErrorBoundary>
        <section className="flex-1 relative bg-surface flex items-center justify-center overflow-hidden">
          <ErrorBoundary
            fallback={
              <div className="absolute inset-0 flex items-center justify-center bg-surface text-tertiary">
                Map failed
              </div>
            }
          >
          <DangerMap />
          </ErrorBoundary>
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
          {planning.isPlanningMode ? <PlanningOverlay /> : <PublishedPlansControl />}
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
