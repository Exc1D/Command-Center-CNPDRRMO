import { useEffect } from "react";
import { useStore } from "./lib/store";
import { HazardAPI } from "./lib/api";
import Sidebar from "./components/Sidebar";
import DangerMap from "./components/Map";
import { DropTagModal, PopUpCard, PinModal } from "./components/Modals";
import { AnalyticsPanel } from "./components/AnalyticsPanel";
import { BarChart2 } from "lucide-react";

export default function App() {
  const { setHazards, isAnalyticsOpen, setAnalyticsOpen } = useStore();

  useEffect(() => {
    // Initial fetch
    const fetchHazards = async () => {
      const hazards = await HazardAPI.getAllHazards();
      setHazards(hazards);
    };
    fetchHazards();

    // Setup network listeners for offline sync
    const handleOnline = () => {
      HazardAPI.syncPending().then(async () => {
        const hazards = await HazardAPI.getAllHazards();
        setHazards(hazards);
      });
    };

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [setHazards]);

  return (
    <div className="w-full h-screen bg-surface text-on-surface font-sans overflow-hidden flex flex-col relative">
      <header className="h-20 bg-surface-container-lowest shadow-ambient flex items-center justify-between px-8 z-[60] relative">
        <div className="flex items-center gap-4">
          <div className="relative w-12 h-12 flex items-center justify-center bg-surface-container rounded-full shadow-sm overflow-hidden">
            <img
              src="/PDRRMO.jpg"
              alt="PDRRMO Logo"
              className="w-12 h-12 object-contain bg-white"
              referrerPolicy="no-referrer"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add("fallback-logo");
              }}
            />
            <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-[10px] text-center leading-none text-tertiary [._fallback-logo_&]:flex hidden">
              PDRRMO
              <br />
              CN
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-display font-extrabold tracking-tight text-on-surface">
              COMMAND CENTER
            </h1>
            <p className="text-[11px] uppercase tracking-[0.05em] text-on-surface/60 font-medium">
              Provincial Disaster Risk Reduction & Management Office
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <span className="text-[11px] uppercase text-primary font-bold tracking-[0.05em]">
              ● Local Sync Active
            </span>
            <span className="text-[11px] text-on-surface/60 uppercase tracking-[0.05em] font-medium">
              Station: Emergency Operations Center
            </span>
          </div>
          <button
            onClick={() => setAnalyticsOpen(!isAnalyticsOpen)}
            className={`h-10 px-4 flex items-center gap-2 transition-colors rounded-md border border-outline-variant/30 text-[11px] font-bold uppercase tracking-[0.05em] ${isAnalyticsOpen ? "bg-primary text-white" : "bg-surface-container hover:bg-surface-container-high text-on-surface"}`}
          >
            <BarChart2
              size={16}
              className={isAnalyticsOpen ? "text-white" : "text-tertiary"}
            />{" "}
            View Analytics
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <Sidebar />
        <section className="flex-1 relative bg-surface flex items-center justify-center overflow-hidden">
          <DangerMap />
          <PopUpCard />
          <AnalyticsPanel />
        </section>
      </main>

      <footer className="h-12 bg-surface-container-low flex items-center px-8 justify-between z-50">
        <div className="flex items-center gap-6">
          <div className="text-[11px] text-on-surface/60 uppercase tracking-[0.05em] font-bold">
            Activity Feed:
          </div>
          <div className="text-[11px] text-on-surface/80">
            Vigilant curation active. Ready for field data.
          </div>
        </div>
        <div className="flex gap-4">
          <div className="text-[11px] px-3 py-1 bg-surface-container text-tertiary font-bold rounded-md uppercase tracking-[0.05em]">
            Map Status: Online
          </div>
        </div>
      </footer>

      <DropTagModal />
      <PinModal />
    </div>
  );
}
