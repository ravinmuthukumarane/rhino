"""
Circutor CVM-C11 Modbus reader.

Function 0x03 or 0x04, int32, 2 registers, big-endian (high word first).
Power/reactive/PF/cos-phi are signed; V, I, energy are unsigned.
Register addresses + scales per mqtt.md section 4 (instantaneous table).
"""

# (address, scale, signed)
REGISTERS = {
    'voltage_r':  (0x00, 0.1,   False),
    'voltage_y':  (0x10, 0.1,   False),
    'voltage_b':  (0x20, 0.1,   False),
    'current_r':  (0x02, 0.001, False),
    'current_y':  (0x12, 0.001, False),
    'current_b':  (0x22, 0.001, False),
    'power_w':    (0x30, 1.0,   True),   # Active power III (W, signed)
    'power_va':   (0x36, 1.0,   False),  # Apparent power III (VA)
    'power_factor': (0x38, 0.01, True),  # Power factor III (signed)
    'frequency':  (0x3C, 0.01,  False),  # Hz
    'energy_kwh': (0xDC, 1.0,   False),  # Active energy consumed (kWh, "Total" tariff)
}


def _decode_int32(regs, signed):
    raw = (regs[0] << 16) | regs[1]
    if signed and raw >= 0x80000000:
        raw -= 0x100000000
    return raw


def read(client, unit_id):
    """Read all registers for one Circutor CVM-C11 meter. Returns backend payload fields."""
    values = {}
    for name, (addr, scale, signed) in REGISTERS.items():
        rr = client.read_holding_registers(addr, count=2, device_id=unit_id)
        if rr is None or rr.isError():
            raise IOError(f"read failed at 0x{addr:02X} ({name}): {rr}")
        values[name] = _decode_int32(rr.registers, signed) * scale

    return {
        'voltage_r': round(values['voltage_r'], 2),
        'voltage_y': round(values['voltage_y'], 2),
        'voltage_b': round(values['voltage_b'], 2),
        'current_r': round(values['current_r'], 3),
        'current_y': round(values['current_y'], 3),
        'current_b': round(values['current_b'], 3),
        'power_kw':  round(values['power_w'] / 1000.0, 3),
        'power_kva': round(values['power_va'] / 1000.0, 3),
        'power_factor': round(values['power_factor'], 3),
        'frequency': round(values['frequency'], 2),
        'energy_kwh': round(values['energy_kwh'], 3),
    }
