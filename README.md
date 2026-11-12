# T-8 Acid VJ

给 Roland AIRA Compact **T-8** 用的 acid 贝斯线生成器 + 实时 VJ 画面。也可以完全不接硬件，只开一个网页玩。

![Stage](docs/stage.jpg)

| Liquid | Glass |
|---|---|
| ![Liquid](docs/liquid.jpg) | ![Glass](docs/glass.jpg) |

| Moon | Moon（近景） |
|---|---|
| ![Moon](docs/moon.jpg) | ![Moon close-up](docs/moon-closeup.jpg) |

---

## 两种用法

### A. 不接硬件：直接打开 `index.html`

双击 `index.html`（Chrome 或 Edge）。按 **Play** 或空格。
贝斯、鼓、和弦、铃声全部由网页自己合成；整个页面只有这一个文件，不联网也能用。

### B. 接 T-8：运行 `acid_t8_multi.py`

```
python acid_t8_multi.py
```

需要 **Python 3.9 – 3.12**，以及 `mido`、`python-rtmidi` 两个包。缺包时脚本会自己处理：

- 电脑上另一个 Python 里已经装好了（最常见：双击时调用的不是你平时用的那个 Python）→ 自动换成那个 Python 运行；
- 都没装 → 问你要不要现在装，按回车即可；
- 只有 Python 3.13 或更新 → `python-rtmidi`（目前最新 1.5.8）没有这些版本的 Windows 安装包，需要再装一个 [Python 3.12](https://www.python.org/downloads/release/python-31210/)（可以和现有的并存），然后重新运行。

手动安装的写法（把 3.12 换成你有的版本）：`py -3.12 -m pip install mido python-rtmidi`，然后 `py -3.12 acid_t8_multi.py`。

用法：

1. 用 USB 线把 T-8 接到电脑（一根线同时走 MIDI 和音频）。
2. 运行上面的命令，浏览器会自动打开 `http://127.0.0.1:8731/`。
3. 在 T-8 上按 **START**。脚本跟随 T-8 的时钟，每小节把一条新的贝斯线发给 T-8 的 BASS 声部（MIDI 通道 2）；T-8 自己的鼓照常播放，画面跟着鼓和贝斯动。
4. 网页里点 **Sound on**，和弦与铃声由网页发声。

**重要：先清空 T-8 里自己存的 BASS pattern**，否则它会和脚本发过去的贝斯线同时响。
按 **BASS** 选中贝斯声部 → 按住 **SHIFT** 再按步进键 **B（PTN CLEAR INST）**。
（T-8 不接收 MIDI CC，这一步只能在机器上手动做。）

没有 T-8 时可以用 `python acid_t8_multi.py --demo` 看效果（内置时钟，不需要 MIDI）。

常用参数：

| 参数 | 作用 |
|---|---|
| `--demo` | 不接 T-8，用内置时钟演示 |
| `--list` | 列出电脑上的 MIDI 端口后退出 |
| `--port-hint 名字` | MIDI 端口名里包含的字样（默认 `T-8`） |
| `--scale 音阶`、`--root 音符号` | 调式和根音（默认 C 小调，根音 36） |
| `--loop` | 不换贝斯线，循环同一小节 |
| `--bpm 数字` | 演示模式的速度 |
| `--http-port 端口`、`--no-browser` | 网页端口；不自动开浏览器 |

---

## 四个画面

| 画面 | 内容 | 音乐怎么驱动 |
|---|---|---|
| **Stage** | 16 根灯管围成一圈，中间悬着一团铬色磁流体 | 16 根灯管就是这一小节的贝斯线（高度 = 音高）；响到哪根，磁流体的尖刺就朝哪根竖起来；底鼓 = 地面冲击波；军鼓 = 顶上的光环 |
| **Liquid** | 真实的流体模拟（墨水） | 底鼓 = 对冲的喷流；每个贝斯音 = 从底部对应位置喷出的一股墨；和弦 = 从上面落下的墨 |
| **Glass** | 玫瑰花窗，外圈 16 片就是音序 | 当前步发亮，光柱从窗里射出来 |
| **Moon** | 宇航员在月面上跑跳 | 步态锁在小节上：左脚踩第 1 拍，右脚踩第 3 拍；腾空高度按月球重力和当前速度算；胸前的灯跟贝斯音变色 |

## 快捷键

| 键 | 作用 | 键 | 作用 |
|---|---|---|---|
| 空格 | 播放 / 停止 | `F` | 全屏 |
| `1`–`4` | 切换画面 | `H` | 隐藏所有按钮 |
| `←` `→` | 上一个 / 下一个画面 | `Tab` | 打开 / 关闭设置 |
| `A` | 自动换画面 | `R` | 录制（下载 .webm） |
| `N` | 换一条贝斯线（仅网页版） | `S` | 声音开 / 关 |

设置里可以调：辉光、节拍冲击强度、胶片颗粒、镜头效果、景深、分辨率、画面延迟（蓝牙音箱有延迟时用）、和弦/铃声的音量和密度等。所有设置会记在浏览器里。

> 画面会随节拍闪动。对闪烁敏感的话，把 **Impact of the beat** 调低。

---

## 系统要求

- Chrome 或 Edge（需要 WebGL2 和浮点渲染目标；近十年的独立显卡和大多数核显都支持）。
- 硬件模式另需 Python 3.9 – 3.12，以及 `mido`、`python-rtmidi`（见上）。`--demo` 模式不需要这两个包。
- 画面较重（尤其 Moon）。分辨率默认是 **Automatic**：帧率掉下来时自动降低渲染分辨率，声音不受影响。

## 目录

```
index.html            网页版（独立可用；也可以直接作为 GitHub Pages 的首页）
acid_t8_multi.py      T-8 版（内嵌同一份网页）
src/                  源码：index.html、js/（引擎、音频、四个画面）、server.py
tools/                构建和测试脚本
docs/                 截图
```

**改代码请改 `src/`，然后运行 `python tools/build.py`**，它会重新生成上面两个文件。不要直接改 `index.html` 和 `acid_t8_multi.py`。

## 测试

```
python tools/build.py
python tools/test_server.py        # T-8 跟随器：乐理规则、MIDI 配对、滑音、网页服务、时序（不需要 MIDI 硬件）
node   tools/test_gait.js          # 月面步态：脚不打滑、动作连续、腿够得着
node   tools/shot.js moon out 1280 720 4,9.5     # 无头渲染指定时刻的画面（需要 playwright 和 Chrome）
node   tools/live.js file://$PWD/dist/standalone.html out sa   # 实时跑一遍页面，检查报错
node   tools/governor.js           # 帧率自适应
```

`node` 的几个脚本需要 `npm i playwright` 和一个 Chrome；找不到 Chrome 时用环境变量 `CHROME=/path/to/chrome` 指定。

## 已知限制

- T-8 不接收 MIDI CC，所以滤波器、共鸣等旋钮没法由程序控制，只能手拧。
- T-8 的滑音是靠相邻两个音重叠来触发的，脚本按这个方式发送。
- 硬件模式下，网页发声的和弦/铃声与 T-8 的模拟输出之间的固定延迟取决于声卡，用设置里的 **Timing against the T-8** 校准一次即可。
- 画面是在软件渲染器上自动化验证的（无报错、逐帧检查过），没有在每一种显卡上实测过。

## 技术说明

- 画面：原生 WebGL2，没有第三方库。Stage 和 Moon 是逐像素光线步进；Moon 的地形是启动时在显卡上烘焙的两张可平铺高度图；Liquid 是 stable-fluids 流体求解。后期：景深、辉光、色调映射、色散、FXAA、颗粒。
- 声音：Web Audio，303 风格的单音贝斯（真滑音）、合成鼓、和弦、FM 铃声，带侧链、延迟和混响。
- 和声：贝斯、和弦、铃声共用一个 4 小节的和弦进行，贝斯的重拍落在和弦音上。
- 时序：网页版用音频时钟提前 140 ms 排程；硬件版由跟随器给每个事件打时间戳，网页据此把和弦排在下一步的准确位置上，不受网络或页面卡顿影响。

## 许可

MIT，见 `LICENSE`。
