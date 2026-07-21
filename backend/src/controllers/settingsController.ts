import { Response, NextFunction } from 'express';
import pool from '../config/database';
import { AuthRequest } from '../types';

// ── Plants ──────────────────────────────────────────────────

export async function getPlants(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT COUNT(*) FROM energy_meters WHERE plant_id = p.id) AS energy_meter_count,
              (SELECT COUNT(*) FROM flow_meters WHERE plant_id = p.id) AS flow_meter_count,
              (SELECT COUNT(*) FROM generators WHERE plant_id = p.id) AS generator_count
       FROM plants p ORDER BY p.name`
    );
    res.json({ plants: rows });
  } catch (err) { next(err); }
}

export async function createPlant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { name, location, description } = req.body as { name: string; location?: string; description?: string };
  try {
    const { rows: [plant] } = await pool.query(
      'INSERT INTO plants (name, location, description) VALUES ($1,$2,$3) RETURNING *',
      [name, location ?? null, description ?? null]
    );
    res.status(201).json({ plant });
  } catch (err) { next(err); }
}

export async function updatePlant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  const { name, location, description, is_active } = req.body as Record<string, any>;
  try {
    const { rows: [plant] } = await pool.query(
      'UPDATE plants SET name=$1, location=$2, description=$3, is_active=$4 WHERE id=$5 RETURNING *',
      [name, location ?? null, description ?? null, is_active ?? true, id]
    );
    if (!plant) { res.status(404).json({ error: 'Plant not found' }); return; }
    res.json({ plant });
  } catch (err) { next(err); }
}

export async function deletePlant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM plants WHERE id=$1', [id]);
    res.json({ message: 'Plant deleted' });
  } catch (err) { next(err); }
}

// ── Energy Meters ───────────────────────────────────────────

export async function getEnergyMeters(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT em.*, p.name AS plant_name FROM energy_meters em
       LEFT JOIN plants p ON p.id = em.plant_id ORDER BY p.name, em.name`
    );
    res.json({ meters: rows });
  } catch (err) { next(err); }
}

export async function createEnergyMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { meter_id, name, plant_id, model, serial_number } = req.body as Record<string, string>;
  try {
    const { rows: [meter] } = await pool.query(
      'INSERT INTO energy_meters (meter_id, name, plant_id, model, serial_number) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [meter_id, name, plant_id ?? null, model ?? null, serial_number ?? null]
    );
    res.status(201).json({ meter });
  } catch (err) { next(err); }
}

export async function updateEnergyMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  const { name, plant_id, model, serial_number, is_active } = req.body as Record<string, any>;
  try {
    const { rows: [meter] } = await pool.query(
      'UPDATE energy_meters SET name=$1, plant_id=$2, model=$3, serial_number=$4, is_active=$5 WHERE id=$6 RETURNING *',
      [name, plant_id ?? null, model ?? null, serial_number ?? null, is_active ?? true, id]
    );
    if (!meter) { res.status(404).json({ error: 'Meter not found' }); return; }
    res.json({ meter });
  } catch (err) { next(err); }
}

export async function deleteEnergyMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM energy_meters WHERE id=$1', [id]);
    res.json({ message: 'Energy meter deleted' });
  } catch (err) { next(err); }
}

// ── Flow Meters ─────────────────────────────────────────────

export async function getFlowMeters(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT fm.*, p.name AS plant_name FROM flow_meters fm
       LEFT JOIN plants p ON p.id = fm.plant_id ORDER BY p.name, fm.name`
    );
    res.json({ meters: rows });
  } catch (err) { next(err); }
}

export async function createFlowMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { meter_id, name, plant_id, model, fluid_type } = req.body as Record<string, string>;
  try {
    const { rows: [meter] } = await pool.query(
      'INSERT INTO flow_meters (meter_id, name, plant_id, model, fluid_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [meter_id, name, plant_id ?? null, model ?? null, fluid_type ?? 'diesel']
    );
    res.status(201).json({ meter });
  } catch (err) { next(err); }
}

export async function updateFlowMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  const { name, plant_id, model, fluid_type, is_active } = req.body as Record<string, any>;
  try {
    const { rows: [meter] } = await pool.query(
      'UPDATE flow_meters SET name=$1, plant_id=$2, model=$3, fluid_type=$4, is_active=$5 WHERE id=$6 RETURNING *',
      [name, plant_id ?? null, model ?? null, fluid_type ?? 'diesel', is_active ?? true, id]
    );
    if (!meter) { res.status(404).json({ error: 'Meter not found' }); return; }
    res.json({ meter });
  } catch (err) { next(err); }
}

export async function deleteFlowMeter(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM flow_meters WHERE id=$1', [id]);
    res.json({ message: 'Flow meter deleted' });
  } catch (err) { next(err); }
}

// ── Generators ──────────────────────────────────────────────

export async function getGenerators(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { rows } = await pool.query(
      `SELECT g.*, p.name AS plant_name FROM generators g
       LEFT JOIN plants p ON p.id = g.plant_id ORDER BY p.name, g.name`
    );
    res.json({ generators: rows });
  } catch (err) { next(err); }
}

export async function createGenerator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { generator_id, name, plant_id, capacity_kva, fuel_type } = req.body as Record<string, any>;
  try {
    const { rows: [gen] } = await pool.query(
      'INSERT INTO generators (generator_id, name, plant_id, capacity_kva, fuel_type) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [generator_id, name, plant_id ?? null, capacity_kva ?? null, fuel_type ?? 'diesel']
    );
    res.status(201).json({ generator: gen });
  } catch (err) { next(err); }
}

export async function updateGenerator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  const { name, plant_id, capacity_kva, fuel_type, is_active } = req.body as Record<string, any>;
  try {
    const { rows: [gen] } = await pool.query(
      'UPDATE generators SET name=$1, plant_id=$2, capacity_kva=$3, fuel_type=$4, is_active=$5 WHERE id=$6 RETURNING *',
      [name, plant_id ?? null, capacity_kva ?? null, fuel_type ?? 'diesel', is_active ?? true, id]
    );
    if (!gen) { res.status(404).json({ error: 'Generator not found' }); return; }
    res.json({ generator: gen });
  } catch (err) { next(err); }
}

export async function deleteGenerator(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM generators WHERE id=$1', [id]);
    res.json({ message: 'Generator deleted' });
  } catch (err) { next(err); }
}
