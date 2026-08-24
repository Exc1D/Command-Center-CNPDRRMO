import { motion } from 'framer-motion';
import { useStore } from '../lib/store';
import { X, Users, MapPin, Trash2 } from 'lucide-react';
import { formatDate } from '../lib/utils';
import { EvacuationCenterAPI } from '../lib/api';

const CENTER_TYPE_LABELS: Record<string, string> = {
  school: 'School',
  barangay_hall: 'Barangay Hall',
  church: 'Church',
  covered_court: 'Covered Court',
  other: 'Other',
};

export function EvacuationCenterCard() {
  const { selectedEvacuationCenter, setSelectedEvacuationCenter, isMapAuthorized, setEvacuationCenters } = useStore();

  if (!selectedEvacuationCenter) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-6 right-6 z-[400] w-80 bg-surface-container-lowest shadow-ambient overflow-hidden rounded-xl border border-white/50"
    >
      <div className="h-1.5 w-full bg-[#059669]" />
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
              <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Capacity</p>
              <p className="text-sm text-on-surface/80 font-medium">{selectedEvacuationCenter.capacity} persons</p>
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
