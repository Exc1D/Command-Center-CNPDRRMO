import { useStore } from '../lib/store';
import { IncidentForm } from './IncidentForm';
export function EditHazardModal() {
  const {isEditModalOpen,editModalHazard,closeEditModal}=useStore();
  return isEditModalOpen && editModalHazard ? <IncidentForm key={editModalHazard.id} record={editModalHazard} geometry={editModalHazard.geometry} onClose={closeEditModal}/> : null;
}
