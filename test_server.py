#!/usr/bin/env python3
"""Tests for the Python follower (dist/acid_t8_multi.py). No MIDI hardware or mido needed:
the follower is driven with simulated clocks and a recording MIDI sink, the HTTP/SSE server is
exercised over real sockets, and --demo is run as a real subprocess."""
import collections
import http.client
import importlib.util
import json
import os
import queue
import random
import socket
import statistics
import subprocess
import sys
import threading
import time

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT_DIR, 'dist', 'acid_t8_multi.py')
spec = importlib.util.spec_from_file_location('t8srv', PY)
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)

FAILS = []


def check(cond, msg):
    if not cond:
        FAILS.append(msg)
        print('   FAIL:', msg)
    return cond


def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ---------------------------------------------------------------- 1. composer
def test_composer():
    print('1. composer (harmony + bass line rules)')
    names = ['R', 'b2', '2', 'b3', '3', '4', 'b5', '5', 'b6', '6', 'b7', '7']
    for scale in sorted(srv.SCALES):
        srv.SCALE = scale
        comp = srv.Composer(random.Random(11))
        sc = set(srv.SCALES[scale])
        notes = strong = strong_chord = slides = accents = 0
        hist = collections.Counter()
        degs = []
        for b in range(400):
            bar = comp.next_bar()
            ch = set(bar['chord'])
            cells = bar['cells']
            check(len(cells) == 16, 'bar must have 16 cells')
            check(bar['bar'] == b % 4, 'bar index in phrase')
            degs.append(bar['deg'])
            for i, c in enumerate(cells):
                if c.note is None:
                    check(not c.slide and not c.accent, 'a rest cannot carry accent/slide')
                    continue
                notes += 1
                pc = (c.note - srv.ROOT) % 12
                hist[names[pc]] += 1
                check(pc in sc, f'{scale}: note outside the scale ({names[pc]})')
                check(srv.ROOT <= c.note <= srv.ROOT + 24, f'{scale}: note {c.note} outside two octaves')
                accents += c.accent
                if i % 4 == 0:
                    strong += 1
                    strong_chord += (c.pc in ch)
                if c.slide:
                    slides += 1
                    nx = cells[i + 1] if i < 15 else None
                    check(nx is not None and nx.note is not None, 'slide must lead into a sounding step')
                    if nx is not None and nx.note is not None:
                        check(nx.note != c.note, 'slide into the same pitch is pointless')
                        check(nx.pc in ch, 'slide must land on a chord tone')
            check(cells[15].slide is False, 'no slide across the bar line')
        dens = notes / (400 * 16)
        top = ' '.join('%s:%d%%' % (k, round(100 * v / notes)) for k, v in hist.most_common(5))
        print(f'   {scale:15s} density {dens:.2f}  accents {accents / notes:.0%}  slides {slides / notes:.0%}  '
              f'beats on chord tones {strong_chord / strong:.0%}  chords used {sorted(set(degs))}  | {top}')
        check(0.45 < dens < 0.85, f'{scale}: density {dens:.2f} out of range')
        check(strong_chord == strong, f'{scale}: every beat must land on a chord tone')
        check(hist.most_common(1)[0][0] in ('R', 'b6', 'b7', '5', '4', 'b3', 'b2'), 'sanity')
    srv.SCALE = 'natural_minor'


# ---------------------------------------------------------------- 2. follower
def run_follower(bars, bpm=130, evolve=True, seed=5, drums=True):
    srv.EVOLVE = evolve
    midi = []          # (clock index, kind, note, velocity)
    state = {'clk': 0}
    q = queue.Queue()
    with srv._clients_lock:
        srv._clients.append(q)
    fol = srv.Follower(lambda kind, note, vel: midi.append((state['clk'], kind, note, vel)), 1,
                       srv.Composer(random.Random(seed)), quiet=True)
    tick = 60.0 / bpm / 24
    fol.on_start()
    for n in range(bars * 96):
        state['clk'] = n
        if drums and n % 6 == 0:
            step = (n // 6) % 16
            if step % 4 == 0:
                fol.on_drum(36, 110)
        if drums and n % 96 == 23:        # a snare that arrives one clock BEFORE step 4's clock
            fol.on_drum(38, 100)
        fol.on_clock(now=1000.0 + n * tick)
        if drums and n % 96 == 73:        # a hat that arrives one clock AFTER step 12's clock
            fol.on_drum(42, 90)
    state['clk'] = bars * 96
    fol.on_stop()
    with srv._clients_lock:
        srv._clients.remove(q)
    ev = []
    while not q.empty():
        ev.append(json.loads(q.get()))
    srv.EVOLVE = True
    return midi, ev, fol


def test_follower():
    print('2. follower (MIDI out + event stream), 64 bars at 130 BPM')
    midi, ev, fol = run_follower(64)
    # --- MIDI: pairing, polyphony, velocities
    held = {}
    maxpoly = 0
    overlaps = 0
    gates = []
    for clk, kind, note, vel in midi:
        if kind == 'on':
            check(note not in held, f'note {note} struck twice without release (clock {clk})')
            check(vel in (srv.BASE_VEL, srv.ACCENT_VEL), f'unexpected velocity {vel}')
            if held:
                overlaps += 1
            held[note] = clk
            maxpoly = max(maxpoly, len(held))
        else:
            if check(note in held, f'release of a note that is not sounding ({note}, clock {clk})'):
                gates.append(clk - held.pop(note))
    ons = sum(1 for m in midi if m[1] == 'on')
    offs = sum(1 for m in midi if m[1] == 'off')
    check(not held, f'notes left hanging after Stop: {held}')
    check(ons == offs, f'note-ons {ons} != note-offs {offs}')
    check(maxpoly <= 2, f'more than two notes at once ({maxpoly})')
    # --- events
    types = [e['type'] for e in ev]
    check(types[0] == 'start' and types[1] == 'pattern' and ev[1]['lead'] is False, 'stream must open with start + pattern')
    check(types[-1] == 'stop', 'stream must end with stop')
    steps = [e for e in ev if e['type'] == 'step']
    check(len(steps) == 64 * 16, f'expected {64 * 16} steps, got {len(steps)}')
    check(all(s['i'] == k % 16 for k, s in enumerate(steps)), 'steps must count 0..15 without gaps')
    bpms = [s['bpm'] for s in steps[32:]]
    check(all(abs(b - 130) < 0.6 for b in bpms), f'reported tempo off: {min(bpms)}..{max(bpms)}')
    # the pattern announced for a bar must be exactly what is played in it, and must arrive 4 steps early
    cur = ev[1]
    pending = None
    played_ok = lead_ok = 0
    slide_on_events = 0
    k = 0
    for e in ev:
        if e['type'] == 'pattern' and e is not ev[1]:
            check(e['lead'] is True, 'later patterns must be announced ahead (lead)')
            check(k % 16 == 13, f'lead pattern should follow step 12, came after step {(k - 1) % 16}')
            pending = e
            lead_ok += 1
        elif e['type'] == 'step':
            if e['i'] == 0 and k > 0:
                check(pending is not None, 'no pattern announced for this bar')
                cur, pending = pending, None
            c = cur['cells'][e['i']]
            if check(c['note'] == e['note'] and c['accent'] == e['accent'] and c['slide'] == e['slide'],
                     f'step {k}: played cell differs from the announced pattern'):
                played_ok += 1
            slide_on_events += bool(e['slide'])
            k += 1
    check(lead_ok == 64, f'expected 64 lead patterns, got {lead_ok}')
    # overlaps (two notes at once) must be exactly the slides
    check(overlaps == slide_on_events, f'overlapping notes {overlaps} != slide steps {slide_on_events}')
    # --- drums: step attribution by nearest clock
    drums = [e for e in ev if e['type'] == 'drum']
    kick_steps = {e['step'] for e in drums if e['inst'] == 'kick'}
    snare_steps = {e['step'] for e in drums if e['inst'] == 'snare'}
    hat_steps = {e['step'] for e in drums if e['inst'] == 'hat'}
    check(kick_steps == {0, 4, 8, 12}, f'kicks landed on steps {sorted(kick_steps)}')
    check(snare_steps == {4}, f'early snare should round to step 4, got {sorted(snare_steps)}')
    check(hat_steps == {12}, f'late hat should stay on step 12, got {sorted(hat_steps)}')
    g = collections.Counter(gates)
    print(f'   {ons} notes, {overlaps} slides (legato overlaps), max {maxpoly} notes at once, '
          f'gate lengths in clocks {dict(sorted(g.items()))}, tempo reported {min(bpms)}–{max(bpms)}')
    # --- loop mode: same bar forever, no lead patterns
    midi2, ev2, _ = run_follower(8, evolve=False)
    pats = [e for e in ev2 if e['type'] == 'pattern']
    check(len(pats) == 1, f'loop mode must send one pattern, sent {len(pats)}')
    st2 = [e for e in ev2 if e['type'] == 'step']
    check(all(st2[i]['note'] == st2[i % 16]['note'] for i in range(len(st2))), 'loop mode must repeat the bar')
    # --- stop mid-note releases it
    srv.EVOLVE = True
    sent = []
    f3 = srv.Follower(lambda k_, n_, v_: sent.append((k_, n_)), 1, srv.Composer(random.Random(2)), quiet=True)
    f3.on_start()
    for n in range(4):
        f3.on_clock(now=n * 0.02)
    f3.on_stop()
    check(sum(1 for s in sent if s[0] == 'on') == sum(1 for s in sent if s[0] == 'off'), 'Stop must release the sounding note')
    # --- Start while running (T-8 "continue") must not leave a note hanging
    sent = []
    f4 = srv.Follower(lambda k_, n_, v_: sent.append((k_, n_)), 1, srv.Composer(random.Random(3)), quiet=True)
    f4.on_start()
    for n in range(3):
        f4.on_clock(now=n * 0.02)
    f4.on_start()
    for n in range(200):
        f4.on_clock(now=1 + n * 0.02)
    f4.on_stop()
    check(sum(1 for s in sent if s[0] == 'on') == sum(1 for s in sent if s[0] == 'off'), 'restart must not leave notes hanging')


# ---------------------------------------------------------------- 3. http + sse
def test_http():
    print('3. web server (page, health, redirects, event stream)')
    port = free_port()
    server = srv.start_server('127.0.0.1', port)
    try:
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        c.request('GET', '/')
        r = c.getresponse()
        body = r.read().decode('utf-8')
        check(r.status == 200 and 'text/html' in r.getheader('Content-Type'), 'GET / must return the page')
        check("window.T8_MODE='hw';" in body, 'page must be switched to hardware mode')
        check('/*@MODE@*/' not in body and '/*@JS@*/' not in body, 'build markers left in the page')
        check('<canvas id="c"' in body and 'Scenes.moon' in body and 'function AudioEngine' in body, 'page looks incomplete')
        check('cdnjs' not in body and 'http://' not in body.replace('http://127.0.0.1', '') and 'https://' not in body.replace('https://github.com/', ''),
              'page must not load anything from the network')
        c.request('GET', '/health')
        r = c.getresponse()
        h = json.loads(r.read())
        check(r.status == 200 and h['ok'] is True and h['version'] == srv.VERSION, '/health')
        for old, scene in (('/stage', 'stage'), ('/liquid', 'liquid'), ('/glass', 'glass'), ('/moon', 'moon')):
            c.request('GET', old)
            r = c.getresponse()
            r.read()
            check(r.status == 302 and r.getheader('Location') == '/#' + scene, f'old bookmark {old} must redirect')
        c.request('GET', '/nope')
        r = c.getresponse()
        r.read()
        check(r.status == 404, 'unknown path must be 404')
        c.close()
        # event stream
        s = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
        s.request('GET', '/events')
        r = s.getresponse()
        check(r.status == 200 and r.getheader('Content-Type') == 'text/event-stream', 'event stream headers')

        def read_event():
            data = None
            while True:
                line = r.fp.readline().decode('utf-8')
                if line == '':
                    return None
                line = line.rstrip('\n')
                if line.startswith('data: '):
                    data = json.loads(line[6:])
                elif line == '' and data is not None:
                    return data
        check(read_event()['type'] == 'hello', 'first event must be hello')
        check(srv.client_count() == 1, 'client must be registered')
        srv.broadcast({'type': 'step', 'i': 3})
        ev = read_event()
        check(ev.get('type') == 'step' and ev.get('i') == 3, 'broadcast must reach the client')
        check(isinstance(ev.get('ts'), (int, float)) and ev['ts'] > 0, 'events must carry the follower\'s time stamp')
        s.close()
        r.close()
        t0 = time.time()
        while srv.client_count() and time.time() - t0 < 14:       # dropped on the next write (at most one 10 s ping away)
            srv.broadcast({'type': 'ping-test'})
            time.sleep(0.2)
        check(srv.client_count() == 0, 'a closed client must be dropped')
        # a slow client must not block the others or grow without bound
        q = queue.Queue(maxsize=4)
        with srv._clients_lock:
            srv._clients.append(q)
        for i in range(10):
            srv.broadcast({'i': i})
        check(srv.client_count() == 0, 'a client that stops reading must be dropped, not waited for')
        print(f'   page {len(body) // 1024} KB, health ok, 4 redirects, stream ok, dead clients dropped')
    finally:
        server.shutdown()
        server.server_close()


# ---------------------------------------------------------------- 4. demo subprocess end to end
def test_demo(port, seconds=6.0):
    print('4. --demo as a real process: timing of the event stream over a socket')
    p = subprocess.Popen([sys.executable, PY, '--demo', '--no-browser', '--http-port', str(port), '--demo-delay', '0.8'],
                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        t0 = time.time()
        conn = None
        while time.time() - t0 < 8:
            try:
                conn = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
                conn.request('GET', '/events')
                break
            except OSError:
                time.sleep(0.1)
        r = conn.getresponse()
        got = []
        end = time.time() + seconds
        while time.time() < end:
            line = r.fp.readline().decode('utf-8').rstrip('\n')
            if line.startswith('data: '):
                got.append((time.perf_counter(), json.loads(line[6:])))
        conn.close()
        types = collections.Counter(e['type'] for _, e in got)
        steps = [(t, e) for t, e in got if e['type'] == 'step']
        iv = [(steps[i + 1][0] - steps[i][0]) * 1000 for i in range(len(steps) - 1)]
        check(types['hello'] == 1 and types['start'] == 1, f'expected hello+start, got {dict(types)}')
        check(len(steps) > 30, f'too few steps ({len(steps)})')
        if iv:
            mean, sd, worst = statistics.mean(iv), statistics.pstdev(iv), max(abs(x - 115.38) for x in iv)
            print(f'   {len(steps)} steps: interval mean {mean:.2f} ms (ideal 115.38), jitter sd {sd:.2f} ms, worst {worst:.1f} ms; '
                  f'{types["drum"]} drum events, {types["pattern"]} patterns')
            check(abs(mean - 115.38) < 1.0, f'demo clock drifts: mean step {mean:.2f} ms')
            check(sd < 8, f'demo clock jitter too high: {sd:.2f} ms')
        check(all(e['bpm'] == 0 or abs(e['bpm'] - 130) < 3 for _, e in steps[24:]), 'tempo estimate should settle near 130')
    finally:
        p.terminate()
        try:
            p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            p.kill()


if __name__ == '__main__':
    random.seed(1)
    test_composer()
    test_follower()
    test_http()
    if '--no-demo' not in sys.argv:
        test_demo(free_port())
    print('\n%s' % ('ALL SERVER TESTS PASSED' if not FAILS else 'SERVER TESTS FAILED: %d problem(s)' % len(FAILS)))
    sys.exit(1 if FAILS else 0)
