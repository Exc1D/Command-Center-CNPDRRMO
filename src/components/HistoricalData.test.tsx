import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { HistoricalData, HISTORICAL_OBSERVATIONS, historicalCsv } from './HistoricalData';
import { useStore } from '../lib/store';

beforeEach(()=>useStore.setState({...useStore.getInitialState()}));
it('filters actual historical observations without combining overlapping rainfall totals',()=>{
  render(<HistoricalData/>);
  const table=screen.getByRole('table',{name:'Historical rainfall measurements'});
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  fireEvent.change(screen.getByLabelText('Historical event'),{target:{value:'Kristine'}});
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  fireEvent.change(screen.getByLabelText('Observation duration'),{target:{value:'24'}});
  expect(within(table).getByText('528.5')).toBeInTheDocument();
  expect(within(table).queryByText('731.6')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('History from'),{target:{value:'2024-10-23'}});
  expect(within(table).getAllByRole('row')).toHaveLength(1);
  expect(screen.getByRole('button',{name:'Export filtered history (CSV)'})).toBeDisabled();
  fireEvent.change(screen.getByLabelText('History through'),{target:{value:'2024-10-20'}});
  expect(screen.getByRole('alert')).toHaveTextContent('start date');
});
it('does not attribute station observations to a barangay and can return to municipality records',()=>{
  useStore.setState({selectedMunicipality:'Daet',selectedBarangay:'Bagasbas'});
  render(<HistoricalData/>);
  expect(screen.getByText(/No barangay-specific/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Show municipality records'}));
  expect(screen.getByText('2 events · 3 observations')).toBeInTheDocument();
});
it('exports only the selected records with their dates, source and explicit missing impact counts',()=>{
  const csv=historicalCsv(HISTORICAL_OBSERVATIONS.filter(r=>r.event==='Usman'));
  expect(csv.split('\r\n')).toHaveLength(2);
  expect(csv).toContain('"573.2","Not available"');
  expect(csv).toContain('TD_USMAN_2018.pdf');
  expect(csv).not.toContain('Kristine');
});
