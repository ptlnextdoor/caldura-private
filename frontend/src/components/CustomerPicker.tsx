import { Check, Search, UserRound } from 'lucide-react';
import type { Customer } from '../api';
import { InputShell, Panel } from './ui/primitives';

type CustomerPickerProps = {
  customers: Customer[];
  selectedId: string;
  filter: string;
  onFilterChange: (value: string) => void;
  onSelect: (id: string) => void;
};

export function CustomerPicker({
  customers,
  selectedId,
  filter,
  onFilterChange,
  onSelect,
}: CustomerPickerProps) {
  const filtered = customers
    .filter((customer) => {
      const needle = filter.toLowerCase();
      return (
        customer.id.toLowerCase().includes(needle) ||
        customer.name.toLowerCase().includes(needle)
      );
    })
    .slice(0, 7);

  return (
    <Panel className="customer-panel">
      <div className="inline-title">
        <UserRound size={18} />
        <span>Customer context</span>
      </div>
      <InputShell icon={<Search size={16} />}>
        <input
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          placeholder="Filter customer number or name"
          aria-label="Filter customers"
        />
      </InputShell>
      <div className="customer-list">
        <button
          className={`customer-row ${selectedId === '' ? 'selected' : ''}`}
          type="button"
          onClick={() => onSelect('')}
        >
          <span>
            <strong>No customer</strong>
            <small>Base catalog relevance only</small>
          </span>
          {selectedId === '' && <Check size={16} />}
        </button>
        {filtered.map((customer) => (
          <button
            className={`customer-row ${selectedId === customer.id ? 'selected' : ''}`}
            key={customer.id}
            type="button"
            onClick={() => onSelect(customer.id)}
          >
            <span>
              <strong>{customer.id}</strong>
              <small>{customer.name}</small>
              <em>{customer.profile_summary}</em>
            </span>
            {selectedId === customer.id && <Check size={16} />}
          </button>
        ))}
      </div>
    </Panel>
  );
}
