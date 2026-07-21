import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../services/api';
import { Factory, Plus, Edit2, Trash2, Check, X, Zap, Droplets, Cpu, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { Navigate } from 'react-router-dom';
import type { Plant, EnergyMeter, FlowMeter, Generator } from '../types';
import DeviceSetpointsTab from '../components/DeviceSetpointsTab';

type Tab = 'plants' | 'energy' | 'flow' | 'generators' | 'setpoints';

const ENERGY_METER_MODELS = [
  'Schneider PM2120',
  'Wattz - Multifunctional energy meter',
  'Circutor CVM-C11',
];

// ── Inline edit row ──────────────────────────────────────────
function PlantRow({ plant, plants, onSave, onDelete }: { plant?: Plant; plants: Plant[]; onSave: (data: object, id?: string) => void; onDelete?: (id: string) => void }) {
  const isNew = !plant;
  const [f, setF] = useState({ name: plant?.name ?? '', location: plant?.location ?? '', description: plant?.description ?? '', is_active: plant?.is_active ?? true });
  const [open, setOpen] = useState(isNew);

  if (!open && !isNew) return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
      <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200 text-sm">{plant!.name}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{plant!.location}</td>
      <td className="px-4 py-3 text-gray-500 text-xs max-w-xs truncate">{plant!.description}</td>
      <td className="px-4 py-3 text-xs">{(plant as any).energy_meter_count ?? 0} EM / {(plant as any).flow_meter_count ?? 0} FM / {(plant as any).generator_count ?? 0} Gen</td>
      <td className="px-4 py-3">{plant!.is_active ? <span className="badge-success">Active</span> : <span className="text-gray-500 text-xs">Inactive</span>}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <button onClick={() => setOpen(true)} className="p-1.5 text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => { if (confirm(`Delete plant "${plant!.name}"? Its energy/flow meters and generators will be unassigned, not deleted.`)) onDelete?.(plant!.id); }}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/20">
      <td className="px-4 py-2"><input className="input text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Plant name" /></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Location" /></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Description" /></td>
      <td className="px-4 py-2"></td>
      <td className="px-4 py-2"><select className="input text-sm w-24" value={f.is_active ? 'true' : 'false'} onChange={(e) => setF({ ...f, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></td>
      <td className="px-4 py-2">
        <div className="flex gap-1">
          <button onClick={() => { onSave(f, plant?.id); if (!isNew) setOpen(false); }} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded transition-colors"><Check className="w-3.5 h-3.5" /></button>
          {!isNew && <button onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
}

function EnergyMeterRow({ meter, plants, onSave, onDelete }: { meter?: EnergyMeter; plants: Plant[]; onSave: (data: object, id?: string) => void; onDelete?: (id: string) => void }) {
  const isNew = !meter;
  const [f, setF] = useState({ meter_id: meter?.meter_id ?? '', name: meter?.name ?? '', plant_id: meter?.plant_id ?? '', model: meter?.model ?? '', serial_number: meter?.serial_number ?? '', is_active: meter?.is_active ?? true });
  const [open, setOpen] = useState(isNew);

  if (!open && !isNew) return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
      <td className="px-4 py-3 font-mono text-primary-600 dark:text-primary-400 text-sm">{meter!.meter_id}</td>
      <td className="px-4 py-3 text-gray-800 dark:text-gray-200 text-sm">{meter!.name}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{meter!.plant_name ?? '—'}</td>
      <td className="px-4 py-3 text-gray-500 text-xs">{meter!.model ?? '—'}</td>
      <td className="px-4 py-3 text-gray-500 text-xs">{meter!.serial_number ?? '—'}</td>
      <td className="px-4 py-3">{meter!.is_active ? <span className="badge-success">Active</span> : <span className="text-gray-500 text-xs">Inactive</span>}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <button onClick={() => setOpen(true)} className="p-1.5 text-gray-500 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-500/10 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => { if (confirm(`Delete energy meter "${meter!.name}" (${meter!.meter_id})?`)) onDelete?.(meter!.id); }}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/20">
      <td className="px-4 py-2"><input className="input text-sm font-mono" value={f.meter_id} onChange={(e) => setF({ ...f, meter_id: e.target.value })} placeholder="EM-01" disabled={!isNew} /></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Main Incomer" /></td>
      <td className="px-4 py-2"><select className="input text-sm" value={f.plant_id} onChange={(e) => setF({ ...f, plant_id: e.target.value })}><option value="">— Select Plant —</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
      <td className="px-4 py-2">
        <select className="input text-sm" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
          <option value="">— Select Model —</option>
          {ENERGY_METER_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.serial_number} onChange={(e) => setF({ ...f, serial_number: e.target.value })} placeholder="Serial #" /></td>
      <td className="px-4 py-2"><select className="input text-sm w-24" value={f.is_active ? 'true' : 'false'} onChange={(e) => setF({ ...f, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></td>
      <td className="px-4 py-2">
        <div className="flex gap-1">
          <button onClick={() => { onSave(f, meter?.id); if (!isNew) setOpen(false); }} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded transition-colors"><Check className="w-3.5 h-3.5" /></button>
          {!isNew && <button onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
}

function FlowMeterRow({ meter, plants, onSave, onDelete }: { meter?: FlowMeter; plants: Plant[]; onSave: (data: object, id?: string) => void; onDelete?: (id: string) => void }) {
  const isNew = !meter;
  const [f, setF] = useState({ meter_id: meter?.meter_id ?? '', name: meter?.name ?? '', plant_id: meter?.plant_id ?? '', fluid_type: meter?.fluid_type ?? 'diesel', model: meter?.model ?? '', is_active: meter?.is_active ?? true });
  const [open, setOpen] = useState(isNew);

  if (!open && !isNew) return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
      <td className="px-4 py-3 font-mono text-orange-600 dark:text-orange-400 text-sm">{meter!.meter_id}</td>
      <td className="px-4 py-3 text-gray-800 dark:text-gray-200 text-sm">{meter!.name}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{meter!.plant_name ?? '—'}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm capitalize">{meter!.fluid_type}</td>
      <td className="px-4 py-3 text-gray-500 text-xs">{meter!.model ?? '—'}</td>
      <td className="px-4 py-3">{meter!.is_active ? <span className="badge-success">Active</span> : <span className="text-gray-500 text-xs">Inactive</span>}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <button onClick={() => setOpen(true)} className="p-1.5 text-gray-500 hover:text-orange-600 dark:hover:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-500/10 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => { if (confirm(`Delete flow meter "${meter!.name}" (${meter!.meter_id})?`)) onDelete?.(meter!.id); }}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/20">
      <td className="px-4 py-2"><input className="input text-sm font-mono" value={f.meter_id} onChange={(e) => setF({ ...f, meter_id: e.target.value })} placeholder="FM-01" disabled={!isNew} /></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Diesel Flow" /></td>
      <td className="px-4 py-2"><select className="input text-sm" value={f.plant_id} onChange={(e) => setF({ ...f, plant_id: e.target.value })}><option value="">— Select Plant —</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
      <td className="px-4 py-2"><select className="input text-sm" value={f.fluid_type} onChange={(e) => setF({ ...f, fluid_type: e.target.value })}><option value="diesel">Diesel</option><option value="water">Water</option><option value="gas">Gas</option></select></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} placeholder="Model" /></td>
      <td className="px-4 py-2"><select className="input text-sm w-24" value={f.is_active ? 'true' : 'false'} onChange={(e) => setF({ ...f, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></td>
      <td className="px-4 py-2">
        <div className="flex gap-1">
          <button onClick={() => { onSave(f, meter?.id); if (!isNew) setOpen(false); }} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded transition-colors"><Check className="w-3.5 h-3.5" /></button>
          {!isNew && <button onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
}

function GeneratorRow({ gen, plants, onSave, onDelete }: { gen?: Generator; plants: Plant[]; onSave: (data: object, id?: string) => void; onDelete?: (id: string) => void }) {
  const isNew = !gen;
  const [f, setF] = useState({ generator_id: gen?.generator_id ?? '', name: gen?.name ?? '', plant_id: gen?.plant_id ?? '', capacity_kva: gen?.capacity_kva?.toString() ?? '', fuel_type: gen?.fuel_type ?? 'diesel', is_active: gen?.is_active ?? true });
  const [open, setOpen] = useState(isNew);

  if (!open && !isNew) return (
    <tr className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
      <td className="px-4 py-3 font-mono text-yellow-600 dark:text-yellow-400 text-sm">{gen!.generator_id}</td>
      <td className="px-4 py-3 text-gray-800 dark:text-gray-200 text-sm">{gen!.name}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm">{gen!.plant_name ?? '—'}</td>
      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 text-sm">{gen!.capacity_kva ? `${gen!.capacity_kva} kVA` : '—'}</td>
      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 text-sm capitalize">{gen!.fuel_type}</td>
      <td className="px-4 py-3">{gen!.is_active ? <span className="badge-success">Active</span> : <span className="text-gray-500 text-xs">Inactive</span>}</td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          <button onClick={() => setOpen(true)} className="p-1.5 text-gray-500 hover:text-yellow-600 dark:hover:text-yellow-400 hover:bg-yellow-50 dark:hover:bg-yellow-500/10 rounded transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => { if (confirm(`Delete generator "${gen!.name}" (${gen!.generator_id})?`)) onDelete?.(gen!.id); }}
            className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );

  return (
    <tr className="border-b border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/20">
      <td className="px-4 py-2"><input className="input text-sm font-mono" value={f.generator_id} onChange={(e) => setF({ ...f, generator_id: e.target.value })} placeholder="GEN-01" disabled={!isNew} /></td>
      <td className="px-4 py-2"><input className="input text-sm" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Generator 1" /></td>
      <td className="px-4 py-2"><select className="input text-sm" value={f.plant_id} onChange={(e) => setF({ ...f, plant_id: e.target.value })}><option value="">— Select Plant —</option>{plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td>
      <td className="px-4 py-2"><input className="input text-sm" type="number" step="any" value={f.capacity_kva} onChange={(e) => setF({ ...f, capacity_kva: e.target.value })} placeholder="200" /></td>
      <td className="px-4 py-2"><select className="input text-sm" value={f.fuel_type} onChange={(e) => setF({ ...f, fuel_type: e.target.value })}><option value="diesel">Diesel</option><option value="gas">Gas</option><option value="petrol">Petrol</option></select></td>
      <td className="px-4 py-2"><select className="input text-sm w-24" value={f.is_active ? 'true' : 'false'} onChange={(e) => setF({ ...f, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></td>
      <td className="px-4 py-2">
        <div className="flex gap-1">
          <button onClick={() => { onSave({ ...f, capacity_kva: f.capacity_kva ? parseFloat(f.capacity_kva) : null }, gen?.id); if (!isNew) setOpen(false); }} className="p-1.5 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-500/10 rounded transition-colors"><Check className="w-3.5 h-3.5" /></button>
          {!isNew && <button onClick={() => setOpen(false)} className="p-1.5 text-gray-500 hover:text-red-600 dark:hover:text-red-400 rounded transition-colors"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </td>
    </tr>
  );
}

// ── Main page ────────────────────────────────────────────────
export default function DeviceSettingsPage() {
  const { isAdmin } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;

  const [tab, setTab] = useState<Tab>('plants');
  const [addNew, setAddNew] = useState(false);
  const qc = useQueryClient();

  const { data: plantsData } = useQuery({ queryKey: ['plants'], queryFn: () => settingsApi.getPlants().then((r) => r.data) });
  const { data: emetersData } = useQuery({ queryKey: ['energy-meters'], queryFn: () => settingsApi.getEnergyMeters().then((r) => r.data) });
  const { data: fmetersData } = useQuery({ queryKey: ['flow-meters'], queryFn: () => settingsApi.getFlowMeters().then((r) => r.data) });
  const { data: gensData } = useQuery({ queryKey: ['generators'], queryFn: () => settingsApi.getGenerators().then((r) => r.data) });

  const plants: Plant[] = plantsData?.plants ?? [];
  const emeters: EnergyMeter[] = emetersData?.meters ?? [];
  const fmeters: FlowMeter[] = fmetersData?.meters ?? [];
  const generators: Generator[] = gensData?.generators ?? [];

  function mutate(createFn: (d: object) => Promise<any>, updateFn: (id: string, d: object) => Promise<any>, keys: string[]) {
    return useMutation({
      mutationFn: ({ data, id }: { data: object; id?: string }) => id ? updateFn(id, data) : createFn(data),
      onSuccess: () => { keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Saved'); },
      onError: (err: any) => toast.error(err.response?.data?.error ?? 'Save failed'),
    });
  }

  function useDelete(deleteFn: (id: string) => Promise<any>, key: string, label: string) {
    return useMutation({
      mutationFn: (id: string) => deleteFn(id),
      onSuccess: () => { qc.invalidateQueries({ queryKey: [key] }); toast.success(`${label} deleted`); },
      onError: (err: any) => toast.error(err.response?.data?.error ?? 'Delete failed'),
    });
  }

  const plantMut = mutate(settingsApi.createPlant, settingsApi.updatePlant, ['plants']);
  const plantDeleteMut = useDelete(settingsApi.deletePlant, 'plants', 'Plant');
  const emMut = mutate(settingsApi.createEnergyMeter, settingsApi.updateEnergyMeter, ['energy-meters']);
  const emDeleteMut = useDelete(settingsApi.deleteEnergyMeter, 'energy-meters', 'Energy meter');
  const fmMut = mutate(settingsApi.createFlowMeter, settingsApi.updateFlowMeter, ['flow-meters']);
  const fmDeleteMut = useDelete(settingsApi.deleteFlowMeter, 'flow-meters', 'Flow meter');
  const genMut = mutate(settingsApi.createGenerator, settingsApi.updateGenerator, ['generators']);
  const genDeleteMut = useDelete(settingsApi.deleteGenerator, 'generators', 'Generator');

  const tabs: { key: Tab; label: string; icon: any; count?: number; color: string }[] = [
    { key: 'plants', label: 'Plants', icon: Factory, count: plants.length, color: 'text-primary-600 dark:text-primary-400' },
    { key: 'energy', label: 'Energy Meters', icon: Zap, count: emeters.length, color: 'text-yellow-600 dark:text-yellow-400' },
    { key: 'flow', label: 'Flow Meters', icon: Droplets, count: fmeters.length, color: 'text-orange-600 dark:text-orange-400' },
    { key: 'generators', label: 'Generators', icon: Cpu, count: generators.length, color: 'text-green-600 dark:text-green-400' },
    { key: 'setpoints', label: 'Device Setpoints', icon: AlertCircle, color: 'text-blue-600 dark:text-blue-400' },
  ];

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="flex items-center gap-2 mb-1"><Factory className="w-5 h-5 text-primary-600 dark:text-primary-400" /><h3 className="font-semibold text-gray-800 dark:text-gray-200">Device Settings</h3></div>
        <p className="text-sm text-gray-600 dark:text-gray-400">Assign energy meters, flow meters, and generators to plant locations. The simulator uses these for data generation.</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1">
        {tabs.map(({ key, label, icon: Icon, count, color }) => (
          <button key={key} onClick={() => { setTab(key); setAddNew(false); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-colors
              ${tab === key ? 'bg-gray-100 dark:bg-gray-800 text-white shadow' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}>
            <Icon className={`w-4 h-4 ${tab === key ? color : 'text-gray-500'}`} />
            <span className="hidden sm:inline">{label}</span>
            {count !== undefined && <span className={`text-xs ${tab === key ? 'text-gray-600 dark:text-gray-400' : 'text-gray-600'}`}>({count})</span>}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="p-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between">
          <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{tabs.find((t) => t.key === tab)?.label}</h4>
          <button onClick={() => setAddNew(!addNew)} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5">
            <Plus className="w-3.5 h-3.5" />{addNew ? 'Cancel' : 'Add New'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {tab === 'plants' && (<>
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Name','Location','Description','Devices','Status',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {addNew && <PlantRow plants={plants} onSave={(d) => { plantMut.mutate({ data: d }); setAddNew(false); }} />}
                {plants.map((p) => <PlantRow key={p.id} plant={p} plants={plants} onSave={(d, id) => plantMut.mutate({ data: d, id })} onDelete={(id) => plantDeleteMut.mutate(id)} />)}
                {plants.length === 0 && !addNew && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No plants. Add one to get started.</td></tr>}
              </tbody>
            </>)}

            {tab === 'energy' && (<>
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Meter ID','Name','Plant','Model','Serial','Status',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {addNew && <EnergyMeterRow plants={plants} onSave={(d) => { emMut.mutate({ data: d }); setAddNew(false); }} />}
                {emeters.map((m) => <EnergyMeterRow key={m.id} meter={m} plants={plants} onSave={(d, id) => emMut.mutate({ data: d, id })} onDelete={(id) => emDeleteMut.mutate(id)} />)}
                {emeters.length === 0 && !addNew && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No energy meters configured.</td></tr>}
              </tbody>
            </>)}

            {tab === 'flow' && (<>
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Meter ID','Name','Plant','Fluid Type','Model','Status',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {addNew && <FlowMeterRow plants={plants} onSave={(d) => { fmMut.mutate({ data: d }); setAddNew(false); }} />}
                {fmeters.map((m) => <FlowMeterRow key={m.id} meter={m} plants={plants} onSave={(d, id) => fmMut.mutate({ data: d, id })} onDelete={(id) => fmDeleteMut.mutate(id)} />)}
                {fmeters.length === 0 && !addNew && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No flow meters configured.</td></tr>}
              </tbody>
            </>)}

            {tab === 'generators' && (<>
              <thead><tr className="border-b border-gray-200 dark:border-gray-800">{['Generator ID','Name','Plant','Capacity','Fuel','Status',''].map((h) => <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {addNew && <GeneratorRow plants={plants} onSave={(d) => { genMut.mutate({ data: d }); setAddNew(false); }} />}
                {generators.map((g) => <GeneratorRow key={g.id} gen={g} plants={plants} onSave={(d, id) => genMut.mutate({ data: d, id })} onDelete={(id) => genDeleteMut.mutate(id)} />)}
                {generators.length === 0 && !addNew && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No generators configured.</td></tr>}
              </tbody>
            </>)}
          </table>
        </div>
      </div>

      {tab === 'setpoints' && (
        <div className="card">
          <DeviceSetpointsTab />
        </div>
      )}
    </div>
  );
}
