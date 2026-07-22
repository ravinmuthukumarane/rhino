"""
Wattz (Eastron SDM630) Modbus reader.

Function 0x04 (read input registers), IEEE-754 float32, 2 registers,
big-endian (high word first). Values are already in engineering units.
Register addresses per mqtt.md section 3.
"""
import struct

REGISTERS = {
    'voltage_r':  0x00,
    'voltage_y':  0x02,
    'voltage_b':  0x04,
    'current_r':  0x06,
    'current_y':  0x08,
    'current_b':  0x0A,
    'power_w':    0x34,   # Total active power (W)
    'power_va':   0x38,   # Total apparent power (VA)
    'power_factor': 0x3E, # Total power factor
    'frequency':  0x46,   # Hz
    'energy_kwh': 0x48,   # Import active energy (kWh)
}


def _decode_float32(regs):
    hi, lo = regs[0], regs[1]
    return struct.unpack(">f", struct.pack(">HH", hi, lo))[0]


def read(client, unit_id):
    """Read all registers for one Wattz meter. Returns the backend payload fields."""
    values = {}
    for name, addr in REGISTERS.items():
        rr = client.read_input_registers(addr, count=2, device_id=unit_id)
        if rr is None or rr.isError():
            raise IOError(f"read failed at 0x{addr:02X} ({name}): {rr}")
        values[name] = _decode_float32(rr.registers)

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
