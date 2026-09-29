import { useStore } from '../lib/store';
import { ReferenceControls } from './ReferenceControls';
import { ArrowRight, LockKeyhole, LockOpen } from 'lucide-react';
export default function Sidebar() {
  const s=useStore();
  return <aside className="operational-sidebar w-[360px] max-w-[85vw] h-full bg-surface-container-low flex flex-col text-on-surface border-r border-outline-variant/35">
    <div className="flex-1 overflow-y-auto p-5 space-y-5">
      <h2 className="text-xl font-bold pr-12">Map layers</h2>
      <button className="operations-button" onClick={async()=>{
        if(s.isMapAuthorized) {
          try { const r=await fetch('/api/logout',{method:'POST'}); if(!r.ok) throw new Error('Could not lock operations'); s.setMapAuthorized(false); }
          catch { s.setSyncError('Could not end the session. Try again.'); }
        } else s.openPinModal('unlock');
      }}>
        {s.isMapAuthorized ? <LockOpen size={20} aria-hidden="true" /> : <LockKeyhole size={20} aria-hidden="true" />}
        <span>{s.isMapAuthorized ? 'Lock map operations' : 'Unlock map operations'}</span>
        <ArrowRight size={18} aria-hidden="true" />
      </button>
      <ReferenceControls/>
      <button className="nav-text-button w-full text-left" onClick={()=>s.setAnalyticsOpen(true)}>Incident Logs & Analytics</button>
    </div>
  </aside>;
}
