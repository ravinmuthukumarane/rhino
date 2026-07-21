-- Default alert setpoints
INSERT INTO alert_setpoints (alert_type, label, unit, min_value, max_value, enabled, email_notify)
VALUES
  ('over_voltage',        'Over Voltage',         'V',    NULL,  255.0, true, true),
  ('low_voltage',         'Low Voltage',          'V',    195.0, NULL,  true, true),
  ('low_power_factor',    'Low Power Factor',     NULL,   0.85,  NULL,  true, true),
  ('high_kva',            'High KVA Demand',      'kVA',  NULL,  100.0, true, true),
  ('high_third_harmonic', 'High 3rd Harmonic THD','%',    NULL,  5.0,   true, true),
  ('power_interruption',  'Power Interruption',   NULL,   NULL,  NULL,  true, true)
ON CONFLICT (alert_type) DO NOTHING;

-- Default demo plant (useful for first run / dev)
INSERT INTO plants (id, name, location, description)
VALUES ('00000000-0000-0000-0000-000000000001', 'Main Plant', 'Headquarters', 'Primary facility')
ON CONFLICT DO NOTHING;

-- Default demo devices
INSERT INTO energy_meters (meter_id, name, plant_id)
VALUES ('EM-01', 'Main Incomer', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (meter_id) DO NOTHING;

INSERT INTO flow_meters (meter_id, name, plant_id, fluid_type)
VALUES ('FM-01', 'Diesel Flow Meter', '00000000-0000-0000-0000-000000000001', 'diesel')
ON CONFLICT (meter_id) DO NOTHING;

INSERT INTO generators (generator_id, name, plant_id, capacity_kva, fuel_type)
VALUES ('GEN-01', 'Diesel Generator 1', '00000000-0000-0000-0000-000000000001', 200.0, 'diesel')
ON CONFLICT (generator_id) DO NOTHING;

-- Default report schedules (daily off by default, monthly on to match prior behavior)
INSERT INTO report_schedules (frequency, enabled, report_type, format)
VALUES
  ('daily',   false, 'consumption_summary', 'excel'),
  ('monthly', true,  'consumption_summary', 'excel')
ON CONFLICT (frequency) DO NOTHING;
