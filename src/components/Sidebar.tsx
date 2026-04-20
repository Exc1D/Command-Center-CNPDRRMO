import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { cn } from '../lib/utils';
import { Layers, Map as MapIcon, Satellite, Download, Clock, ShieldAlert, ShieldCheck, ChevronDown, Check } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import barangaysData from '../lib/barangays.json';

const MUNICIPALITIES = Object.keys(barangaysData).map(key => {
  const data = (barangaysData as any)[key];
  const lats = data.barangays.map((b: any) => b.lat);
  const lngs = data.barangays.map((b: any) => b.lng);
  const centerLat = lats.reduce((a: number,b: number) => a + b, 0) / lats.length;
  const centerLng = lngs.reduce((a: number,b: number) => a + b, 0) / lats.length;

  return {
    name: key,
    center: [centerLat, centerLng] as [number, number],
    zoom: 13,
    barangays: data.barangays.map((b: any) => b.name),
    barangaysFull: data.barangays
  };
});

export default function Sidebar() {
  const {
    baseMap, setBaseMap,
    activeFilters, toggleFilter,
    flyTo, filteredHazards, flyTo: storeFlyTo,
    isMapAuthorized, setMapAuthorized,
    openPinModal, setSelectedHazard
  } = useStore();
  
  const [exporting, setExporting] = useState(false);
  const [selectedMun, setSelectedMun] = useState<string>('ALL');
  const [selectedBrgy, setSelectedBrgy] = useState<string>('ALL');
  const [incidentLogsOpen, setIncidentLogsOpen] = useState(true);

  const handleExportPDF = async () => {
    setExporting(true);
    try {
      const mapElement = document.querySelector('.leaflet-container');
      if (!mapElement) return;

      const canvas = await html2canvas(mapElement as HTMLElement, { useCORS: true });
      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.setFillColor(248, 249, 255); 
      pdf.rect(0, 0, pdfWidth, pdfHeight, 'F');
      
      pdf.addImage(imgData, 'JPEG', 10, 20, pdfWidth - 20, pdfHeight - 40);
      
      pdf.setTextColor(13, 28, 46);
      pdf.setFontSize(18);
      pdf.text('DRRMC Camarines Norte - Hazard Report', 10, 15);
      
      pdf.setFontSize(10);
      let xOffset = 10;
      DISASTER_TYPES.forEach(t => {
        pdf.setFillColor(t.color);
        pdf.rect(xOffset, pdfHeight - 15, 5, 5, 'F');
        pdf.text(t.label, xOffset + 7, pdfHeight - 11);
        xOffset += 40;
      });

      pdf.save(`DRRMC_Report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);

    } catch (e) {
      console.error(e);
      alert('Failed to generate PDF. Make sure all map tiles have CORS enabled.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <aside className="w-80 h-full bg-surface-container-low flex flex-col text-on-surface z-[55] shadow-ambient relative">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-8 space-y-8 custom-scrollbar">
        
        {/* Verification Check */}
        <section>
          <button 
            onClick={() => {
              if (isMapAuthorized) {
                setMapAuthorized(false);
              } else {
                openPinModal('unlock');
              }
            }}
            className={cn(
              "w-full flex items-center justify-center gap-3 p-3 rounded-lg transition-all font-bold tracking-[0.05em] uppercase text-[11px]",
               isMapAuthorized 
                 ? "bg-surface-container-highest text-tertiary shadow-sm border border-surface-container" 
                 : "bg-[#ffdad6] text-[var(--color-primary-container)] hover:bg-[#ffb4ab]"
            )}
          >
            {isMapAuthorized ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            {isMapAuthorized ? "Map Authorized" : "Unlock Map Operations"}
          </button>
          {!isMapAuthorized && <p className="text-[10px] text-on-surface/60 mt-2 font-medium tracking-[0.02em] leading-tight px-1 text-center">Authorization required to draw, edit layers, and purge spatial data.</p>}
        </section>

        {/* Target Sector Selection */}
        <section>
          <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface/80 block mb-3">Target Sector</label>
          
          <div className="space-y-3">
            {/* Municipality Selector */}
            <div className="relative">
              <select 
                className="w-full bg-surface-container-lowest shadow-ambient border-none p-3 rounded-md text-sm text-on-surface focus:ring-0 outline-none transition-all font-medium appearance-none cursor-pointer hover:bg-surface-container"
                value={selectedMun}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedMun(val);
                  setSelectedBrgy('ALL');
                  if (val === 'ALL') {
                    flyTo([14.1167, 122.9500], 10);
                  } else {
                    const loc = MUNICIPALITIES.find(m => m.name === val);
                    if (loc) flyTo(loc.center, loc.zoom);
                  }
                }}
              >
                <option value="ALL">Province Overview</option>
                {MUNICIPALITIES.map((m) => (
                  <option key={m.name} value={m.name}>{m.name}</option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface/50">▼</div>
            </div>

            {/* Barangay Selector */}
            {selectedMun !== 'ALL' && (
              <div className="relative animate-in slide-in-from-top-2 fade-in duration-200">
                <select 
                  className="w-full bg-surface-container-lowest shadow-ambient border-none p-3 rounded-md text-sm text-on-surface focus:ring-0 outline-none transition-all font-medium appearance-none cursor-pointer hover:bg-surface-container"
                  value={selectedBrgy}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSelectedBrgy(val);

                    const mun = MUNICIPALITIES.find(m => m.name === selectedMun);
                    if (mun) {
                      if (val === 'ALL') {
                        flyTo(mun.center, mun.zoom);
                      } else {
                        const brgy = mun.barangaysFull?.find((b: any) => b.name === val);
                        if (brgy) {
                          flyTo([brgy.lat, brgy.lng], 15);
                        }
                      }
                    }
                  }}
                >
                  <option value="ALL">All Barangays ({selectedMun})</option>
                  {MUNICIPALITIES.find(m => m.name === selectedMun)?.barangays.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-on-surface/50">▼</div>
              </div>
            )}
          </div>
        </section>

        {/* Base Map Switcher */}
        <section>
          <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface/80 block mb-3">Topography Layer</label>
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => setBaseMap('street')}
              className={cn("w-full flex items-center justify-start gap-3 p-3 rounded-xl transition-all", baseMap === 'street' ? "bg-surface-container shadow-ambient text-tertiary font-bold" : "bg-transparent text-on-surface/80 hover:bg-surface-container-lowest hover:shadow-ambient")}
            >
              <MapIcon className="w-5 h-5 opacity-80" />
              <span className="text-[11px] uppercase tracking-[0.05em] font-bold">Urban Grid (OSM)</span>
            </button>
            <button 
              onClick={() => setBaseMap('topo')}
              className={cn("w-full flex items-center justify-start gap-3 p-3 rounded-xl transition-all", baseMap === 'topo' ? "bg-surface-container shadow-ambient text-tertiary font-bold" : "bg-transparent text-on-surface/80 hover:bg-surface-container-lowest hover:shadow-ambient")}
            >
              <Layers className="w-5 h-5 opacity-80" />
              <span className="text-[11px] uppercase tracking-[0.05em] font-bold">Topographic Contour</span>
            </button>
            <button 
              onClick={() => setBaseMap('satellite')}
              className={cn("w-full flex items-center justify-start gap-3 p-3 rounded-xl transition-all", baseMap === 'satellite' ? "bg-surface-container shadow-ambient text-tertiary font-bold" : "bg-transparent text-on-surface/80 hover:bg-surface-container-lowest hover:shadow-ambient")}
            >
              <Satellite className="w-5 h-5 opacity-80" />
              <span className="text-[11px] uppercase tracking-[0.05em] font-bold">ESRI Satellite</span>
            </button>
          </div>
        </section>

        {/* Hazard Filters */}
        <section>
          <label className="text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface/80 block mb-3">Active Filters</label>
          <div className="space-y-3">
            {DISASTER_TYPES.map(type => {
              const isActive = activeFilters.includes(type.id);
              return (
                <button
                  key={type.id}
                  onClick={() => toggleFilter(type.id)}
                  className={`w-full flex items-center justify-between cursor-pointer group p-3 rounded-xl shadow-ambient transition-all border-2 ${isActive ? 'border-primary bg-surface-container text-on-surface' : 'border-transparent bg-surface-container-lowest hover:bg-surface'}`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full transition-all" style={{ backgroundColor: type.color, boxShadow: isActive ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${type.color}` : 'none' }}></div>
                    <span className="text-sm font-semibold">{type.label}</span>
                  </div>
                  <Check size={16} className={isActive ? 'text-primary' : 'text-transparent'} />
                </button>
              );
            })}
          </div>
        </section>

        {/* Recent Updates */}
        <section>
          <button
            onClick={() => setIncidentLogsOpen(!incidentLogsOpen)}
            className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.05em] text-on-surface/80 block mb-3 hover:text-on-surface transition-colors"
          >
            <span className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-tertiary" /> Incident Logs
            </span>
            <ChevronDown
              size={14}
              className={`text-on-surface/50 transition-transform duration-200 ${incidentLogsOpen ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
          <AnimatePresence>
            {incidentLogsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="space-y-3">
                  {filteredHazards.slice().sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime()).slice(0, 5).map((h, i) => {
                    const typeDef = DISASTER_TYPES.find(t => t.id === h.type);
                    const bgClass = i % 2 === 0 ? 'bg-surface-container-lowest' : 'bg-surface';
                    return (
                      <div
                        key={h.id}
                        className={cn("p-4 rounded-xl cursor-pointer shadow-ambient transition-transform hover:-translate-y-1 relative overflow-hidden", bgClass)}
                        onClick={() => {
                          setSelectedHazard(h);
                          try {
                            if (h.geometry.type === 'Polygon' && h.geometry.coordinates?.[0]?.[0]) {
                               const coords = h.geometry.coordinates[0][0];
                               if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  storeFlyTo([coords[1], coords[0]], 14);
                               }
                            } else if (h.geometry.type === 'Point' && h.geometry.coordinates) {
                               const coords = h.geometry.coordinates;
                               if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  storeFlyTo([coords[1], coords[0]], 15);
                               }
                            } else if (h.geometry.type === 'LineString' && h.geometry.coordinates?.[0]) {
                               const coords = h.geometry.coordinates[0];
                               if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  storeFlyTo([coords[1], coords[0]], 14);
                               }
                            }
                          } catch (e) {
                            console.error("Invalid geometry for flyTo", e);
                          }
                        }}
                      >
                        <div className="absolute top-0 left-0 bottom-0 w-1.5" style={{ backgroundColor: typeDef?.color || 'var(--color-primary)' }} />
                        <div className="ml-2">
                          <p className="text-[10px] text-on-surface/50 font-bold tracking-[0.05em] uppercase mb-1">{format(new Date(h.dateAdded), 'HH:mm - MMM d')}</p>
                          <p className="text-sm font-display font-bold text-on-surface mb-1 leading-tight">{h.title || 'Untitled Area'}</p>
                          <p className="text-[10px] font-bold uppercase tracking-[0.05em] text-on-surface/60 mb-1">{typeDef?.label} &middot; {h.severity}</p>
                          <p className="text-xs text-on-surface/80 truncate">{h.notes || 'Status monitored.'}</p>
                        </div>
                      </div>
                    )
                  })}
                  {filteredHazards.length === 0 && (
                    <p className="text-[11px] text-on-surface/40 tracking-[0.05em] font-bold uppercase text-center py-6 bg-surface-container-lowest rounded-xl shadow-ambient">No Active Incidents</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      <div className="p-6 bg-surface-container">
        <button 
          onClick={handleExportPDF}
          disabled={exporting}
          className="w-full py-3 btn-primary font-bold text-[11px] uppercase tracking-[0.05em] disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {exporting ? (
            <span className="animate-pulse tracking-[0.1em]">Gathering Intel...</span>
          ) : (
            <>
              <Download className="w-4 h-4" /> Export Report
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
