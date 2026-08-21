export type UserRole = 'admin' | 'viewer';
export type PowerSource = 'CEB' | 'GENERATOR';
export type TimePeriod = 'day' | 'peak' | 'off_peak';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type GeneratorStatus = 'ON' | 'OFF';
export type ReportFormat = 'excel' | 'pdf';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_verified: boolean;
  created_at: string;
}

export interface Plant {
  id: string;
  name: string;
  location: string;
  description?: string;
  is_active: boolean;
  energy_meter_count?: number;
  flow_meter_count?: number;
  generator_count?: number;
  created_at: string;
}

export interface ReportScheduleRecipient {
  id: string;
  frequency: 'daily' | 'monthly';
  email: string;
  name: string | null;
  created_at: string;
}

export interface EnergyMeter {
  id: string;
  meter_id: string;
  name: string;
  plant_id: string;
  plant_name?: string;
  model?: string;
  serial_number?: string;
  plant_section?: string;
  is_active: boolean;
}

export interface FlowMeter {
  id: string;
  meter_id: string;
  name: string;
  plant_id: string;
  plant_name?: string;
  model?: string;
  fluid_type: string;
  is_active: boolean;
}

export interface Generator {
  id: string;
  generator_id: string;
  name: string;
  plant_id: string;
  plant_name?: string;
  capacity_kva?: number;
  fuel_type: string;
  is_active: boolean;
}

export interface PowerStatusSensor {
  id: string;
  sensor_id: string;
  name: string;
  plant_id: string;
  plant_name?: string;
  plant_section?: string;
  generator_id: string;
  is_active: boolean;
}

export interface EnergyReading {
  id: number;
  meter_id: string;
  plant_id: string;
  plant_name?: string;
  voltage_r: number;
  voltage_y: number;
  voltage_b: number;
  current_r: number;
  current_y: number;
  current_b: number;
  power_kw: number;
  power_kva: number;
  power_factor: number;
  energy_kwh: number;
  frequency: number;
  source: PowerSource;
  time_period: TimePeriod;
  recorded_at: string;
}

export interface FlowReading {
  id: number;
  meter_id: string;
  plant_id: string;
  plant_name?: string;
  flow_rate: number;
  total_volume: number;
  recorded_at: string;
}

export interface GeneratorEvent {
  id: number;
  generator_id: string;
  plant_id: string;
  plant_name?: string;
  status: GeneratorStatus;
  reason?: string;
  recorded_at: string;
}

export interface LiveReadingPayload {
  energy: EnergyReading | null;
  diesel: FlowReading | null;
  generator: { status: GeneratorStatus; generator_id: string } | null;
  timePeriod: TimePeriod;
  plant_id: string;
  meter_id?: string;
}

export interface Alert {
  id: number;
  alert_type: string;
  severity: AlertSeverity;
  message: string;
  value?: number;
  setpoint_value?: number;
  source?: PowerSource;
  plant_id?: string;
  plant_name?: string;
  meter_id?: string;
  acknowledged: boolean;
  acknowledged_by?: string;
  acknowledged_by_name?: string;
  acknowledged_at?: string;
  email_sent: boolean;
  created_at: string;
}

export interface AlertSetpoint {
  id: string;
  alert_type: string;
  label: string;
  unit?: string;
  min_value?: number;
  max_value?: number;
  enabled: boolean;
  email_notify: boolean;
  updated_by_name?: string;
  updated_at: string;
}

export interface DailyEnergySummary {
  summary_date: string;
  plant_id: string;
  plant_name?: string;
  meter_id: string;
  total_kwh: number;
  max_kva: number;
  avg_power_factor: number;
  avg_voltage: number;
  ceb_kwh: number;
  generator_kwh: number;
  day_kwh: number;
  peak_kwh: number;
  off_peak_kwh: number;
  interruption_count: number;
}

export interface DailyDieselSummary {
  summary_date: string;
  plant_id: string;
  plant_name?: string;
  meter_id: string;
  total_liters: number;
  generator_run_hours: number;
}

export interface PowerInterruption {
  id: number;
  plant_id?: string;
  plant_name?: string;
  meter_id?: string;
  started_at: string;
  restored_at?: string;
  duration_minutes?: number;
  generator_activated: boolean;
  notes?: string;
}
