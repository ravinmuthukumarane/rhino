#!/usr/bin/env python3
"""
mqtt_bridge.py
=====================================================================
Polls energy meters over Modbus TCP (via ADAM-4572 gateways, per mqtt.md)
and publishes readings to the rhino backend's MQTT broker in the format
backend/src/services/mqttService.ts expects:

    topic:   rhino/rrpl/telemetry            (single shared topic)
    payload: {meter_id, type: "energy", voltage_r/y/b, current_r/y/b,
              power_kw, power_kva, power_factor, energy_kwh, frequency,
              source, timestamp}

meter_id must exactly match a meter_id already registered in the app under
Device Settings -> Energy Meters (see meters_inventory.py for the mapping and
which two meters still need registering).

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
from datetime import datetime, timezone

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


def build_payload(meter_id: str, source: str, values: dict) -> dict:
    payload = dict(values)
    payload['meter_id'] = meter_id
    payload['type'] = 'energy'
    payload['source'] = source
    payload['timestamp'] = int(datetime.now(timezone.utc).timestamp() * 1000)
    return payload


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

                payload_dict = build_payload(meter_id, source, values)
                mqtt_client.publish(TELEMETRY_TOPIC, json.dumps(payload_dict), qos=1)
                print(f"  {label}: published ({values['power_kw']} kW, {values['voltage_r']} V)")
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
