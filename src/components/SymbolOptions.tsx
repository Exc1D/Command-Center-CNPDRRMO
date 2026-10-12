import { PLANNING_SYMBOLS } from '../lib/planning';

export const SYMBOL_CATEGORIES = [...new Set(PLANNING_SYMBOLS.map(symbol => symbol.category))];

export function SymbolOptions() {
  return SYMBOL_CATEGORIES.map(category => <optgroup key={category} label={category}>
    {PLANNING_SYMBOLS.filter(symbol => symbol.category === category).map(symbol => <option key={symbol.key} value={symbol.key}>{symbol.label}</option>)}
  </optgroup>);
}
