import { useState, useEffect, useRef } from 'react';
import { useStore } from '../lib/store';
import { EvacuationCenterAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';
import { motion } from 'framer-motion';
import { X, MapPin } from 'lucide-react';
import { detectLocationFromGeometry } from '../lib/utils';

const CENTER_TYPES = [
  { id: 'school', label: 'School' },
  { id: 'barangay_hall', label: 'Barangay Hall' },
  { id: 'church', label: 'Church' },
  { id: 'covered_court', label: 'Covered Court' },
  { id: 'other', label: 'Other' },
];

export function EvacuationCenterModal() {
  const {
    isEvacuationCenterModalOpen,
    evacuationCenterTempCoords,
    closeEvacuationCenterModal,
    setEvacuationCenters,
  } = useStore();

  const [name, setName] = useState('');
  const [type, setType] = useState<'school' | 'barangay_hall' | 'church' | 'covered_court' | 'other'>('barangay_hall');
  const [capacity, setCapacity] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const detectStartedRef = useRef(false);

  useEffect(() => {
    if (isEvacuationCenterModalOpen) {
      setName('');
      setType('barangay_hall');
      setCapacity('');
      setMunicipality('');
      setBarangay('');
      setIsDetecting(true);
      detectStartedRef.current = false;
    }
  }, [isEvacuationCenterModalOpen]);

  useEffect(() => {
    if (!isEvacuationCenterModalOpen || !evacuationCenterTempCoords || detectStartedRef.current) return;
    if (municipality || barangay) return;

    detectStartedRef.current = true;
    const geometry = {
      type: 'Point',
      coordinates: [evacuationCenterTempCoords[0], evacuationCenterTempCoords[1]]
    };
    detectLocationFromGeometry(geometry).then((location) => {
      if (location) {
        setMunicipality(location.municipality);
        setBarangay(location.barangay);
      }
      setIsDetecting(false);
    });
  }, [isEvacuationCenterModalOpen, evacuationCenterTempCoords]);

  const handleSave = async () => {
    const parsedCapacity = parseInt(capacity, 10);
    if (!name.trim() || !evacuationCenterTempCoords || isNaN(parsedCapacity) || parsedCapacity <= 0) return;
    setIsSaving(true);
    try {
      const newCenter = {
        id: uuidv4(),
        name: name.trim(),
        type,
        capacity: parsedCapacity,
        municipality,
        barangay,
        coordinates: evacuationCenterTempCoords,
        dateAdded: new Date().toISOString()
      };
      await EvacuationCenterAPI.addCenter(newCenter);
      const centers = await EvacuationCenterAPI.getAllCenters();
      setEvacuationCenters(centers);
      closeEvacuationCenterModal();
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEvacuationCenterModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-surface-container-highest shadow-ambient w-full max-w-sm overflow-hidden text-on-surface rounded-xl p-6 relative border border-white/50"
      >
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] uppercase text-primary mb-1 font-bold tracking-[0.05em] flex items-center gap-2">
              <MapPin className="w-3 h-3" /> New Evacuation Center
            </div>
            <h2 className="text-xl font-display font-bold text-on-surface">Add Evacuation Center</h2>
          </div>
          <button onClick={closeEvacuationCenterModal} className="text-on-surface/40 hover:text-on-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Center Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. San Jose Elementary School"
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as any)}
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface font-medium transition-colors"
            >
              {CENTER_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Capacity (persons)</label>
            <input
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="e.g. 150"
              min="1"
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Municipality</label>
              <input
                type="text"
                value={municipality}
                onChange={(e) => setMunicipality(e.target.value)}
                placeholder={isDetecting ? 'Detecting...' : 'Municipality'}
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Barangay</label>
              <input
                type="text"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                placeholder={isDetecting ? 'Detecting...' : 'Barangay'}
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !evacuationCenterTempCoords || !capacity || parseInt(capacity, 10) <= 0}
            className="w-full py-3 btn-primary font-bold text-[11px] uppercase tracking-[0.05em] shadow-ambient disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? 'Saving...' : !name.trim() ? 'Name Required' : !capacity || parseInt(capacity, 10) <= 0 ? 'Valid Capacity Required' : 'Save Center'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}