"""
Maps each (gateway, unit) from mqtt.md section 2 to the meter_id string
already registered in the app (Device Settings -> Energy Meters), derived by
matching mqtt.md's location descriptions against the RRPL plant's registered
meters. 'source' marks generator-output meters vs grid-fed load meters.

Two meters from mqtt.md are NOT YET REGISTERED in the app (marked below) --
their meter_id here is a proposed name only. Nothing will be stored for them
until a matching Energy Meter with that EXACT meter_id string is created
under Device Settings, since the backend looks up plant_id by meter_id and
silently drops readings for meter_ids it doesn't recognize.

unit 26 (Compressor 1 P4) is flagged in mqtt.md as routed but silent (modbus
exception 0x0B) -- likely an RS-485 wiring/address/power issue at the meter,
not a bridge bug. Expect read errors for it until that's fixed on-site.
"""

METERS = [
    # gateway,          unit, type,      meter_id,                         source,      registered
    # Units on this gateway shifted +1 on-device 2026-08-04 (old 1-5 -> new 2-6); 29 unaffected.
    ('192.168.1.119',   2,    'wattz',   'BM Section 2 -Vacuum/VAT/CON',   'CEB',       True),
    ('192.168.1.119',   3,    'wattz',   'BM Section 1 -ST/TH/MD/TR',      'CEB',       True),
    ('192.168.1.119',   4,    'wattz',   'PR',                             'CEB',       True),
    ('192.168.1.119',   5,    'wattz',   'STR/COMPRE',                     'CEB',       True),
    ('192.168.1.119',   6,    'wattz',   'GENERATOR',                      'GENERATOR', True),
    ('192.168.1.119',   29,   'pm2120',  'P1 -Main Incoming Energy',       'CEB',       True),

    ('192.168.1.155',   6,    'wattz',   'Air Dryer',                      'CEB',       True),
    ('192.168.1.155',   7,    'wattz',   'Compressor 1',                   'CEB',       True),
    ('192.168.1.155',   8,    'wattz',   'Compressor 3',                   'CEB',       True),
    ('192.168.1.155',   9,    'wattz',   'Compressor 4',                   'CEB',       True),
    ('192.168.1.155',   10,   'wattz',   'Compressor 2',                   'CEB',       True),
    ('192.168.1.155',   11,   'wattz',   'STR',                            'CEB',       True),

    ('192.168.1.156',   18,   'wattz',   'WORKSHOP',                       'CEB',       True),
    ('192.168.1.156',   19,   'wattz',   'CANTEEN',                        'CEB',       True),
    ('192.168.1.156',   20,   'wattz',   'MAIN OFFICE',                    'CEB',       True),

    ('192.168.1.157',   12,   'wattz',   'P4- STR/TR',                     'CEB',       True),
    ('192.168.1.157',   13,   'wattz',   'P4-SUB SECTION',                 'CEB',       True),
    ('192.168.1.157',   14,   'wattz',   'STRIP CEILING PLANT',            'CEB',       False),  # NOT REGISTERED YET
    ('192.168.1.157',   15,   'wattz',   'P4- BAG OPENER',                 'CEB',       True),
    ('192.168.1.157',   16,   'wattz',   'P4- ST/TR',                      'CEB',       False),  # NOT REGISTERED YET

    ('192.168.1.158',   17,   'wattz',   'GENERATOR 02',                   'GENERATOR', True),
    ('192.168.1.158',   30,   'pm2120',  'P4 -Main Incoming Energy',       'CEB',       True),

    ('192.168.1.123',   21,   'cvm_c11', 'P2-PR',                          'CEB',       True),
    ('192.168.1.123',   22,   'cvm_c11', 'P1-CELLULOSE',                   'CEB',       True),
    ('192.168.1.123',   23,   'cvm_c11', 'OFFICE/WSHOP/CWA',               'CEB',       True),
    ('192.168.1.123',   24,   'cvm_c11', 'P4- BM',                         'CEB',       True),
    ('192.168.1.123',   25,   'cvm_c11', 'P4- PR',                         'CEB',       True),

    ('192.168.1.159',   26,   'cvm_c11', 'Compressor 1 P4',                'CEB',       True),  # meter silent (0x0B) per mqtt.md
    ('192.168.1.159',   27,   'cvm_c11', 'Compressor 2 P4',                'CEB',       True),
    ('192.168.1.159',   28,   'cvm_c11', 'Air Dryer P4',                   'CEB',       True),
]
