# SPEC.md — Tidemark 產品規格書

| 版本 | 日期 | 說明 |
|------|------|------|
| 0.1 | 2026-02-16 | 初版 |

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

### Impacts（成功行為指標）

1. **從多工具切換到單一工作流**：使用者不再需要在瀏覽器插件、yt-dlp 命令列、字幕工具之間來回切換
2. **從事後回想到即時標記**：使用者養成在看直播時即時標記時間點的習慣
3. **從下載整支 VOD 到精準片段下載**：使用者利用時間標記直接帶入下載頁面，只下載需要的片段
4. **從手動打字幕到自動轉錄**：下載完成後一鍵送往 ASR 轉錄

### Success Criteria（成功指標）

- SC-1: 從瀏覽器標記時間到在桌面端開始下載該片段，全程不超過 5 次點擊
- SC-2: 桌面端首次啟動到第一次成功下載，不超過 3 分鐘（不含網路下載時間）
- SC-3: 時間標記在 Extension 與 Desktop 之間同步延遲不超過 5 秒
- SC-4: 支援 YouTube 與 Twitch 雙平台的所有公開內容（VOD、Clip、直播流）

### Non-Goals（非目標）

- NG-1: 不處理 DRM 保護或付費牆內容的繞過
- NG-2: 不提供影片編輯功能（裁切是下載階段的功能，非後製編輯）
- NG-3: 不做社群功能（分享、評論、公開書籤）
- NG-4: Phase 1 不實作排程下載與頻道書籤（Phase 2 範疇）
- NG-5: 不取代 OBS 等專業錄製軟體
- NG-6: 不做行動端版本

---

## Design Layer（設計層）

### System Boundary（系統邊界）

**系統內部（Tidemark 負責）：**

- 瀏覽器擴充套件：時間標記的建立、管理與同步
- 桌面應用程式：內容下載、片段裁切、直播錄製、ASR 轉錄、時間標記管理、下載歷史
- Cloud Sync Service：Extension 與 Desktop 之間的時間標記資料同步

**系統外部（依賴但不控制）：**

- YouTube / Twitch 平台（影片來源、API、網頁結構）
- yt-dlp（下載引擎，作為 sidecar binary 嵌入）
- FFmpeg / FFprobe（轉碼、裁切、合併引擎，作為 sidecar binary 嵌入）
- Whisper / Qwen3-ASR（本地 ASR 引擎，以 Python sidecar 形式執行）
- OpenAI API / Groq API / ElevenLabs API（雲端 ASR 引擎，BYOK 模式）
- Cloudflare Workers + D1（Cloud Sync 的後端服務）
- Twitch GQL API（Twitch 內容元資料與 VOD 查詢）

### System Components（系統元件）

```
+---------------------+        +-------------------+        +------------------+
|  Browser Extension  | <----> |   Cloud Sync      | <----> |   Desktop App    |
|  (Chrome/Edge)      |        |   (CF Workers+D1) |        |   (Tauri)        |
+---------------------+        +-------------------+        +------------------+
        |                                                           |
        | content script                                     +------+------+------+
        v                                                    |             |      |
  YouTube / Twitch                                     yt-dlp +       Python  Cloud ASR
  Web Pages                                            FFmpeg    ASR Sidecar   APIs
                                                                (local)      (BYOK)
```

#### Browser Extension

- 職責：在 YouTube/Twitch 頁面擷取當前播放時間，建立 Record，管理 Folder 分類，將資料同步至 Cloud Sync
- 技術形式：Chrome Extension (Manifest v3)，支援 Chrome 與 Edge
- 狀態管理：本地使用 Chrome Storage API，同步使用 Cloud Sync API

#### Desktop App

- 職責：內容下載（YouTube + Twitch）、直播錄製、片段裁切、ASR 轉錄（本地 + 雲端 BYOK）、Record 管理（含雲端同步後的本地呈現）、下載歷史管理、全域設定
- 技術形式：Tauri (Rust backend + Web frontend)
- 外部程序管理：yt-dlp, FFmpeg, FFprobe 以 sidecar binary 嵌入；本地 ASR 以 Python sidecar 執行

#### Cloud Sync Service

- 職責：Extension 與 Desktop 之間的資料中介，負責 Record 與 Folder 的雲端持久化與同步
- 技術形式：Cloudflare Workers（REST API）+ Cloudflare D1（SQLite 資料庫）
- 資料範圍：僅同步 Record 與 Folder 資料。下載歷史、設定不同步

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

---

### Interfaces Between Components（元件間介面）

#### Interface 1: Extension ↔ Cloud Sync

- 通訊協定：HTTPS REST API（Cloudflare Workers）
- 認證方式：Google OAuth → Workers 驗證 → JWT token
- 同步策略：客戶端每 3-5 秒輪詢 `GET /sync?since={lastUpdatedAt}`，取得增量變更
- 寫入：每次本地變更後立即 `POST /records` 或 `POST /folders`
- 衝突解決：Last-write-wins，以 `updatedAt` 較新者為準

#### Interface 2: Desktop ↔ Cloud Sync

- 通訊協定：HTTPS REST API（Cloudflare Workers），與 Interface 1 相同的 API
- 認證方式：Google OAuth（透過系統瀏覽器 redirect 流程）→ JWT token
- 同步策略：同 Interface 1

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

CREATE INDEX idx_records_user_updated ON records(user_id, updated_at);
CREATE INDEX idx_folders_user_updated ON folders(user_id, updated_at);
```

**API Endpoints**:

| Method | Path | 說明 |
|--------|------|------|
| POST | `/auth/google` | Google OAuth token 交換 JWT |
| GET | `/sync?since={iso8601}` | 增量同步（取得 since 之後的所有 records + folders 變更） |
| POST | `/records` | 建立或更新 Record（upsert by id） |
| DELETE | `/records/{id}` | 軟刪除 Record（設 deleted=1） |
| POST | `/folders` | 建立或更新 Folder（upsert by id） |
| DELETE | `/folders/{id}` | 軟刪除 Folder（設 deleted=1） |

**Subrequest 估算**（per `/sync` invocation）：

| 操作 | Subrequest 數 |
|------|---------------|
| JWT 驗證 | 0（本地驗證） |
| D1 查詢 records | 1 |
| D1 查詢 folders | 1 |
| **總計** | **2** |

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

- Cloudflare D1 為 Record/Folder 的 source of truth
- Extension 與 Desktop 各自維護本地快取
- 離線優先：Extension 與 Desktop 均可在離線狀態下運作，回到線上後自動同步
- 下載歷史與設定：僅存在 Desktop 本地，不同步

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

#### UI 模式

- Tab Navigation：Desktop 主介面使用側邊 Tab 導航（Download、History、Subtitles、Records、Settings）
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

### P2.1 Scheduled Downloads（排程下載）

- 來源：TwitchLink 的 ScheduledDownloads 模組
- 功能：為指定的 Twitch 頻道設定下載預設（畫質、檔名範本、輸出資料夾），當該頻道開始直播時自動觸發下載
- 關鍵元件：ScheduledDownloadPreset、PubSub WebSocket 連線、ScheduledDownloadManager
- 架構預留：Desktop 端需預留 background service / system tray 模式

### P2.2 Channel Bookmarks（頻道書籤）

- 來源：TwitchLink 的 Bookmarks 功能
- 功能：收藏常看的 Twitch/YouTube 頻道，快速存取頻道狀態與最新影片列表
- 架構預留：資料模型中為 Bookmark 預留儲存空間

### P2.3 PubSub Live Detection（直播偵測）

- 來源：TwitchLink 的 TwitchPubSub 模組
- 功能：透過 Twitch PubSub WebSocket 持續監聽已書籤頻道的直播狀態變化
- 架構預留：Tauri 端需預留持久 WebSocket 連線管理

### P2.4 Video Unmuting（靜音片段修復）

- 來源：TwitchLink 的 unmute video 功能
- 功能：Twitch VOD 中因版權音樂被靜音的片段，嘗試修復音訊

### P2.5 Multi-Language UI

- 功能：桌面端 UI 支援多語言（繁中、英文、日文）
- 架構預留：所有 UI 字串使用 i18n key

### P2.6 Filename Template Editor

- 來源：TwitchLink 的 FileNameGenerator 與 Template 系統
- 功能：可視化的檔名範本編輯器，顯示所有可用變數與即時預覽
