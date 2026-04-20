import { useState, useEffect } from 'react';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { HazardAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit3, X, AlertTriangle, ShieldAlert } from 'lucide-react';

export function DropTagModal() {
  const { isDropTagModalOpen, dropTagTempGeometry, closeDropTagModal, setHazards } = useStore();
  const [type, setType] = useState('flood');
  const [severity, setSeverity] = useState('Moderate');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isDropTagModalOpen) {
      setType('flood');
      setSeverity('Moderate');
      setTitle('');
      setNotes('');
    }
  }, [isDropTagModalOpen]);

  const handleSave = async () => {
    setIsSaving(true);
    const newHazard = {
      id: uuidv4(),
      type,
      severity,
      title: title.trim() || 'Untitled Zone',
      notes,
      geometry: dropTagTempGeometry,
      dateAdded: new Date().toISOString()
    };
    
    await HazardAPI.addHazard(newHazard);
    const hazards = await HazardAPI.getAllHazards();
    setHazards(hazards);
    
    setIsSaving(false);
    closeDropTagModal();
  };

  if (!isDropTagModalOpen) return null;

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
              <AlertTriangle className="w-3 h-3" /> New Hazard Mapping
            </div>
            <h2 className="text-xl font-display font-bold text-on-surface">Locational Data Entry</h2>
          </div>
          <button onClick={closeDropTagModal} className="text-on-surface/40 hover:text-on-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-on-surface/60 uppercase tracking-[0.05em] mb-2">Area / Incident Title</label>
            <input 
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Brgy. Bagasbas Coastline"
              className="w-full bg-surface-container-lowest border border-outline-variant p-2 text-sm rounded-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary text-on-surface transition-colors font-medium"
            />
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
        </div>

        <div className="mt-6">
          <button 
            onClick={handleSave}
            disabled={isSaving}
            className="w-full py-3 btn-primary font-bold text-[11px] uppercase tracking-[0.05em] shadow-ambient disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isSaving ? 'Locking Data...' : 'Lock Zone Data'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export function PopUpCard() {
  const { selectedHazard, setSelectedHazard, openPinModal, isMapAuthorized } = useStore();

  if (!selectedHazard) return null;

  const typeDef = DISASTER_TYPES.find(t => t.id === selectedHazard.type);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="absolute bottom-6 right-6 z-[400] w-80 bg-surface-container-lowest shadow-ambient overflow-hidden rounded-xl border border-white/50"
    >
      <div 
        className="h-1.5 w-full" 
        style={{ backgroundColor: typeDef?.color }}
      />
      <div className="p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <div className="text-[10px] uppercase text-tertiary mb-1 font-bold tracking-[0.05em]">Active Hazard Profile</div>
            <h3 className="text-xl font-display font-bold text-on-surface leading-tight mb-1">
              {selectedHazard.title || typeDef?.label}
            </h3>
            <p className="text-xs font-semibold text-on-surface/60 mb-3">{typeDef?.label}</p>
            <span className={`inline-block px-3 py-1 text-[10px] uppercase tracking-[0.05em] font-bold rounded-sm border ${
              selectedHazard.severity === 'Critical' ? 'bg-error-container text-[var(--color-primary-container)] border-error-container' :
              selectedHazard.severity === 'Severe' ? 'bg-[#ffe4cc] text-[#ea580c] border-transparent' :
              selectedHazard.severity === 'Moderate' ? 'bg-[#fef3c7] text-[#ca8a04] border-transparent' :
              'bg-surface-container text-tertiary border-transparent'
            }`}>
              {selectedHazard.severity}
            </span>
          </div>
          <button onClick={() => setSelectedHazard(null)} className="text-on-surface/40 hover:text-on-surface transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-4 mb-6">
          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Timestamp</p>
            <p className="text-sm text-on-surface/80 font-sans font-medium mt-1">{format(new Date(selectedHazard.dateAdded), 'MM/dd/yyyy HH:mm:ss')}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Field Context</p>
            <p className="text-xs text-on-surface/80 leading-relaxed bg-surface-container-low p-3 mt-1 rounded-sm border border-outline-variant/30 font-medium whitespace-pre-wrap">
              {selectedHazard.notes || <span className="italic text-on-surface/40">No operational notes provided.</span>}
            </p>
          </div>
          {selectedHazard.syncStatus && selectedHazard.syncStatus !== 'synced' && (
             <div>
               <p className="text-[9px] uppercase font-bold text-primary tracking-[0.05em] flex items-center gap-1">
                 <AlertTriangle size={10}/> Local Buffer Active
               </p>
             </div>
          )}
        </div>

        {isMapAuthorized && (
          <div className="flex flex-col gap-3">
            <button 
              onClick={() => {
                alert("Use the Geoman toolbar on the left to drag corners/edit coordinates. Geometry changes will be saved automatically upon completion.");
              }}
              className="w-full flex items-center justify-center gap-2 bg-transparent hover:bg-surface-container text-tertiary border border-surface-container py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors rounded-md"
            >
              <Edit3 className="w-4 h-4" /> Modify Record
            </button>
            <button 
              onClick={() => openPinModal('delete', selectedHazard.id)}
              className="w-full flex items-center justify-center gap-2 bg-error-container/50 text-[var(--color-primary-container)] hover:bg-[#ffdad6] py-2.5 text-[11px] font-bold uppercase tracking-[0.05em] transition-colors rounded-md"
            >
              <Trash2 className="w-4 h-4" /> Purge Record
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function PinModal() {
  const { isPinModalOpen, pinActionType, pinActionData, closePinModal, setHazards, setSelectedHazard, setMapAuthorized } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const CORRECT_PIN = '1234';

  useEffect(() => {
    if (isPinModalOpen) {
      setPin('');
      setError(false);
    }
  }, [isPinModalOpen]);

  useEffect(() => {
    if (pin.length === 4) {
      if (pin === CORRECT_PIN) {
        if (pinActionType === 'delete') {
          handleDelete();
        } else if (pinActionType === 'unlock') {
          handleUnlock();
        }
      } else {
        setError(true);
        setTimeout(() => {
          setPin('');
          setError(false);
        }, 500);
      }
    }
  }, [pin]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isPinModalOpen) return;
      if (e.key >= '0' && e.key <= '9') {
        if (pin.length < 4 && !error) {
          setPin(prev => prev + e.key);
        }
      } else if (e.key === 'Backspace') {
        setPin(prev => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        closePinModal();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isPinModalOpen, pin, error]);

  const handleDelete = async () => {
    if (pinActionData) {
      await HazardAPI.deleteHazard(pinActionData);
      const hazards = await HazardAPI.getAllHazards();
      setHazards(hazards);
      setSelectedHazard(null);
    }
    closePinModal();
  };

  const handleUnlock = () => {
    setMapAuthorized(true);
    closePinModal();
  };

  const handleKeyPress = (num: string) => {
    if (pin.length < 4 && !error) {
      setPin(prev => prev + num);
    }
  };

  if (!isPinModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm">
      <motion.div 
        animate={error ? { x: [-10, 10, -10, 10, 0] } : {}}
        transition={{ duration: 0.3 }}
        className="w-80 bg-surface-container-lowest shadow-ambient rounded-xl p-8 relative border border-white/50"
      >
        <button onClick={closePinModal} className="absolute top-4 right-4 text-on-surface/40 hover:text-on-surface">
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-14 h-14 bg-error-container text-[var(--color-primary-container)] rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4 shadow-[0_4px_12px_rgba(183,0,17,0.1)]">
            {pinActionType === 'unlock' ? <ShieldAlert className="w-6 h-6" /> : '!'}
          </div>
          <h2 className="text-xl font-display font-bold tracking-tight text-on-surface">Verification Required</h2>
          <p className="text-[11px] text-on-surface/60 mt-2 font-medium uppercase tracking-[0.05em]">
            {pinActionType === 'unlock' 
              ? 'Enter 4-digit security PIN to unlock map operations.' 
              : 'Enter 4-digit security PIN to authorize purge command.'}
          </p>
        </div>

        {/* PIN Indicators */}
        <div className="flex justify-center gap-3 mb-8">
          {[0, 1, 2, 3].map(i => (
            <div 
              key={i} 
              className={`w-3.5 h-3.5 rounded-full transition-all duration-200 border ${
                pin.length > i 
                  ? error ? 'bg-primary border-primary' : 'bg-tertiary border-tertiary shadow-[0_0_8px_rgba(0,94,145,0.4)]' 
                  : 'bg-transparent border-on-surface/20'
              }`} 
            />
          ))}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
            <button
              key={num}
              onClick={() => handleKeyPress(num.toString())}
              className="h-14 bg-surface-container-low hover:bg-surface-container shadow-sm flex items-center justify-center font-display font-bold text-xl text-on-surface rounded-md transition-colors"
            >
              {num}
            </button>
          ))}
          <button
            onClick={() => handleKeyPress('0')}
            className="h-14 bg-surface-container-low hover:bg-surface-container shadow-sm flex items-center justify-center font-display font-bold text-xl text-on-surface rounded-md transition-colors col-start-2"
          >
            0
          </button>
          <button
            onClick={() => setPin(prev => prev.slice(0, -1))}
            className="h-14 bg-transparent hover:bg-error-container text-on-surface/40 hover:text-primary flex items-center justify-center transition-colors rounded-md"
          >
            <Trash2 className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
