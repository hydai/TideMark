# SPEC.md — Tidemark 產品規格書

| 版本 | 日期 | 說明 |
|------|------|------|
| 0.1 | 2026-02-16 | 初版 |
| 0.2 | 2026-02-17 | 新增 Module 7: 排程下載（P2.1 升級為正式規格） |
| 0.3 | 2026-02-17 | 新增 Module 8: 頻道書籤（P2.2 升級為正式規格） |

---

## Intent Layer（意圖層）

### Purpose（目的）

Tidemark 是一款統一的串流內容擷取工具，讓使用者在瀏覽器中標記直播時間點，並在桌面端完成內容下載、片段裁切與 AI 字幕轉錄，零切換、一次完成。

### Users（使用者）

| 角色 | 描述 |
|------|------|
| 追直播的觀眾 | 在 YouTube/Twitch 看直播時，需要快速標記精彩時間點，事後下載片段回顧 |
| 內容整理者 | 定期下載 VOD/Clip 並整理歸檔，需要字幕輔助搜尋與回顧 |
| 剪輯創作者 | 下載特定片段後加上字幕，作為二創素材來源 |
| 頻道追蹤者 | 追蹤特定實況主/YouTuber，希望自動錄製每場直播，不漏掉任何內容 |

### Impacts（成功行為指標）

1. **從多工具切換到單一工作流**：使用者不再需要在瀏覽器插件、yt-dlp 命令列、字幕工具之間來回切換
2. **從事後回想到即時標記**：使用者養成在看直播時即時標記時間點的習慣
3. **從下載整支 VOD 到精準片段下載**：使用者利用時間標記直接帶入下載頁面，只下載需要的片段
4. **從手動打字幕到自動轉錄**：下載完成後一鍵送往 ASR 轉錄
5. **從守在螢幕前到自動擷取**：使用者設定頻道後離開電腦，直播開始時系統自動偵測並下載，不遺漏任何內容
6. **從零散 URL 到集中管理**：使用者將常看的頻道集中收藏，一覽即時直播狀態與最新影片，不再需要逐一開啟頻道頁面檢查

### Success Criteria（成功指標）

- SC-1: 從瀏覽器標記時間到在桌面端開始下載該片段，全程不超過 5 次點擊
- SC-2: 桌面端首次啟動到第一次成功下載，不超過 3 分鐘（不含網路下載時間）
- SC-3: 時間標記在 Extension 與 Desktop 之間同步延遲不超過 5 秒
- SC-4: 支援 YouTube 與 Twitch 雙平台的所有公開內容（VOD、Clip、直播流）
- SC-5: Twitch 頻道開始直播後，排程下載在 30 秒內自動觸發
- SC-6: YouTube 頻道開始直播後，排程下載在輪詢間隔 + 30 秒內自動觸發
- SC-7: 頻道書籤的直播狀態從平台事件到 UI 更新延遲不超過 5 秒（Twitch）或輪詢間隔 + 5 秒（YouTube）
- SC-8: 頻道書籤在 Extension 與 Desktop 之間的同步延遲不超過 5 秒（與 Record/Folder 同步一致）

### Non-Goals（非目標）

- NG-1: 不處理 DRM 保護或付費牆內容的繞過
- NG-2: 不提供影片編輯功能（裁切是下載階段的功能，非後製編輯）
- NG-3: 不做社群功能（分享、評論、公開書籤）
- ~~NG-4: Phase 1 不實作頻道書籤（Phase 2 範疇）~~ → 已於 v0.3 升級為 Module 8
- NG-5: 不取代 OBS 等專業錄製軟體
- NG-6: 不做行動端版本

---

## Design Layer（設計層）

### System Boundary（系統邊界）

**系統內部（Tidemark 負責）：**

- 瀏覽器擴充套件：時間標記的建立、管理與同步
- 桌面應用程式：內容下載、片段裁切、直播錄製、ASR 轉錄、時間標記管理、下載歷史、排程下載與直播偵測、頻道書籤管理
- Cloud Sync Service：Extension 與 Desktop 之間的時間標記與頻道書籤資料同步

**系統外部（依賴但不控制）：**

- YouTube / Twitch 平台（影片來源、API、網頁結構）
- yt-dlp（下載引擎，作為 sidecar binary 嵌入）
- FFmpeg / FFprobe（轉碼、裁切、合併引擎，作為 sidecar binary 嵌入）
- Whisper / Qwen3-ASR（本地 ASR 引擎，以 Python sidecar 形式執行）
- OpenAI API / Groq API / ElevenLabs API（雲端 ASR 引擎，BYOK 模式）
- Cloudflare Workers + D1（Cloud Sync 的後端服務）
- Twitch GQL API（Twitch 內容元資料與 VOD 查詢）
- Twitch PubSub WebSocket（Twitch 直播狀態即時推播，排程下載用）
- YouTube RSS Feed（YouTube 頻道影片列表，直播偵測輪詢用）

### System Components（系統元件）

```
+---------------------+        +-------------------+        +------------------+
|  Browser Extension  | <----> |   Cloud Sync      | <----> |   Desktop App    |
|  (Chrome/Edge)      |        |   (CF Workers+D1) |        |   (Tauri)        |
+---------------------+        +-------------------+        +------------------+
        |                                                           |
        | content script                                     +------+------+------+
        v                                                    |             |      |
  YouTube / Twitch                                     yt-dlp +       Python  Cloud ASR  Twitch
  Web Pages                                            FFmpeg    ASR Sidecar   APIs    PubSub +
                                                                (local)      (BYOK)   YT RSS
```

#### Browser Extension

- 職責：在 YouTube/Twitch 頁面擷取當前播放時間，建立 Record，管理 Folder 分類，將資料同步至 Cloud Sync
- 技術形式：Chrome Extension (Manifest v3)，支援 Chrome 與 Edge
- 狀態管理：本地使用 Chrome Storage API，同步使用 Cloud Sync API

#### Desktop App

- 職責：內容下載（YouTube + Twitch）、直播錄製、片段裁切、ASR 轉錄（本地 + 雲端 BYOK）、Record 管理（含雲端同步後的本地呈現）、下載歷史管理、排程下載（直播偵測 + 自動下載 + 系統列背景執行）、頻道書籤管理（直播狀態、元資料、最新影片、快速動作）、全域設定
- 技術形式：Tauri (Rust backend + Web frontend)
- 外部程序管理：yt-dlp, FFmpeg, FFprobe 以 sidecar binary 嵌入；本地 ASR 以 Python sidecar 執行
- 背景服務：系統列（System Tray）常駐模式，支援 Twitch PubSub WebSocket 持續連線與 YouTube RSS 定期輪詢

#### Cloud Sync Service

- 職責：Extension 與 Desktop 之間的資料中介，負責 Record、Folder 與 Channel Bookmark 的雲端持久化與同步
- 技術形式：Cloudflare Workers（REST API）+ Cloudflare D1（SQLite 資料庫）
- 資料範圍：同步 Record、Folder 與 Channel Bookmark 核心資料。下載歷史、設定、頻道元資料不同步

---

### Feature Behaviors（功能行為）

---

#### Module 1: Browser Extension — 時間標記

##### F1.1 記錄當前時間

**使用者操作**：在 YouTube/Twitch 頁面上，點擊擴充套件圖示開啟 Popup，輸入可選的主題名稱，點擊「記錄當前時間」按鈕（或按 Enter）

**系統回應**：

1. 透過 Content Script 讀取頁面上的播放器當前時間
   - YouTube：從 `<video>` 元素的 `currentTime` 取得
   - Twitch 直播：從 `.live-time > span[aria-hidden="true"]` 取得
   - Twitch VOD：從 VOD 時間顯示元素取得
2. 同時取得直播/影片標題與頻道 URL
   - Twitch：透過 GQL 查詢最新 VOD ID，組成 VOD 連結
   - YouTube：透過 `meta[itemprop="videoId"]` 取得 videoId，組成 `youtu.be` 短連結
3. 建立一筆 Record 物件
4. 將 Record 存入 Chrome Storage，並顯示在列表中
5. 若使用者已登入 Cloud Sync，同步上傳

**儲存的資料**（Record 物件）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 唯一識別碼（timestamp-based） |
| timestamp | string | 記錄建立的本地時間（顯示用） |
| liveTime | string | 播放時間點，格式 `HH:MM:SS` 或 `MM:SS` |
| title | string | 直播/影片標題 |
| topic | string | 使用者輸入的主題名稱（預設「無主題」） |
| folderId | string \| null | 所屬 Folder ID |
| channelUrl | string | VOD 連結（含 `?t=` 時間參數）或 YouTube 短連結 |
| platform | string | `"youtube"` 或 `"twitch"` |

**本地上限**：Chrome Storage 最多保留 500 筆 Record（雲端無上限）

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E1.1a | 頁面非 YouTube/Twitch | 顯示「請在 YouTube 或 Twitch 頁面使用」 |
| E1.1b | 找不到播放器時間元素 | 顯示「無法取得播放時間，請確認影片已載入」 |
| E1.1c | Content Script 注入失敗 | 自動重試最多 3 次，仍失敗則提示「請重新整理頁面」 |
| E1.1d | Chrome Storage 寫入失敗 | 顯示「儲存失敗，請稍後重試」 |

##### F1.2 Folder 管理

**使用者操作**：在 Popup 左側面板中新增、重新命名、刪除、拖曳排序 Folder

**系統回應**：

- 新增：顯示輸入框，按 Enter 或確認按鈕建立
- 重新命名：雙擊 Folder 名稱進入編輯模式
- 刪除：點擊刪除按鈕後彈出確認對話框，確認後將該 Folder 下所有 Record 移至「未分類」
- 排序：拖曳 Folder 項目上下移動，放開後自動儲存新順序
- 「未分類」為系統預設 Folder，不可刪除、不可拖曳

**儲存的資料**（Folder 物件）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 唯一識別碼 `folder-{timestamp}` |
| name | string | Folder 名稱 |
| created | string | 建立時間 ISO 8601 |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E1.2a | Folder 名稱空白 | 不建立，不顯示錯誤 |
| E1.2b | 儲存失敗 | 顯示「操作失敗」 |

##### F1.3 Record 管理

**使用者操作**：

- 檢視：點擊 Folder 後，右側顯示該 Folder 下的 Record，依直播標題分組（Group）折疊
- 編輯：雙擊 Record 主題名稱進入編輯模式
- 刪除：點擊 Record 右上角的刪除按鈕
- 複製時間：點擊複製按鈕，將時間點複製到剪貼簿
- 前往 VOD：點擊「前往 VOD」連結，在新分頁開啟帶有 `?t=` 時間參數的 VOD 頁面
- 拖曳排序：同 Group 內拖曳 Record 調整順序；拖曳 Record 到其他 Folder 變更歸屬
- Group 排序：拖曳整個標題 Group 調整 Group 間的順序

**系統回應**：每次操作後立即寫入 Chrome Storage 並重新渲染列表

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E1.3a | VOD 尚未產生（Twitch 直播剛結束） | 連結指向頻道影片列表頁 |

##### F1.4 匯入匯出

**使用者操作**：在 Extension 設定中選擇匯出（全部 Record + Folder 導出為 JSON）或匯入（選擇 JSON 檔案）

**系統回應**：

- 匯出：產生 JSON 檔案並下載
- 匯入：解析 JSON 並合併（或覆寫，由使用者選擇）至本地 Storage

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E1.4a | JSON 格式錯誤 | 顯示「檔案格式不正確」 |
| E1.4b | 資料結構不相容 | 顯示「無法匯入：資料版本不相容」 |

##### F1.5 平台偵測與主題切換

- YouTube 頁面：套用紅色系主題
- Twitch 頁面：套用紫色系主題（預設）
- 主題影響所有 UI 元素的主色調，無需使用者操作

##### F1.6 Cloud Sync（Extension 側）

**使用者操作**：在 Extension 設定中登入 Google 帳號

**系統回應**：

1. 透過 Google OAuth 取得身份，向 Cloudflare Workers API 驗證並取得 JWT token
2. 登入後，每次 Record/Folder 變更自動上傳至 Cloud Sync
3. 定期輪詢（每 3-5 秒）Cloud Sync API，拉取來自其他裝置或 Desktop 的變更
4. 使用 `updatedAt` 時間戳做增量同步，僅拉取上次同步後的變更

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E1.6a | 登入失敗 | 顯示「登入失敗，請稍後重試」 |
| E1.6b | 同步衝突 | Last-write-wins，以 `updatedAt` 較新者為準 |
| E1.6c | 網路中斷 | 暫停同步，恢復後自動重試 |

---

#### Module 2: Desktop — Download（內容下載）

##### F2.1 URL 解析與資訊取得

**使用者操作**：在「Download」頁面的輸入框貼上 URL，點擊「貼上並取得」

**系統回應**：

1. 解析 URL 判斷平台（YouTube / Twitch）與內容類型（video / stream / clip）
2. 呼叫 yt-dlp（YouTube）或 Twitch GQL API（Twitch）取得內容元資料
3. 顯示：標題、頻道名、縮圖、時長、可選畫質列表、編解碼器選項
4. 若為直播中內容，標示「直播中」並提供「錄製直播」選項

**支援的 URL 格式**：

- YouTube: `youtube.com/watch?v=`, `youtu.be/`, `youtube.com/live/`
- Twitch: `twitch.tv/{channel}`, `twitch.tv/videos/{id}`, `twitch.tv/{channel}/clip/{slug}`, `clips.twitch.tv`

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.1a | URL 無法辨識 | 顯示「不支援的連結格式」 |
| E2.1b | 影片不存在或已刪除 | 顯示「找不到該影片」 |
| E2.1c | 需要認證（私人/訂閱者限定） | 提示「需要 Twitch OAuth Token」或「需要 YouTube Cookies」 |
| E2.1d | 網路錯誤 | 顯示「網路連線失敗，請檢查網路」 |

##### F2.2 下載設定

**使用者操作**：在取得影片資訊後，調整以下選項：

| 選項 | 說明 |
|------|------|
| 影片品質 | 從可用清單中選擇 |
| 內容類型 | 影片+音訊 / 僅影片 / 僅音訊 |
| 影片編解碼器 | H.264 / VP9 / AV1（YouTube） |
| 音訊編解碼器 | MP3 / AAC / Opus |
| 輸出檔名 | 可編輯，提供範本變數 |
| 輸出資料夾 | 檔案選擇器 |
| 輸出容器格式 | Auto / MP4 / MKV |

**檔名範本變數**：

| 變數 | 說明 |
|------|------|
| `{type}` | 內容類型（stream/video/clip） |
| `{id}` | 影片 ID |
| `{title}` | 標題 |
| `{channel}` | 頻道 username |
| `{channel_name}` | 頻道顯示名稱 |
| `{date}` | 發佈/開始日期 YYYY-MM-DD |
| `{resolution}` | 畫質（如 1080p） |
| `{duration}` | 時長 |

##### F2.3 時間範圍下載

**使用者操作**：在下載設定區輸入開始時間與結束時間

**系統回應**：

1. 驗證時間格式（支援 `HH:MM:SS`、`MM:SS`、純秒數）
2. 驗證時間範圍在影片時長內
3. 下載時僅擷取指定範圍

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.3a | 結束時間早於開始時間 | 顯示「結束時間必須晚於開始時間」 |
| E2.3b | 時間超出影片時長 | 顯示「時間超出影片長度」 |
| E2.3c | 時間格式不正確 | 顯示「請輸入有效時間格式」 |

##### F2.4 下載執行與進度管理

**使用者操作**：點擊「開始下載」後，可在進行中的任務卡片上：暫停、恢復、取消、展開查看詳細進度

**系統回應**：

1. 啟動 yt-dlp（YouTube）或 Twitch segment downloader（Twitch）
2. 即時更新進度：百分比、下載速度、剩餘時間、轉碼狀態
3. 下載完成後，呼叫 FFmpeg 進行合併/轉碼（若需要）
4. 完成後顯示完成卡片，提供：開啟檔案、在資料夾中顯示、送往字幕轉錄
5. 寫入下載歷史

**同時下載限制**：依設定的最大同時下載數量（預設 3）

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.4a | 下載中斷 | 自動重試（依設定的重試次數） |
| E2.4b | 磁碟空間不足 | 暫停下載，提示「磁碟空間不足」 |
| E2.4c | yt-dlp / FFmpeg 未找到或異常 | 提示「核心工具異常，請嘗試重新初始化」 |

##### F2.5 直播錄製

**使用者操作**：當偵測到直播中，選擇「錄製直播」

**系統回應**：

1. 持續下載直播串流
2. 進度顯示：已錄製時長、檔案大小、串流位元率
3. 使用者可隨時手動停止
4. 直播結束時自動停止並進行後處理（remux）

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.5a | 直播中斷（主播斷線） | 顯示「串流中斷」，已錄製部分保留 |
| E2.5b | 串流品質切換 | 自動適應新的串流品質 |

##### F2.6 Twitch 認證

**使用者操作**：在設定中輸入 Twitch OAuth Token（手動輸入或透過 OAuth 流程取得）

**系統回應**：驗證 Token 有效性，有效時顯示「已驗證」並啟用訂閱者限定內容下載

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.6a | Token 無效或過期 | 顯示「Token 無效，請重新取得」 |

##### F2.7 YouTube 認證

**使用者操作**：在設定中匯入 `cookies.txt`（Netscape 格式）

**系統回應**：驗證 cookies 檔案格式，傳遞 cookies 給 yt-dlp 以存取會員/私人影片

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E2.7a | cookies 格式不正確 | 顯示「Cookies 檔案格式不正確，請使用 Netscape 格式」 |

---

#### Module 3: Desktop — Transcription（字幕轉錄）

Tidemark 的轉錄功能支援兩種模式：**本地 ASR**（在使用者電腦上執行）與**雲端 ASR（BYOK）**（使用者提供自己的 API Key 呼叫第三方服務）。

##### F3.1 檔案輸入

**使用者操作**：在「Subtitles」頁面拖放影音檔案，或點擊選取檔案，或從下載完成卡片的「送往字幕轉錄」進入

**系統回應**：顯示檔案名稱、檔案大小、時長預覽

##### F3.2 轉錄設定

**使用者操作**：選擇 ASR 引擎與相關選項

**本地引擎選項**：

| 選項 | 可選值 |
|------|--------|
| ASR 引擎 | Whisper / Qwen3-ASR |
| 語言 | 自動偵測 / 指定語言 |
| 模型大小 | Whisper: tiny~large; Qwen: 對應模型清單 |
| 硬體模式 | auto / gpu / cpu |
| 輸出格式 | SRT / TXT / 雙格式 |
| Whisper 進階 | VAD（語音活動偵測）、Demucs 人聲分離 |
| Qwen 進階 | 斷句、最長秒數、最長字數、繁中輸出 |

**雲端引擎選項（BYOK）**：

| 引擎 | API Provider | 支援模型 | 特色 |
|------|-------------|----------|------|
| OpenAI Whisper | OpenAI | whisper-1 | 高精度，支援多語言，25 MB 檔案上限 |
| Groq Whisper | Groq | whisper-large-v3, distil-whisper | 極快速度（near real-time），免費額度 |
| ElevenLabs | ElevenLabs | Scribe v1/v2 | 高精度多語言，支援 speaker diarization |

雲端引擎的共用選項：

| 選項 | 說明 |
|------|------|
| 語言 | 自動偵測 / 指定語言（ISO 639-1） |
| 輸出格式 | SRT / TXT / 雙格式 |
| 自動分段 | 大檔案自動切割上傳（依 API 檔案大小限制） |

**系統回應**：

- 本地引擎：檢查引擎與模型的可用狀態，未安裝的模型提示下載
- 雲端引擎：檢查對應的 API Key 是否已設定，未設定則提示前往設定頁輸入

##### F3.3 轉錄執行

**使用者操作**：點擊「開始轉錄」

**系統回應（本地引擎）**：

1. 啟動 Python sidecar，載入選定的 ASR 模型
2. 即時顯示進度（已處理時長 / 總時長）
3. 完成後輸出字幕檔到指定資料夾
4. 提供「開啟輸出檔」快捷操作

**系統回應（雲端引擎 BYOK）**：

1. 讀取使用者設定中對應的 API Key
2. 若檔案超過 API 大小限制，使用 FFmpeg 切割為多段
3. 依序上傳各段至 API endpoint
4. 即時顯示進度（已上傳段數 / 總段數）
5. 收到回傳結果後，合併各段字幕，調整時間軸偏移
6. 輸出字幕檔到指定資料夾

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E3.3a | Python 環境未就緒（本地） | 顯示「ASR 環境未安裝」並提供「安裝環境」按鈕 |
| E3.3b | 模型未下載（本地） | 顯示「模型未下載」並提供下載按鈕 |
| E3.3c | GPU 不可用但選了 GPU 模式（本地） | 自動降級至 CPU 模式並提示 |
| E3.3d | 記憶體不足（本地） | 提示「記憶體不足，請嘗試較小的模型」 |
| E3.3e | API Key 未設定（雲端） | 顯示「請先在設定中輸入 {provider} API Key」 |
| E3.3f | API Key 無效或過期（雲端） | 顯示「API Key 無效，請檢查後重試」 |
| E3.3g | API 額度用盡（雲端） | 顯示「API 額度已用盡，請檢查帳戶餘額」 |
| E3.3h | API 請求失敗（雲端） | 顯示具體錯誤訊息，已完成的段落保留 |
| E3.3i | 檔案過大無法分段（雲端） | 顯示「檔案過大，請嘗試使用本地引擎」 |

##### F3.4 ASR 環境管理

**使用者操作**：在字幕頁面查看環境狀態，手動安裝/重新安裝環境，下載/刪除模型

**系統回應**：顯示 Python 環境狀態、已安裝模型列表、GPU 可用性，提供一鍵安裝/重新安裝環境與模型下載進度

---

#### Module 4: Desktop — Records（時間標記管理）

##### F4.1 Record 檢視與管理

**使用者操作**：在「Records」頁面，左側管理 Folder，右側檢視/搜尋/編輯 Record

**系統回應**：

1. 從 Cloud Sync 載入（已登入時）或從本地儲存載入（未登入時）
2. Folder 新增、重新命名、刪除、拖曳排序（同 Extension 行為）
3. Record 搜尋（依標題/主題/頻道名過濾）
4. Record 編輯（修改主題名稱）
5. Record 刪除

##### F4.2 下載片段（Record → Download 聯動）

**使用者操作**：對某筆 Record 點擊「下載片段」

**系統回應**：

1. 從 Record 中取得 `channelUrl`（VOD 連結）與 `liveTime`（時間點）
2. 自動切換到 Download 頁面
3. 自動填入 URL
4. 自動填入時間範圍：
   - 開始時間 = `liveTime` - 前偏移秒數（預設 10 秒，可在設定中調整）
   - 結束時間 = `liveTime` + 後偏移秒數（預設 10 秒，可在設定中調整）
5. 使用者確認後開始下載

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E4.2a | VOD 尚未產生或已過期 | 顯示「找不到對應的 VOD」 |
| E4.2b | URL 解析失敗 | 顯示「無法解析此記錄的連結」 |

##### F4.3 Cloud Sync（Desktop 側）

**使用者操作**：在 Records 頁面登入 Google（未登入時會要求登入）

**系統回應**：

1. 透過 Google OAuth 進行登入，向 Cloudflare Workers API 驗證並取得 JWT token
2. 同步雲端的 Record 與 Folder 至本地顯示
3. 本地修改即時上傳
4. 定期輪詢（每 3-5 秒）Cloud Sync API，拉取來自 Extension 的新增/修改

---

#### Module 5: Desktop — History（下載歷史管理）

##### F5.1 歷史列表

**使用者操作**：在「History」頁面檢視所有下載紀錄

**系統回應**：顯示列表，每筆包含：標題、頻道名、狀態、下載日期、檔案大小、檔案路徑

**操作**：

- 關鍵字搜尋（標題/頻道）
- 狀態篩選（全部/完成/失敗/取消）
- 排序（依日期/標題/頻道）
- 開啟檔案
- 在資料夾中顯示
- 刪除單筆紀錄
- 清空全部紀錄

##### F5.2 歷史資料

**儲存的資料**（DownloadHistory 物件）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 唯一識別碼 |
| url | string | 原始下載 URL |
| title | string | 影片/直播標題 |
| channel | string | 頻道名稱 |
| platform | string | `"youtube"` 或 `"twitch"` |
| contentType | string | `"video"` / `"stream"` / `"clip"` |
| status | string | `"completed"` / `"failed"` / `"cancelled"` |
| filePath | string | 輸出檔案絕對路徑 |
| fileSize | number | 檔案大小（bytes） |
| resolution | string | 下載畫質 |
| startedAt | string | 下載開始時間 ISO 8601 |
| completedAt | string \| null | 下載完成時間 |
| errorMessage | string \| null | 失敗時的錯誤訊息 |

**儲存位置**：本地 JSON 檔案，不同步至雲端

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E5.1a | 檔案已被移動或刪除 | 「開啟檔案」顯示「檔案不存在」提示 |

---

#### Module 6: Desktop — Settings（設定）

##### F6.1 一般設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 預設下載資料夾 | 下載檔案的預設輸出路徑 | `~/Tidemark/Downloads` |
| 預設字幕輸出資料夾 | 轉錄字幕的預設輸出路徑 | 同下載資料夾 |
| 開機自啟動 | 系統啟動時自動執行 | 關閉 |
| 桌面通知 | 下載/轉錄完成時發送系統通知 | 開啟 |
| Twitch OAuth Token | Twitch 認證用 | 空 |
| YouTube Cookies | 匯入 cookie.txt | 空 |
| 語言 | 介面語言 | 繁體中文 |
| 時區 | 顯示時間的時區 | 系統時區 |

##### F6.2 下載設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 是否啟用轉碼器 | 下載後是否進行轉碼 | 關閉 |
| 預設影片品質 | 預設選擇的畫質 | 最高可用 |
| 輸出容器 | Auto / MP4 / MKV | Auto |
| 最大同時下載數量 | 並行下載任務數 | 3 |
| 自動重試 | 下載失敗時是否自動重試 | 開啟 |
| 最大重試次數 | 自動重試次數上限 | 3 |
| 下載速度限制 | MB/s，0 = 不限 | 0 |
| 顯示編解碼器選項 | 下載頁面是否顯示進階編解碼器欄位 | 隱藏 |

##### F6.3 外觀設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 主題 | 深色 / 淺色 / 跟隨系統 | 跟隨系統 |
| 動畫效果 | 開啟/關閉 UI 動畫 | 開啟 |
| 緊湊模式 | 減少 UI 間距 | 關閉 |

##### F6.4 Records 設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 顯示「所有紀錄」Folder | 是否顯示合併所有 Folder 的虛擬 Folder | 開啟 |
| 顯示「未分類」Folder | 是否顯示未分類 Folder | 開啟 |
| 下載片段前偏移秒數 | Record → Download 時，開始時間往前偏移 | 10 秒 |
| 下載片段後偏移秒數 | Record → Download 時，結束時間往後偏移 | 10 秒 |

##### F6.5 ASR API Keys（BYOK）

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| OpenAI API Key | 用於 OpenAI Whisper API 轉錄 | 空 |
| Groq API Key | 用於 Groq Whisper API 轉錄 | 空 |
| ElevenLabs API Key | 用於 ElevenLabs Scribe 轉錄 | 空 |

每個 Key 旁提供「測試連線」按鈕，驗證 Key 有效性並顯示剩餘額度（若 API 支援）。API Key 以加密形式儲存於 OS keychain。

##### F6.6 GPU 加速

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 下載硬體編碼 | 啟用/停用 GPU 硬體編碼加速 | 停用 |
| 硬體編碼器 | 自動 / 手動選擇 | 自動 |
| 前端渲染加速 | Tauri WebView 的硬體加速（需重啟） | 開啟 |

##### F6.7 關於與更新

- 顯示當前版本號
- 檢查更新功能
- 核心工具版本顯示（yt-dlp、FFmpeg）
- 開源授權資訊

##### F6.8 排程下載設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 啟用排程下載 | 是否啟用排程下載功能（關閉時隱藏 Scheduled Downloads 頁面） | 關閉 |
| 關閉行為 | 視窗關閉時的行為：最小化至系統列 / 完全關閉 | 最小化至系統列 |
| YouTube 輪詢間隔 | YouTube 直播偵測的輪詢間隔（秒），範圍 30–300 | 90 |
| 觸發冷卻期 | 同一頻道觸發後忽略後續事件的等待時間（秒） | 300 |
| 排程下載通知 | 通知管道：OS 通知 / 應用程式內 Toast / 兩者 / 關閉 | 兩者 |
| 排程下載自動轉錄 | 排程下載完成後是否自動啟動字幕轉錄 | 關閉 |
| 開機自動啟動監聽 | 應用程式啟動時是否自動開始直播偵測 | 開啟 |

##### F6.9 頻道書籤設定

| 設定項 | 說明 | 預設值 |
|--------|------|--------|
| 啟用頻道書籤 | 是否啟用頻道書籤功能（關閉時隱藏 Channel Bookmarks 頁面） | 關閉 |
| 元資料自動刷新間隔 | 頻道元資料（頭像、追蹤者數等）的自動刷新間隔（小時） | 24 |
| 影片快取數量 | 每個頻道顯示的最新影片數量 | 5 |

---

#### Module 7: Desktop — Scheduled Downloads（排程下載）

Tidemark 的排程下載功能讓使用者為特定頻道預設下載參數，當該頻道開始直播時自動觸發下載。支援 Twitch（透過 PubSub WebSocket 即時偵測）與 YouTube（透過 RSS Feed 定期輪詢）。應用程式可最小化至系統列（System Tray），在背景持續監聽頻道狀態。

##### F7.1 下載預設管理（Download Preset）

**使用者操作**：在「Scheduled Downloads」頁面，新增、編輯、刪除、啟用/停用頻道的下載預設

**系統回應**：

1. 新增預設：輸入頻道 URL 或名稱，系統自動辨識平台（Twitch / YouTube）並取得頻道資訊（名稱、頭像）
2. 設定下載參數：影片品質、內容類型、輸出資料夾、檔名範本、容器格式
3. 啟用/停用：切換預設的啟用狀態，停用時不會觸發自動下載
4. 列表顯示每個預設的：頻道名稱、平台圖示、啟用狀態、上次觸發時間、累計下載次數

**儲存的資料**（DownloadPreset 物件）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 唯一識別碼 |
| channelId | string | 頻道識別碼（Twitch: login name, YouTube: channel ID） |
| channelName | string | 頻道顯示名稱 |
| platform | string | `"twitch"` 或 `"youtube"` |
| enabled | boolean | 是否啟用 |
| quality | string | 偏好畫質（如 `"best"`, `"1080p"`, `"720p"`） |
| contentType | string | `"video+audio"` / `"audio_only"` |
| outputDir | string | 輸出資料夾路徑 |
| filenameTemplate | string | 檔名範本（同 F2.2 變數，其中 `{date}` 為直播開始日期） |
| containerFormat | string | `"auto"` / `"mp4"` / `"mkv"` |
| createdAt | string | 建立時間 ISO 8601 |
| lastTriggeredAt | string \| null | 上次觸發時間 |
| triggerCount | number | 累計觸發次數 |

**備註**：排程下載用於錄製直播串流，影片/音訊編解碼器由串流來源決定，不在預設中指定。`quality` 欄位控制串流品質選擇

**儲存位置**：`{appDataDir}/tidemark/scheduled_presets.json`

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.1a | 頻道 URL 無法辨識 | 顯示「無法辨識此頻道」 |
| E7.1b | 重複的頻道預設 | 顯示「此頻道已有預設，是否覆蓋？」 |
| E7.1c | 輸出資料夾不存在或無寫入權限 | 顯示「輸出資料夾無效」 |

##### F7.2 Twitch 直播偵測（PubSub WebSocket）

**系統行為**（背景服務，無需使用者操作）：

1. 為所有已啟用的 Twitch 預設，建立至 Twitch PubSub 伺服器的 WebSocket 連線
2. 訂閱 `video-playback-by-id.<channel_id>` 主題
3. 收到 `stream-up` 事件時，標記該頻道為「直播中」，觸發自動下載（F7.4）
4. 收到 `stream-down` 事件時，標記該頻道為「離線」
5. 連線維持：每 4 分鐘發送 PING，收到 PONG 確認連線存活

**PubSub 連線規格**：

| 項目 | 值 |
|------|------|
| WebSocket URL | `wss://pubsub-edge.twitch.tv` |
| 訂閱主題 | `video-playback-by-id.<channel_id>` |
| PING 間隔 | 4 分鐘 |
| 單一連線主題上限 | 50 |
| 重連策略 | 指數退避（1s → 2s → 4s → ... → 120s 上限） |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.2a | WebSocket 連線失敗 | 指數退避重連，通知使用者「Twitch 連線中斷，重試中…」 |
| E7.2b | PING 逾時（無 PONG 回應） | 關閉連線並重新建立 |
| E7.2c | 訂閱主題數超過 50 | 自動建立額外的 WebSocket 連線 |
| E7.2d | Twitch 服務維護 | 顯示「Twitch 服務暫時不可用」，持續重試 |

##### F7.3 YouTube 直播偵測（RSS 輪詢）

**系統行為**（背景服務，無需使用者操作）：

1. 為所有已啟用的 YouTube 預設，定期檢查頻道是否正在直播
2. 查詢 YouTube RSS Feed（`https://www.youtube.com/feeds/videos.xml?channel_id={id}`）
3. 解析 Feed 中的最新項目，透過 yt-dlp 確認是否為直播中的串流（`--dump-json` 檢查 `is_live` 欄位）
4. 偵測到直播時，標記該頻道為「直播中」，觸發自動下載（F7.4）

**輪詢規格**：

| 項目 | 值 |
|------|------|
| 輪詢間隔 | 預設 90 秒（可在 F6.8 設定中調整，範圍 30–300 秒） |
| RSS Feed URL | `https://www.youtube.com/feeds/videos.xml?channel_id={id}` |
| 確認方式 | yt-dlp `--dump-json` 檢查 `is_live` 欄位 |
| 並行檢查上限 | 最多同時 3 個頻道（避免 rate limit） |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.3a | RSS Feed 無法存取 | 跳過本次檢查，下次輪詢重試 |
| E7.3b | YouTube rate limit | 自動將輪詢間隔增加至 2 倍，5 分鐘後恢復原間隔 |
| E7.3c | 頻道 ID 無效 | 停用該預設，通知使用者「頻道不存在」 |
| E7.3d | yt-dlp 確認逾時 | 跳過本次檢查，下次輪詢重試 |

##### F7.4 自動下載觸發

**系統行為**（由 F7.2 或 F7.3 驅動）：

1. 當直播偵測服務偵測到頻道開始直播
2. 查找對應的已啟用 DownloadPreset
3. 使用預設中的下載參數，自動建立直播錄製任務（錄製行為同 F2.5，但無需使用者確認，完全自動執行）
4. 下載任務進入排程下載佇列（F7.6），若佇列已滿則排入等待
5. 更新預設的 `lastTriggeredAt` 與 `triggerCount`
6. 發送通知（F7.7）

**防重複觸發規則**：

| 規則 | 說明 |
|------|------|
| 串流 ID 判斷 | 同一頻道同一場直播僅觸發一次。Twitch 以 PubSub 事件中的 stream ID 為判斷依據；YouTube 以 RSS Feed 項目的 video ID（`yt:video:id`）為判斷依據 |
| 觸發冷卻期 | 同一頻道在上次觸發後的冷卻期內（預設 300 秒，可在 F6.8 調整），新事件忽略（防止 stream-up/down 抖動） |
| 佇列重複檢查 | 若佇列中已有相同串流的下載任務，不重複建立 |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.4a | 下載啟動失敗（yt-dlp 錯誤） | 通知使用者「{頻道名} 的自動下載啟動失敗」，記錄錯誤 |
| E7.4b | 磁碟空間不足 | 暫停所有排程下載，通知使用者「磁碟空間不足」 |
| E7.4c | 達到同時下載上限 | 任務排入佇列等待，通知使用者「{頻道名} 已排入下載佇列」 |
| E7.4d | 串流重啟（冷卻期後再次偵測到 stream-up，但串流 ID 不同） | 視為新的直播，重新觸發下載 |
| E7.4e | 觸發後網路中斷導致 yt-dlp 無法啟動 | 任務標記為失敗，通知使用者，網路恢復後不自動重試（因直播可能已結束） |

##### F7.5 系統列模式（System Tray）

**使用者操作**：點擊視窗關閉按鈕（或透過選單選擇「最小化至系統列」）

**系統回應**：

1. 視窗隱藏，應用程式圖示顯示在系統列（macOS: 選單列、Windows: 系統匣）
2. 系統列圖示根據狀態變化：
   - 預設圖示：無監聽中的預設
   - 監聽中圖示：有啟用的預設正在監聽
   - 下載中圖示：有排程下載任務執行中
3. 背景服務持續執行（直播偵測、下載任務）

**系統列右鍵選單**：

| 選項 | 動作 |
|------|------|
| 顯示主視窗 | 還原主視窗至前景 |
| 監聽狀態 | 顯示目前監聽中的頻道數與平台 |
| 暫停所有監聽 | 暫停所有直播偵測（保持連線但不觸發下載） |
| 恢復所有監聽 | 恢復暫停的直播偵測 |
| 結束 | 停止所有監聽與下載，完全關閉應用程式 |

**使用者操作**：雙擊系統列圖示（Windows）或點擊系統列圖示（macOS）

**系統回應**：還原主視窗至前景

**系統行為**（視窗關閉時的判斷邏輯，依以下優先順序執行第一個匹配的條件）：

| 優先順序 | 條件 | 行為 |
|----------|------|------|
| 1 | 按住 Shift + 關閉（或選單中選「結束」） | 完全關閉應用程式 |
| 2 | 有啟用的排程預設（不論是否有下載進行中） | 最小化至系統列（不關閉應用程式） |
| 3 | 無啟用的排程預設 | 依 F6.8「關閉行為」設定決定：最小化至系統列 或 完全關閉 |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.5a | 系統不支援系統列（極少見） | 關閉按鈕改為完全關閉，顯示警告「此系統不支援背景執行」 |

##### F7.6 排程下載佇列

**系統行為**：

1. 管理由自動觸發（F7.4）產生的排程下載任務
2. 佇列遵守 F6.2 設定的最大同時下載數量限制（排程下載與手動下載共用配額）
3. 達到上限時，新任務排入等待佇列
4. 任務完成或取消後，自動從佇列中取出下一個任務執行

**佇列優先順序**：

| 優先級 | 類型 | 說明 |
|--------|------|------|
| 1（最高） | 手動下載 | 使用者在 Download 頁面手動發起的下載 |
| 2 | 排程下載 | 由直播偵測自動觸發的下載，依偵測時間先後排序 |

**佇列狀態顯示**（在 Scheduled Downloads 頁面）：

- 執行中的排程下載：顯示進度（百分比、下載速度、已錄製時長）
- 等待中的排程下載：顯示佇列位置
- 已完成的排程下載：顯示完成時間、檔案大小
- 失敗的排程下載：顯示錯誤原因，提供「重試」按鈕

**使用者操作**：在佇列中對任務執行取消、重試

**系統回應**：取消時終止下載程序並從佇列移除；重試時重新加入佇列尾端

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.6a | 佇列中任務全部失敗 | 通知使用者「所有排程下載均失敗，請檢查網路與設定」 |
| E7.6b | 直播結束但下載仍在佇列中等待 | 通知使用者「{頻道名} 的直播已結束，改為下載 VOD」 |

##### F7.7 通知系統

**通知管道**：

| 管道 | 說明 | 預設 |
|------|------|------|
| OS 通知 | macOS Notification Center / Windows Toast Notification | 開啟 |
| 應用程式內 Toast | 右下角 Toast 通知（同 Pattern 2 的 Info 等級） | 開啟 |

**通知事件**：

| 事件 | 通知內容 | 等級 |
|------|----------|------|
| 偵測到直播開始 | 「{頻道名} 正在直播，已啟動自動下載」 | Info |
| 排程下載完成 | 「{頻道名} 的直播錄製已完成（{檔案大小}）」 | Info |
| 排程下載失敗 | 「{頻道名} 的下載失敗：{錯誤摘要}」 | Warning |
| 連線中斷 | 「Twitch/YouTube 監聽連線中斷，重試中…」 | Warning |
| 磁碟空間不足 | 「磁碟空間不足，已暫停所有排程下載」 | Critical |
| 直播結束未下載 | 「{頻道名} 的直播已結束，排程下載未能啟動」 | Warning |

**OS 通知互動**：

- 點擊通知：開啟 Tidemark 主視窗，跳轉至 Scheduled Downloads 頁面
- 完成通知：提供「開啟檔案」與「在資料夾中顯示」的快捷動作（macOS actionable notification / Windows toast action）

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E7.7a | OS 通知權限未授予 | 僅使用應用程式內 Toast，設定頁提示使用者授予通知權限 |

---

#### Module 8: Desktop — Channel Bookmarks（頻道書籤）

Tidemark 的頻道書籤功能讓使用者收藏常看的 Twitch/YouTube 頻道，集中檢視即時直播狀態、頻道元資料與最新影片。書籤與排程下載（Module 7）雙向整合：可從書籤快速建立下載預設，也可在書籤上查看已存在的預設狀態。書籤核心資料透過 Cloud Sync 在 Extension 與 Desktop 間同步；頻道元資料與影片清單為裝置本地快取，不同步。

##### F8.1 頻道書籤 CRUD（Channel Bookmark CRUD）

**使用者操作**：在「Channel Bookmarks」頁面，新增、編輯、刪除、拖曳排序頻道書籤

**系統回應**：

1. 新增書籤：輸入頻道 URL 或名稱，系統呼叫 `resolve_channel_info()`（複用 F7.1 的頻道解析邏輯）自動辨識平台並取得頻道資訊（名稱、頭像、平台）
2. 編輯書籤：修改自訂備註（notes）
3. 刪除書籤：點擊刪除按鈕後彈出確認對話框，確認後軟刪除
4. 排序：拖曳書籤項目上下移動，放開後自動儲存新的 `sort_order`
5. 若使用者已登入 Cloud Sync，變更即時同步

**儲存的資料**（ChannelBookmark 物件）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| id | string | 唯一識別碼（timestamp-based） |
| channelId | string | 頻道識別碼（Twitch: login name, YouTube: channel ID） |
| channelName | string | 頻道顯示名稱 |
| platform | string | `"twitch"` 或 `"youtube"` |
| notes | string | 使用者自訂備註（預設空字串） |
| sortOrder | number | 排序順序 |
| createdAt | string | 建立時間 ISO 8601 |
| updatedAt | string | 最後更新時間 ISO 8601 |

**儲存位置**：`{appDataDir}/tidemark/channel_bookmarks.json`

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.1a | 頻道 URL 無法辨識 | 顯示「無法辨識此頻道」 |
| E8.1b | 重複的頻道書籤 | 顯示「此頻道已在書籤中」 |
| E8.1c | 頻道不存在或已關閉 | 顯示「找不到此頻道」 |

##### F8.2 即時直播狀態（Live Status Indicator）

**系統行為**（背景服務，無需使用者操作）：

1. 書籤中的頻道自動加入既有的直播偵測基礎設施（共用 Module 7 的 PubSub/RSS 連線，不建立重複連線）
   - Twitch 頻道：加入 PubSub WebSocket 的 `video-playback-by-id` 訂閱（F7.2）
   - YouTube 頻道：加入 RSS Feed 輪詢列表（F7.3）
2. 收到直播狀態事件時，更新書籤 UI 上的狀態徽章
3. **僅限書籤的頻道**（無對應 DownloadPreset）：`stream-up` 事件僅更新直播徽章，**不觸發**自動下載
4. **同時有書籤與預設的頻道**：`stream-up` 事件同時更新徽章與觸發下載（F7.4）

**狀態徽章**：

| 狀態 | 顯示 | 說明 |
|------|------|------|
| 直播中 | 紅色圓點 + 「直播中」 | 頻道正在直播 |
| 離線 | 灰色圓點 | 頻道未直播 |
| 未知 | 無徽章 | 尚未取得狀態（初始化中） |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.2a | 直播偵測服務未啟動（如使用者未啟用排程下載功能） | 書籤頁面顯示「啟用排程下載以獲取即時直播狀態」提示，頻道狀態顯示為「未知」 |
| E8.2b | PubSub/RSS 連線中斷 | 狀態徽章保持最後已知狀態，顯示「連線中斷」提示（複用 F7.2/F7.3 的重連機制） |

##### F8.3 頻道元資料顯示（Channel Metadata Display）

**系統行為**：

1. 書籤新增時，取得並快取頻道元資料：頭像 URL、頻道名稱、平台、追蹤者/訂閱者數、最後直播時間
2. 元資料快取在裝置本地，**不同步至雲端**（各裝置獨立取得與刷新）
3. 懶刷新策略：開啟 Channel Bookmarks 頁面時，檢查元資料的 `lastRefreshedAt`，若超過設定的自動刷新間隔（預設 24 小時，可在 F6.9 調整），在背景靜默刷新

**元資料快取物件**（ChannelMetadata，裝置本地）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| channelId | string | 頻道識別碼（與 ChannelBookmark.channelId 對應） |
| avatarUrl | string \| null | 頻道頭像 URL |
| followerCount | number \| null | 追蹤者/訂閱者數 |
| lastStreamAt | string \| null | 最後直播時間 ISO 8601 |
| lastRefreshedAt | string | 元資料最後刷新時間 ISO 8601 |

**元資料來源**：

| 平台 | 來源 | 取得方式 |
|------|------|----------|
| Twitch | Twitch GQL API | 查詢 `User` 物件（login, displayName, profileImageURL, followers, lastBroadcast） |
| YouTube | yt-dlp `--dump-json` | 從頻道頁面取得（channel, uploader, thumbnail, channel_follower_count） |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.3a | 元資料取得失敗（網路錯誤） | 使用上次快取的元資料，下次開啟頁面時重試 |
| E8.3b | 頻道已關閉或更名 | 顯示快取的舊資料，標示「資料可能已過期」 |

##### F8.4 最新影片列表（Latest Videos List）

**使用者操作**：在 Channel Bookmarks 頁面展開某個書籤，查看該頻道的最新影片列表

**系統回應**：

1. 展開時呼叫平台 API 取得最新 5-10 筆影片（VOD/Clip）
2. 影片清單以時間倒序排列，每筆顯示：縮圖、標題、發佈時間、時長、觀看數
3. 影片清單為**暫態快取**（記憶體中），關閉頁面或切換頁面後清除，不持久化、不同步

**影片資料來源**：

| 平台 | 來源 | 取得方式 |
|------|------|----------|
| Twitch | Twitch GQL API | 查詢頻道的 `VideoConnection`（最新 VOD 與 Clip） |
| YouTube | YouTube RSS Feed | 解析 `https://www.youtube.com/feeds/videos.xml?channel_id={id}` 中的最新項目 |

**暫態快取物件**（ChannelVideo，僅存於記憶體）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| videoId | string | 影片識別碼 |
| title | string | 影片標題 |
| url | string | 影片 URL |
| thumbnailUrl | string \| null | 縮圖 URL |
| publishedAt | string | 發佈時間 ISO 8601 |
| duration | string \| null | 時長（VOD 有，直播/Clip 可能為 null） |
| viewCount | number \| null | 觀看數 |
| contentType | string | `"video"` / `"clip"` / `"stream"` |

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.4a | 影片列表取得失敗 | 顯示「無法載入影片列表，請稍後重試」，提供「重試」按鈕 |
| E8.4b | 頻道無公開影片 | 顯示「此頻道目前沒有公開影片」 |

##### F8.5 快速動作（Quick Actions）

**使用者操作**：在書籤項目上透過動作按鈕或右鍵選單執行快速操作

**可用動作**：

| 動作 | 說明 | 觸發方式 |
|------|------|----------|
| 下載最新 VOD | 取得頻道最新 VOD 的 URL，自動帶入 Download 頁面（F2.1） | 動作按鈕 |
| 新增排程預設 | 以此頻道資訊預填，跳轉至 Scheduled Downloads 頁面新增預設（F7.1） | 動作按鈕 |
| 開啟頻道頁面 | 在系統預設瀏覽器中開啟頻道頁面 URL | 動作按鈕 |
| 複製頻道 URL | 將頻道 URL 複製至系統剪貼簿 | 右鍵選單 |

**系統回應**：

1. 下載最新 VOD：從影片列表（F8.4）或即時查詢中取得最新 VOD URL，切換至 Download 頁面並自動填入
2. 新增排程預設：切換至 Scheduled Downloads 頁面，自動填入 `channelId`、`channelName`、`platform`
3. 開啟頻道頁面：呼叫系統 API 開啟 URL
4. 複製 URL：寫入系統剪貼簿，顯示「已複製」Toast

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.5a | 頻道無可下載的 VOD | 顯示「此頻道目前沒有可下載的 VOD」 |
| E8.5b | 頻道已有排程預設 | 顯示「此頻道已有排程預設，是否前往查看？」 |

##### F8.6 Cloud Sync（頻道書籤同步）

**系統行為**（複用既有 Cloud Sync 基礎設施）：

1. 書籤的核心資料（id, channelId, channelName, platform, notes, sortOrder）透過 Cloud Sync 在 Extension 與 Desktop 間同步
2. 同步策略與 Record/Folder 一致：
   - 寫入：每次本地變更後立即 push 至 Cloud Sync
   - 讀取：定期輪詢（每 3-5 秒）拉取增量變更（`updatedAt` 追蹤）
   - 衝突解決：Last-write-wins，以 `updatedAt` 較新者為準
   - 刪除：軟刪除（`deleted=1`），不硬刪除
3. **不同步的資料**：頻道元資料（F8.3）、影片列表（F8.4）、直播狀態（F8.2）均為裝置本地資料
4. **Extension 角色**：Extension 僅負責書籤核心資料的儲存與同步，不提供直播狀態、元資料、影片列表、快速動作等完整 UI（這些為 Desktop-only 功能）

**D1 Schema**（新增 `channel_bookmarks` 表，詳見 Cloud Sync API 設計）

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.6a | 同步衝突 | Last-write-wins，以 `updatedAt` 較新者為準（同 Record/Folder） |
| E8.6b | Cloud Sync 不可用 | 降級為純本地模式，恢復後自動同步 |

##### F8.7 排程下載整合（Scheduled Downloads Integration）

**系統行為**（雙向整合，無需使用者操作）：

**書籤 → 排程下載方向**：

1. 書籤列表中，若頻道已有對應的 DownloadPreset（F7.1），顯示排程預設狀態圖示（啟用中 / 已停用）
2. 快速動作「新增排程預設」（F8.5）提供從書籤到預設的快速通道

**排程下載 → 書籤方向**：

1. Scheduled Downloads 頁面的每個預設，若該頻道已有書籤，顯示書籤圖示
2. 書籤圖示可點擊，跳轉至 Channel Bookmarks 頁面並聚焦該頻道

**關聯判斷**：以 `channelId` + `platform` 為鍵，比對 ChannelBookmark 與 DownloadPreset

**錯誤情境**：

| 代碼 | 條件 | 系統回應 |
|------|------|----------|
| E8.7a | 書籤對應的預設已刪除 | 書籤上的排程狀態圖示消失，不影響書籤本身 |
| E8.7b | 預設對應的書籤已刪除 | 預設上的書籤圖示消失，不影響預設本身 |

---

### Interfaces Between Components（元件間介面）

#### Interface 1: Extension ↔ Cloud Sync

- 通訊協定：HTTPS REST API（Cloudflare Workers）
- 認證方式：Google OAuth → Workers 驗證 → JWT token
- 同步策略：客戶端每 3-5 秒輪詢 `GET /sync?since={lastUpdatedAt}`，取得增量變更
- 寫入：每次本地變更後立即 `POST /records`、`POST /folders` 或 `POST /channel-bookmarks`
- 衝突解決：Last-write-wins，以 `updatedAt` 較新者為準
- 資料範圍：Records、Folders、Channel Bookmarks

#### Interface 2: Desktop ↔ Cloud Sync

- 通訊協定：HTTPS REST API（Cloudflare Workers），與 Interface 1 相同的 API
- 認證方式：Google OAuth（透過系統瀏覽器 redirect 流程）→ JWT token
- 同步策略：同 Interface 1
- 資料範圍：同 Interface 1（Records、Folders、Channel Bookmarks）

#### Interface 3: Desktop ↔ yt-dlp (Sidecar)

- 通訊方式：Tauri Rust backend 透過 `Command` 啟動 yt-dlp 子程序
- 輸入：命令列參數（URL、格式、輸出路徑、cookies 路徑、時間範圍）
- 輸出：stdout/stderr 解析（進度百分比、下載速度、錯誤訊息）
- 生命週期：每個下載任務一個 yt-dlp 程序，任務結束或取消時終止

#### Interface 4: Desktop ↔ FFmpeg (Sidecar)

- 通訊方式：Tauri Rust backend 透過 `Command` 啟動 FFmpeg 子程序
- 輸入：命令列參數（輸入檔、輸出檔、編解碼器、裁切時間）
- 輸出：stderr 解析（轉碼進度、錯誤訊息）
- 用途：影音合併、格式轉換、硬體編碼、時間裁切、雲端 ASR 的檔案分段

#### Interface 5: Desktop ↔ Python ASR Sidecar（本地）

- 通訊方式：Tauri Rust backend 透過 `Command` 啟動 Python 程序，透過 stdout JSON 行協議通訊
- 輸入：JSON 配置（輸入檔、引擎、模型、語言、輸出格式、進階參數）
- 輸出：JSON 行輸出（進度更新、完成通知、錯誤通知）
- 環境管理：內建 Python venv，模型下載管理

#### Interface 6: Desktop ↔ Cloud ASR APIs（BYOK）

- 通訊方式：Tauri Rust backend 透過 HTTPS 呼叫第三方 API
- 認證方式：使用者提供的 API Key（Bearer token）
- API 規格：

| Provider | Endpoint | 方法 | 檔案上限 | 回傳格式 |
|----------|----------|------|----------|----------|
| OpenAI | `api.openai.com/v1/audio/transcriptions` | POST multipart | 25 MB | JSON (segments + text) |
| Groq | `api.groq.com/openai/v1/audio/transcriptions` | POST multipart | 25 MB | JSON (segments + text) |
| ElevenLabs | `api.elevenlabs.io/v1/speech-to-text` | POST multipart | 1 GB | JSON (words + text) |

- 大檔案處理：超過 API 檔案上限時，使用 FFmpeg 分段 → 逐段上傳 → 合併結果並調整時間戳

#### Interface 7: Extension ↔ Desktop（選擇性直連）

- 通訊方式：Desktop 可開啟本地 HTTP server（localhost），Extension 偵測到後可直接推送 Record
- 用途：使用者無需雲端帳號也能在 Extension 與 Desktop 之間同步
- 回退策略：若本地 server 未偵測到，走 Cloud Sync 路徑

#### Interface 8: Desktop ↔ Twitch PubSub WebSocket

- 通訊方式：Tauri Rust backend 建立 WebSocket 連線至 Twitch PubSub 伺服器
- 連線位址：`wss://pubsub-edge.twitch.tv`
- 訊息格式：JSON（`{"type": "LISTEN", "data": {"topics": [...]}}`）
- 訂閱主題：`video-playback-by-id.<channel_id>`
- 接收事件：`stream-up`（直播開始）、`stream-down`（直播結束）、`viewcount`（觀看人數更新）
- 心跳：客戶端每 4 分鐘發送 `{"type":"PING"}`，伺服器回應 `{"type":"PONG"}`
- 連線管理：每條 WebSocket 最多訂閱 50 個主題，超過時建立新連線
- 重連策略：連線斷開時使用指數退避重連（1s → 2s → 4s → ... → 120s 上限）
- 無需認證：`video-playback-by-id` 主題為公開主題，不需要 OAuth token

#### Interface 9: Desktop ↔ YouTube RSS Feed

- 通訊方式：Tauri Rust backend 透過 HTTPS GET 請求查詢 YouTube RSS Feed
- Feed URL：`https://www.youtube.com/feeds/videos.xml?channel_id={id}`
- 回傳格式：Atom XML，包含頻道最新 15 筆影片/直播項目
- 輪詢間隔：預設 90 秒（可調整）
- 後續確認：對 Feed 中的最新項目，呼叫 yt-dlp `--dump-json` 確認 `is_live` 狀態
- 無需認證：RSS Feed 為公開資源

---

### Cloud Sync API 設計

**Base URL**: `https://tidemark-api.{domain}.workers.dev`

**D1 Schema**:

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  folder_id TEXT REFERENCES folders(id),
  timestamp TEXT NOT NULL,
  live_time TEXT NOT NULL,
  title TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '無主題',
  channel_url TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE channel_bookmarks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('youtube', 'twitch')),
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_records_user_updated ON records(user_id, updated_at);
CREATE INDEX idx_folders_user_updated ON folders(user_id, updated_at);
CREATE INDEX idx_channel_bookmarks_user_updated ON channel_bookmarks(user_id, updated_at);
CREATE UNIQUE INDEX idx_channel_bookmarks_user_channel ON channel_bookmarks(user_id, channel_id, platform) WHERE deleted = 0;
```

**API Endpoints**:

| Method | Path | 說明 |
|--------|------|------|
| POST | `/auth/google` | Google OAuth token 交換 JWT |
| GET | `/sync?since={iso8601}` | 增量同步（取得 since 之後的所有 records + folders + channel_bookmarks 變更） |
| POST | `/records` | 建立或更新 Record（upsert by id） |
| DELETE | `/records/{id}` | 軟刪除 Record（設 deleted=1） |
| POST | `/folders` | 建立或更新 Folder（upsert by id） |
| DELETE | `/folders/{id}` | 軟刪除 Folder（設 deleted=1） |
| POST | `/channel-bookmarks` | 建立或更新 Channel Bookmark（upsert by id） |
| DELETE | `/channel-bookmarks/{id}` | 軟刪除 Channel Bookmark（設 deleted=1） |

**Subrequest 估算**（per `/sync` invocation）：

| 操作 | Subrequest 數 |
|------|---------------|
| JWT 驗證 | 0（本地驗證） |
| D1 查詢 records | 1 |
| D1 查詢 folders | 1 |
| D1 查詢 channel_bookmarks | 1 |
| **總計** | **3** |

遠低於 Workers 的 1000 subrequest limit。

---

### Error Scenarios Summary（錯誤場景總覽）

| 錯誤類別 | 處理策略 |
|----------|----------|
| 網路中斷 | 暫停需要網路的操作，恢復後自動重試。本地操作不受影響 |
| 外部工具缺失 | 首次啟動自動檢查並初始化 yt-dlp/FFmpeg。缺失時引導使用者下載 |
| 平台 API 變更 | yt-dlp 定期自動更新；Twitch GQL hash 需追蹤更新 |
| 認證過期 | 提示使用者重新登入或更新 Token/Cookies/API Key |
| 儲存空間不足 | 下載前檢查可用空間，不足時提示 |
| Cloud Sync 不可用 | 降級為純本地模式，資料不遺失 |
| Cloud ASR API 失敗 | 顯示具體錯誤訊息，已完成的段落保留，建議切換引擎或改用本地 |
| Twitch PubSub 斷線 | 指數退避自動重連（1s → 120s），持續重試直到恢復。通知使用者連線狀態 |
| YouTube 輪詢失敗 | 跳過本次檢查，下次輪詢重試。遇 rate limit 時自動降低頻率 |
| 排程下載觸發失敗 | 通知使用者具體錯誤，不影響其他預設的正常運作 |
| 頻道元資料過期 | 使用最後快取的元資料繼續顯示，背景靜默刷新。刷新失敗時標示「資料可能已過期」 |

---

## Consistency Layer（一致性層）

### Terminology（術語表）

| 術語 | 英文 | 定義 |
|------|------|------|
| Record | Record | 一筆時間標記記錄，包含播放時間點、主題、直播標題 |
| Mark | Mark | 建立 Record 的動作 |
| Folder | Folder | Record 的分類容器 |
| Uncategorized | 未分類 | 系統預設 Folder，存放未歸類的 Record |
| Group | Group | Record 列表中依直播標題自動產生的折疊群組 |
| Download Task | 下載任務 | 一次下載操作的實例，含狀態與進度 |
| Clip Range | 片段範圍 | 下載時指定的開始時間到結束時間 |
| Transcription | 轉錄 | 將影音檔案的音訊轉換為文字/字幕的過程 |
| Sidecar | Sidecar | 與主應用程式打包在一起的外部可執行程式 |
| Cloud Sync | 雲端同步 | Record/Folder 在 Extension 與 Desktop 之間的同步服務 |
| VOD | VOD | Video on Demand，直播結束後的回放影片 |
| Offset | 偏移 | 從 Record 帶入下載時，前後額外包含的秒數 |
| BYOK | Bring Your Own Key | 使用者自行提供第三方 API Key 來使用雲端服務 |
| Local ASR | 本地 ASR | 在使用者電腦上執行的語音辨識引擎（Whisper / Qwen3-ASR） |
| Cloud ASR | 雲端 ASR | 透過 BYOK API Key 呼叫的第三方語音辨識服務 |
| Preset | 下載預設 | 為特定頻道設定的下載參數組合，用於排程下載自動觸發時套用 |
| Scheduled Download | 排程下載 | 由直播偵測自動觸發的下載任務，使用預設的下載參數 |
| Live Detection | 直播偵測 | 監聽頻道直播狀態變化的背景服務，包含 Twitch PubSub 與 YouTube RSS 兩種方式 |
| System Tray | 系統列 | 作業系統的通知區域圖示（macOS: 選單列、Windows: 系統匣），用於背景執行 |
| PubSub | PubSub | Twitch 的即時事件推播 WebSocket 服務，用於偵測直播狀態變化 |
| Cooldown | 冷卻期 | 同一頻道觸發自動下載後，忽略後續重複事件的等待時間 |
| Stream ID | 串流 ID | 單場直播的唯一識別碼。Twitch: PubSub 事件中的 stream ID；YouTube: 直播影片的 video ID |
| Channel Bookmark | 頻道書籤 | 使用者收藏的 Twitch/YouTube 頻道，包含頻道核心資訊與使用者備註，支援 Cloud Sync |
| Metadata Refresh | 元資料刷新 | 定期從平台 API 重新取得頻道元資料（頭像、追蹤者數等）的背景操作 |
| Quick Action | 快速動作 | 頻道書籤上的一鍵操作（下載 VOD、新增預設、開啟頻道頁面等） |

### Patterns（共用模式）

#### Pattern 1: 資料流

```
Extension (Chrome Storage)
       |
       | write on change
       v
Cloud Sync (Cloudflare D1)  ← source of truth
       |
       | polling every 3-5s
       v
Desktop (Local SQLite / JSON)
       |
       | on user action
       v
yt-dlp / FFmpeg / ASR (Sidecar or Cloud API)
```

- Cloudflare D1 為 Record/Folder/Channel Bookmark 的 source of truth
- Extension 與 Desktop 各自維護本地快取
- 離線優先：Extension 與 Desktop 均可在離線狀態下運作，回到線上後自動同步
- 下載歷史、設定、頻道元資料、影片快取：僅存在 Desktop 本地，不同步
- 頻道書籤同步資料流（透過 Cloud Sync）：

```
Extension (Chrome Storage)           Desktop (JSON)
       |                                   |
       | channel_bookmarks                 | channel_bookmarks
       | (core data only)                  | (core data + local metadata)
       v                                   v
Cloud Sync (Cloudflare D1: channel_bookmarks table)
       ↕ polling every 3-5s
       同步欄位：id, channelId, channelName, platform, notes, sortOrder
       不同步：avatarUrl, followerCount, lastStreamAt, video cache
```

- 排程下載資料流（獨立於 Cloud Sync）：

```
Twitch PubSub (WebSocket)  ──stream-up──>  Live Detection Service
YouTube RSS (HTTP polling)  ──is_live───>       (Desktop)
                                                   |
                                           +-------+-------+
                                           |               |
                                     match preset    match bookmark
                                           |               |
                                           v               v
                                   Download Preset   Update badge
                                      (JSON)          (UI only)
                                           |
                                           | auto-trigger
                                           v
                                   Download Queue → yt-dlp / FFmpeg
```

#### Pattern 2: 三級錯誤處理

| 等級 | 名稱 | 行為 | 範例 |
|------|------|------|------|
| Critical | 致命錯誤 | 阻斷操作，顯示模態對話框，記錄 log | Sidecar 缺失、資料庫損毀 |
| Warning | 警告 | 顯示可消除的 toast/banner，操作可繼續 | 網路中斷、Token 即將過期 |
| Info | 資訊 | 顯示短暫提示（1.5 秒自動消失） | 「已複製」、「已儲存」、「已同步」 |

#### Pattern 3: 認證

| 服務 | 認證方式 | 儲存位置 | 更新策略 |
|------|----------|----------|----------|
| Cloud Sync | Google OAuth → Workers → JWT | Extension: Chrome Identity API; Desktop: OS keychain | 自動 refresh |
| Twitch API | OAuth Token（手動輸入） | Desktop 設定檔（加密） | 使用者手動更新 |
| YouTube 私人內容 | cookies.txt | Desktop 本地檔案 | 使用者手動匯入 |
| Cloud ASR (BYOK) | API Key（手動輸入） | Desktop: OS keychain（加密） | 使用者手動更新 |

#### Pattern 4: 外部工具管理

1. 首次啟動檢查：Desktop 啟動時檢查 yt-dlp、FFmpeg、FFprobe 是否存在且版本符合
2. 自動下載：缺失時自動從官方 Release 下載對應平台的 binary
3. 更新檢查：定期檢查 yt-dlp 新版本（YouTube 反爬蟲更新頻繁）
4. 版本固定：FFmpeg 使用已知穩定版本
5. 持久連線管理：Twitch PubSub WebSocket 連線需持續維護（PING/PONG 心跳、斷線重連、主題訂閱管理），與 sidecar 的一次性程序管理不同，屬於長生命週期資源

#### Pattern 5: ASR 引擎選擇策略

使用者選擇 ASR 引擎時的 UI 引導邏輯：

| 條件 | 建議引擎 | 原因 |
|------|----------|------|
| 有 GPU + 隱私優先 | 本地 Whisper / Qwen | 資料不離開本機 |
| 無 GPU + 追求速度 | Groq (BYOK) | near real-time 轉錄 |
| 高精度多語言需求 | OpenAI 或 ElevenLabs (BYOK) | 商業級精度 |
| 需要 Speaker Diarization | ElevenLabs (BYOK) | 內建說話者分離 |
| 離線環境 | 本地 Whisper / Qwen | 不需網路 |

### Form（形式規範）

#### 檔案命名

- 應用程式設定檔：`{appDataDir}/tidemark/config.json`
- 下載歷史：`{appDataDir}/tidemark/history.json`
- Records 本地快取：`{appDataDir}/tidemark/records.db`（SQLite）
- 下載輸出：預設 `[{type}] [{channel_name}] [{date}] {title} {resolution}.{ext}`
- 字幕輸出：與輸入檔案同名，副檔名為 `.srt` 或 `.txt`
- 排程下載預設：`{appDataDir}/tidemark/scheduled_presets.json`
- 頻道書籤：`{appDataDir}/tidemark/channel_bookmarks.json`
- 頻道元資料快取：`{appDataDir}/tidemark/channel_metadata_cache.json`

#### UI 模式

- Tab Navigation：Desktop 主介面使用側邊 Tab 導航（Download、History、Subtitles、Records、Channel Bookmarks、Scheduled Downloads、Settings）。Scheduled Downloads 頁面僅在 F6.8「啟用排程下載」開啟時顯示；Channel Bookmarks 頁面僅在 F6.9「啟用頻道書籤」開啟時顯示
- Card Pattern：下載任務以卡片呈現，含進度條、操作按鈕、展開/收起詳情
- Toast Notifications：短暫操作回饋（右下角，1.5~3 秒自動消失）
- Modal Dialogs：破壞性操作（刪除、清空）需要確認對話框
- Theme System：支援深色/淺色/跟隨系統，使用 CSS 變數實作

#### URL 處理

- 所有 URL 在顯示前進行 sanitize
- URL 貼入時自動 trim 空白與尾部參數清理
- 支援從系統剪貼簿自動偵測 URL（可在設定中關閉）

---

## Phase 2 Features（第二階段功能）

以下功能在 Phase 1 不實作，但在架構設計時需預留擴充空間。

### ~~P2.1 Scheduled Downloads（排程下載）~~ → 已升級為 Module 7

已於 v0.2 升級為正式規格，詳見 Design Layer 的 Module 7。

### ~~P2.2 Channel Bookmarks（頻道書籤）~~ → 已升級為 Module 8

已於 v0.3 升級為正式規格，詳見 Design Layer 的 Module 8。

### ~~P2.3 PubSub Live Detection（直播偵測）~~ → 已併入 Module 7

已於 v0.2 併入 Module 7（F7.2 Twitch 直播偵測），詳見 Design Layer 的 Module 7。

### P2.4 Video Unmuting（靜音片段修復）

- 來源：TwitchLink 的 unmute video 功能
- 功能：Twitch VOD 中因版權音樂被靜音的片段，嘗試修復音訊

### P2.5 Multi-Language UI

- 功能：桌面端 UI 支援多語言（繁中、英文、日文）
- 架構預留：所有 UI 字串使用 i18n key

### P2.6 Filename Template Editor

- 來源：TwitchLink 的 FileNameGenerator 與 Template 系統
- 功能：可視化的檔名範本編輯器，顯示所有可用變數與即時預覽
