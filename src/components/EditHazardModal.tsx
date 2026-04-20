import { useState, useEffect } from 'react';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { HazardAPI } from '../lib/api';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

export function EditHazardModal() {
  const { isEditModalOpen, editModalHazard, closeEditModal, setHazards, setMapAuthorized } = useStore();
  const [type, setType] = useState('flood');
  const [severity, setSeverity] = useState('Moderate');
  const [title, setTitle] = useState('');
  const [municipality, setMunicipality] = useState('');
  const [barangay, setBarangay] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isEditModalOpen && editModalHazard) {
      setType(editModalHazard.type || 'flood');
      setSeverity(editModalHazard.severity || 'Moderate');
      setTitle(editModalHazard.title || '');
      setMunicipality(editModalHazard.municipality || '');
      setBarangay(editModalHazard.barangay || '');
      setNotes(editModalHazard.notes || '');
      setMapAuthorized(true);
    }
  }, [isEditModalOpen, editModalHazard, setMapAuthorized]);

  const handleSave = async () => {
    if (!editModalHazard) return;
    setIsSaving(true);

    const updatedHazard = {
      id: editModalHazard.id,
      type,
      severity,
      title: title.trim() || editModalHazard.title || 'Untitled Zone',
      municipality,
      barangay,
      notes,
      geometry: editModalHazard.geometry,
      dateAdded: editModalHazard.dateAdded,
    };

    await HazardAPI.updateHazard(updatedHazard);
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);

    setIsSaving(false);
    closeEditModal();
  };

  if (!isEditModalOpen || !editModalHazard) return null;

  const typeDef = DISASTER_TYPES.find(t => t.id === editModalHazard.type);

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
              <AlertTriangle className="w-3 h-3" /> Edit Hazard Record
            </div>
            <h2 className="text-xl font-display font-bold text-on-surface">Modify Incident Data</h2>
          </div>
          <button onClick={closeEditModal} className="text-on-surface/40 hover:text-on-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Incident Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Brgy. Bagasbas Coastline"
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
                placeholder="Municipality"
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Barangay</label>
              <input
                type="text"
                value={barangay}
                onChange={(e) => setBarangay(e.target.value)}
                placeholder="Barangay"
                className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Disaster Type</label>
            <div className="grid grid-cols-2 gap-2">
              {DISASTER_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setType(t.id)}
                  className={`py-2 px-3 text-[11px] text-left rounded-md tracking-[0.05em] uppercase transition-all flex items-center gap-2 font-bold ${
                    type === t.id
                      ? 'bg-surface-container shadow-ambient text-tertiary border border-transparent'
                      : 'bg-surface-container-lowest border border-outline-variant text-on-surface/60 hover:bg-surface-container hover:text-on-surface'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.1)]" style={{ backgroundColor: t.color }}></span>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Severity Level</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface font-medium transition-colors"
            >
              <option value="Minor">Minor / Monitoring</option>
              <option value="Moderate">Moderate / Alert</option>
              <option value="Severe">Severe / Evacuation</option>
              <option value="Critical">Critical / Life-Threatening</option>
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Intelligence / Field Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Provide observational context..."
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface resize-none transition-colors"
            />
          </div>

          <div className="p-3 bg-surface-container-low rounded-sm border border-outline-variant/30">
            <p className="text-[10px] uppercase font-bold text-on-surface/50 tracking-[0.05em] mb-1">Geometry</p>
            <p className="text-xs text-on-surface/70">
              Use the Geoman toolbar on the map to drag corners and edit coordinates. Changes auto-save on completion.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-3 btn-primary font-bold text-[11px] uppercase tracking-[0.05em] shadow-ambient disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
