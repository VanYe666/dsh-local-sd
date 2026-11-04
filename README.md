# dsh-local-sd — 本地 Stable Diffusion 桥接插件

[![npm version](https://img.shields.io/npm/v/dsh-local-sd.svg)](https://www.npmjs.com/package/dsh-local-sd)
[![license](https://img.shields.io/npm/l/dsh-local-sd.svg)](LICENSE)
[![node](https://img.shields.io/node/v/dsh-local-sd.svg)](package.json)

在 DSH 里一句话画图：模型把中文需求翻成 Danbooru 标签，直接调用你本机的 Stable Diffusion 出图，**图在对话里显示**。

全程本地：不联网、不经过任何托管 API、**没有任何内容过滤**。提示词原样送进采样器。

装好之后只需要做一件事：**在「设置 → 本地绘图」里选一下你的 WebUI 目录**。之后画图、启后端、关后端全自动。

**后端按需启动、闲置自动关闭** —— 不画图时它完全不占显存。

---

## 它做什么

注册四个工具给模型：

| 工具 | 作用 |
|---|---|
| `generate_image_local` | 一个提示词，出一张图（后端没开就自动拉起） |
| `generate_image_batch` | 多个提示词 / 同一提示词多张（最多 8 张，串行） |
| `sd_backend_status` | 探测后端，列出已加载的模型、采样器、剩余自动关闭倒计时 |
| `sd_backend_control` | `start` / `stop` / `status` / `detect`，手动预热、立刻释放显存、或扫描本机安装 |

外加一个设置页：**设置 → 本地绘图**。里面能选目录、看状态、调参数、手动启停后端。

出图落在工作区 `generated/sd-<时间戳>-<序号>.png`，同时在对话里渲染。

---

## 安装

```bash
# 从 npm 装（推荐）
dsh plugin --profile desktop add dsh-local-sd

# 或者从 GitHub 装
dsh plugin --profile desktop add https://github.com/VanYe666/dsh-local-sd
```

包来源可以是：

| 方式 | 写法 |
|---|---|
| npm 包 | `dsh-local-sd` |
| GitHub 仓库 | `https://github.com/VanYe666/dsh-local-sd` |
| 本地 tgz | `file:C:\path\to\dsh-local-sd-0.4.1.tgz` |
| 本地源码目录（开发） | `file:D:\path\to\dsh-local-sd` |

不想用 `dsh plugin` 的话，直接在 profile 目录里 pnpm：

```bash
cd %USERPROFILE%\.dsh\profiles\desktop
pnpm add dsh-local-sd
```

然后把 `"dsh-local-sd"` 加进 `package.json` 的 `dsh.profile.bundles` 数组。

装完重启 DSH。

> 用官方桌面客户端的话，也可以走 **设置 → 插件** 的图形界面装，不要命令行——那个 profile 归应用的插件管理器所有。

---

## 装完之后：选目录

打开 **设置 → 本地绘图**，三种方式随便挑一个：

1. **浏览…** —— 弹系统目录选择框（Electron 桌面版可用；浏览器里跑 `dsh web` 时没有这个框）
2. **自动探测** —— 扫一遍常见位置，扫到就列出来，点「用这个」
3. **手填** —— 直接粘贴路径

**填哪一层？** 填解压后**带 `run.bat` 的那一层**。

```
D:\AI\forge\webui_forge_cu124_torch24\        ← 填这个
├── run.bat                                   ← 插件要找的就是它
├── webui-user.bat
├── system\
├── webui\
└── models\
```

Forge 的便携包有两层 `run.bat`，**用外层那个**。也接受直接填 `run.bat` 的完整路径，插件会自己往上取目录。

A1111 原版：Windows 找 `webui.bat`，Linux / macOS 找 `webui.sh`，顺序自动。

选好点保存，页面会立刻告诉你识别到了哪个启动文件。识别不到就说明目录填错层了。

---

## 后端要求

需要一个 **A1111 兼容的 sdapi 后端**。任选其一。

### SD WebUI Forge（推荐）

`webui-user.bat` 里必须有 `--api`：

```bat
set COMMANDLINE_ARGS=--medvram --xformers --no-half-vae --api
```

默认端口 **7860**。

> **便携包必看**：Forge 的官方 7z 便携包自带 `system\python`（3.10.6，torch 已装好），
> 但 `webui-user.bat` 默认不指定 `PYTHON`，`webui.bat` 会去建 venv、并从系统 PATH
> 里找 Python。机器上装了 3.11+ 的话，它会拿新 Python 建 venv、联网重装 torch，
> 在代理环境下直接失败（`ProxyError` / `Couldn't install torch`）。
>
> 在 `webui-user.bat` 里固定用自带的 Python，并跳过 venv：
>
> ```bat
> set PYTHON="%~dp0..\system\python\python.exe"
> set VENV_DIR=
> set SKIP_VENV=1
> set COMMANDLINE_ARGS=--api --xformers --no-half-vae --skip-python-version-check
> ```
>
> 另外官方 `run.bat` 里 `call environment.bat` 用的是相对路径，从别的工作目录启动
> 会找不到它，于是 `system\python` 没进 PATH、又退回系统 Python。插件已经用
> `cd /d` 兜住了这一层，但自己手动跑的时候仍然建议改成 `call "%~dp0environment.bat"`。

4GB 显存额外注意：

| 场景 | 参数 |
|---|---|
| SD1.5 | `--medvram --xformers --no-half-vae --api` |
| SDXL | `--lowvram --xformers --no-half-vae --api`（`--medvram` 会爆） |

### KoboldCpp

```bash
koboldcpp.exe --sdmodel <image-model.gguf> --sdoffloadcpu --sdtiledvae 512 --port 5001
```

4GB 显存建议再加 `--sdvramlimit 3000 --sdquant 2 --sdvaedevice CPU --sdclipdevice CPU`。

### A1111 原版

同上，确保 `--api`。

---

## 生命周期：按需启动，闲置自关

SD 后端吃几 GB 显存，不该一直挂着。

```
你第一次要图
  → 探测 7860/5001… 都没人应答
  → 从「绘图程序目录」推导出 run.bat，cd 进去执行
  → 轮询 /sdapi/v1/options，直到后端应答（最多 启动超时）
  → 出图
  → 每次出图都重置闲置计时器
闲置超过 闲置关闭时间（默认 5 分钟）
  → 杀掉「插件自己启动的」进程树，释放显存
```

关键细节：

- **只杀自己启动的进程。** 你手动双击打开的 Forge，插件永远不会去关它。设置页的「进程归属」会明确显示当前后端是谁启动的。
- **并发调用会合并。** 同时来三次请求，只拉起一次后端。
- **冷启动慢是正常的。** Forge 从零启动要 2~3 分钟（加载 torch、扫模型）。第一次出图要等，后续都很快。
- **启动失败会快速报错。** 如果 launcher 进程立刻以非 0 退出，插件不等满超时，直接报错并提示你手动运行看输出。
- **代理环境变量会被清掉。** 插件拉起后端时剥离 `HTTP_PROXY` / `HTTPS_PROXY` 并重建 `NO_PROXY`，否则 Forge 的 `httpx` 在 import 阶段就崩（`InvalidURL: Invalid port: ':1]'`）。

---

## 设置页能改什么

| 项 | 说明 |
|---|---|
| 绘图程序目录 | 含 `run.bat` / `webui.bat` / `webui.sh` 的那一层 |
| 自动启动 | 后端没开时是否拉起它。关掉就只连现成的 |
| 启动超时 | 冷启动最长等待，默认 240000 ms（4 分钟） |
| 闲置关闭 | 闲置多久自动关，默认 300000 ms（5 分钟）。**填 0 = 永不自动关闭** |
| 接口地址 | 默认 `http://127.0.0.1:7860`，改过端口才需要动 |
| 默认出图参数 | 宽、高、步数、CFG。4GB 显存建议 512×768 |

配置写在 `$DSH_HOME/local-sd.json`（Windows 是 `C:\Users\<你>\.dsh\local-sd.json`）。**每次调用都重新读取**，改完不用重启 DSH；手改这个 JSON 也一样有效。

---

## 用法

装好、选完目录之后，在对话里直接说：

> 画一个银发红瞳的少女，跪坐在床上，表情迷离

模型会自己：

1. 翻成 `1girl, solo, silver hair, red eyes, kneeling on bed, ...`
2. 补画质词和负面词
3. 调 `generate_image_local`
4. **如果 Forge 没开，先把它拉起来**（第一次会等 2~3 分钟）
5. 出图并显示

### 手动控制后端

- 「预热一下绘图后端」 → `sd_backend_control` action=start
- 「把显存放掉」 → `sd_backend_control` action=stop
- 「现在用的是哪个模型」 → `sd_backend_status`
- 「帮我找找 WebUI 装哪了」 → `sd_backend_control` action=detect

### 直接控制参数

- **尺寸**：`512x512` / `512x768` / `768x512` / `640x640` / `768x768` / `832x1216` / `1216x832` / `1024x1024`
- **步数**：`steps` 1–150（默认 25）
- **CFG**：`cfg` 1–30（默认 7）
- **采样器**：`euler_a`、`dpmpp_2m`、`dpmpp_2m_sde_gpu`、`ddim`、`heun`、`unipc` 等，snake_case 自动转后端显示名
- **种子**：`seed`，-1 随机；固定种子可微调同一构图
- **LoRA**：`lora` 数组
- **负面词**：`negative`，不传用配置默认值

---

## 提示词写法

SD1.5 / SDXL 听不懂自然语言，必须用 Danbooru 标签：

```
画质词 + 角色特征 + 动作姿势 + 场景光影 + 视角构图
```

常见画质词：

```
masterpiece, best quality, very aesthetic, absurdres, highres
```

CetusMix、Counterfeit 这类 SD1.5 融合模型对**简洁直白的标签**反应最好，别写长句。

---

## 性能参考（4GB 显存实测）

| 配置 | 单张耗时 |
|---|---|
| 512×768 / 25 步 | 约 2 分钟 |
| 512×512 / 20 步 | 60~80 秒 |
| 批量 4 张 | 约 8 分钟 |
| 冷启动（Forge 从零） | 2~3 分钟（仅第一次） |

---

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 设置页说「没找到启动文件」 | 目录填错层了 | 填带 `run.bat` 的那一层，不是 `system\` 里面 |
| 「浏览…」点了没反应 | 浏览器里跑 `dsh web`，没有系统目录框 | 手填路径，或用「自动探测」 |
| `No local Stable Diffusion backend answered` | 后端没开且自动启动关了，或端口不对 | 设置页开自动启动，或检查接口地址 |
| 启动超时报错 | 冷启动太慢 | 调大启动超时；确认目录里有 `run.bat` |
| launcher 立刻退出（exit 1） | 命令写错 / 缺依赖 | 手动双击那个 `.bat` 看报错 |
| 报「文件名、目录名或卷标语法不正确」 | Windows 上 `cmd /c` 的引号被 Node 默认处理剥掉，`cd /d` 收到裸路径（0.4.0 已修） | 升级到 0.4.1+ |
| Forge 启动后立刻报 `INCOMPATIBLE PYTHON VERSION` / `ProxyError` | 便携包没固定自带 Python，去建 venv 联网装 torch | 见上面「便携包必看」，设 `PYTHON` + `SKIP_VENV=1` |
| 后端活着但出图 500 | 模型没加载 / 显存爆了 | 设置页看状态；降分辨率或改 `--lowvram` |
| 图糊、花屏 | VAE 半精度问题 | 启动参数加 `--no-half-vae` |
| 出图全是噪点 | 步数太低或 CFG 异常 | 步数提到 20+，CFG 回到 7 |
| 配置改了没生效 | 端口写错 / JSON 语法错 | 插件容错 BOM；确认 JSON 合法 |

`sd_backend_status` 是最快的自检：它直接告诉你后端是否可达、加载的是哪个模型、还有多久自动关闭。

---

## 开发

```bash
npm test
```

覆盖启动器路径推导：绝对路径、相对路径、带引号、直接指向 `run.bat`、目录里没有启动文件、目录不存在。
只依赖 Node 内置模块，不需要装任何东西，也不碰网络。

打新包：

```bash
npm pack
```

改完源码重装一次：

```bash
cd ~/.dsh/profiles/desktop && pnpm add file:D:\path\to\dsh-local-sd
```

---

## 安全说明

这个插件**不做任何内容判断**。提示词原样 POST 给本机 sdapi 接口，图片原样写回工作区。没有云端往返，没有审核，没有改写。

出图内容完全取决于**你自己加载的模型**。

设置页的 API 走同源 `POST /local-sd/api`，由宿主自己的 `connection.requestRejection` 把关，只在本机回环可用。

---

## License

MIT
