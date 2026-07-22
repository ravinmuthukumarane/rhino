"""
Schneider PM2120 Modbus reader.

mqtt.md notes this register map as "not yet extracted" for this project.
This uses the PM2120 map already validated in script/test.py (function 0x03,
IEEE-754 float32, 2 registers, big-endian, 1-based register numbers so the
wire address is (register - 1)). Re-check against PM2100_Modbus_Register_Map.pdf
if readings look wrong.
"""
import struct

REG_BASE = 1  # Schneider prints 1-based register numbers; wire address = addr - REG_BASE

REGISTERS = {
    'voltage_r':  3028,  # V_AN
    'voltage_y':  3030,  # V_BN
    'voltage_b':  3032,  # V_CN
    'current_r':  3000,  # I_A
    'current_y':  3002,  # I_B
    'current_b':  3004,  # I_C
    'power_kw':   3060,  # P_total
    'power_kva':  3076,  # S_total
    'power_factor': 3084,  # PF_total (four-quadrant encoding, see _decode_4q_pf)
    'frequency':  3110,
    'energy_kwh': 2700,  # E_active_del
}


def _decode_float32(regs):
    hi, lo = regs[0], regs[1]
    return struct.unpack(">f", struct.pack(">HH", hi, lo))[0]


def _decode_4q_pf(v):
    """Four-quadrant PF float (stored range -2..+2) -> signed PF in -1..+1."""
    if v > 1.0:
        return 2.0 - v
    if v < -1.0:
        return -2.0 - v
    return v


def read(client, unit_id):
    """Read all registers for one Schneider PM2120 meter. Returns backend payload fields."""
    values = {}
    for name, addr in REGISTERS.items():
        wire = addr - REG_BASE
        rr = client.read_holding_registers(wire, count=2, device_id=unit_id)
        if rr is None or rr.isError():
            raise IOError(f"read failed at {addr} ({name}): {rr}")
        values[name] = _decode_float32(rr.registers)

    return {
        'voltage_r': round(values['voltage_r'], 2),
        'voltage_y': round(values['voltage_y'], 2),
        'voltage_b': round(values['voltage_b'], 2),
        'current_r': round(values['current_r'], 3),
        'current_y': round(values['current_y'], 3),
        'current_b': round(values['current_b'], 3),
        'power_kw':  round(values['power_kw'], 3),
        'power_kva': round(values['power_kva'], 3),
        'power_factor': round(_decode_4q_pf(values['power_factor']), 3),
        'frequency': round(values['frequency'], 2),
        'energy_kwh': round(values['energy_kwh'], 3),
    }
