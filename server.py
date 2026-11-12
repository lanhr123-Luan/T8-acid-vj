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


PAGE_B64 = "@@PAGE_B64@@"


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
