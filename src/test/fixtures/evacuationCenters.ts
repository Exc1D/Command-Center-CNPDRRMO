import type { EvacuationCenter } from '@/lib/db';

export const ec1: EvacuationCenter = {
  id: 'ec1',
  name: 'Bagasbas Elementary School',
  type: 'school',
  capacity: 150,
  municipality: 'Daet',
  barangay: 'Bagasbas',
  coordinates: [122.9803837, 14.1337179],
  dateAdded: '2026-04-10T08:00:00Z'
};

export const ec2: EvacuationCenter = {
  id: 'ec2',
  name: 'Mercedes Barangay Hall',
  type: 'barangay_hall',
  capacity: 80,
  municipality: 'Mercedes',
  barangay: 'Mercedes',
  coordinates: [122.9853, 14.1392],
  dateAdded: '2026-04-11T09:00:00Z'
};

export const ec3: EvacuationCenter = {
  id: 'ec3',
  name: 'St. John the Baptist Church',
  type: 'church',
  capacity: 200,
  municipality: 'Labo',
  barangay: 'Poblacion',
  coordinates: [122.588174, 14.1707462],
  dateAdded: '2026-04-12T10:00:00Z'
};