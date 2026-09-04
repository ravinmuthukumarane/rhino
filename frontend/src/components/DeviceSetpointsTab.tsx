import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Trash2, Plus } from 'lucide-react';
import { settingsApi, deviceSetpointsApi } from '../services/api';

const ALERT_TYPES = [
  { value: 'over_voltage',     label: 'Over Voltage',       unit: 'V',   bound: 'max' as const },
  { value: 'low_voltage',      label: 'Low Voltage',        unit: 'V',   bound: 'min' as const },
  { value: 'low_power_factor', label: 'Low Power Factor',   unit: '',    bound: 'min' as const },
  { value: 'high_kva',         label: 'High KVA Demand',    unit: 'kVA', bound: 'max' as const },
  { value: 'power_interruption', label: 'Power Interruption', unit: '',  bound: 'none' as const },
];

export default function DeviceSetpointsTab() {
  const qc = useQueryClient();
  const [selectedMeter, setSelectedMeter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSp, setNewSp] = useState({ alert_type: '', min_value: '', max_value: '', enabled: true, email_notify: true });

  const { data: meters } = useQuery({
    queryKey: ['energy-meters'],
    queryFn: () => settingsApi.getEnergyMeters().then(r => r.data),
  });
  const meterName = (meterId: string) => {
    const m = meters?.meters?.find((x: any) => x.meter_id === meterId);
    return m ? `${m.name} (${m.meter_id})` : meterId;
  };
  const alertLabel = (type: string) => ALERT_TYPES.find((t) => t.value === type)?.label ?? type.replace(/_/g, ' ');

  // Every device override across every meter, so overrides are visible
  // without having to select each meter one at a time to find them.
  const { data: allSetpoints } = useQuery({
    queryKey: ['device-setpoints-all'],
    queryFn: () => deviceSetpointsApi.getAll().then(r => r.data),
  });

  const { data: setpoints } = useQuery({
    queryKey: ['device-setpoints', selectedMeter],
    queryFn: () => deviceSetpointsApi.getEffective(selectedMeter).then(r => r.data),
    enabled: !!selectedMeter,
  });

  const invalidateSetpoints = () => {
    qc.invalidateQueries({ queryKey: ['device-setpoints'] });
    qc.invalidateQueries({ queryKey: ['device-setpoints-all'] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => deviceSetpointsApi.update(id, data),
    onSuccess: () => {
      invalidateSetpoints();
      setEditingId(null);
      toast.success('Setpoint updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deviceSetpointsApi.delete(id),
    onSuccess: () => {
      invalidateSetpoints();
      toast.success('Setpoint deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const existingTypes: string[] = setpoints?.setpoints?.filter((s: any) => s.source === 'device').map((s: any) => s.alert_type) || [];
  const availableTypes = ALERT_TYPES.filter((t) => !existingTypes.includes(t.value));

  const createMutation = useMutation({
    mutationFn: (data: any) => deviceSetpointsApi.create(data),
    onSuccess: () => {
      invalidateSetpoints();
      // Stay open so several parameters can be added for the same meter
      // back to back - only the value fields reset; the next available
      // parameter is auto-selected below once the list refetches.
      setNewSp({ alert_type: '', min_value: '', max_value: '', enabled: true, email_notify: true });
      toast.success('Setpoint created');
    },
    onError: () => toast.error('Failed to create'),
  });

  useEffect(() => {
    if (showAddForm && !newSp.alert_type) {
      if (availableTypes.length > 0) setNewSp((v) => ({ ...v, alert_type: availableTypes[0].value }));
      else setShowAddForm(false); // every parameter for this meter is now configured
    }
  }, [showAddForm, availableTypes, newSp.alert_type]);

  const handleSave = (sp: any) => {
    const { min_value, max_value, enabled, email_notify } = editValues[sp.id] || sp;
    const bound = ALERT_TYPES.find((t) => t.value === sp.alert_type)?.bound;
    updateMutation.mutate({
      id: sp.id,
      min_value: bound === 'min' && min_value !== '' ? parseFloat(min_value) : null,
      max_value: bound === 'max' && max_value !== '' ? parseFloat(max_value) : null,
      enabled: enabled ?? true,
      email_notify: email_notify ?? true,
    });
  };

  const handleCreate = () => {
    if (!newSp.alert_type) { toast.error('Select a parameter'); return; }
    createMutation.mutate({
      meter_id: selectedMeter,
      alert_type: newSp.alert_type,
      min_value: newSpMeta?.bound === 'min' && newSp.min_value !== '' ? parseFloat(newSp.min_value) : null,
      max_value: newSpMeta?.bound === 'max' && newSp.max_value !== '' ? parseFloat(newSp.max_value) : null,
      enabled: newSp.enabled,
      email_notify: newSp.email_notify,
    });
  };

  const newSpMeta = ALERT_TYPES.find((t) => t.value === newSp.alert_type);

  const allRows: any[] = allSetpoints?.setpoints ?? [];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">All Device Overrides ({allRows.length})</p>
        {allRows.length === 0 ? (
          <p className="text-sm text-gray-500">No device-specific overrides configured yet - select a meter below to add one.</p>
        ) : (
          <div className="overflow-hidden border border-gray-200 dark:border-gray-800 rounded-lg">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50">
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Meter</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Parameter</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Min Value</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Max Value</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Enabled</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Email</th>
                  <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map((sp: any) => (
                  <tr key={sp.id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 text-xs">{meterName(sp.meter_id)}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{alertLabel(sp.alert_type)}</td>
                    <td className="px-4 py-3">
                      {ALERT_TYPES.find((t) => t.value === sp.alert_type)?.bound !== 'min' ? (
                        <span className="text-gray-400 dark:text-gray-600" title="Not evaluated for this alert type">n/a</span>
                      ) : editingId === sp.id ? (
                        <input type="number" step="any" className="input py-1 text-xs w-24"
                          value={editValues[sp.id]?.min_value ?? sp.min_value ?? ''}
                          onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], min_value: e.target.value } })} />
                      ) : <span className="text-gray-600 dark:text-gray-400">{sp.min_value ?? '—'}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {ALERT_TYPES.find((t) => t.value === sp.alert_type)?.bound !== 'max' ? (
                        <span className="text-gray-400 dark:text-gray-600" title="Not evaluated for this alert type">n/a</span>
                      ) : editingId === sp.id ? (
                        <input type="number" step="any" className="input py-1 text-xs w-24"
                          value={editValues[sp.id]?.max_value ?? sp.max_value ?? ''}
                          onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], max_value: e.target.value } })} />
                      ) : <span className="text-gray-600 dark:text-gray-400">{sp.max_value ?? '—'}</span>}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === sp.id ? (
                        <input type="checkbox" checked={editValues[sp.id]?.enabled ?? sp.enabled}
                          onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], enabled: e.target.checked } })} className="w-4 h-4" />
                      ) : <input type="checkbox" checked={sp.enabled} disabled className="w-4 h-4" />}
                    </td>
                    <td className="px-4 py-3">
                      {editingId === sp.id ? (
                        <input type="checkbox" checked={editValues[sp.id]?.email_notify ?? sp.email_notify}
                          onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], email_notify: e.target.checked } })} className="w-4 h-4" />
                      ) : <input type="checkbox" checked={sp.email_notify} disabled className="w-4 h-4" />}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex gap-2">
                        {editingId === sp.id ? (
                          <>
                            <button onClick={() => handleSave(sp)} className="text-green-600 dark:text-green-400 hover:underline text-xs font-medium">Save</button>
                            <button onClick={() => setEditingId(null)} className="text-gray-500 hover:underline text-xs">Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setEditingId(sp.id)} className="text-blue-600 dark:text-blue-400 hover:underline text-xs">Edit</button>
                            <button onClick={() => deleteMutation.mutate(sp.id)} className="text-red-600 dark:text-red-400 hover:underline text-xs"><Trash2 className="w-3 h-3" /></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <label className="label">Select Energy Meter</label>
        <select value={selectedMeter} onChange={e => setSelectedMeter(e.target.value)} className="input text-sm">
          <option value="">Choose a meter...</option>
          {meters?.meters?.map((m: any) => (
            <option key={m.meter_id} value={m.meter_id}>
              {m.name} ({m.meter_id})
            </option>
          ))}
        </select>
      </div>

      {selectedMeter && (
        <>
          {!showAddForm ? (
            <div className="flex gap-2">
              <button
                onClick={() => availableTypes.length === 0 ? toast.error('All alert types already configured for this meter') : setShowAddForm(true)}
                className="btn-primary text-sm flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add Device Override
              </button>
            </div>
          ) : (
            <div className="border border-primary-500/40 rounded-lg p-4 space-y-3 bg-primary-50/40 dark:bg-primary-900/10">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">New override for this meter</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="label">Parameter</label>
                  <select value={newSp.alert_type} onChange={e => setNewSp({ ...newSp, alert_type: e.target.value })} className="input text-sm">
                    {availableTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {newSpMeta?.bound === 'min' && (
                  <div>
                    <label className="label">Min Value {newSpMeta?.unit && `(${newSpMeta.unit})`}</label>
                    <input type="number" step="any" className="input text-sm" placeholder="required"
                      value={newSp.min_value} onChange={e => setNewSp({ ...newSp, min_value: e.target.value })} />
                  </div>
                )}
                {newSpMeta?.bound === 'max' && (
                  <div>
                    <label className="label">Max Value {newSpMeta?.unit && `(${newSpMeta.unit})`}</label>
                    <input type="number" step="any" className="input text-sm" placeholder="required"
                      value={newSp.max_value} onChange={e => setNewSp({ ...newSp, max_value: e.target.value })} />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={newSp.enabled} onChange={e => setNewSp({ ...newSp, enabled: e.target.checked })} className="w-4 h-4" /> Enabled
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                  <input type="checkbox" checked={newSp.email_notify} onChange={e => setNewSp({ ...newSp, email_notify: e.target.checked })} className="w-4 h-4" /> Email alert
                </label>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleCreate} disabled={createMutation.isPending || !newSp.alert_type} className="btn-primary text-sm py-1.5 px-4">
                  {createMutation.isPending ? 'Creating…' : 'Create'}
                </button>
                <button onClick={() => { setShowAddForm(false); setNewSp({ alert_type: '', min_value: '', max_value: '', enabled: true, email_notify: true }); }} className="btn-secondary text-sm py-1.5 px-4">
                  Done
                </button>
                <span className="text-xs text-gray-500">Create adds this parameter and keeps the form open for the next one.</span>
              </div>
            </div>
          )}

          {setpoints?.setpoints && (
            <div className="space-y-1">
              <p className="text-xs text-gray-500">Every parameter for this meter - 🌍 Global rows are just showing the current fallback value, not a saved override.</p>
            <div className="overflow-hidden border border-gray-200 dark:border-gray-800 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800/50">
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Alert Type</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Min Value</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Max Value</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Enabled</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Email</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Source</th>
                    <th className="text-left px-4 py-3 text-xs text-gray-600 dark:text-gray-400 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {setpoints.setpoints.map((sp: any) => (
                    <tr key={sp.id} className="border-b border-gray-200 dark:border-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800/20">
                      <td className="px-4 py-3 text-gray-800 dark:text-gray-200 font-medium">{sp.alert_type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        {ALERT_TYPES.find((t) => t.value === sp.alert_type)?.bound !== 'min' ? (
                          <span className="text-gray-400 dark:text-gray-600" title="Not evaluated for this alert type">n/a</span>
                        ) : editingId === sp.id && sp.source === 'device' ? (
                          <input
                            type="number"
                            step="any"
                            className="input py-1 text-xs w-24"
                            value={editValues[sp.id]?.min_value ?? sp.min_value ?? ''}
                            onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], min_value: e.target.value } })}
                          />
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">{sp.min_value ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {ALERT_TYPES.find((t) => t.value === sp.alert_type)?.bound !== 'max' ? (
                          <span className="text-gray-400 dark:text-gray-600" title="Not evaluated for this alert type">n/a</span>
                        ) : editingId === sp.id && sp.source === 'device' ? (
                          <input
                            type="number"
                            step="any"
                            className="input py-1 text-xs w-24"
                            value={editValues[sp.id]?.max_value ?? sp.max_value ?? ''}
                            onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], max_value: e.target.value } })}
                          />
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400">{sp.max_value ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === sp.id && sp.source === 'device' ? (
                          <input
                            type="checkbox"
                            checked={editValues[sp.id]?.enabled ?? sp.enabled}
                            onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], enabled: e.target.checked } })}
                            className="w-4 h-4"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={sp.enabled}
                            disabled
                            className="w-4 h-4"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === sp.id && sp.source === 'device' ? (
                          <input
                            type="checkbox"
                            checked={editValues[sp.id]?.email_notify ?? sp.email_notify}
                            onChange={e => setEditValues({ ...editValues, [sp.id]: { ...editValues[sp.id], email_notify: e.target.checked } })}
                            className="w-4 h-4"
                          />
                        ) : (
                          <input
                            type="checkbox"
                            checked={sp.email_notify}
                            disabled
                            className="w-4 h-4"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={sp.source === 'device' ? 'text-yellow-600 dark:text-yellow-400 font-medium' : 'text-gray-500'}>
                          {sp.source === 'device' ? '🔧 Device' : '🌍 Global'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {sp.source === 'device' && (
                          <div className="flex gap-2">
                            {editingId === sp.id ? (
                              <>
                                <button
                                  onClick={() => handleSave(sp)}
                                  className="text-green-600 dark:text-green-400 hover:underline text-xs font-medium"
                                >
                                  Save
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="text-gray-500 hover:underline text-xs"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  onClick={() => setEditingId(sp.id)}
                                  className="text-blue-600 dark:text-blue-400 hover:underline text-xs"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => deleteMutation.mutate(sp.id)}
                                  className="text-red-600 dark:text-red-400 hover:underline text-xs"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </div>
          )}

          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700/30 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">💡 How Device Setpoints Work</p>
            <ul className="text-xs space-y-1 text-blue-800 dark:text-blue-200">
              <li>🔧 <strong>Device overrides</strong> are meter-specific thresholds that override global setpoints</li>
              <li>🌍 <strong>Global setpoints</strong> apply to all meters that don't have device overrides</li>
              <li>Example: Set stricter voltage limits for critical equipment, relaxed for less critical areas</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
