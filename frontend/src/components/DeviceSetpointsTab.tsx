import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';

export default function DeviceSetpointsTab() {
  const qc = useQueryClient();
  const [selectedMeter, setSelectedMeter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<any>({});

  const { data: meters } = useQuery({
    queryKey: ['energy-meters'],
    queryFn: () => axios.get('/api/settings/energy-meters').then(r => r.data),
  });

  const { data: setpoints } = useQuery({
    queryKey: ['device-setpoints', selectedMeter],
    queryFn: () =>
      axios.get('/api/device-setpoints/effective', { params: { meter_id: selectedMeter } })
        .then(r => r.data),
    enabled: !!selectedMeter,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) =>
      axios.put(`/api/device-setpoints/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-setpoints'] });
      setEditingId(null);
      toast.success('Setpoint updated');
    },
    onError: () => toast.error('Failed to update'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      axios.delete(`/api/device-setpoints/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-setpoints'] });
      toast.success('Setpoint deleted');
    },
    onError: () => toast.error('Failed to delete'),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) =>
      axios.post('/api/device-setpoints', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['device-setpoints'] });
      setEditValues({});
      toast.success('Setpoint created');
    },
    onError: () => toast.error('Failed to create'),
  });

  const handleSave = (sp: any) => {
    const { min_value, max_value, enabled, email_notify } = editValues[sp.id] || sp;
    updateMutation.mutate({
      id: sp.id,
      min_value: min_value !== '' ? parseFloat(min_value) : null,
      max_value: max_value !== '' ? parseFloat(max_value) : null,
      enabled: enabled ?? true,
      email_notify: email_notify ?? true,
    });
  };

  const handleCreateNew = () => {
    if (!selectedMeter) {
      toast.error('Select a meter first');
      return;
    }
    const alertTypes = ['over_voltage', 'low_voltage', 'low_power_factor', 'high_kva', 'high_third_harmonic', 'power_interruption'];
    const existingTypes = setpoints?.setpoints?.filter((s: any) => s.source === 'device').map((s: any) => s.alert_type) || [];
    const available = alertTypes.find(t => !existingTypes.includes(t));

    if (!available) {
      toast.error('All alert types already configured');
      return;
    }

    createMutation.mutate({
      meter_id: selectedMeter,
      alert_type: available,
      min_value: null,
      max_value: null,
      enabled: true,
      email_notify: true,
    });
  };

  return (
    <div className="space-y-4">
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
          <div className="flex gap-2">
            <button onClick={handleCreateNew} className="btn-primary text-sm">
              + Create Device Override
            </button>
          </div>

          {setpoints?.setpoints && (
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
                        {editingId === sp.id && sp.source === 'device' ? (
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
                        {editingId === sp.id && sp.source === 'device' ? (
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
