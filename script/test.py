#!/usr/bin/env python3
"""
read_energy_meters.py
=====================================================================
Polls every energy meter listed in "Meter & CT details" over Modbus TCP.

Topology
--------
Each "Converter IP" is a Modbus-TCP-to-RS485 gateway. Several meters hang
off one gateway on a shared RS-485 bus, each addressed by its Modbus slave
address (the "Modbus Address" column = the Modbus unit / slave id).

So the script opens ONE TCP connection per gateway IP, then reads each meter
on that gateway by its unit id, dispatching to the correct register map for
that meter's model.

Supported models (full register maps built in):
  - Circutor CVM-C11   (32-bit INTEGER registers, scaled)
  - Schneider PM2120   (32-bit IEEE-754 FLOAT registers; map sourced from
    Schneider's public PM2100/PM2200/EM6400NG register list, which is
    shared verbatim across PM2110/PM2120/PM2130 - see
    PM2100_Modbus_Register_Map.pdf)

Not supported:
  - Wattz Multifunction meter -> NO public Modbus register map exists.
    These meters are polled-skipped and reported. Drop the map into
    REGISTER_MAPS['wattz'] once you obtain it from Data Acquisition Design
    (sales@dataad.co.uk) and they will be read automatically.

Requirements
------------
    pip install pymodbus>=3.0
    (this file decodes 32/64-bit values itself with `struct`, so it does not
     depend on pymodbus payload helpers that were removed in 3.9+)

Usage
-----
    python read_energy_meters.py                # poll once, print + write CSV/JSON
    python read_energy_meters.py --loop 30      # poll every 30 s forever
    python read_energy_meters.py --only 21,22   # only these unit ids
    python read_energy_meters.py --ip 192.168.1.123   # only one gateway
=====================================================================
"""

from __future__ import annotations
import argparse
import csv
import json
import struct
import sys
import time
from datetime import datetime

try:
    from pymodbus.client import ModbusTcpClient
    from pymodbus.framer import FramerType
except ImportError:
    sys.exit("pymodbus not installed. Run:  pip install 'pymodbus>=3.0'")

MODBUS_TCP_PORT = 502
TIMEOUT_S       = 3.0
MAX_BLOCK       = 120     # max 16-bit registers per Modbus read (spec limit 125)
MAX_GAP         = 8       # merge registers into one block if gap <= this many words

# The ADAM-4572 gateways DO real Modbus RTU<->TCP protocol translation, so
# the client must speak standard Modbus/TCP (MBAP header) - FramerType.SOCKET.
# Confirmed by live testing: Wattz meters (which reply normally) only work
# with SOCKET framing; RTU-over-TCP framing against this gateway just shows
# you a mangled echo of your own request. The "Unknown response 128" /
# "Unable to decode request" errors seen on every Circutor/Schneider meter
# are the gateway's own exception 0x0A/0x0B ("Gateway Path Unavailable" /
# "Gateway Target Device Failed to Respond") reported via a non-standard
# exception function byte (0x80 instead of 0x83) that pymodbus won't parse -
# i.e. the gateway itself got no reply from those meters on the RS-485 bus.
# That points to a serial-parameter mismatch (baud/parity/stop bits) or a
# wrong slave address on the Circutor/Schneider meters, not a framing bug.
DEFAULT_FRAMER = FramerType.SOCKET

# If your meters are programmed with their CT ratio, they already report
# PRIMARY-side values. Leave this False. Set True ONLY if a meter is wired
# with the CT ratio NOT programmed (i.e. it reports secondary values) and you
# want the script to scale current/power/energy by CT primary/secondary.
APPLY_CT_SCALING = False


# =====================================================================
#  REGISTER MAPS
#  Each entry: (name, address, dtype, scale, unit)
#    address : Circutor -> protocol address (0-based) as printed in the
#              Circutor manual (hex there, decimal here).
#              Schneider -> the 1-based register number from Schneider's list;
#              set 'reg_base': 1 so the reader subtracts 1 for the wire address.
#    dtype   : 'uint32' | 'int32' | 'uint16' | 'int64' | 'float32' | '4q_pf'
#    scale   : multiply the decoded raw value by this to get engineering units
#    unit    : display unit AFTER scaling
#  'word_order': 'big'  -> high 16-bit word first (ABCD). Both these meters
#                use big word order. Change to 'little' (CDAB) only if a meter
#                returns byte-swapped nonsense.
# =====================================================================

REGISTER_MAPS = {
    # -----------------------------------------------------------------
    "circutor_cvm_c11": {
        "word_order": "big",
        "reg_base": 0,                       # addresses are already 0-based protocol addrs
        "read_fc": "holding",                # FC03 (CVM also supports FC04)
        "max_block": 40,                      # CVM-C11 manual: max 20 variables (40 registers) per frame
        "registers": [
            # --- Phase L1 ---
            ("V_L1",        0x00, "uint32", 0.1,   "V"),
            ("I_L1",        0x02, "uint32", 0.001, "A"),     # mA -> A
            ("P_L1",        0x04, "int32",  0.001, "kW"),    # W  -> kW
            ("QL_L1",       0x06, "int32",  0.001, "kvar"),
            ("Qc_L1",       0x08, "int32",  0.001, "kvar"),
            ("S_L1",        0x0A, "int32",  0.001, "kVA"),
            ("PF_L1",       0x0C, "int32",  0.01,  ""),
            ("cosphi_L1",   0x0E, "int32",  0.01,  ""),
            # --- Phase L2 ---
            ("V_L2",        0x10, "uint32", 0.1,   "V"),
            ("I_L2",        0x12, "uint32", 0.001, "A"),
            ("P_L2",        0x14, "int32",  0.001, "kW"),
            ("QL_L2",       0x16, "int32",  0.001, "kvar"),
            ("Qc_L2",       0x18, "int32",  0.001, "kvar"),
            ("S_L2",        0x1A, "int32",  0.001, "kVA"),
            ("PF_L2",       0x1C, "int32",  0.01,  ""),
            ("cosphi_L2",   0x1E, "int32",  0.01,  ""),
            # --- Phase L3 ---
            ("V_L3",        0x20, "uint32", 0.1,   "V"),
            ("I_L3",        0x22, "uint32", 0.001, "A"),
            ("P_L3",        0x24, "int32",  0.001, "kW"),
            ("QL_L3",       0x26, "int32",  0.001, "kvar"),
            ("Qc_L3",       0x28, "int32",  0.001, "kvar"),
            ("S_L3",        0x2A, "int32",  0.001, "kVA"),
            ("PF_L3",       0x2C, "int32",  0.01,  ""),
            ("cosphi_L3",   0x2E, "int32",  0.01,  ""),
            # --- Three-phase totals ---
            ("P_III",       0x30, "int32",  0.001, "kW"),
            ("QL_III",      0x32, "int32",  0.001, "kvar"),
            ("Qc_III",      0x34, "int32",  0.001, "kvar"),
            ("S_III",       0x36, "int32",  0.001, "kVA"),
            ("PF_III",      0x38, "int32",  0.01,  ""),
            ("cosphi_III",  0x3A, "int32",  0.01,  ""),
            ("Frequency",   0x3C, "uint32", 0.01,  "Hz"),
            ("V_L1_L2",     0x3E, "uint32", 0.1,   "V"),
            ("V_L2_L3",     0x40, "uint32", 0.1,   "V"),
            ("V_L3_L1",     0x42, "uint32", 0.1,   "V"),
            ("I_Neutral",   0x44, "uint32", 0.001, "A"),
            ("THD_V_L1",    0x46, "uint32", 0.1,   "%"),
            ("THD_V_L2",    0x48, "uint32", 0.1,   "%"),
            ("THD_V_L3",    0x4A, "uint32", 0.1,   "%"),
            ("THD_I_L1",    0x4C, "uint32", 0.1,   "%"),
            ("THD_I_L2",    0x4E, "uint32", 0.1,   "%"),
            ("THD_I_L3",    0x50, "uint32", 0.1,   "%"),
            # --- Energy, TOTAL tariff column (kWh-range registers) ---
            ("E_active_imp",   0xDC, "uint32", 1.0, "kWh"),
            ("E_reactiveL_imp",0xE0, "uint32", 1.0, "kvarh"),
            ("E_apparent_imp", 0xE8, "uint32", 1.0, "kVAh"),
            ("E_active_gen",   0xF0, "uint32", 1.0, "kWh"),
        ],
    },

    # -----------------------------------------------------------------
    # Built from Schneider Electric's public "EasyLogic PM2100 / PM2200 /
    # EM6400NG Register List" (see PM2100_Modbus_Register_Map.pdf). That
    # register list is shared verbatim across PM2110/PM2120/PM2130, so this
    # map is correct for the "Schneider PM2120" meters in the site inventory.
    "schneider_pm2120": {
        "word_order": "big",
        "reg_base": 1,                       # Schneider prints 1-based register numbers
        "read_fc": "holding",                # FC03
        "registers": [
            # --- Current ---
            ("I_A",     3000, "float32", 1.0, "A"),
            ("I_B",     3002, "float32", 1.0, "A"),
            ("I_C",     3004, "float32", 1.0, "A"),
            ("I_N",     3006, "float32", 1.0, "A"),
            ("I_avg",   3010, "float32", 1.0, "A"),
            ("I_unbalance_A",     3012, "float32", 1.0, "%"),
            ("I_unbalance_worst", 3018, "float32", 1.0, "%"),
            # --- Voltage L-L ---
            ("V_AB",    3020, "float32", 1.0, "V"),
            ("V_BC",    3022, "float32", 1.0, "V"),
            ("V_CA",    3024, "float32", 1.0, "V"),
            ("V_LL_avg",3026, "float32", 1.0, "V"),
            # --- Voltage L-N ---
            ("V_AN",    3028, "float32", 1.0, "V"),
            ("V_BN",    3030, "float32", 1.0, "V"),
            ("V_CN",    3032, "float32", 1.0, "V"),
            ("V_LN_avg",3036, "float32", 1.0, "V"),
            ("V_unbalance_LL_worst", 3044, "float32", 1.0, "%"),
            ("V_unbalance_LN_worst", 3052, "float32", 1.0, "%"),
            # --- Power ---
            ("P_A",     3054, "float32", 1.0, "kW"),
            ("P_B",     3056, "float32", 1.0, "kW"),
            ("P_C",     3058, "float32", 1.0, "kW"),
            ("P_total", 3060, "float32", 1.0, "kW"),
            ("Q_A",     3062, "float32", 1.0, "kvar"),
            ("Q_B",     3064, "float32", 1.0, "kvar"),
            ("Q_C",     3066, "float32", 1.0, "kvar"),
            ("Q_total", 3068, "float32", 1.0, "kvar"),
            ("S_A",     3070, "float32", 1.0, "kVA"),
            ("S_B",     3072, "float32", 1.0, "kVA"),
            ("S_C",     3074, "float32", 1.0, "kVA"),
            ("S_total", 3076, "float32", 1.0, "kVA"),
            # --- Power factor (four-quadrant float encoding) ---
            ("PF_A",     3078, "4q_pf", 1.0, ""),
            ("PF_B",     3080, "4q_pf", 1.0, ""),
            ("PF_C",     3082, "4q_pf", 1.0, ""),
            ("PF_total", 3084, "4q_pf", 1.0, ""),
            ("PF_disp_A",     3086, "4q_pf", 1.0, ""),
            ("PF_disp_total", 3092, "4q_pf", 1.0, ""),
            # --- Frequency ---
            ("Frequency",3110, "float32", 1.0, "Hz"),
            # --- Demand ---
            ("P_demand_present", 3766, "float32", 1.0, "kW"),
            ("P_demand_predicted",3768, "float32", 1.0, "kW"),
            ("P_demand_peak",    3770, "float32", 1.0, "kW"),
            ("Q_demand_last",   3780, "float32", 1.0, "kvar"),
            ("Q_demand_peak",   3786, "float32", 1.0, "kvar"),
            ("S_demand_last",   3796, "float32", 1.0, "kVA"),
            ("S_demand_peak",   3802, "float32", 1.0, "kVA"),
            ("I_demand_last_avg",3876, "float32", 1.0, "A"),
            ("I_demand_peak_avg",3882, "float32", 1.0, "A"),
            # --- Energy (floating point) ---
            ("E_active_del",    2700, "float32", 1.0, "kWh"),
            ("E_active_rec",    2702, "float32", 1.0, "kWh"),
            ("E_reactive_del",  2708, "float32", 1.0, "kvarh"),
            ("E_reactive_rec",  2710, "float32", 1.0, "kvarh"),
            ("E_apparent_del",  2716, "float32", 1.0, "kVAh"),
            ("E_apparent_rec",  2718, "float32", 1.0, "kVAh"),
            # --- THD ---
            ("THD_I_A",  21300, "float32", 1.0, "%"),
            ("THD_I_B",  21302, "float32", 1.0, "%"),
            ("THD_I_C",  21304, "float32", 1.0, "%"),
            ("THD_V_AB", 21322, "float32", 1.0, "%"),
            ("THD_V_BC", 21324, "float32", 1.0, "%"),
            ("THD_V_CA", 21326, "float32", 1.0, "%"),
            ("THD_V_AN", 21330, "float32", 1.0, "%"),
            ("THD_V_BN", 21332, "float32", 1.0, "%"),
            ("THD_V_CN", 21334, "float32", 1.0, "%"),
        ],
    },

    # -----------------------------------------------------------------
    # No public register map exists for the Wattz meter. Leave empty.
    # When you get the map from Data Acquisition Design, fill "registers"
    # in the same format and set the correct dtype/scale/word_order.
    "wattz": None,
}


# =====================================================================
#  METER INVENTORY  (generated from Meter & CT details.xlsx)
#  ct = (primary, secondary) parsed from the "CT" column
# =====================================================================
INVENTORY = [
    # gateway_ip,       unit, model_key,            location, description,                 ct
    # Units on this gateway shifted +1 on-device 2026-08-04 (old 1-5 -> new 2-6); 29 unaffected.
    ("192.168.1.119",   4,  "wattz",            "P1", "PR",                          (400, 5)),
    ("192.168.1.119",   3,  "wattz",            "P1", "BM Sec1 ST/TH/MD/TR",         (800, 5)),
    ("192.168.1.119",   2,  "wattz",            "P1", "BM Sec2 Vacuum/VAT/CON",      (250, 5)),
    ("192.168.1.119",   5,  "wattz",            "P1", "STR/COMPRE",                  (400, 5)),
    ("192.168.1.119",   6,  "wattz",            "P1", "GENERATOR",                   (2000, 5)),
    ("192.168.1.119",  29,  "schneider_pm2120", "P1", "P1 Main Incoming Energy",     (2000, 5)),

    ("192.168.1.155",   7,  "wattz",            "P1", "Compressor 1",                (100, 5)),
    ("192.168.1.155",  10,  "wattz",            "P1", "Compressor 2",                (100, 5)),
    ("192.168.1.155",   8,  "wattz",            "P1", "Compressor 3",                (100, 5)),
    ("192.168.1.155",   9,  "wattz",            "P1", "Compressor 4",                (100, 5)),
    ("192.168.1.155",   6,  "wattz",            "P1", "Air Dryer",                   (100, 5)),
    ("192.168.1.155",  11,  "wattz",            "P1", "STR",                         (200, 5)),

    ("192.168.1.123",  21,  "circutor_cvm_c11", "P4", "P2-PR",                       (400, 5)),
    ("192.168.1.123",  22,  "circutor_cvm_c11", "P4", "P1-CELLULOSE",                (250, 5)),
    ("192.168.1.123",  23,  "circutor_cvm_c11", "P4", "OFFICE/WSHOP/CWA",            (250, 5)),
    ("192.168.1.123",  24,  "circutor_cvm_c11", "P4", "P4-BM",                       (800, 5)),
    ("192.168.1.123",  25,  "circutor_cvm_c11", "P4", "P4-PR",                       (800, 5)),

    ("192.168.1.157",  12,  "wattz",            "P4", "P4-STR/TR",                   (200, 5)),
    ("192.168.1.157",  13,  "wattz",            "P4", "P4-SUB SECTION",              (400, 5)),
    ("192.168.1.157",  15,  "wattz",            "P4", "P4-BAG OPENER",               (250, 5)),
    ("192.168.1.157",  14,  "wattz",            "P4", "STRIP CEILING PLANT",         (400, 5)),
    ("192.168.1.157",  16,  "wattz",            "P4", "P4-ST/TR",                     (250, 5)),

    ("192.168.1.158",  17,  "wattz",            "P4", "GENERATOR",                   (2000, 5)),
    ("192.168.1.158",  30,  "schneider_pm2120", "P4", "P4 Main Incoming Energy",     (1600, 5)),

    ("192.168.1.159",  26,  "circutor_cvm_c11", "P4", "Compressor 1",                (100, 5)),
    ("192.168.1.159",  27,  "circutor_cvm_c11", "P4", "Compressor 2",                (100, 5)),
    ("192.168.1.159",  28,  "circutor_cvm_c11", "P4", "Air Dryer",                   (100, 5)),

    ("192.168.1.156",  18,  "wattz",            "Canteen", "WORKSHOP",               (100, 5)),
    ("192.168.1.156",  19,  "wattz",            "Canteen", "CANTEEN",                (150, 5)),
    ("192.168.1.156",  20,  "wattz",            "Canteen", "MAIN OFFICE",            (100, 5)),
]


# =====================================================================
#  DECODING HELPERS
# =====================================================================
_WORD_COUNT = {"uint16": 1, "int16": 1,
               "uint32": 2, "int32": 2, "float32": 2, "4q_pf": 2,
               "int64": 4, "uint64": 4}


def _words_for(dtype: str) -> int:
    return _WORD_COUNT[dtype]


def _decode(words, dtype: str, word_order: str):
    """Decode a list of 16-bit register words into a Python number."""
    regs = list(words)
    if word_order == "little":
        regs = list(reversed(regs))
    raw = b"".join(struct.pack(">H", r & 0xFFFF) for r in regs)  # bytes big-endian in each word
    if dtype == "float32":
        return struct.unpack(">f", raw)[0]
    if dtype == "int32":
        return struct.unpack(">i", raw)[0]
    if dtype == "uint32":
        return struct.unpack(">I", raw)[0]
    if dtype == "int64":
        return struct.unpack(">q", raw)[0]
    if dtype == "uint64":
        return struct.unpack(">Q", raw)[0]
    if dtype == "uint16":
        return struct.unpack(">H", raw)[0]
    if dtype == "int16":
        return struct.unpack(">h", raw)[0]
    if dtype == "4q_pf":
        return _decode_4q_pf(struct.unpack(">f", raw)[0])
    raise ValueError(f"unknown dtype {dtype}")


def _decode_4q_pf(v: float) -> float:
    """Schneider four-quadrant power-factor float (stored range -2..+2).
    Returns signed PF in -1..+1. Sign convention (lead/lag vs import/export)
    depends on meter setup; verify against the panel display for one meter."""
    if v > 1.0:
        return 2.0 - v
    if v < -1.0:
        return -2.0 - v
    return v


def _plan_blocks(register_defs, reg_base, max_block=MAX_BLOCK):
    """Group register addresses into a small number of contiguous Modbus reads.
    Returns list of (wire_start, count) plus a lookup wire_addr -> index used
    later to slice values back out."""
    items = []
    for name, addr, dtype, scale, unit in register_defs:
        wire = addr - reg_base
        items.append((wire, _words_for(dtype)))
    items.sort()
    blocks = []
    cur_s = cur_e = None
    for s, w in items:
        e = s + w
        if cur_s is None:
            cur_s, cur_e = s, e
        elif s - cur_e <= MAX_GAP and (e - cur_s) <= max_block:
            cur_e = max(cur_e, e)
        else:
            blocks.append((cur_s, cur_e - cur_s))
            cur_s, cur_e = s, e
    if cur_s is not None:
        blocks.append((cur_s, cur_e - cur_s))
    return blocks


# =====================================================================
#  MODBUS I/O
# =====================================================================
_ADDR_KW = None   # cached device-address keyword for this pymodbus version


def _read_holding(client, address, count, unit):
    """Read holding registers (FC03), compatible across pymodbus versions.

    The device-address keyword changed over releases:
        pymodbus 2.x         -> unit=
        pymodbus 3.0 .. 3.8  -> slave=
        pymodbus 3.9+        -> device_id=
    We detect which one this install accepts and cache it.
    """
    global _ADDR_KW
    if _ADDR_KW is not None:
        return client.read_holding_registers(address, count=count, **{_ADDR_KW: unit})

    last_err = None
    for kw in ("device_id", "slave", "unit"):
        try:
            resp = client.read_holding_registers(address, count=count, **{kw: unit})
            _ADDR_KW = kw          # remember the one that worked
            return resp
        except TypeError as e:
            last_err = e
            continue
    # last resort: positional signature with no device kwarg (single-device gateways)
    try:
        return client.read_holding_registers(address, count)
    except TypeError:
        raise last_err


def read_meter(client, unit, model_key, ct):
    """Read every mapped register for one meter. Returns dict name -> {value,unit}."""
    model = REGISTER_MAPS.get(model_key)
    if not model or not model.get("registers"):
        raise NotImplementedError(
            f"no register map for model '{model_key}' "
            f"(obtain the Modbus register list from the manufacturer)")

    reg_base   = model["reg_base"]
    word_order = model["word_order"]
    defs       = model["registers"]
    max_block  = model.get("max_block", MAX_BLOCK)

    # 1) block-read the whole map into a cache: wire_addr -> register value
    cache = {}
    for start, count in _plan_blocks(defs, reg_base, max_block):
        rr = _read_holding(client, start, count, unit)
        if rr is None or rr.isError():
            raise IOError(f"read failed at {start} x{count}: {rr}")
        for i, val in enumerate(rr.registers):
            cache[start + i] = val

    # 2) decode each parameter out of the cache
    ratio = (ct[0] / ct[1]) if (APPLY_CT_SCALING and ct and ct[1]) else 1.0
    scale_current_power = {"A", "kW", "kvar", "kVA", "kWh", "kvarh", "kVAh"}

    out = {}
    for name, addr, dtype, scale, unit_str in defs:
        wire = addr - reg_base
        words = [cache[wire + k] for k in range(_words_for(dtype))]
        value = _decode(words, dtype, word_order) * scale
        if unit_str in scale_current_power:
            value *= ratio
        out[name] = {"value": round(value, 4), "unit": unit_str}
    return out


# =====================================================================
#  ORCHESTRATION
# =====================================================================
def poll_all(only_units=None, only_ip=None, framer=DEFAULT_FRAMER):
    # group meters by gateway so we open one TCP connection per gateway
    gateways = {}
    for ip, unit, model, loc, desc, ct in INVENTORY:
        if only_ip and ip != only_ip:
            continue
        if only_units and unit not in only_units:
            continue
        gateways.setdefault(ip, []).append((unit, model, loc, desc, ct))

    results = []
    for ip, meters in sorted(gateways.items()):
        print(f"\n=== Gateway {ip}  ({len(meters)} meter(s)) ===")
        client = ModbusTcpClient(ip, port=MODBUS_TCP_PORT, timeout=TIMEOUT_S, framer=framer)
        connected = client.connect()
        if not connected:
            print(f"  !! could not connect to {ip}:{MODBUS_TCP_PORT}")
            for unit, model, loc, desc, ct in meters:
                results.append(_row(ip, unit, model, loc, desc, ct,
                                    status="GATEWAY_UNREACHABLE", data=None))
            continue
        try:
            for unit, model, loc, desc, ct in sorted(meters, key=lambda m: m[0]):
                label = f"[{unit:>2}] {loc}/{desc} ({model})"
                try:
                    data = read_meter(client, unit, model, ct)
                    results.append(_row(ip, unit, model, loc, desc, ct,
                                        status="OK", data=data))
                    _print_meter(label, data)
                except NotImplementedError as e:
                    results.append(_row(ip, unit, model, loc, desc, ct,
                                        status="NO_MAP", data=None))
                    print(f"  {label}: SKIPPED - {e}")
                except Exception as e:
                    results.append(_row(ip, unit, model, loc, desc, ct,
                                        status=f"ERROR:{e}", data=None))
                    print(f"  {label}: ERROR - {e}")
        finally:
            client.close()
    return results


def _row(ip, unit, model, loc, desc, ct, status, data):
    return {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "gateway_ip": ip, "unit_id": unit, "model": model,
        "location": loc, "description": desc,
        "ct_primary": ct[0], "ct_secondary": ct[1],
        "status": status, "data": data,
    }


def _fmt(v, unit):
    """Format a value + unit into a fixed-width readable string."""
    if isinstance(v, float):
        s = f"{v:,.3f}".rstrip("0").rstrip(".") if v != int(v) else f"{int(v):,}"
    else:
        s = str(v)
    return f"{s} {unit}".strip()


def _print_meter(label, data, cols=3):
    """Print every parameter for one meter as an aligned multi-column grid."""
    print(f"  {label}")
    items = [(name, _fmt(pv["value"], pv["unit"])) for name, pv in data.items()]
    # column width based on longest "name = value" cell
    cells = [f"{n:<12}= {v}" for n, v in items]
    width = max((len(c) for c in cells), default=0) + 3
    line = "        "
    for i, c in enumerate(cells):
        line += c.ljust(width)
        if (i + 1) % cols == 0:
            print(line.rstrip())
            line = "        "
    if line.strip():
        print(line.rstrip())


def write_outputs(results, csv_path="meter_readings.csv", json_path="meter_readings.json"):
    # JSON: full nested structure
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2)

    # CSV: one row per parameter (long format, good for databases / Excel pivots)
    with open(csv_path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["timestamp", "gateway_ip", "unit_id", "model", "location",
                    "description", "ct_primary", "ct_secondary", "status",
                    "parameter", "value", "unit"])
        for r in results:
            if r["data"]:
                for pname, pv in r["data"].items():
                    w.writerow([r["timestamp"], r["gateway_ip"], r["unit_id"],
                                r["model"], r["location"], r["description"],
                                r["ct_primary"], r["ct_secondary"], r["status"],
                                pname, pv["value"], pv["unit"]])
            else:
                w.writerow([r["timestamp"], r["gateway_ip"], r["unit_id"],
                            r["model"], r["location"], r["description"],
                            r["ct_primary"], r["ct_secondary"], r["status"],
                            "", "", ""])
    print(f"\nWrote {csv_path} and {json_path}")


def _summary(results):
    ok  = sum(1 for r in results if r["status"] == "OK")
    nom = sum(1 for r in results if r["status"] == "NO_MAP")
    bad = len(results) - ok - nom
    print(f"\nSummary: {ok} read OK, {nom} skipped (no register map: Wattz), "
          f"{bad} errors, {len(results)} total.")


# =====================================================================
def main():
    ap = argparse.ArgumentParser(description="Poll plant energy meters over Modbus TCP")
    ap.add_argument("--loop", type=int, metavar="SECONDS",
                    help="poll repeatedly every N seconds (Ctrl-C to stop)")
    ap.add_argument("--only", type=str,
                    help="comma-separated unit ids to poll, e.g. 21,22,29")
    ap.add_argument("--ip", type=str, help="only poll this gateway IP")
    ap.add_argument("--framer", choices=["socket", "rtu"], default="socket",
                    help="'socket' (default) for the ADAM-4572 gateways here, which do "
                         "real MBAP Modbus-TCP translation; 'rtu' only if a gateway turns "
                         "out to tunnel raw RTU frames over TCP instead")
    args = ap.parse_args()

    only_units = None
    if args.only:
        only_units = {int(x) for x in args.only.split(",") if x.strip()}

    framer = FramerType.SOCKET if args.framer == "socket" else FramerType.RTU

    def one_pass():
        results = poll_all(only_units=only_units, only_ip=args.ip, framer=framer)
        write_outputs(results)
        _summary(results)

    if args.loop:
        try:
            while True:
                one_pass()
                time.sleep(args.loop)
        except KeyboardInterrupt:
            print("\nStopped.")
    else:
        one_pass()


if __name__ == "__main__":
    main()