# CHANGELOG

## 2026-05-07

### 项目系统
- 新增 `projects` 表，视频支持按项目归类
- 项目内上传视频自动关联，支持项目管理（创建/删除）
- 项目详情页：视频封面、分析摘要、多选、AI 跨视频剪辑

### AI 视频分析
- 改为整段视频提交（非关键帧截图），长视频自动分段
- 分析结果直接展示在视频卡片上（摘要/分类/关键词）
- 视频封面缩略图（提取第一帧）

### AI 视频剪辑（9 种操作）
- trim（裁剪）、slice（切片合并）、concat（多视频拼接）、speed（变速）
- reverse（倒放）、resize（分辨率）、watermark（水印）、volume（音量）
- mute（静音）
- 自然语言输入，AI 理解意图自动生成 FFmpeg 指令

### AI 配音（TTS）
- 接入 AI 网关 `audio_tts` 语音合成
- 56 种中文音色（含粤语），可调节语速/音量
- 支持将配音混入视频（替换原声或叠加）

### 视频预览
- 视频流端点支持 HTTP Range（拖动进度条）
- 封面点击弹出播放器，支持视频/音频预览
- 编辑产物通过「生成结果」页统一预览/下载

### 修复
- FFmpeg 剪辑无画面：`-ss` 移到 `-i` 前 + `-to` 改为时长
- AnalysisViewer taskId 为 null 导致 400 错误
- 项目上传不自动创建分析任务
- 网关 URL 相对路径下载失败
- drizzle migration 文件损坏

### 配置
```env
# OpenAI 兼容
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
OPENAI_CHAT_MODEL=doubao-seed-2-0-lite-260428
OPENAI_WHISPER_MODEL=whisper-1

# AI 网关
GATEWAY_BASE_URL=https://api.botskillpro.cn/
GATEWAY_API_KEY=sk_xxx
```
