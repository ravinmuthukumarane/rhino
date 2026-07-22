# Energy Meter → Modbus → MQTT — Implementation Guide

A complete spec for writing a service that polls the plant energy meters over the
ADAM-4572 gateways and publishes readings to MQTT. Everything needed to write the
code (addresses, register maps, scaling, topics, payloads) is in this one file.

---

## 1. Architecture

```
   Meters (RS-485 Modbus RTU)          ADAM-4572              Your service
  ┌───────────────────────────┐      ┌──────────┐          ┌──────────────┐
  │ Wattz / CVM-C11 / PM2120  │──485─│ gateway  │──LAN:502─│ pymodbus TCP │
  │ each at a slave address    │      │ (per IP) │          │  → MQTT      │
  └───────────────────────────┘      └──────────┘          └──────┬───────┘
                                                                   │ 1883
                                                             ┌─────▼──────┐
                                                             │ MQTT broker│
                                                             └────────────┘
```

- Each **ADAM-4572** is a **Modbus TCP → RTU gateway** on TCP port **502**.
- You speak **Modbus TCP** to the gateway IP; the **meter's RS-485 address goes in
  the Modbus unit id** (`device_id` in pymodbus 3.x).
- The gateway only forwards unit ids that exist in its **Slave-ID table**
  (Operation tab). Unlisted id → exception `0x0A`. Listed but silent meter →
  exception `0x0B`.

---

## 2. Device inventory (gateway → unit id → meter)

CT ratio is informational: the meters are programmed with their CT and already
return **primary** values, so **do not multiply again** in code.

| Gateway IP     | Unit id | Meter type      | Location / load            | CT      | Status |
|----------------|---------|-----------------|----------------------------|---------|--------|
| 192.168.1.119  | 1       | Wattz (SDM630)  | BM Section 2 (Vac/VAT/CON) | 250/5   | ✅ live |
| 192.168.1.119  | 2       | Wattz (SDM630)  | BM Section 1 (ST/TH/MD/TR) | 800/5   | ✅ live |
| 192.168.1.119  | 3       | Wattz (SDM630)  | P1 – PR                    | 400/5   | ✅ live |
| 192.168.1.119  | 4       | Wattz (SDM630)  | STR / COMPRE               | 400/5   | ✅ live |
| 192.168.1.119  | 5       | Wattz (SDM630)  | Generator (P1)             | 2000/5  | ✅ live |
| 192.168.1.119  | 29      | Schneider PM2120| P1 Main Incoming           | 2000/5  | ⬜ add to table |
| 192.168.1.155  | 6       | Wattz (SDM630)  | Air Dryer                  | 100/5   | ✅ live |
| 192.168.1.155  | 7       | Wattz (SDM630)  | Compressor 1               | 100/5   | ✅ live |
| 192.168.1.155  | 8       | Wattz (SDM630)  | Compressor 3               | 100/5   | ✅ live |
| 192.168.1.155  | 9       | Wattz (SDM630)  | Compressor 4               | 100/5   | ✅ live |
| 192.168.1.155  | 10      | Wattz (SDM630)  | Compressor 2               | 100/5   | ✅ live |
| 192.168.1.155  | 11      | Wattz (SDM630)  | STR                        | 200/5   | ✅ live |
| 192.168.1.156  | 18      | Wattz (SDM630)  | Workshop (Canteen)         | 100/5   | ✅ live |
| 192.168.1.156  | 19      | Wattz (SDM630)  | Canteen                    | 150/5   | ✅ live |
| 192.168.1.156  | 20      | Wattz (SDM630)  | Main Office                | 100/5   | ✅ live |
| 192.168.1.157  | 12      | Wattz (SDM630)  | P4 – STR/TR                | 200/5   | ✅ live |
| 192.168.1.157  | 13      | Wattz (SDM630)  | P4 – Sub Section           | 400/5   | ✅ live |
| 192.168.1.157  | 14      | Wattz (SDM630)  | Strip Ceiling Plant        | 400/5   | ✅ live |
| 192.168.1.157  | 15      | Wattz (SDM630)  | P4 – Bag Opener            | 250/5   | ✅ live |
| 192.168.1.157  | 16      | Wattz (SDM630)  | P4 – ST/TR                 | 250/5   | ✅ live |
| 192.168.1.158  | 17      | Wattz (SDM630)  | Generator (P4)             | 2000/5  | ⬜ verify |
| 192.168.1.158  | 30      | Schneider PM2120| P4 Main Incoming           | 1600/5  | ⬜ add to table |
| 192.168.1.123  | 21      | Circutor CVM-C11| P2 – PR                    | 400/5   | ⬜ add to table |
| 192.168.1.123  | 22      | Circutor CVM-C11| P1 – Cellulose             | 250/5   | ⬜ add to table |
| 192.168.1.123  | 23      | Circutor CVM-C11| Office / Wshop / CWA       | 250/5   | ⬜ add to table |
| 192.168.1.123  | 24      | Circutor CVM-C11| P4 – BM                    | 800/5   | ⬜ add to table |
| 192.168.1.123  | 25      | Circutor CVM-C11| P4 – PR                    | 800/5   | ⬜ add to table |
| 192.168.1.159  | 26      | Circutor CVM-C11| Compressor 1 (P4)          | 100/5   | ⚠ routed, meter silent (0x0B) |
| 192.168.1.159  | 27      | Circutor CVM-C11| Compressor 2 (P4)          | 100/5   | ⬜ add to table |
| 192.168.1.159  | 28      | Circutor CVM-C11| Air Dryer (P4)             | 100/5   | ⬜ add to table |

> Gateway config reminder: on each gateway's **Operation** tab, add rows in
> *Manual Slave ID Control* where `ID` = incoming unit id and `Map ID` = meter's
> RS-485 address (keep them equal). Serial params (baud/parity) on the gateway
> must match the meter or the meter stays silent (`0x0B`).

---

## 3. Modbus read spec — Wattz (Eastron SDM630 map)

- **Function:** `0x04` (read input registers).
- **Data type:** IEEE-754 **float32**, **2 registers**, **big-endian** (high word first).
- **Addresses:** hex, base-0. Value is already in engineering units (V, A, W, Hz, kWh…).

| Name                     | Addr | Unit |     | Name                    | Addr | Unit |
|--------------------------|------|------|-----|-------------------------|------|------|
| Voltage L1               | 0x00 | V    |     | Total active power      | 0x34 | W    |
| Voltage L2               | 0x02 | V    |     | Total apparent power    | 0x38 | VA   |
| Voltage L3               | 0x04 | V    |     | Total reactive power    | 0x3C | var  |
| Current L1               | 0x06 | A    |     | Total power factor      | 0x3E | –    |
| Current L2               | 0x08 | A    |     | Total phase angle       | 0x42 | deg  |
| Current L3               | 0x0A | A    |     | **Frequency**           | 0x46 | Hz   |
| Active power L1          | 0x0C | W    |     | Import active energy    | 0x48 | kWh  |
| Active power L2          | 0x0E | W    |     | Export active energy    | 0x4A | kWh  |
| Active power L3          | 0x10 | W    |     | Import reactive energy  | 0x4C | kvarh|
| Apparent power L1/L2/L3  | 0x12/0x14/0x16 | VA |  | Export reactive energy | 0x4E | kvarh|
| Reactive power L1/L2/L3  | 0x18/0x1A/0x1C | var |  | Total kVAh            | 0x50 | kVAh |
| Power factor L1/L2/L3    | 0x1E/0x20/0x22 | –  |  | Total Ah              | 0x52 | Ah   |
| Phase angle L1/L2/L3     | 0x24/0x26/0x28 | deg|  | Total system power demand | 0x54 | W |
| Average voltage L-N      | 0x2A | V    |     | Max total power demand  | 0x56 | W    |
| Average current          | 0x2E | A    |     | Voltage L1-L2/L2-L3/L3-L1 | 0xC8/0xCA/0xCC | V |
| Sum of line currents     | 0x30 | A    |     | Average voltage L-L     | 0xCE | V    |
|                          |      |      |     | Neutral current         | 0xE0 | A    |
|                          |      |      |     | Total active energy     | 0x156| kWh  |
|                          |      |      |     | Total reactive energy   | 0x158| kvarh|

Decode (Python):
```python
import struct
hi, lo = regs[0], regs[1]                 # from read_input_registers(addr, count=2)
value = struct.unpack(">f", struct.pack(">HH", hi, lo))[0]
```
Reference implementation: `wattz_meter.py` (full map + reader).

---

## 4. Modbus read spec — Circutor CVM-C11

- **Function:** `0x03` or `0x04`.
- **Data type:** **int32**, **2 registers**, **big-endian** (high word first).
  Power / reactive / PF / cos φ are **signed**; V, I, energy are unsigned.
- **Addresses:** hex, base-0. **Apply the scale** in the table (engineering =
  raw × scale).

Instantaneous (Table 1):

| Name                | Addr | scale → unit |     | Name                | Addr | scale → unit |
|---------------------|------|--------------|-----|---------------------|------|--------------|
| Voltage L1          | 0x00 | ×0.1 → V     |     | Active power III    | 0x30 | ×1 → W (signed) |
| Current L1          | 0x02 | ×0.001 → A   |     | Reactive ind III    | 0x32 | ×1 → var |
| Active power L1     | 0x04 | ×1 → W (s)   |     | Reactive cap III    | 0x34 | ×1 → var |
| Reactive ind L1     | 0x06 | ×1 → var (s) |     | Apparent power III  | 0x36 | ×1 → VA |
| Reactive cap L1     | 0x08 | ×1 → var (s) |     | Power factor III    | 0x38 | ×0.01 (s) |
| Apparent power L1   | 0x0A | ×1 → VA      |     | Cos φ III           | 0x3A | ×0.01 (s) |
| Power factor L1     | 0x0C | ×0.01 (s)    |     | Frequency           | 0x3C | ×0.01 → Hz |
| Cos φ L1            | 0x0E | ×0.01 (s)    |     | Voltage L1-L2       | 0x3E | ×0.1 → V |
| Voltage L2          | 0x10 | ×0.1 → V     |     | Voltage L2-L3       | 0x40 | ×0.1 → V |
| Current L2          | 0x12 | ×0.001 → A   |     | Voltage L3-L1       | 0x42 | ×0.1 → V |
| Active power L2     | 0x14 | ×1 → W (s)   |     | Neutral current     | 0x44 | ×0.001 → A |
| Voltage L3          | 0x20 | ×0.1 → V     |     |                     |      |          |
| Current L3          | 0x22 | ×0.001 → A   |     |                     |      |          |
| Active power L3     | 0x24 | ×1 → W (s)   |     |                     |      |          |

Energy totals (Table 2, "Total" tariff column):

| Name                     | Addr | Unit  |     | Name                    | Addr | Unit  |
|--------------------------|------|-------|-----|-------------------------|------|-------|
| Active energy consumed   | 0xDC | kWh   |     | Active energy generated | 0xF0 | kWh   |
| Ind reactive consumed    | 0xE0 | kvarh |     | Ind reactive generated  | 0xF4 | kvarh |
| Cap reactive consumed    | 0xE4 | kvarh |     | Cap reactive generated  | 0xF8 | kvarh |
| Apparent consumed        | 0xE8 | kVAh  |     | Apparent generated      | 0xFC | kVAh  |

Decode (Python):
```python
raw = (regs[0] << 16) | regs[1]           # big-endian, high word first
if signed and raw >= 0x80000000:
    raw -= 0x100000000
value = raw * scale
```
Reference implementation: `cvm_c11.py` (full map + reader).

Schneider PM2120 (ids 29/30): map not yet extracted — see `PM2100_Modbus_Register_Map.pdf`. PM2100/PM2000 series are float32 (FC03), addresses differ; add when commissioned.

---

## 5. pymodbus notes (v3.13 — important)

```python
from pymodbus.client import ModbusTcpClient

client = ModbusTcpClient("192.168.1.119", port=502, timeout=3)  # DEFAULT socket framer
client.connect()

rr = client.read_input_registers(0x00, count=2, device_id=UNIT_ID)  # FC04
rr = client.read_holding_registers(addr, count=2, device_id=UNIT_ID) # FC03
if rr.isError():
    ...      # exception 0x0A (not routed) / 0x0B (meter silent) / timeout
regs = rr.registers   # list[int] of 16-bit registers
client.close()
```

- **Keyword is `device_id=`** in 3.11+, **not** `slave=`.
- Use the **default socket framer** — the ADAM-4572 speaks real Modbus TCP (MBAP).
  Do NOT use the RTU framer (times out).
- **Reuse one `ModbusTcpClient` per gateway** across all its units; don't reconnect
  per register. Read each 32-bit value as `count=2`.
- Batch option: the SDM630 block 0x00–0x56 is contiguous; you may read it in one
  `read_input_registers(0x00, count=88, device_id=…)` and slice, but reading
  per-value is simpler and works fine.

---

## 6. MQTT design

Library: `paho-mqtt`.

### Broker connection
```python
import paho.mqtt.client as mqtt
c = mqtt.Client(client_id="meter-gateway", protocol=mqtt.MQTTv311)
# c.username_pw_set(user, pass)   # if broker requires auth
c.will_set("energy/status/bridge", payload="offline", qos=1, retain=True)  # LWT
c.connect("BROKER_HOST", 1883, keepalive=60)
c.loop_start()
c.publish("energy/status/bridge", "online", qos=1, retain=True)
```

### Topic scheme
One topic per meter, one JSON message per poll:

```
energy/<gateway_ip>/<unit_id>          # e.g. energy/192.168.1.155/11
```
or a friendlier slug:
```
energy/<location_slug>                 # e.g. energy/p1/str
```
Optionally a per-meter status topic (retained):
```
energy/<location_slug>/status          # "online" / "offline"
```

### Payload (JSON)
```json
{
  "ts": "2026-07-21T15:40:03+05:30",
  "gateway": "192.168.1.155",
  "unit": 11,
  "name": "STR",
  "type": "wattz",
  "online": true,
  "measurements": {
    "voltage_ln_avg": 240.2,
    "current_avg": 59.4,
    "power_active_total_w": 32660.0,
    "power_factor_total": -0.764,
    "frequency_hz": 50.04,
    "energy_import_kwh": 175617.0
  }
}
```
- On read failure set `"online": false` and omit/keep last `measurements` empty;
  publish so downstream sees the outage.
- Use **QoS 1**. Use `retain=True` only for status topics (so a late subscriber
  sees current state); leave measurement messages non-retained (they're periodic).
- Publish numbers already in engineering units; keep field names stable and
  snake_case.

---

## 7. Recommended code structure

```
meters.yaml / meters.py      # the inventory table from §2 as data
wattz_meter.py               # SDM630 reader  (exists)
cvm_c11.py                   # CVM-C11 reader (exists)
pm2120.py                    # add later
mqtt_bridge.py               # main loop: poll → build JSON → publish
```

Config row schema (one per meter):
```python
{"gateway": "192.168.1.155", "unit": 11, "type": "wattz",
 "name": "STR", "location": "p1/str", "ct": "200/5"}
```

Main loop (pseudocode):
```
load meters config
connect MQTT (with LWT), publish bridge "online"
group meters by gateway
open one ModbusTcpClient per gateway
loop forever:
    for each gateway:
        for each meter on that gateway:
            try: values = reader.read(client, unit)      # dict of engineering values
                 online = True
            except: online = False
            publish energy/<...> JSON {ts, gateway, unit, name, type, online, measurements}
    sleep(POLL_INTERVAL)   # e.g. 5–15 s for instantaneous; energy changes slowly
handle SIGINT: publish bridge "offline", disconnect
```

Design points:
- **Reader dispatch by `type`**: `"wattz"` → SDM630 float map, `"cvm-c11"` →
  int32 scaled map, `"pm2120"` → later.
- **Per-meter timeout/skip**: one silent meter (0x0B) must not stall the rest —
  catch, mark offline, continue.
- **Reconnect logic**: if a gateway TCP drops, recreate its client next cycle.
- **Poll interval**: 5–15 s is plenty; the ADAM-4572 response timeout is 1200 ms
  and each meter is ~10–45 registers, so a full gateway sweep is well under a second.
- **Don't re-apply CT ratio** — meters already report primary values.

---

## 8. Requirements

```
pymodbus>=3.0
paho-mqtt>=1.6
pyyaml            # if using meters.yaml
```

## 9. Exception cheat-sheet (what a failed read means)

| Result           | Meaning                              | Fix |
|------------------|--------------------------------------|-----|
| DATA             | OK                                   | –   |
| exc `0x0A`       | unit id not in gateway Slave-ID table| add ID/Map ID on gateway Operation tab |
| exc `0x0B`       | routed, but meter didn't answer      | match gateway baud/parity to meter; check RS-485 wiring/address/power |
| timeout/no reply | gateway unreachable or wrong port    | check IP / port 502 / network |
```
