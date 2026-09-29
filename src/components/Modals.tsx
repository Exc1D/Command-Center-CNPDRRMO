import { IncidentForm } from './IncidentForm';
import { hazardDefinition } from '../lib/reference';
import { useState, useEffect } from 'react';
import { useStore, DISASTER_TYPES } from '../lib/store';
import { HazardAPI } from '../lib/api';
import { v4 as uuidv4 } from 'uuid';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Edit3, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { detectLocationFromGeometry, formatDate } from '../lib/utils';

export function DropTagModal() {
  const {isDropTagModalOpen,dropTagTempGeometry,closeDropTagModal}=useStore();
  return isDropTagModalOpen ? <IncidentForm geometry={dropTagTempGeometry} onClose={closeDropTagModal}/> : null;
}

export function PopUpCard() {
  const { selectedHazard, setSelectedHazard, setHazards, openPinModal, openEditModal, isMapAuthorized } = useStore();

  if (!selectedHazard) return null;

  const typeDef = hazardDefinition(selectedHazard.type);

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
        
        <div className="space-y-4 mb-6"><p className="text-sm">{selectedHazard.municipality || "Location unknown"} · {selectedHazard.barangay || "Barangay unknown"}</p><p className="text-sm">Affected population: {selectedHazard.affectedPopulation == null ? "Unknown" : selectedHazard.affectedPopulation.toLocaleString()} {selectedHazard.affectedPopulationBasis === "population_estimate" && "(provisional population estimate)"}</p>
          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Timestamp</p>
            <p className="text-sm text-on-surface/80 font-sans font-medium mt-1">{formatDate(selectedHazard.dateAdded, 'MM/dd/yyyy HH:mm:ss')}</p>
          </div>
          <div>
            <p className="text-[9px] uppercase font-bold text-on-surface/50 tracking-[0.05em]">Field Context</p>
            <p className="text-xs text-on-surface/80 leading-relaxed bg-surface-container-low p-3 mt-1 rounded-sm border border-outline-variant/30 font-medium whitespace-pre-wrap">
              {selectedHazard.notes || <span className="italic text-on-surface/40">No operational notes provided.</span>}
            </p>
          </div>
          {selectedHazard.syncStatus && selectedHazard.syncStatus !== 'synced' && selectedHazard.syncStatus !== 'conflict' && (
             <div>
               <p className="text-[9px] uppercase font-bold text-primary tracking-[0.05em] flex items-center gap-1">
                 <AlertTriangle size={10}/> Local Buffer Active
               </p>
             </div>
          )}
          {selectedHazard.syncStatus === 'conflict' && (
            <div className="rounded-sm bg-error-container p-3 text-[10px]">
              <p className="font-bold uppercase mb-2"><AlertTriangle size={10} className="inline mr-1" />Sync conflict — server version shown</p>
              <div className="flex gap-2">
                <button className="flex-1 bg-surface-container-lowest rounded p-2 font-bold" onClick={async () => {
                  await HazardAPI.acceptHazardConflict(selectedHazard.id);
                  const hazards = await HazardAPI.getAllHazards();
                  setHazards(hazards);
                  setSelectedHazard(hazards.find(item => item.id === selectedHazard.id) ?? null);
                }}>Keep server</button>
                <button disabled={!isMapAuthorized} className="flex-1 bg-primary text-on-primary rounded p-2 font-bold disabled:opacity-40" onClick={async () => {
                  await HazardAPI.applyHazardConflict(selectedHazard.id);
                  const hazards = await HazardAPI.getAllHazards();
                  setHazards(hazards);
                  setSelectedHazard(hazards.find(item => item.id === selectedHazard.id) ?? null);
                }}>Apply local</button>
              </div>
            </div>
          )}
        </div>

        {isMapAuthorized && (
          <div className="flex flex-col gap-3">
            <button
              onClick={() => {
                openEditModal(selectedHazard);
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
  const [operationError, setOperationError] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (isPinModalOpen) {
      setPin('');
      setError(false);
      setOperationError(false);
      setIsVerifying(false);
    }
  }, [isPinModalOpen]);

  useEffect(() => {
    if (pin.length === 4 && !isVerifying) {
      verifyPin();
    }
  }, [pin]);

  const verifyPin = async () => {
    setIsVerifying(true);
    try {
      const response = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await response.json();
      if (data.valid) {
        if (pinActionType === 'delete') {
          await handleDelete();
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
    } catch {
      setError(true);
      setTimeout(() => {
        setPin('');
        setError(false);
      }, 500);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!isPinModalOpen) return;
      if (e.key >= '0' && e.key <= '9') {
        if (pin.length < 4 && !error && !isVerifying) {
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
  }, [isPinModalOpen, pin, error, isVerifying]);

  const handleDelete = async () => {
    if (pinActionData) {
      try {
        await HazardAPI.deleteHazard(pinActionData);
        const hazards = await HazardAPI.getAllHazards();
        setHazards(hazards);
        setSelectedHazard(null);
        closePinModal();
      } catch {
        setOperationError(true);
        setTimeout(() => {
          setOperationError(false);
        }, 500);
      }
    }
  };

  const handleUnlock = () => {
    setMapAuthorized(true);
    closePinModal();
  };

  const handleKeyPress = (num: string) => {
    if (pin.length < 4 && !error && !isVerifying) {
      setPin(prev => prev + num);
    }
  };

  if (!isPinModalOpen) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-on-surface/20 backdrop-blur-sm">
      <motion.div 
        animate={error || operationError ? { x: [-10, 10, -10, 10, 0] } : {}}
        transition={{ duration: 0.3 }}
        className="w-80 bg-surface-container-lowest shadow-ambient rounded-xl p-8 relative border border-white/50"
      >
        <button aria-label="Close PIN verification" onClick={closePinModal} className="absolute top-4 right-4 text-on-surface/40 hover:text-on-surface">
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
            aria-label="Remove last PIN digit"
            onClick={() => setPin(prev => prev.slice(0, -1))}
            className="h-14 bg-transparent hover:bg-error-container text-on-surface/40 hover:text-primary flex items-center justify-center transition-colors rounded-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
