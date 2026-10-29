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
import { getCentroid, monitorSummary } from "./lib/utils";
import { MAP_CONFIG } from "./lib/constants";
import { PlanningAPI } from "./lib/planningApi";
import { ChevronDown, ChevronUp, CircleHelp, LockKeyhole, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";

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
  // Phones open on the map; the layers panel would otherwise cover most of it.
  const [sidebarOpen,setSidebarOpen] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? true);
  const planning = usePlanningStore();
  const [guideOpen, setGuideOpen] = useState(() => !readFlag(GUIDE_SEEN_KEY));

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
          {/* Help sits apart from the main navigation, in the top-right corner where people expect it. */}
          <button onClick={() => setGuideOpen(true)} aria-label="How to use this app" title="How to use this app" className="nav-text-button inline-flex items-center gap-1.5">
            <CircleHelp size={18} aria-hidden="true" /><span className="max-sm:hidden">Help</span>
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
          {!planning.isPlanningMode && !isMapAuthorized && (
            <button onClick={() => useStore.getState().openPinModal('unlock')} className="summary-chip absolute bottom-6 left-1/2 -translate-x-1/2 z-[450] flex items-center gap-2 whitespace-nowrap">
              <LockKeyhole size={16} aria-hidden="true" /> Unlock editing to add reports
            </button>
          )}
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

      {guideOpen && <QuickGuide onClose={() => { writeFlag(GUIDE_SEEN_KEY, true); setGuideOpen(false); }} />}
      <DropTagModal />
      <PinModal />
      <EditHazardModal />
      <EvacuationCenterModal />
      <EvacuationCenterCard />
    </div>
  );
}

const SUMMARY_HIDDEN_KEY = 'summaryHidden';
const GUIDE_SEEN_KEY = 'guideSeen';
const readFlag = (key: string) => { try { return localStorage.getItem(key) === '1'; } catch { return false; } };
const writeFlag = (key: string, on: boolean) => { try { on ? localStorage.setItem(key, '1') : localStorage.removeItem(key); } catch { /* private mode: preference lasts this visit only */ } };

function MonitorSummary() {
  const hazards = useStore(state => state.hazards);
  const centers = useStore(state => state.evacuationCenters);
  const [hidden, setHidden] = useState(() => readFlag(SUMMARY_HIDDEN_KEY));
  const [roadIndex, setRoadIndex] = useState(0);
  const summary = monitorSummary(hazards, centers);
  const toggle = () => setHidden(value => { writeFlag(SUMMARY_HIDDEN_KEY, !value); return !value; });

  const showCenters = () => { const s = useStore.getState(); if (!s.evacuationCentersVisible) s.toggleEvacuationCenters(); };
  const nextClosedRoad = () => {
    const closed = hazards.filter(h => h.type === 'road' && h.severity === 'Not passable' && getCentroid(h.geometry));
    if (!closed.length) return;
    const road = closed[roadIndex % closed.length];
    const point = getCentroid(road.geometry)!;
    useStore.getState().flyTo([point.lat, point.lng], MAP_CONFIG.BARANGAY_ZOOM);
    useStore.getState().setSelectedHazard(road);
    setRoadIndex(index => index + 1);
  };
  const items: [string, string, string, () => void][] = [
    ['Incidents logged', summary.incidents.toLocaleString(), 'Open analytics', () => useStore.getState().setAnalyticsOpen(true)],
    ['Roads not passable', summary.roadsClosed.toLocaleString(), summary.roadsClosed ? 'Show next closed road on the map' : 'No closed roads', nextClosedRoad],
    ['Centers open', `${summary.openCenters} of ${summary.totalCenters}`, 'Show evacuation centers on the map', showCenters],
    ['Evacuees inside now', `${summary.personsNow.toLocaleString()} persons · ${summary.familiesNow.toLocaleString()} families`, 'Show evacuation centers on the map', showCenters],
  ];

  if (hidden) return (
    <button onClick={toggle} aria-expanded={false} className="summary-chip absolute top-3 left-16 z-[450] flex items-center gap-1.5">
      <ChevronDown size={16} aria-hidden="true" /> Show summary
    </button>
  );
  return (
    <section aria-label="Province summary" className="absolute top-3 left-16 z-[450] flex flex-wrap items-start gap-2 max-w-[calc(100%-8rem)] pointer-events-none">
      {items.map(([label, value, hint, onClick]) => (
        <button key={label} onClick={onClick} title={hint} className="summary-card pointer-events-auto text-left">
          <span className="block text-[11px] text-on-surface/60">{label}</span>
          <span className="block text-sm font-semibold tabular-nums">{value}</span>
        </button>
      ))}
      <button onClick={toggle} aria-expanded={true} aria-label="Hide summary" title="Hide summary" className="summary-chip pointer-events-auto self-center">
        <ChevronUp size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

const GUIDE_STEPS = [
  ['Monitor: see what is happening', 'The map shows reported incidents, closed roads and evacuation centers. Tap a number at the top of the map to jump to it. To add a report, tap “Unlock editing”, enter the PIN, then use the pin buttons on the left edge of the map.'],
  ['Planning: build a response', 'Switch to Planning at the top right to draft a response plan. Work through the three tabs in order: 1 Brief, 2 Map, 3 Review.'],
  ['Analytics: check the numbers', 'Analytics gives a situation overview, shows where to focus and lists the latest reports. Open it from the top bar at any time. Tap Help in the top-right corner to see this guide again.'],
];

function QuickGuide({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [title, body] = GUIDE_STEPS[step];
  const last = step === GUIDE_STEPS.length - 1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop-in fixed inset-0 z-[1500] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="guide-title" className="sheet-in w-full max-w-sm rounded-2xl p-6 bg-surface-container-lowest shadow-ambient text-on-surface space-y-4">
        <p className="text-xs font-semibold text-on-surface/60">Quick guide · {step + 1} of {GUIDE_STEPS.length}</p>
        <h2 id="guide-title" className="text-lg font-bold">{title}</h2>
        <p className="text-sm leading-relaxed">{body}</p>
        <div className="flex items-center justify-between gap-2 pt-2">
          <button onClick={onClose} className="nav-text-button">Skip</button>
          <div className="flex gap-2">
            {step > 0 && <button onClick={() => setStep(step - 1)} className="nav-text-button">Back</button>}
            <button autoFocus onClick={() => last ? onClose() : setStep(step + 1)} className="btn-primary min-h-10 px-5 rounded-full">{last ? 'Got it' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
