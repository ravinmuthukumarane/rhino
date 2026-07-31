#!/usr/bin/env python3
"""
mqtt_bridge.py
=====================================================================
Polls energy meters over Modbus TCP (via ADAM-4572 gateways, per mqtt.md)
and publishes readings to the rhino backend's MQTT broker in the format
backend/src/services/mqttService.ts expects:

    topic:   rhino/rrpl/telemetry            (single shared topic)
    payload: {"device_id": "u155_10", "plant_id": "rhaino",
              "timestamp": "2026-07-31T22:55:42.000+05:30",
              "tags": {"volt_l1":.., "volt_l2":.., "volt_l3":..,
                       "curr_l1":.., "curr_l2":.., "curr_l3":..,
                       "total_power":.., "total_app":.., "total_pf":..,
                       "freq":.., "import_kwh":..}}

device_id = "u{gateway last IP octet}_{modbus unit id}", e.g. gateway
192.168.1.155 unit 10 -> "u155_10". The backend looks up meter_id/plant_id/
source purely from device_id (see energy_meters.device_id in the DB) - it is
NOT read from meter_id or plant_id in the payload. See meters_inventory.py
for which two meters still need registering under Device Settings before
they'll have a device_id to publish against.

total_power/total_app are published in Watts/VA (matching mqtt.md's
documented Wattz SDM630 register units) - the backend converts to kW/kVA by
dividing by 1000 unless MQTT_POWER_UNIT=kw is set there. Verify this against
real meter readings; flip that env var if the gateway already reports kW/kVA.

Requirements:
    pip install pymodbus>=3.0 paho-mqtt>=1.6

Usage:
    python mqtt_bridge.py                      # poll every 10s forever
    python mqtt_bridge.py --interval 15
    python mqtt_bridge.py --broker rhino.sentinel.lk
    python mqtt_bridge.py --only "PR,STR"       # only these meter_ids
    python mqtt_bridge.py --once                # single pass, for testing
=====================================================================
"""

from __future__ import annotations
import argparse
import json
import signal
import sys
import time
from datetime import datetime

try:
    from pymodbus.client import ModbusTcpClient
except ImportError:
    sys.exit("pymodbus not installed. Run:  pip install 'pymodbus>=3.0'")

try:
    import paho.mqtt.client as mqtt
except ImportError:
    sys.exit("paho-mqtt not installed. Run:  pip install 'paho-mqtt>=1.6'")

import wattz_meter
import cvm_c11
import pm2120
from meters_inventory import METERS

MODBUS_PORT = 502
MODBUS_TIMEOUT_S = 3.0
DEFAULT_BROKER = 'rhino.sentinel.lk'
DEFAULT_MQTT_PORT = 1883
DEFAULT_INTERVAL_S = 10
TELEMETRY_TOPIC = 'rhino/rrpl/telemetry'

READERS = {
    'wattz': wattz_meter.read,
    'cvm_c11': cvm_c11.read,
    'pm2120': pm2120.read,
}

_running = True


def _handle_sigint(signum, frame):
    global _running
    print('\nStopping...')
    _running = False


def device_id(gateway: str, unit: int) -> str:
    last_octet = gateway.split('.')[-1]
    return f"u{last_octet}_{unit}"


def build_payload(gateway: str, unit: int, values: dict) -> dict:
    tags = {
        'volt_l1': values['voltage_r'],
        'volt_l2': values['voltage_y'],
        'volt_l3': values['voltage_b'],
        'curr_l1': values['current_r'],
        'curr_l2': values['current_y'],
        'curr_l3': values['current_b'],
        'total_power': round(values['power_kw'] * 1000, 3),   # W - see module docstring
        'total_app': round(values['power_kva'] * 1000, 3),    # VA
        'total_pf': values['power_factor'],
        'freq': values['frequency'],
        'import_kwh': values['energy_kwh'],
    }
    return {
        'device_id': device_id(gateway, unit),
        'plant_id': 'rhaino',
        'timestamp': datetime.now().astimezone().isoformat(timespec='milliseconds'),
        'tags': tags,
    }


def poll_once(mqtt_client, only=None):
    gateways: dict[str, list] = {}
    for gateway, unit, mtype, meter_id, source, registered in METERS:
        if only and meter_id not in only:
            continue
        gateways.setdefault(gateway, []).append((unit, mtype, meter_id, source, registered))

    ok = skipped = errors = 0
    for gateway, meters in sorted(gateways.items()):
        client = ModbusTcpClient(gateway, port=MODBUS_PORT, timeout=MODBUS_TIMEOUT_S)
        if not client.connect():
            print(f"  !! could not connect to gateway {gateway}:{MODBUS_PORT}")
            errors += len(meters)
            continue
        try:
            for unit, mtype, meter_id, source, registered in meters:
                label = f"[{gateway} u{unit}] {meter_id} ({mtype})"
                try:
                    values = READERS[mtype](client, unit)
                except Exception as e:
                    print(f"  {label}: READ ERROR - {e}")
                    errors += 1
                    continue

                if not registered:
                    print(f"  {label}: read OK but NOT REGISTERED in Device Settings yet - skipping publish")
                    skipped += 1
                    continue

                payload_dict = build_payload(gateway, unit, values)
                mqtt_client.publish(TELEMETRY_TOPIC, json.dumps(payload_dict), qos=1)
                print(f"  {label}: published as {payload_dict['device_id']} ({values['power_kw']} kW, {values['voltage_r']} V)")
                ok += 1
        finally:
            client.close()

    print(f"Poll done: {ok} published, {skipped} skipped (unregistered), {errors} errors.")


def main():
    ap = argparse.ArgumentParser(description="Poll energy meters and publish to MQTT")
    ap.add_argument('--broker', default=DEFAULT_BROKER, help=f"MQTT broker host (default: {DEFAULT_BROKER})")
    ap.add_argument('--port', type=int, default=DEFAULT_MQTT_PORT)
    ap.add_argument('--interval', type=int, default=DEFAULT_INTERVAL_S, help="seconds between polls")
    ap.add_argument('--only', type=str, help="comma-separated meter_ids to poll, e.g. 'PR,STR'")
    ap.add_argument('--once', action='store_true', help="poll once and exit, instead of looping")
    ap.add_argument('--mqtt-user', default=None)
    ap.add_argument('--mqtt-pass', default=None)
    args = ap.parse_args()

    only = set(x.strip() for x in args.only.split(',')) if args.only else None

    client = mqtt.Client(client_id=f"rhino-meter-bridge-{int(time.time())}")
    if args.mqtt_user:
        client.username_pw_set(args.mqtt_user, args.mqtt_pass)
    client.will_set('energy/status/bridge', payload='offline', qos=1, retain=True)

    print(f"Connecting to MQTT broker {args.broker}:{args.port}...")
    client.connect(args.broker, args.port, keepalive=60)
    client.loop_start()
    client.publish('energy/status/bridge', 'online', qos=1, retain=True)

    signal.signal(signal.SIGINT, _handle_sigint)

    if args.once:
        poll_once(client, only)
    else:
        print(f"Polling every {args.interval}s. Ctrl-C to stop.")
        while _running:
            poll_once(client, only)
            for _ in range(args.interval * 10):
                if not _running:
                    break
                time.sleep(0.1)

    client.publish('energy/status/bridge', 'offline', qos=1, retain=True)
    time.sleep(0.5)  # let the offline message flush before disconnecting
    client.loop_stop()
    client.disconnect()


if __name__ == '__main__':
    main()
