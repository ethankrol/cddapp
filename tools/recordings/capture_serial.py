#!/usr/bin/env python3
"""Capture either supported serial format. No device commands, resampling or BP inference.
Requires pyserial only for capture; parsing can be tested with Python's standard library.
"""
import argparse
import csv
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import re
import time

LEGACY = ['time_stamp_millis', 'RawRed', 'RawIR']
RAW = ['sequence', 'read_started_us', 'read_finished_us', 'fifo_available', 'red_counts', 'ir_counts']
NUMBER = re.compile(r'^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$')

def parse_line(line, mode):
    fields = [v.strip() for v in line.strip().split(',')]
    width = 3 if mode == 'legacy' else 6
    if len(fields) != width or not all(NUMBER.fullmatch(v) for v in fields):
        raise ValueError('wrong columns or nonnumeric row')
    values = [float(v) for v in fields]
    if not all(math.isfinite(v) and abs(v) <= 3.4028234663852886e38 for v in values):
        raise ValueError('non-finite or oversized value')
    if mode == 'legacy':
        if values[0] < 0 or values[0] > 0xffffffff or not values[0].is_integer():
            raise ValueError('timestamp must fit uint32')
    else:
        if any(v < 0 or not v.is_integer() for v in values):
            raise ValueError('raw fields must be nonnegative integers')
        if values[0] > 0xffffffff or max(values[1:3]) > 0xffffffff or values[3] > 255 or max(values[4:]) > 0xffffff:
            raise ValueError('raw field outside transport range')
        values = [int(v) for v in values]
    return values

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--port', required=True, help='COM4 on Windows, or the exact /dev/cu.* port on macOS')
    p.add_argument('--out', required=True, type=Path, help='New CSV path; refuses to overwrite')
    p.add_argument('--format', choices=['legacy','raw'], required=True)
    p.add_argument('--seconds', type=float, default=90)
    p.add_argument('--participant-code', required=True)
    p.add_argument('--recording-id', required=True)
    p.add_argument('--sensor-description', required=True, help='Actual board/sensor and measurement site')
    p.add_argument('--firmware-file', required=True, type=Path, help='The sketch actually flashed')
    p.add_argument('--library-version', required=True, help='Version shown in Arduino Library Manager')
    args = p.parse_args()
    if not 1 <= args.seconds <= 600:
        p.error('--seconds must be between 1 and 600')
    for field in [args.participant_code, args.recording_id]:
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', field):
            p.error('Use short participant/recording codes without names or email addresses')
    firmware_hash = hashlib.sha256(args.firmware_file.read_bytes()).hexdigest()
    metadata_path = args.out.with_suffix(args.out.suffix + '.json')
    if args.out.exists() or metadata_path.exists():
        p.error('Output or sidecar already exists. Choose a new recording ID/file.')
    try:
        import serial
    except ImportError:
        p.error('Install the capture dependency: python3 -m pip install pyserial')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    report = dict(schemaVersion=1,kind='cdd_serial_capture_v1',format=args.format,
        participantCode=args.participant_code,recordingId=args.recording_id,
        sensorDescription=args.sensor_description,firmwareSha256=firmware_hash,
        libraryVersion=args.library_version,baud=115200,declaredSensorRateHz=None,
        timestampMeaning='device print time' if args.format=='legacy' else 'device FIFO readout time',
        preprocessing='legacy moving baseline subtraction' if args.format=='legacy' else 'none in diagnostic sketch',
        startedAt=utc(),hostTimeIsAcquisitionTime=False,acceptedRows=0,rejectedRows=0,
        commentOrHeaderLines=0,decodeFailures=0,incompleteLines=0,deviceErrors=0,
        repeatedHeaders=0,deviceRestartSuspected=False,
        firstSampleReceivedAt=None,lastSampleReceivedAt=None,stopReason='not_started',
        cuffReferences=[],sensorSamplesLost=None,bpInferenceRun=False)
    started=time.monotonic()
    pending=b''
    try:
        with args.out.open('x',newline='',encoding='utf-8') as f, serial.Serial(args.port,115200,timeout=.25) as ser:
            writer=csv.writer(f);writer.writerow(LEGACY if args.format=='legacy' else RAW);f.flush()
            report['stopReason']='duration_complete'
            seen_header=False
            while time.monotonic()-started < args.seconds:
                pending += ser.readline()
                if len(pending)>8192:
                    report['rejectedRows']+=1;pending=b'';continue
                if not pending.endswith(b'\n'):
                    continue
                try:
                    line=pending.decode('ascii').strip()
                except UnicodeDecodeError:
                    report['decodeFailures']+=1;pending=b'';continue
                pending=b''
                if not line:
                    continue
                if line.startswith('# ERROR'):
                    report['deviceErrors']+=1
                    raise RuntimeError('Firmware reported an error; inspect the board configuration.')
                if line == ','.join(LEGACY if args.format=='legacy' else RAW):
                    if seen_header or report['acceptedRows']:
                        report['repeatedHeaders']+=1;report['deviceRestartSuspected']=True
                    seen_header=True;report['commentOrHeaderLines']+=1;continue
                if line.startswith('#'):
                    report['commentOrHeaderLines']+=1;continue
                try:
                    row=parse_line(line,args.format)
                except ValueError:
                    report['rejectedRows']+=1;continue
                received=utc()
                if report['firstSampleReceivedAt'] is None: report['firstSampleReceivedAt']=received
                report['lastSampleReceivedAt']=received
                writer.writerow(row);f.flush();report['acceptedRows']+=1
                if report['acceptedRows']>=30000:
                    report['stopReason']='30000_row_limit';break
    except KeyboardInterrupt:
        report['stopReason']='user_stopped'
    except Exception as e:
        report['stopReason']='error';report['error']=str(e)
    finally:
        if pending: report['incompleteLines']+=1
        report['finishedAt']=utc();report['hostElapsedSeconds']=time.monotonic()-started
        report['csvSha256']=hashlib.sha256(args.out.read_bytes()).hexdigest() if args.out.exists() else None
        with metadata_path.open('x',encoding='utf-8') as f: json.dump(report,f,indent=2);f.write('\n')
    print(json.dumps(report,indent=2))
    return 1 if report['stopReason']=='error' or report['acceptedRows']<2 else 0

if __name__=='__main__':
    raise SystemExit(main())
