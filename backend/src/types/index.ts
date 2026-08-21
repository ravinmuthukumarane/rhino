import { Request } from 'express';

export type UserRole = 'admin' | 'viewer';
export type PowerSource = 'CEB' | 'GENERATOR';
export type TimePeriod = 'day' | 'peak' | 'off_peak';
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type GeneratorStatus = 'ON' | 'OFF';
export type ReportFormat = 'excel' | 'pdf';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_verified: boolean;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

export interface Plant {
  id: string;
  name: string;
  location: string;
  description?: string;
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
  is_active: boolean;
  created_at: string;
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
  created_at: string;
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
  created_at: string;
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
  created_at: string;
}

export interface EnergyReading {
  id: number;
  meter_id: string;
  plant_id: string;
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
  flow_rate: number;
  total_volume: number;
  recorded_at: string;
}

export interface GeneratorEvent {
  id: number;
  generator_id: string;
  plant_id: string;
  status: GeneratorStatus;
  reason?: string;
  fuel_level_pct?: number;
  recorded_at: string;
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
  updated_by?: string;
  updated_by_name?: string;
  updated_at: string;
}

export interface PowerInterruption {
  id: number;
  plant_id?: string;
  started_at: string;
  restored_at?: string;
  duration_minutes?: number;
  generator_activated: boolean;
  notes?: string;
}

export interface DailyEnergySummary {
  summary_date: string;
  plant_id: string;
  meter_id: string;
  total_kwh: number;
  max_kva: number;
  avg_power_factor: number;
  avg_voltage: number;
  max_current: number;
  ceb_kwh: number;
  generator_kwh: number;
  day_kwh: number;
  peak_kwh: number;
  off_peak_kwh: number;
  interruption_count: number;
}

export interface GenerateReportInput {
  type: string;
  periodStart?: string;
  periodEnd?: string;
  format: ReportFormat;
  plantId?: string;
  meterId?: string;
  generatedBy: AuthUser;
}

export interface LiveReadingPayload {
  energy: EnergyReading | null;
  diesel: FlowReading | null;
  generator: { status: GeneratorStatus; generator_id: string } | null;
  timePeriod: TimePeriod;
}
