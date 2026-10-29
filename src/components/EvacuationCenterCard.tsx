import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { X, Users, MapPin, Trash2 } from 'lucide-react';
import { CENTER_STATUS, centerOccupancyTone, formatDate } from '../lib/utils';
import { EvacuationCenterAPI } from '../lib/api';
import type { EvacuationCenter } from '../lib/db';

const CENTER_TYPE_LABELS: Record<string, string> = {
  school: 'School',
  barangay_hall: 'Barangay Hall',
  church: 'Church',
  covered_court: 'Covered Court',
  other: 'Other',
};

const COUNT_FIELDS = [
  ['familiesNow', 'Families now'],
  ['personsNow', 'Persons now'],
  ['familiesCumulative', 'Families cumulative'],
  ['personsCumulative', 'Persons cumulative'],
] as const;

function OccupancyEditor({ center }: { center: EvacuationCenter }) {
  const { setEvacuationCenters, setSelectedEvacuationCenter } = useStore();
  const [status, setStatus] = useState(center.status ?? 'standby');
  const [counts, setCounts] = useState(() => Object.fromEntries(COUNT_FIELDS.map(([field]) => [field, center[field] ?? 0])) as Record<typeof COUNT_FIELDS[number][0], number>);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { syncStatus: _syncStatus, conflictData: _conflictData, ...base } = center;
      // Cumulative counts everyone ever served, so it can never trail the current headcount.
      await EvacuationCenterAPI.updateCenter({
        ...base,
        ...counts,
        status,
        familiesCumulative: Math.max(counts.familiesCumulative, counts.familiesNow),
        personsCumulative: Math.max(counts.personsCumulative, counts.personsNow),
        occupancyUpdatedAt: new Date().toISOString(),
      });
      const centers = await EvacuationCenterAPI.getAllCenters();
      setEvacuationCenters(centers);
      setSelectedEvacuationCenter(centers.find(item => item.id === center.id) ?? null);
    } catch { /* the shared sync banner reports authorization and validation failures */ }
    setSaving(false);
  };

  return (
    <div className="mb-4 space-y-3 rounded-lg bg-surface-container p-3">
      <label className="block text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">
        Status
        <select value={status} onChange={event => setStatus(event.target.value as typeof status)} className="mt-1 w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm text-on-surface font-medium normal-case tracking-normal">
          {Object.entries(CENTER_STATUS).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        {COUNT_FIELDS.map(([field, label]) => (
          <label key={field} className="block text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">
            {label}
            <input type="number" min={0} step={1} inputMode="numeric" value={counts[field]}
              onChange={event => setCounts(current => ({ ...current, [field]: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))}
              className="mt-1 w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm text-on-surface font-medium" />
          </label>
        ))}
      </div>
      <button onClick={save} disabled={saving} className="w-full bg-primary text-on-primary rounded py-2 text-xs font-bold disabled:opacity-40">
        {saving ? 'Saving…' : 'Update occupancy'}
      </button>
    </div>
  );
}

export function EvacuationCenterCard() {
  const { selectedEvacuationCenter, setSelectedEvacuationCenter, isMapAuthorized, setEvacuationCenters } = useStore();

  if (!selectedEvacuationCenter) return null;

  return (
    <motion.div
      key={selectedEvacuationCenter.id}
      initial={{ opacity: 0, y: 24, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 24, scale: 0.94 }}
      style={{ transformOrigin: 'bottom right' }}
      className="absolute bottom-6 right-6 z-[400] w-80 bg-surface-container-lowest shadow-ambient overflow-hidden rounded-xl border border-white/50"
    >
      <div className="h-1.5 w-full" style={{ background: centerOccupancyTone(selectedEvacuationCenter).color }} />
      <div className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] uppercase text-tertiary mb-1 font-bold tracking-[0.05em]">Evacuation Center</div>
            <h3 className="text-xl font-display font-bold text-on-surface leading-tight">
              {selectedEvacuationCenter.name}
            </h3>
            <p className="text-xs font-semibold text-on-surface/60 mb-3">{CENTER_TYPE_LABELS[selectedEvacuationCenter.type] ?? 'Other'}</p>
          </div>
          <button
            onClick={() => setSelectedEvacuationCenter(null)}
            className="text-on-surface/40 hover:text-on-surface transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 mb-6">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-on-surface/50" />
            <div>
              <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">{centerOccupancyTone(selectedEvacuationCenter).label}</p>
              <p className="text-sm text-on-surface/80 font-medium">
                {selectedEvacuationCenter.personsNow ?? 0} / {selectedEvacuationCenter.capacity} persons · {selectedEvacuationCenter.familiesNow ?? 0} families
              </p>
              <p className="text-xs text-on-surface/60">
                Served so far: {selectedEvacuationCenter.personsCumulative ?? 0} persons · {selectedEvacuationCenter.familiesCumulative ?? 0} families
              </p>
              {selectedEvacuationCenter.occupancyUpdatedAt && <p className="text-xs text-on-surface/50">
                Updated {formatDate(selectedEvacuationCenter.occupancyUpdatedAt, 'MM/dd/yyyy HH:mm')}
              </p>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-on-surface/50" />
            <div>
              <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Location</p>
              <p className="text-sm text-on-surface/80 font-medium">
                {selectedEvacuationCenter.barangay}{selectedEvacuationCenter.municipality ? `, ${selectedEvacuationCenter.municipality}` : ''}
              </p>
            </div>
          </div>

          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Date Added</p>
            <p className="text-sm text-on-surface/80 font-sans font-medium mt-1">
              {formatDate(selectedEvacuationCenter.dateAdded, 'MM/dd/yyyy HH:mm:ss')}
            </p>
          </div>
        </div>

        {isMapAuthorized && selectedEvacuationCenter.syncStatus !== 'conflict' && <OccupancyEditor key={`${selectedEvacuationCenter.id}:${selectedEvacuationCenter.version}`} center={selectedEvacuationCenter} />}

        {selectedEvacuationCenter.syncStatus && !['synced', 'conflict'].includes(selectedEvacuationCenter.syncStatus) && (
          <div className="text-[9px] uppercase font-bold text-primary tracking-[0.05em] flex items-center gap-1">
            Local Buffer Active
          </div>
        )}
        {selectedEvacuationCenter.syncStatus === 'conflict' && <div className="rounded bg-error-container p-3 text-[10px] mb-3">
          <p className="font-bold uppercase mb-2">Sync conflict — server version shown</p>
          <div className="flex gap-2">
            <button className="flex-1 bg-surface-container-lowest rounded p-2 font-bold" onClick={async () => {
              await EvacuationCenterAPI.acceptCenterConflict(selectedEvacuationCenter.id);
              const centers = await EvacuationCenterAPI.getAllCenters();
              setEvacuationCenters(centers);
              setSelectedEvacuationCenter(centers.find(item => item.id === selectedEvacuationCenter.id) ?? null);
            }}>Keep server</button>
            <button disabled={!isMapAuthorized} className="flex-1 bg-primary text-on-primary rounded p-2 font-bold disabled:opacity-40" onClick={async () => {
              await EvacuationCenterAPI.applyCenterConflict(selectedEvacuationCenter.id);
              const centers = await EvacuationCenterAPI.getAllCenters();
              setEvacuationCenters(centers);
              setSelectedEvacuationCenter(centers.find(item => item.id === selectedEvacuationCenter.id) ?? null);
            }}>Apply local</button>
          </div>
        </div>}
        {isMapAuthorized && <button onClick={async () => {
          if (!confirm(`Delete evacuation center “${selectedEvacuationCenter.name}”?`)) return;
          try {
            await EvacuationCenterAPI.deleteCenter(selectedEvacuationCenter.id);
            setEvacuationCenters(await EvacuationCenterAPI.getAllCenters());
            setSelectedEvacuationCenter(null);
          } catch { /* the shared sync banner reports authorization and validation failures */ }
        }} className="mt-4 w-full flex items-center justify-center gap-2 bg-error-container py-2 rounded text-xs font-bold"><Trash2 size={14} />Delete center</button>}
      </div>
    </motion.div>
  );
}
