# MQTT Integration Guide

## Overview

The energy monitoring system can receive real-time data from smart meters via MQTT instead of the simulator. This guide explains how to:
1. Register your meters in the database
2. Configure MQTT
3. Send meter data via MQTT
4. Query data via the API

## Step 1: Register Meters in Database

### Via Admin UI (Easiest)
1. Login to http://localhost:3000
2. Go to **Device Settings** → **Energy Meters** or **Flow Meters**
3. Click "Add New" and fill in:
   - **Meter ID**: Unique identifier (e.g., `EM-PLANT-01-001`)
   - **Name**: Display name
   - **Plant ID**: Select from dropdown
   - **Model**: Meter model (e.g., `SDM630`)
   - **Serial Number**: Device serial

### Via API
```bash
# Get plant IDs first
curl http://localhost:5000/api/settings/plants \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Add energy meter
curl -X POST http://localhost:5000/api/settings/energy-meters \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "EM-PLANT-01-001",
    "name": "Main Energy Meter - Plant 1",
    "plant_id": "00000000-0000-0000-0000-000000000001",
    "model": "SDM630",
    "serial_number": "SN123456"
  }'

# Add flow meter (diesel)
curl -X POST http://localhost:5000/api/settings/flow-meters \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "meter_id": "FM-PLANT-01-001",
    "name": "Diesel Meter - Plant 1",
    "plant_id": "00000000-0000-0000-0000-000000000001",
    "model": "FLOWMETER-X",
    "fluid_type": "diesel"
  }'
```

## Step 2: Configure MQTT in .env

```bash
# Enable MQTT instead of simulator
ENABLE_MQTT=true
ENABLE_SIMULATOR=false

# MQTT Broker URL
MQTT_BROKER_URL=mqtt://your-broker-ip:1883
# or with authentication:
MQTT_BROKER_URL=mqtt://username:password@your-broker-ip:1883
```

## Step 3: Send Data via MQTT

### Energy Meter Message Format

**Topic**: `energy/{meter_id}/data`

**Payload** (JSON):
```json
{
  "meter_id": "EM-PLANT-01-001",
  "plant_id": "00000000-0000-0000-0000-000000000001",
  "voltage_r": 230.5,
  "voltage_y": 231.2,
  "voltage_b": 229.8,
  "current_r": 105.3,
  "current_y": 102.1,
  "current_b": 103.5,
  "power_kw": 72.5,
  "power_kva": 78.3,
  "power_factor": 0.926,
  "energy_kwh": 12345.67,
  "frequency": 50.0,
  "third_harmonic_r": 2.3,
  "third_harmonic_y": 2.1,
  "third_harmonic_b": 2.5,
  "source": "CEB",
  "timestamp": 1686153600000
}
```

**Required Fields**:
- `meter_id`: Must match registered meter ID
- `voltage_r`, `current_r`, `power_kw`, `power_kva`: Numeric values
- `power_factor`: 0-1 (e.g., 0.926)

**Optional Fields**:
- `plant_id`: Auto-looked-up from meter_id if not provided
- `voltage_y`, `voltage_b`: Defaults to voltage_r if not provided
- `current_y`, `current_b`: Defaults to current_r if not provided
- `frequency`: Defaults to 50.0
- `third_harmonic_*`: Defaults to 0
- `source`: 'CEB' or 'GENERATOR', defaults to 'CEB'
- `timestamp`: Unix timestamp in milliseconds, defaults to now

### Diesel/Flow Meter Message Format

**Topic**: `diesel/{meter_id}/data`

**Payload** (JSON):
```json
{
  "meter_id": "FM-PLANT-01-001",
  "plant_id": "00000000-0000-0000-0000-000000000001",
  "flow_rate": 15.5,
  "total_volume": 45678.23,
  "timestamp": 1686153600000
}
```

**Required Fields**:
- `meter_id`: Must match registered meter ID
- `flow_rate`: Liters per hour
- `total_volume`: Total accumulated volume

## Step 4: Example MQTT Publisher (Python)

```python
import paho.mqtt.client as mqtt
import json
import time

broker = "your-broker-ip"
port = 1883
client = mqtt.Client("rhino-data-sender")

client.connect(broker, port, 60)
client.loop_start()

# Energy meter data
energy_data = {
    "meter_id": "EM-PLANT-01-001",
    "voltage_r": 230.5,
    "voltage_y": 231.2,
    "voltage_b": 229.8,
    "current_r": 105.3,
    "current_y": 102.1,
    "current_b": 103.5,
    "power_kw": 72.5,
    "power_kva": 78.3,
    "power_factor": 0.926,
    "energy_kwh": 12345.67,
    "timestamp": int(time.time() * 1000)
}

client.publish("energy/EM-PLANT-01-001/data", json.dumps(energy_data))

# Diesel meter data
diesel_data = {
    "meter_id": "FM-PLANT-01-001",
    "flow_rate": 15.5,
    "total_volume": 45678.23,
    "timestamp": int(time.time() * 1000)
}

client.publish("diesel/FM-PLANT-01-001/data", json.dumps(diesel_data))

client.loop_stop()
```

## Step 5: Query Data via API

### Get Latest Readings
```bash
curl http://localhost:5000/api/readings/latest?plant_id=00000000-0000-0000-0000-000000000001 \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Energy History
```bash
curl "http://localhost:5000/api/readings/energy/history?meter_id=EM-PLANT-01-001&limit=100" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Daily Summary
```bash
curl "http://localhost:5000/api/readings/summary/daily?from=2024-01-01&to=2024-01-31&meter_id=EM-PLANT-01-001" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Monthly Summary
```bash
curl "http://localhost:5000/api/readings/summary/monthly?plant_id=00000000-0000-0000-0000-000000000001" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Alerts
```bash
curl "http://localhost:5000/api/alerts?plant_id=00000000-0000-0000-0000-000000000001&limit=50" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Step 6: Testing

### 1. Install dependencies
```bash
npm install
```

### 2. Configure .env
```bash
ENABLE_MQTT=true
ENABLE_SIMULATOR=false
MQTT_BROKER_URL=mqtt://localhost:1883
```

### 3. Start backend
```bash
npm run dev
```

You should see:
```
[MQTT] Connected to broker: mqtt://localhost:1883
[MQTT] Subscribed to energy/+/data
[MQTT] Subscribed to diesel/+/data
```

### 4. Publish test message
```bash
# Using mosquitto_pub (if installed)
mosquitto_pub -h localhost -t "energy/EM-PLANT-01-001/data" -m '{
  "meter_id": "EM-PLANT-01-001",
  "voltage_r": 230.5,
  "current_r": 105.3,
  "power_kw": 72.5,
  "power_kva": 78.3,
  "power_factor": 0.926,
  "energy_kwh": 12345.67
}'
```

### 5. Check backend logs
```
[MQTT] Energy reading stored: EM-PLANT-01-001
```

### 6. View in UI
- Go to http://localhost:3000
- Dashboard should show live readings
- Alerts page should show any triggered alerts
- Reports can be generated with the data

## Troubleshooting

### Connection refused
- Check MQTT broker is running
- Verify `MQTT_BROKER_URL` is correct
- Check firewall allows port 1883

### Meter not found error
- Ensure meter_id is registered in database
- Check spelling matches exactly

### Data not appearing
- Verify meter_id in MQTT payload matches registered meter_id
- Check message is valid JSON
- Check topic format: `energy/{meter_id}/data` or `diesel/{meter_id}/data`

### Alerts not triggering
- Check alert setpoints are configured
- Verify readings exceed threshold values
- Check setpoint is enabled in Settings

## Database Schema Reference

### energy_readings table
```sql
CREATE TABLE energy_readings (
  id BIGSERIAL PRIMARY KEY,
  meter_id VARCHAR(100),
  plant_id UUID REFERENCES plants(id),
  voltage_r NUMERIC(8,3),
  voltage_y NUMERIC(8,3),
  voltage_b NUMERIC(8,3),
  current_r NUMERIC(8,3),
  current_y NUMERIC(8,3),
  current_b NUMERIC(8,3),
  power_kw NUMERIC(10,3),
  power_kva NUMERIC(10,3),
  power_factor NUMERIC(5,3),
  energy_kwh NUMERIC(14,3),
  frequency NUMERIC(5,2),
  third_harmonic_r NUMERIC(6,2),
  third_harmonic_y NUMERIC(6,2),
  third_harmonic_b NUMERIC(6,2),
  source VARCHAR(20),
  time_period VARCHAR(20),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### diesel_readings table
```sql
CREATE TABLE diesel_readings (
  id BIGSERIAL PRIMARY KEY,
  meter_id VARCHAR(100),
  plant_id UUID REFERENCES plants(id),
  flow_rate NUMERIC(10,3),
  total_volume NUMERIC(14,3),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);
```

### daily_energy_summary table
Pre-aggregated daily totals per meter:
- `summary_date`: Date
- `meter_id`: Meter ID
- `total_kwh`: Total energy for the day
- `max_kva`: Maximum demand
- `ceb_kwh`: Energy from CEB
- `generator_kwh`: Energy from generator
- `day_kwh`, `peak_kwh`, `off_peak_kwh`: Time-period breakdown

### daily_diesel_summary table
Pre-aggregated daily totals per meter:
- `summary_date`: Date
- `meter_id`: Meter ID
- `total_liters`: Total diesel consumed
- `generator_run_hours`: How long generator ran
