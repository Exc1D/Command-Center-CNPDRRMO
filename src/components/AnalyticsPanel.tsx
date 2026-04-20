import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { X, BarChart2, Table as TableIcon, List as ListIcon, Search } from 'lucide-react';
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';
import { format } from 'date-fns';

const SEVERITY_COLORS: Record<string, string> = {
  Minor: '#9ca3af',
  Moderate: '#fbbf24',
  Severe: '#f97316',
  Critical: '#ef4444',
};

const SEVERITY_OPTIONS = [
  { id: 'Minor', label: 'Minor', bgClass: 'bg-surface-container', textClass: 'text-tertiary' },
  { id: 'Moderate', label: 'Moderate', bgClass: 'bg-[#fef3c7]', textClass: 'text-[#ca8a04]' },
  { id: 'Severe', label: 'Severe', bgClass: 'bg-[#ffe4cc]', textClass: 'text-[#ea580c]' },
  { id: 'Critical', label: 'Critical', bgClass: 'bg-error-container', textClass: 'text-[var(--color-primary-container)]' },
];

export function AnalyticsPanel() {
  const { isAnalyticsOpen, setAnalyticsOpen, filteredHazards, flyTo, setSelectedHazard } = useStore();
  const [activeTab, setActiveTab] = useState<'chart' | 'table' | 'list'>('chart');
  const [activeSeverities, setActiveSeverities] = useState<string[]>(['Minor', 'Moderate', 'Severe', 'Critical']);
  const [searchQuery, setSearchQuery] = useState('');

  if (!isAnalyticsOpen) return null;

  const severityData = SEVERITY_OPTIONS.map(s => ({
    name: s.id,
    value: filteredHazards.filter(h => h.severity === s.id).length,
    color: SEVERITY_COLORS[s.id],
  })).filter(d => d.value > 0);

  const summaryData = (() => {
    const groups: Record<string, Record<string, number>> = {};
    for (const h of filteredHazards) {
      const loc = `${h.municipality || 'Unknown'}, ${h.barangay || 'Unknown'}`;
      if (!groups[loc]) groups[loc] = {};
      groups[loc][h.severity] = (groups[loc][h.severity] || 0) + 1;
    }
    return Object.entries(groups).map(([location, severities]) => ({
      location,
      severities,
      total: Object.values(severities).reduce((a, b) => a + b, 0),
    }));
  })();

  return (
    <AnimatePresence>
      <motion.aside
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="absolute top-4 right-4 bottom-4 w-[450px] bg-surface-container-low shadow-ambient rounded-2xl border border-white/50 flex flex-col overflow-hidden z-[500] pointer-events-auto"
      >
        <div className="p-6 pb-4 border-b border-outline-variant/30 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-primary mb-1 font-bold tracking-[0.05em]">Provincial DRRMC</div>
            <h2 className="text-xl font-display font-bold text-on-surface">Data Analytics</h2>
          </div>
          <button 
            onClick={() => setAnalyticsOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-container hover:bg-surface-container-high transition-colors text-on-surface/60 hover:text-on-surface"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-outline-variant/30">
          <button 
            onClick={() => setActiveTab('chart')}
            className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors flex justify-center items-center gap-2 ${activeTab === 'chart' ? 'text-primary bg-surface-container border-b-2 border-primary' : 'text-on-surface/50 hover:bg-surface-container-lowest'}`}
          >
            <BarChart2 size={14} /> Chart
          </button>
          <button 
            onClick={() => setActiveTab('table')}
            className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors flex justify-center items-center gap-2 ${activeTab === 'table' ? 'text-primary bg-surface-container border-b-2 border-primary' : 'text-on-surface/50 hover:bg-surface-container-lowest'}`}
          >
            <TableIcon size={14} /> Table
          </button>
          <button 
            onClick={() => setActiveTab('list')}
            className={`flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors flex justify-center items-center gap-2 ${activeTab === 'list' ? 'text-primary bg-surface-container border-b-2 border-primary' : 'text-on-surface/50 hover:bg-surface-container-lowest'}`}
          >
            <ListIcon size={14} /> List
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-surface">
          {activeTab === 'chart' && (
            <div className="h-full flex flex-col">
              <h3 className="text-sm font-bold text-on-surface mb-6 uppercase tracking-[0.05em]">Severity Distribution</h3>
              {severityData.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-on-surface/40 text-sm font-medium">No active data points</div>
              ) : (
                <div className="flex-1 min-h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={severityData}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={100}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {severityData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: 'var(--color-surface-container-highest)', border: '1px solid var(--color-outline-variant)', borderRadius: '8px', fontSize: '12px', fontWeight: 'bold' }}
                      />
                      <Legend
                        verticalAlign="bottom"
                        height={36}
                        formatter={(value) => <span style={{ color: 'var(--color-on-surface)', fontSize: '11px', fontWeight: 600 }}>{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {activeTab === 'table' && (
            <div className="h-full flex flex-col">
              <h3 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-[0.05em]">Summary Matrix</h3>
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-container-low border-b border-outline-variant">
                    <tr>
                      <th className="p-3 text-[10px] uppercase text-on-surface/60 font-bold tracking-[0.05em]">Location</th>
                      <th className="p-3 text-[10px] uppercase text-on-surface/60 font-bold tracking-[0.05em]">Severity Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/30">
                    {summaryData.map((row, idx) => (
                      <tr key={idx} className="hover:bg-surface-container-lowest transition-colors">
                        <td className="p-3 font-semibold text-on-surface">{row.location}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(row.severities).map(([sev, count]) => (
                              <span
                                key={sev}
                                className={`text-[9px] uppercase tracking-[0.05em] font-bold px-2 py-0.5 rounded-sm border ${
                                  sev === 'Critical' ? 'bg-error-container text-[var(--color-primary-container)] border-error-container' :
                                  sev === 'Severe' ? 'bg-[#ffe4cc] text-[#ea580c] border-transparent' :
                                  sev === 'Moderate' ? 'bg-[#fef3c7] text-[#ca8a04] border-transparent' :
                                  'bg-surface-container text-tertiary border-transparent'
                                }`}
                              >
                                {sev}: {count}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredHazards.length === 0 && (
                      <tr>
                        <td colSpan={2} className="p-6 text-center text-on-surface/40 font-medium text-xs">No active data points</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'list' && (
            <div className="h-full flex flex-col">
              <h3 className="text-sm font-bold text-on-surface mb-4 uppercase tracking-[0.05em]">Raw Feed</h3>

              <div className="mb-4 space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/40" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search incidents..."
                    className="w-full bg-surface-container-lowest border border-outline-variant pl-9 pr-3 py-2 text-sm rounded-lg text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:border-primary transition-colors"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  {SEVERITY_OPTIONS.map(s => {
                    const isActive = activeSeverities.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        onClick={() => {
                          setActiveSeverities(prev =>
                            isActive ? prev.filter(x => x !== s.id) : [...prev, s.id]
                          );
                        }}
                        className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.05em] rounded-sm border transition-all ${isActive ? `${s.bgClass} ${s.textClass} border-current` : 'bg-surface-container-lowest border-outline-variant text-on-surface/50 hover:bg-surface-container'}`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {filteredHazards.length === 0 ? (
                  <div className="p-6 text-center text-on-surface/40 font-medium text-xs bg-surface-container-lowest rounded-xl border border-outline-variant">No incidents reported</div>
                ) : (
                  filteredHazards
                    .filter(h => activeSeverities.includes(h.severity))
                    .filter(h => {
                      if (!searchQuery.trim()) return true;
                      const q = searchQuery.toLowerCase();
                      return (h.title || '').toLowerCase().includes(q) || (h.notes || '').toLowerCase().includes(q);
                    })
                    .map(h => {
                      const tDef = DISASTER_TYPES.find(t => t.id === h.type);
                      return (
                        <div
                          key={h.id}
                          onClick={() => {
                            setSelectedHazard(h);
                            try {
                              if (h.geometry.type === 'Polygon' && h.geometry.coordinates?.[0]?.[0]) {
                                const coords = h.geometry.coordinates[0][0];
                                if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  flyTo([coords[1], coords[0]], 14);
                                }
                              } else if (h.geometry.type === 'Point' && h.geometry.coordinates) {
                                const coords = h.geometry.coordinates;
                                if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  flyTo([coords[1], coords[0]], 15);
                                }
                              } else if (h.geometry.type === 'LineString' && h.geometry.coordinates?.[0]) {
                                const coords = h.geometry.coordinates[0];
                                if (coords && typeof coords[1] === 'number' && typeof coords[0] === 'number') {
                                  flyTo([coords[1], coords[0]], 14);
                                }
                              }
                            } catch (e) {
                              console.error("Invalid geometry for flyTo", e);
                            }
                          }}
                          className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/50 hover:border-outline-variant transition-colors group cursor-pointer"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full shadow-sm" style={{ backgroundColor: tDef?.color }}></span>
                              <span className="text-[10px] uppercase font-bold text-on-surface/60 tracking-[0.05em]">{tDef?.label}</span>
                            </div>
                            <span className={`text-[9px] uppercase tracking-[0.05em] font-bold px-2 py-0.5 rounded-sm border ${
                              h.severity === 'Critical' ? 'bg-error-container text-[var(--color-primary-container)] border-error-container' :
                              h.severity === 'Severe' ? 'bg-[#ffe4cc] text-[#ea580c] border-transparent' :
                              h.severity === 'Moderate' ? 'bg-[#fef3c7] text-[#ca8a04] border-transparent' :
                              'bg-surface-container text-tertiary border-transparent'
                            }`}>
                              {h.severity}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-on-surface mb-2 leading-tight">{h.title || 'Untitled Incident'}</h4>
                          {h.notes && (
                            <p className="text-xs text-on-surface/70 leading-relaxed line-clamp-2 bg-surface-container-low p-2 rounded-sm mb-3">
                              {h.notes}
                            </p>
                          )}
                          <div className="text-[9px] uppercase font-bold text-on-surface/40 tracking-[0.05em]">
                            Logged: {format(new Date(h.dateAdded), 'MM/dd/yyyy HH:mm')}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}
        </div>
      </motion.aside>
    </AnimatePresence>
  );
}
