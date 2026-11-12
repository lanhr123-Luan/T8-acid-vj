#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T-8 Acid VJ — 硬件模式 (Roland AIRA Compact T-8)

这个脚本做三件事:
  1. 跟随 T-8 的 MIDI 时钟, 每小节生成一条 acid 贝斯线, 通过 MIDI 通道 2 发回给 T-8 的 BASS 声部;
  2. 读取 T-8 鼓组 (通道 10) 的触发;
  3. 在本机开一个网页 (http://127.0.0.1:8731), 把节拍 / 贝斯 / 鼓的事件实时推给它做可视化。
     网页本身已经打包在这个文件里, 不需要联网, 也不需要任何别的文件。

依赖:  mido 和 python-rtmidi (Python 3.9 – 3.12)。缺的话脚本会自己找一个装好了的 Python, 或者问你要不要现在装。
用法:  python acid_t8_multi.py            # 正常使用: 插好 T-8, 运行, 然后在 T-8 上按 Play
       python acid_t8_multi.py --demo     # 不接 T-8, 用内置时钟演示 (检查网页是否正常)
       python acid_t8_multi.py --list     # 只列出 MIDI 端口
       Ctrl+C 退出

使用前请先清空 T-8 里自己存的 BASS pattern (否则它会和这里发过去的贝斯线一起响):
按 BASS 选中贝斯声部, 再按住 SHIFT 按步进键 B (PTN CLEAR INST)。
"""

import os
import re
import sys
import glob
import time
import shutil
import subprocess
import json
import zlib
import base64
import random
import argparse
import threading
import queue
import webbrowser
import http.server
import socketserver

VERSION = "2.0"

# ============== 配置区 (可直接改, 也可用命令行参数覆盖) ==============
PORT_HINT    = "T-8"              # MIDI 端口名里包含的字样
BASS_CHANNEL = 2                  # T-8 BASS 声部接收通道
STEPS        = 16
ROOT         = 36                 # 根音 MIDI 音符号 (36 = C2)
SCALE        = "natural_minor"    # natural_minor / phrygian / harmonic_minor / minor_penta

DENSITY      = 0.62               # 贝斯线疏密
ACCENT_PROB  = 0.30               # 重音概率
SLIDE_PROB   = 0.30               # 滑音概率
OCTAVE_PROB  = 0.18               # 跳八度概率
GATE         = 0.55               # 普通音符时值 (占一步的比例)

BASE_VEL     = 80
ACCENT_VEL   = 120
EVOLVE       = True               # True: 每小节换一条新贝斯线; False: 一直循环同一小节

HOST = "127.0.0.1"
PORT = 8731
# =====================================================================

SCALES = {
    "natural_minor":  [0, 2, 3, 5, 7, 8, 10],
    "phrygian":       [0, 1, 3, 5, 7, 8, 10],
    "harmonic_minor": [0, 2, 3, 5, 7, 8, 11],
    "minor_penta":    [0, 3, 5, 7, 10],
}

# 每 4 小节一个和弦进行 (音阶级数, 0 = 主和弦)。贝斯、和弦层、铃声层都跟着它走, 所以三层互相协和。
PROGS = {
    "natural_minor":  [[0, 0, 0, 0], [0, 0, 5, 6], [0, 3, 0, 6], [0, 5, 0, 4], [0, 0, 3, 0]],
    "phrygian":       [[0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 6, 0], [0, 1, 0, 0]],
    "harmonic_minor": [[0, 0, 0, 0], [0, 3, 0, 4], [0, 0, 5, 4]],
    "minor_penta":    [[0, 0, 0, 0]],
}

# T-8 鼓组发送的 MIDI 音符号 (通道 10), 来自官方 MIDI 实现表
DRUM_NOTES = {36: "kick", 38: "snare", 50: "clap", 47: "tom", 42: "hat", 46: "ohat"}


class Cell:
    __slots__ = ("note", "accent", "slide", "pc")

    def __init__(self, note, accent=False, slide=False, pc=0):
        self.note = note
        self.accent = accent
        self.slide = slide        # True = 这个音保持不放, 滑到下一步的音 (303 的 slide)
        self.pc = pc


def clamp(n, lo=12, hi=96):
    return max(lo, min(hi, n))


def chord_tones(scale, deg):
    """音阶第 deg 级上的七和弦 (三度叠置)。减三和弦当主和弦用会很刺耳, 所以退回主和弦。"""
    n = len(scale)
    if n != 7:
        return [scale[i] for i in (0, 1, 3, 4) if i < n], 0
    pcs = [scale[(deg + k) % 7] for k in (0, 2, 4, 6)]
    if (pcs[2] - pcs[0]) % 12 == 6:
        return [scale[k] for k in (0, 2, 4, 6)], 0
    return pcs, deg


class Composer:
    """按 4 小节的和弦计划写贝斯: 强拍落根音/五度/八度, 次强拍用和弦音, 只有弱位才用经过音。"""

    def __init__(self, rng=None):
        self.rng = rng or random
        self.reset()

    def reset(self):
        self.bar = -1
        self.prog = None
        self.mask = None
        self.chord = [0, 3, 7, 10]
        self.deg = 0

    def _new_mask(self):
        r = self.rng
        mask = []
        for i in range(STEPS):
            p = 0.95 if i % 4 == 0 else (0.72 if i % 2 == 0 else 0.55)
            mask.append(r.random() < p * DENSITY / 0.62)
        mask[0] = True
        return mask

    def next_bar(self):
        """返回下一小节: {"cells": [Cell...], "chord": [...], "deg": n, "bar": 0..3}"""
        r = self.rng
        scale = SCALES[SCALE]
        self.bar += 1
        b = self.bar % 4
        if self.prog is None or b == 0:
            progs = PROGS.get(SCALE, [[0, 0, 0, 0]])
            self.prog = progs[0] if r.random() < 0.45 else r.choice(progs)
            self.mask = self._new_mask()
        self.chord, self.deg = chord_tones(scale, self.prog[b])
        ch = self.chord
        root, third, fifth, seventh = ch[0], ch[1 % len(ch)], ch[2 % len(ch)], ch[-1]
        mask = list(self.mask)
        for i in range(STEPS):
            if r.random() < (0.12 if b < 3 else 0.30):
                mask[i] = True if i % 4 == 0 else (not mask[i])
        if b == 3:                                   # 第 4 小节末尾加花
            for i in range(STEPS - 4, STEPS):
                mask[i] = mask[i] or r.random() < 0.5
        cells = []
        for i in range(STEPS):
            if not mask[i]:
                cells.append(Cell(None))
                continue
            x = r.random()
            if i % 4 == 0:
                pc = root if x < 0.72 else (fifth if x < 0.88 else seventh)
            elif i % 2 == 0:
                pc = root if x < 0.42 else (fifth if x < 0.62 else (third if x < 0.78 else seventh))
            else:
                if x < 0.30:
                    pc = root
                elif x < 0.45:
                    pc = fifth
                elif x < 0.60:
                    pc = seventh
                else:
                    cands = [s for s in scale if 0 < min((s - root) % 12, (root - s) % 12) <= 2]
                    pc = r.choice(cands) if cands else third
            note = ROOT + pc
            if pc == root:
                if r.random() < OCTAVE_PROB * 2.0:
                    note += 12
            elif r.random() < OCTAVE_PROB * 0.6:
                note += 12
            accent = r.random() < ACCENT_PROB * (1.4 if i % 4 == 0 else 1.0) * (1.3 if note >= ROOT + 12 else 1.0)
            cells.append(Cell(clamp(note), accent=accent, slide=False, pc=pc))
        # 滑音: 只在 "下一步也有音、而且是另一个音高的和弦音" 时才从这一步滑过去
        for i in range(STEPS - 1):
            a, nx = cells[i], cells[i + 1]
            if a.note is not None and nx.note is not None and nx.pc in ch and nx.note != a.note \
                    and r.random() < SLIDE_PROB:
                a.slide = True
        return {"cells": cells, "chord": list(ch), "deg": self.deg, "bar": b}


# -------- SSE 广播 --------
_clients = []
_clients_lock = threading.Lock()


def broadcast(event):
    # 每个事件带上本机的单调时钟 (毫秒)。网页用它还原事件真正发生的时刻, 不受网络/页面卡顿的影响
    event["ts"] = round(time.perf_counter() * 1000.0, 2)
    data = json.dumps(event, separators=(",", ":"))
    with _clients_lock:
        dead = []
        for q in _clients:
            try:
                q.put_nowait(data)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _clients.remove(q)


def client_count():
    with _clients_lock:
        return len(_clients)


# -------- 跟随器 --------
class Follower:
    """T-8 每发 6 个 MIDI clock 走一步 (16 分音符)。这里只负责 "在正确的 clock 上发正确的音"。"""

    def __init__(self, send, ch, composer=None, quiet=False):
        self.send = send              # send(kind, note, velocity): kind = "on" / "off"
        self.ch = ch
        self.comp = composer or Composer()
        self.quiet = quiet
        self.bar = self.comp.next_bar()
        self.next_bar = None
        self.clk = 0
        self.running = False
        self.held = None
        self.held_slide = False
        self.off_at = None
        self.gate_clocks = min(5, max(1, round(GATE * 6)))
        self.last_t = None
        self.ema_dt = None
        self.cur_step = 0

    def _on(self, n, v):
        self.send("on", n, v)

    def _off(self, n):
        self.send("off", n, 0)

    def panic(self):
        if self.held is not None:
            self._off(self.held)
        self.held = None
        self.held_slide = False
        self.off_at = None

    def _send_pattern(self, bar, lead):
        cells = [{"note": c.note, "accent": c.accent, "slide": c.slide} for c in bar["cells"]]
        broadcast({"type": "pattern", "steps": STEPS, "root": ROOT, "scale": SCALE, "cells": cells,
                   "chord": bar["chord"], "deg": bar["deg"], "bar": bar["bar"], "lead": bool(lead)})

    def bpm(self):
        return round(60.0 / (self.ema_dt * 24), 1) if self.ema_dt else 0

    def on_start(self):
        self.panic()
        self.clk = 0
        self.running = True
        self.comp.reset()
        self.bar = self.comp.next_bar()
        self.next_bar = None
        self.last_t = None
        self.ema_dt = None
        if not self.quiet:
            print("▶ Start — 正在跟随 T-8")
        broadcast({"type": "start"})
        self._send_pattern(self.bar, False)

    def on_stop(self):
        self.running = False
        self.panic()
        if not self.quiet:
            print("■ Stop")
        broadcast({"type": "stop"})

    def on_drum(self, note, velocity):
        inst = DRUM_NOTES.get(note)
        if inst is None:
            return
        # 鼓的 note-on 可能比它所属那一步的 clock 早到或晚到一点, 所以按最近的一步归位
        step = ((self.clk + 2) // 6) % STEPS if self.running else self.cur_step
        broadcast({"type": "drum", "inst": inst, "vel": velocity, "step": step})

    def on_clock(self, now=None):
        now = time.perf_counter() if now is None else now
        if self.last_t is not None:
            dt = now - self.last_t
            if 0.002 < dt < 0.2:
                self.ema_dt = dt if self.ema_dt is None else self.ema_dt * 0.9 + dt * 0.1
        self.last_t = now

        if not self.running:
            return
        clk = self.clk

        if self.off_at is not None and clk >= self.off_at:
            if self.held is not None:
                self._off(self.held)
            self.held = None
            self.off_at = None

        if clk % 6 == 0:
            step = (clk // 6) % STEPS
            self.cur_step = step
            if step == 0 and clk > 0 and EVOLVE:
                if self.next_bar is None:                 # 正常情况下第 12 步已经准备好了
                    self.next_bar = self.comp.next_bar()
                    self._send_pattern(self.next_bar, False)
                self.bar = self.next_bar
                self.next_bar = None
            cell = self.bar["cells"][step]
            triggered = cell.note is not None
            if triggered:
                vel = ACCENT_VEL if cell.accent else BASE_VEL
                if self.held_slide and self.held is not None:
                    # 滑音: 先发新音再放旧音 (两个音重叠), T-8 就会滑过去而不重新触发包络
                    self._on(cell.note, vel)
                    if self.held != cell.note:
                        self._off(self.held)
                else:
                    if self.held is not None:
                        self._off(self.held)
                    self._on(cell.note, vel)
                self.held = cell.note
                if cell.slide:
                    self.held_slide = True
                    self.off_at = None
                else:
                    self.held_slide = False
                    self.off_at = clk + self.gate_clocks
            else:
                if self.held is not None and self.held_slide:
                    self._off(self.held)
                    self.held = None
                self.held_slide = False

            broadcast({"type": "step", "i": step, "note": cell.note, "accent": cell.accent,
                       "slide": cell.slide, "on": triggered, "bpm": self.bpm()})

            # 提前 4 步把下一小节发给网页, 这样网页可以把和弦/铃声精确地预排到下一拍上
            if step == STEPS - 4 and EVOLVE:
                self.next_bar = self.comp.next_bar()
                self._send_pattern(self.next_bar, True)

        self.clk += 1


# -------- 网页 --------
_PAGE_CACHE = {}


def page_bytes(mode="hw"):
    if mode not in _PAGE_CACHE:
        html = zlib.decompress(base64.b64decode(PAGE_B64)).decode("utf-8")
        html = html.replace("/*@MODE@*/", "window.T8_MODE='%s';" % mode)
        _PAGE_CACHE[mode] = html.encode("utf-8")
    return _PAGE_CACHE[mode]


LEGACY_SCENES = {"/stage": "stage", "/liquid": "liquid", "/glass": "glass", "/moon": "moon"}
STATE = {"running": False, "demo": False}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, ctype, body, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", page_bytes("hw"))
        elif path in LEGACY_SCENES:                       # 旧版的 /stage /liquid /glass /moon 书签仍然可用
            self._send(302, "text/plain", b"", {"Location": "/#" + LEGACY_SCENES[path]})
        elif path == "/health":
            body = json.dumps({"ok": True, "version": VERSION, "clients": client_count(),
                               "demo": STATE["demo"]}).encode("utf-8")
            self._send(200, "application/json", body)
        elif path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            self.close_connection = True
            q = queue.Queue(maxsize=512)
            with _clients_lock:
                _clients.append(q)
            try:
                self._write("retry: 1000\ndata: " + json.dumps({"type": "hello", "version": VERSION}) + "\n\n")
                while True:
                    try:
                        data = q.get(timeout=10)
                        self._write("data: " + data + "\n\n")
                    except queue.Empty:
                        self._write(": ping\n\n")
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                pass
            finally:
                with _clients_lock:
                    if q in _clients:
                        _clients.remove(q)
        elif path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        else:
            self._send(404, "text/plain; charset=utf-8", b"not found")

    def _write(self, s):
        self.wfile.write(s.encode("utf-8"))
        self.wfile.flush()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_server(host, port):
    try:
        server = Server((host, port), Handler)
    except OSError as e:
        sys.exit(f"网页端口 {port} 绑定失败: {e}\n"
                 "上一个脚本大概率还在运行 —— 找到旧的黑色窗口按 Ctrl+C 或直接关掉, 再重新运行。")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


# -------- MIDI --------
# ---------------------------------------------------------------------------
# 依赖检查。最常见的启动失败不是没装 mido, 而是电脑上有好几个 Python:
# 装了 mido 的是一个, 这次 (比如双击) 被调用的是另一个。所以缺依赖时:
#   1. 先在本机其它 Python 里找一个已经装好的, 直接换它来运行;
#   2. 没有就问一句, 帮你装到一个装得上的 Python 里;
#   3. 都不行, 给出可以直接复制的命令。
# python-rtmidi 1.5.8 (目前最新) 只提供 Python 3.9 – 3.12 的现成安装包,
# 3.13 及以上要自己编译 (需要 C++ 编译器), 一般装不上。
# ---------------------------------------------------------------------------
RTMIDI_MAX = (3, 12)


def _missing():
    miss = []
    for mod, pkg in (("mido", "mido"), ("rtmidi", "python-rtmidi")):
        try:
            __import__(mod)
        except ImportError:
            miss.append(pkg)
    return miss


def _paths_from_py_list(text):
    """从 Windows 的 `py -0p` 输出里取出各个 python.exe 的路径"""
    return [m.group(1).strip() for m in re.finditer(r'([A-Za-z]:\\[^\r\n"*]*?python[\w.\-]*\.exe)', text, re.I)]


def _other_pythons():
    """本机其它的 Python 解释器 (不含正在运行的这个)"""
    seen = {os.path.normcase(os.path.realpath(sys.executable))}
    found = []

    def add(path):
        key = os.path.normcase(os.path.realpath(path))
        if key not in seen and os.path.isfile(path):
            seen.add(key)
            found.append(path)

    for path in os.environ.get("T8VJ_PYTHON", "").split(os.pathsep):   # 手动指定: set T8VJ_PYTHON=C:\...\python.exe
        if path.strip():
            add(path.strip())
    if os.name == "nt":
        try:
            out = subprocess.run(["py", "-0p"], capture_output=True, text=True, timeout=15).stdout
            for path in _paths_from_py_list(out):
                add(path)
        except Exception:
            pass
        env = os.environ.get
        pats = [r"C:\Python3*\python.exe"]
        if env("LOCALAPPDATA"):
            # (WindowsApps 里只看带版本号的 python3.x.exe; 不带版本号的那两个是会弹出应用商店的占位程序)
            pats += [env("LOCALAPPDATA") + r"\Programs\Python\Python3*\python.exe",
                     env("LOCALAPPDATA") + r"\Python\pythoncore-3*\python.exe",
                     env("LOCALAPPDATA") + r"\Microsoft\WindowsApps\python3.*.exe"]
        for base in (env("ProgramFiles"), env("ProgramFiles(x86)")):
            if base:
                pats.append(base + r"\Python3*\python.exe")
        if env("USERPROFILE"):
            pats += [env("USERPROFILE") + "\\" + d + r"\python.exe" for d in ("anaconda3", "miniconda3")]
        for pat in pats:
            for path in sorted(glob.glob(pat), reverse=True):
                add(path)
    else:
        for name in ["python3.%d" % v for v in range(12, 8, -1)] + ["python3", "python"]:
            path = shutil.which(name)
            if path:
                add(path)
    return found


def _probe(exe):
    """这个解释器的版本, 以及它能不能 import mido 和 rtmidi → ((主, 次) 或 None, 能否)"""
    try:
        r = subprocess.run([exe, "-c", "import sys;print('%d.%d'%sys.version_info[:2]);import mido,rtmidi"],
                           capture_output=True, text=True, timeout=30)
        m = re.match(r"\s*(\d+)\.(\d+)", r.stdout or "")
        return ((int(m.group(1)), int(m.group(2))) if m else None), r.returncode == 0
    except Exception:
        return None, False


def _relaunch(exe):
    """换一个解释器重新运行本脚本, 并以它的退出码结束 (它自己负责出错时的停顿)"""
    env = dict(os.environ, T8VJ_RELAUNCH="1")
    proc = subprocess.Popen([exe, os.path.abspath(sys.argv[0])] + sys.argv[1:], env=env)
    while True:
        try:
            code = proc.wait()
            break
        except KeyboardInterrupt:      # Ctrl+C 两边都会收到: 等那边清完音自己退出
            continue
    sys.stdout.flush()
    os._exit(code or 0)


def need_mido():
    miss = _missing()
    if not miss:
        import mido
        return mido
    ver = sys.version_info[:2]
    vs = lambda v: "%d.%d" % v if v else "?"
    print(f"当前这个 Python ({vs(ver)}: {sys.executable}) 里没有装 {' / '.join(miss)}。")
    usable = None                      # 一个装得上 python-rtmidi 的解释器
    if (3, 9) <= ver <= RTMIDI_MAX:
        usable = sys.executable
    if os.environ.get("T8VJ_RELAUNCH") != "1":
        for exe in _other_pythons():
            v, ok = _probe(exe)
            if ok:
                print(f"→ 另一个 Python ({vs(v)}: {exe}) 里已经装好了, 改用它运行。\n")
                _relaunch(exe)
            if usable is None and v and (3, 9) <= v <= RTMIDI_MAX:
                usable = exe
        if usable and sys.stdin and sys.stdin.isatty():
            cmd = [usable, "-m", "pip", "install", "mido", "python-rtmidi"]
            print("可以现在自动安装, 将运行:\n   " + " ".join('"%s"' % c if " " in c else c for c in cmd))
            try:
                ans = input("直接按回车 = 安装;  输入 n 再回车 = 不装: ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                ans = "n"
            if ans in ("", "y", "yes"):
                if subprocess.call(cmd) == 0:
                    print("\n装好了, 重新启动...\n")
                    _relaunch(usable)
                print("\n自动安装没有成功 (原因见上面 pip 的输出)。")
    lines = ["缺少依赖: " + " / ".join(miss) + "。"]
    if usable:
        q = '"%s"' % usable if " " in usable else usable
        lines += ["解决: 打开命令行 (在本文件所在的文件夹里, 资源管理器地址栏输入 cmd 回车), 依次运行这两行:",
                  f"   {q} -m pip install mido python-rtmidi",
                  f"   {q} {os.path.basename(sys.argv[0])}"]
    else:
        lines += [f"这台电脑上只找到 Python {vs(ver)}。python-rtmidi 目前只有 Python 3.9 – 3.12 的现成安装包, 在 {vs(ver)} 上一般装不上。",
                  "解决: 再装一个 Python 3.12 (和现有的可以并存):",
                  "   1. 打开 https://www.python.org/downloads/release/python-31210/ , 下载 Windows installer (64-bit) 并安装;",
                  "   2. 重新运行本脚本 (它会自己找到 3.12, 并问你要不要装依赖)。",
                  "   也可以手动:  py -3.12 -m pip install mido python-rtmidi   然后   py -3.12 " + os.path.basename(sys.argv[0])]
    lines += ["", "不接 T-8 只想看画面:  加上 --demo 运行, 或者直接双击打开 acid_standalone.html (不需要 Python)。"]
    sys.exit("\n".join(lines))


def midi_ports(mido):
    try:
        return mido.get_input_names(), mido.get_output_names()
    except Exception as e:
        sys.exit(f"MIDI 接口没能打开: {e}\n(mido 和 python-rtmidi 都装好了, 是系统的 MIDI 服务这一层出的错。)")


def pick(names, kind, hint):
    print(f"可用 MIDI {kind}端口:")
    for n in names:
        print("   -", n)
    for n in names:
        if hint.lower() in n.lower():
            print(f"→ {kind}选中: {n}")
            return n
    sys.exit(f"没找到名字里带 '{hint}' 的 MIDI {kind}端口。\n"
             "请检查: T-8 是否开机、USB 线是否是数据线 (不是纯充电线)、是否被别的软件占用;\n"
             "端口名不同的话, 用  --port-hint 名字里的一段  指定。")


def run_midi(args, fol):
    mido = need_mido()
    ins, outs = midi_ports(mido)
    in_name = pick(ins, "输入", args.port_hint)
    out_name = pick(outs, "输出", args.port_hint)
    try:
        inport = mido.open_input(in_name)
        outport = mido.open_output(out_name)
    except Exception as e:
        sys.exit(f"MIDI 端口打开失败: {e}\n"
                 "最常见原因: 上一个脚本还在运行, 或某个 DAW / 浏览器的 WebMIDI 页面占着 T-8 的 MIDI 口。\n"
                 "关掉旧的黑色命令行窗口和 DAW, 再重新运行本脚本。")
    ch = BASS_CHANNEL - 1

    def send(kind, note, vel):
        outport.send(mido.Message("note_on" if kind == "on" else "note_off", note=note, velocity=vel, channel=ch))

    fol.send = send
    print("\n现在去 T-8 上按 Play (如果已经在播, 先 Stop 再 Play)。Ctrl+C 退出。")
    print("提醒: T-8 自己的 BASS 轨要先静音 —— 按住 SHIFT 再按 BASS, 按钮闪烁就是静音了。\n")
    try:
        for msg in inport:
            t = msg.type
            if t == "clock":
                fol.on_clock()
            elif t == "start" or t == "continue":
                fol.on_start()
            elif t == "stop":
                fol.on_stop()
            elif t == "note_on" and msg.velocity > 0 and msg.channel == 9:
                fol.on_drum(msg.note, msg.velocity)
    finally:
        fol.panic()
        time.sleep(0.1)
        inport.close()
        outport.close()


def run_demo(args, fol, stop_evt=None):
    """不接硬件: 用内置时钟驱动同一套逻辑, 并模拟一组 4/4 鼓点 (只有画面事件, 没有贝斯和鼓的声音)。"""
    bpm = float(args.bpm)
    tick = 60.0 / bpm / 24.0
    hats = {2: "ohat", 6: "ohat", 10: "ohat", 14: "ohat"}
    print(f"\n[演示模式] 内置时钟 {bpm:g} BPM。没有连接 T-8, 所以不会有贝斯和鼓的声音, 只是让网页动起来。Ctrl+C 退出。\n")
    time.sleep(float(args.demo_delay))
    fol.on_start()
    t0 = time.perf_counter()
    n = 0
    while not (stop_evt and stop_evt.is_set()):
        target = t0 + n * tick
        delay = target - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
        if n % 6 == 0:
            step = (n // 6) % STEPS
            if step % 4 == 0:
                fol.on_drum(36, 110)
            if step % 8 == 4:
                fol.on_drum(50, 100)
            if step in hats:
                fol.on_drum(46, 90)
            elif step % 2 == 0:
                fol.on_drum(42, 80)
        fol.on_clock()
        n += 1


def main(argv=None):
    global ROOT, SCALE, EVOLVE
    ap = argparse.ArgumentParser(description="T-8 Acid VJ (hardware mode)")
    ap.add_argument("--demo", action="store_true", help="不接 T-8, 用内置时钟演示")
    ap.add_argument("--list", action="store_true", help="列出 MIDI 端口后退出")
    ap.add_argument("--port-hint", default=PORT_HINT, help="MIDI 端口名里包含的字样 (默认 T-8)")
    ap.add_argument("--http-port", type=int, default=PORT, help="网页端口 (默认 8731)")
    ap.add_argument("--root", type=int, default=ROOT, help="根音 MIDI 音符号 (默认 36 = C2)")
    ap.add_argument("--scale", default=SCALE, choices=sorted(SCALES), help="音阶")
    ap.add_argument("--loop", action="store_true", help="不要每小节换贝斯线, 循环同一小节")
    ap.add_argument("--bpm", default="130", help="演示模式的速度")
    ap.add_argument("--demo-delay", default="1.5", help=argparse.SUPPRESS)
    ap.add_argument("--no-browser", action="store_true", help="不要自动打开浏览器")
    args = ap.parse_args(argv)
    ROOT, SCALE = args.root, args.scale
    if args.loop:
        EVOLVE = False

    if args.list:
        ins, outs = midi_ports(need_mido())
        print("MIDI 输入端口:")
        for n in ins:
            print("   -", n)
        print("MIDI 输出端口:")
        for n in outs:
            print("   -", n)
        return

    if not args.demo:
        need_mido()                                    # 缺依赖就尽早报错, 不要先弹出一个连不上的网页
    fol = Follower(lambda kind, note, vel: None, BASS_CHANNEL - 1)
    STATE["demo"] = bool(args.demo)
    server = start_server(HOST, args.http_port)
    url = f"http://{HOST}:{args.http_port}"
    print(f"T-8 Acid VJ {VERSION}")
    print(f"可视化页面: {url}")
    if not args.no_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        if args.demo:
            run_demo(args, fol)
        else:
            run_midi(args, fol)
    except KeyboardInterrupt:
        print("\n退出, 清音...")
    finally:
        try:
            fol.panic()
            broadcast({"type": "stop"})
            time.sleep(0.15)
            server.shutdown()
        except Exception:
            pass


def _pause_exit(code=1):
    try:
        input("\n按回车键关闭窗口...")
    except (EOFError, KeyboardInterrupt):
        pass
    raise SystemExit(code)


# 下面是打包好的网页 (zlib + base64)。要改网页请改 src/ 里的源码再运行 tools/build.py。
PAGE_B64 = (
    "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"
    "f4iklIQ="
)


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):          # 控制台不认识中文时用 ? 代替, 而不是直接崩溃
        try:
            _stream.reconfigure(errors="replace")
        except Exception:
            pass
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None):
            if not isinstance(e.code, int):
                print(f"\n[启动失败] {e.code}")
            _pause_exit(1)
    except KeyboardInterrupt:
        pass
    except Exception:
        import traceback
        traceback.print_exc()
        print("\n[运行出错] 上面是错误详情, 把最后几行发给 Claude 即可定位。")
        _pause_exit(1)
