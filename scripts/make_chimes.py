"""Builds the chime WAVs in sounds/<style>/{done,input}.wav.

Every sound is synthesized here from sine and square waves, so the files are
original and can be rebuilt with `python3 scripts/make_chimes.py`.
"""
import math
import os
import struct
import wave

RATE = 44100
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'sounds')


def note(buf, at, dur, freq, partials=((1, 1.0),), decay=7.0, attack=0.005, wave_fn=math.sin, sweep=0.0, gain=1.0):
    start = int(at * RATE)
    for i in range(int(dur * RATE)):
        if start + i >= len(buf):
            break
        t = i / RATE
        env = min(1.0, t / attack) * math.exp(-t * decay)
        f = freq * (1 + sweep * t)
        s = sum(amp * wave_fn(2 * math.pi * f * mult * t) for mult, amp in partials)
        buf[start + i] += gain * env * s


def square(x):
    return 1.0 if math.sin(x) >= 0 else -1.0


def write(style, name, total, notes):
    buf = [0.0] * int(total * RATE)
    for args in notes:
        note(buf, **args)
    # Fade the tail out and scale to a comfortable peak.
    fade = int(0.03 * RATE)
    for i in range(fade):
        buf[-1 - i] *= i / fade
    peak = max(abs(s) for s in buf) or 1.0
    scale = 0.5 / peak
    os.makedirs(os.path.join(ROOT, style), exist_ok=True)
    with wave.open(os.path.join(ROOT, style, f'{name}.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(s * scale * 32767)) for s in buf))


BRIGHT = ((1, 1.0), (2, 0.3))
MARIMBA = ((1, 1.0), (4, 0.25), (10, 0.05))
GLASS = ((1, 1.0), (2.76, 0.45), (5.4, 0.2), (8.93, 0.08))

# Classic: a rising fifth when done, two quick pings for input.
write('classic', 'done', 0.85, [
    dict(at=0, dur=0.6, freq=660, partials=BRIGHT),
    dict(at=0.12, dur=0.7, freq=990, partials=BRIGHT),
])
write('classic', 'input', 0.55, [
    dict(at=0, dur=0.25, freq=1175, partials=BRIGHT),
    dict(at=0.16, dur=0.35, freq=1175, partials=BRIGHT),
])

# Soft: low, slow-blooming pure tones.
write('soft', 'done', 1.2, [
    dict(at=0, dur=1.1, freq=392, attack=0.06, decay=3.5),
    dict(at=0.18, dur=1.0, freq=523.25, attack=0.06, decay=3.5),
])
write('soft', 'input', 0.9, [
    dict(at=0, dur=0.45, freq=587.33, attack=0.04, decay=5),
    dict(at=0.3, dur=0.6, freq=587.33, attack=0.04, decay=5),
])

# Marimba: wooden mallet notes, a C major arpeggio when done.
write('marimba', 'done', 0.9, [
    dict(at=0, dur=0.5, freq=523.25, partials=MARIMBA, decay=10),
    dict(at=0.1, dur=0.5, freq=659.25, partials=MARIMBA, decay=10),
    dict(at=0.2, dur=0.7, freq=783.99, partials=MARIMBA, decay=8),
])
write('marimba', 'input', 0.6, [
    dict(at=0, dur=0.35, freq=880, partials=MARIMBA, decay=12),
    dict(at=0.14, dur=0.45, freq=698.46, partials=MARIMBA, decay=10),
])

# Arcade: 8-bit square-wave blips.
write('arcade', 'done', 0.5, [
    dict(at=0, dur=0.09, freq=523.25, wave_fn=square, decay=4, gain=0.4),
    dict(at=0.09, dur=0.09, freq=659.25, wave_fn=square, decay=4, gain=0.4),
    dict(at=0.18, dur=0.3, freq=1046.5, wave_fn=square, decay=6, gain=0.4),
])
write('arcade', 'input', 0.35, [
    dict(at=0, dur=0.08, freq=987.77, wave_fn=square, decay=4, gain=0.4),
    dict(at=0.12, dur=0.12, freq=987.77, wave_fn=square, decay=4, gain=0.4),
])

# Glass: bell-like inharmonic shimmer.
write('glass', 'done', 1.6, [
    dict(at=0, dur=1.6, freq=1318.5, partials=GLASS, decay=3),
])
write('glass', 'input', 1.0, [
    dict(at=0, dur=0.6, freq=1760, partials=GLASS, decay=6),
    dict(at=0.2, dur=0.8, freq=1760, partials=GLASS, decay=5),
])

# Pop: short bubbles that sweep up in pitch.
write('pop', 'done', 0.35, [
    dict(at=0, dur=0.12, freq=400, sweep=12, decay=25),
    dict(at=0.12, dur=0.2, freq=600, sweep=12, decay=20),
])
write('pop', 'input', 0.3, [
    dict(at=0, dur=0.1, freq=700, sweep=15, decay=30),
    dict(at=0.1, dur=0.1, freq=700, sweep=15, decay=30),
])
