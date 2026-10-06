# Spec – Lịch thông minh xử lý phát sinh

Oct 6, 2026 · @Phạm Nguyễn Minh Trí

## Bối cảnh và mục tiêu

Tính năng này biến lịch từ nơi lưu sự kiện thành hệ thống biết mỗi block phục vụ mục tiêu nào, có được dời hay không, và tự đề xuất cách xếp lại khi có việc phát sinh.

Người dùng đầu tiên là founder: sinh viên năm nhất với 5 môn, gym 4 buổi/tuần, điều hành startup, 2 CLB, ban cán sự, cuối tuần về quê. Lịch tĩnh trên Google Calendar vỡ mỗi khi có việc phát sinh. Mục tiêu #1 (học) bị việc ưu tiên thấp chiếm giờ mà không ai nhận ra.

Nguyên tắc thiết kế:

- Mục tiêu ưu tiên cao không bao giờ âm thầm mất giờ vào việc ưu tiên thấp.
- App đề xuất, người dùng duyệt. App không tự sửa lịch.
- Luật cứng: không cắt giờ ngủ, không đè lên block cố định.
- Giai đoạn 1 chạy hoàn toàn bằng luật, không cần AI.
- Mọi thay đổi đều được ghi log, sẵn sàng cho phân tích và nghiên cứu sau này.

## Hiện trạng và lộ trình

Giai đoạn 1 xây trên app hiện tại và chỉ phục vụ một người dùng: một file `public/index.html` không framework, Netlify Functions cho đăng nhập, dữ liệu mỗi người là một file JSON trong Google Drive appDataFolder. Giai đoạn 1 không cần thêm server hay database.

| Thành phần | Hiện trạng | Giai đoạn |
| --- | --- | --- |
| Mục tiêu theo phase, chỉ tiêu tuần theo đơn vị tự chọn | Đã có | – |
| Task với ma trận Eisenhower, trạng thái todo/doing/done | Đã có | – |
| Ghi sự kiện sang Google Calendar (lịch primary), một chiều | Đã có | – |
| Hạng mục tiêu, ngân sách giờ/tuần | Chưa có (cần xác minh hạng) | 1 |
| Block, lịch khung, engine phát sinh | Chưa có | 1 |
| Đọc ngược Google Calendar | Chưa có | 1 |
| Check-in, ngân sách tuần thực tế | Chưa có | 1 |
| AI | Chưa có | 2 |
| Database, xử lý nền phía server, push, nhiều người dùng | Chưa có | 3 |

1. **Giai đoạn 1 – Cá nhân, không AI:** loại block, lịch khung, engine phát sinh dựa trên luật, đồng bộ hai chiều với Google Calendar, check-in, ngân sách tuần. Người dùng duy nhất là founder.
2. **Giai đoạn 2 – AI:** nhập phát sinh bằng câu tự nhiên, tóm tắt tuần, giải thích đánh đổi. Chỉ bắt đầu khi giai đoạn 1 đã dùng thật ít nhất 4 tuần.
3. **Giai đoạn 3 – Nhiều người dùng và nghiên cứu:** onboarding, đồng ý dữ liệu, ẩn danh, phân tích.

Ràng buộc của giai đoạn 1: mọi thứ chạy trong trình duyệt khi app đang mở, dữ liệu nằm trong file JSON trên Drive. Netlify Functions chỉ giữ vai trò đăng nhập và làm mới token như hiện tại.

## Khái niệm lõi

Mỗi block mang hai thông tin quyết định cách engine đối xử với nó: loại block và mục tiêu nó phục vụ (ưu tiên của block = hạng của mục tiêu).

| Loại (`type`) | Engine được làm gì | Ví dụ |
| --- | --- | --- |
| Cố định (`fixed`) | Không bao giờ dời, không đặt gì chồng lên | Lớp học, giờ ngủ, sự kiện bên ngoài từ Google Calendar |
| Bảo vệ (`protected`) | Chỉ việc ưu tiên 1–2 được chiếm; block bị chiếm phải được dời đi chỗ khác | 4 block học sáng thứ 6 |
| Linh hoạt (`flexible`) | Dời được trong khung hạn của nó; chỉ việc ưu tiên cao hơn mới được đẩy nó | 2 block làm bài trong 24h sau lớp GT |
| Đệm (`buffer`) | Hút việc phát sinh trước tiên; khi tới giờ mà vẫn trống thì hỏi người dùng dùng để học thêm hay nghỉ | Tối thứ 3, 17:45–19:30 |

**Block và task là hai lớp riêng.** Block là hộp thời gian: bắt đầu, kết thúc, loại, mục tiêu, loại năng lượng. Task là nội dung cụ thể, ví dụ "GT Câu 12 (a,b,e,f)", có ước lượng số block và hạn. Một block chứa 0 đến nhiều task. Block bị dời thì task đi theo; task xong sớm thì phần còn lại của block được giải phóng.

**Lịch khung (weekly template).** Người dùng định nghĩa một tuần mẫu (xem Phụ lục). Mỗi Chủ nhật, app sinh block thật cho tuần tới từ mẫu. Sửa một tuần cụ thể không làm thay đổi mẫu.

**Năng lượng.** Mỗi block gắn `energy` = `deep` (buổi sáng, dạng mới khó) hoặc `light` (buổi tối, sổ lỗi, ôn). Task cũng có yêu cầu năng lượng; engine ưu tiên xếp task vào block cùng loại.

## Mô hình dữ liệu

App không có database: toàn bộ dữ liệu là đối tượng `state` lưu thành file JSON trong Drive appDataFolder. Giai đoạn 1 thêm các mảng mới vào `state` thay vì tạo bảng. Tên trường giữ cố định như dưới đây để sau này chuyển sang database không phải đổi.

| Khóa | Trường chính | Ghi chú |
| --- | --- | --- |
| `state.goals` (đã có, bổ sung) | rank (1–5), timeBudgetMinPerWeek | Giữ nguyên hệ phase và chỉ tiêu theo đơn vị tự chọn; ngân sách giờ là trường riêng, được để trống |
| `state.settings.sleepRules` (mới) | giờ ngủ theo từng đêm | Ví dụ 22:00–05:00 trước ngày có ca 6h |
| `state.blockTemplates` (mới) | id, weekday, start, end, type, goalId, energy, label | Lịch khung |
| `state.blocks` (mới) | id, templateId, start, end, type, goalId, energy, status, source, deadline, gcalEventId, updatedAt | `status`: planned / done / partial / skipped / moved / unknown. `source`: template / manual / disruption / external |
| `state.tasks` (đã có, bổ sung) | blockId, estBlocks, energyNeed, earliest, deadline | Giữ ma trận Eisenhower và todo/doing/done. `blockId` trống = đang chờ xếp |
| `state.disruptions` (mới) | id, title, durationMin, priority, mode, fixedStart, windowStart, windowEnd, resolution | `mode`: fixed\_time / flexible. `resolution`: accepted / edited / rejected |
| `state.checkins` (mới) | id, blockId, result, completedRatio, reasonCode, note, createdAt | `reasonCode`: disruption / tired / distracted / sick / other |
| `state.calendarSync` (mới) | syncToken, lastSyncAt | Phục vụ đọc ngược Google Calendar |
| File riêng theo tháng, ví dụ `changelog-2026-10.json` | id, entity, entityId, action, before, after, cause, createdAt | Chỉ ghi thêm. Tách file để không phải ghi lại cả `state` mỗi lần. `cause`: disruption / user\_edit / gcal\_sync / template |

Quy ước chung:

- Thời điểm của block lưu dạng ISO 8601 có múi giờ, ví dụ `2026-10-09T08:00:00+07:00`, khớp cách app đang dùng giờ địa phương. Ngày thuần vẫn dùng `ymd()`.
- Chống ghi đè giữa hai thiết bị: trước khi lưu, đọc lại `version` của file trên Drive. Nếu đã đổi kể từ lần tải thì tải lại, gộp các mảng theo `id` (bản có `updatedAt` mới hơn thắng), rồi mới lưu.
- Không xóa cứng; dùng `deletedAt`.
- Changelog, `checkins` và `disruptions` là bộ dữ liệu "kế hoạch so với thực tế" cho nghiên cứu sau này, nên ghi đầy đủ ngay từ giai đoạn 1.

## Engine xếp lịch và xử lý phát sinh

Engine giai đoạn 1 là một hàm thuần dựa trên luật: nhận lịch hiện tại và một việc phát sinh, trả về một phương án thay đổi để người dùng duyệt. Không gọi AI, cùng đầu vào luôn cho cùng đầu ra, nên viết unit test được.

Engine nằm trong một file riêng, ví dụ `public/engine.js`, không đụng DOM hay Drive. Nó chạy trong trình duyệt và chạy được bằng Node để test theo đúng cách `test_logic.js` đang làm. Không viết thêm vào `index.html`.

```
propose(blocks, goals, disruption, now) -> Proposal
Proposal = { placement, moved: [{block, from, to}], lost: [block],
             budget_before, budget_after, warnings, alternatives }
```

**Đầu vào (form “Thêm việc phát sinh”):** tên, thời lượng, ưu tiên 1–5 (hoặc chọn mục tiêu để lấy hạng), kiểu giờ cố định (giờ bắt đầu) hoặc linh hoạt (khung từ–đến).

**Luật cứng, không ngoại lệ:**

- Không đặt gì vào giờ ngủ.
- Không chồng lên block `fixed`.
- Việc ưu tiên 3–5 không được chiếm block `protected`.
- Chỉ được đẩy block `flexible` có ưu tiên thấp hơn việc mới (số hạng lớn hơn).
- Không tự áp dụng; luôn trả về phương án để duyệt.

**Thuật toán:**

1. Lập danh sách khung ứng viên. Giờ cố định: đúng khung đó. Linh hoạt: mọi khoảng đủ dài trong \[window\_start, window\_end\], bước 15 phút, trừ giờ ngủ.
2. Tính chi phí mỗi ứng viên. Trống hoàn toàn = 0. Chồng lên `buffer` = 1. Chồng lên `flexible` ưu tiên thấp hơn = 10 cộng số block phải dời. Chồng lên `protected` (chỉ khi việc mới ưu tiên 1–2) = 50. Vi phạm luật cứng = loại.
3. Chọn ứng viên chi phí thấp nhất; hòa thì chọn khung sớm hơn.
4. Với mỗi block bị chiếm (trừ `buffer`), tìm chỗ mới theo thứ tự: `buffer` trống trong hạn của block → khoảng trống cùng `energy` trong hạn → khoảng trống bất kỳ trong hạn. Giai đoạn 1 chỉ dời một cấp: block bị dời không được đẩy tiếp block khác.
5. Block không tìm được chỗ trong hạn → đưa vào `lost` và hiển thị số phút mục tiêu đó sẽ hụt trong tuần.
6. Không có ứng viên hợp lệ → trả về cảnh báo xung đột và 3 khung thay thế hợp lệ gần nhất (có thể ngoài khung người dùng chọn).
7. Người dùng bấm Duyệt → áp dụng, ghi `ChangeLog` với `cause` = disruption\_id, đồng bộ Google Calendar. Bấm Sửa → mở lại form. Bấm Bỏ → chỉ lưu `Disruption` với `resolution` = rejected.

Các trọng số 1 / 10 / 50 là giá trị khởi đầu, đặt thành cấu hình để tinh chỉnh sau khi có dữ liệu thật.

**Màn hình duyệt** phải cho thấy trong một lần nhìn: việc mới nằm đâu, block nào đi từ đâu tới đâu, block nào bị mất, và ngân sách tuần của từng mục tiêu trước và sau.

## Đồng bộ Google Calendar

App vẫn ghi vào lịch primary như hiện tại và thêm chiều đọc ngược. Giai đoạn 1 không dùng webhook vì không có server lưu trạng thái: app kéo thay đổi về mỗi khi mở và theo vòng kiểm tra 5 phút đang có. Scope `calendar.events` hiện có đã đủ.

- **Sự kiện do app tạo:** lưu `gcalEventId` trong block; ghi `blockId`, `type`, `goalId` vào `extendedProperties.private` để phân biệt với sự kiện người dùng tự tạo; màu theo loại block (`colorId`). Cần kiểm tra `syncTaskEvent()` hiện đã lưu ID sự kiện chưa.
- **Đọc ngược:** `events.list` trên lịch primary. Lần đầu đồng bộ đầy đủ, sau đó dùng `syncToken` lưu trong `state.calendarSync`. Token hết hạn (Google trả lỗi 410) thì đồng bộ đầy đủ lại.
- **Sự kiện không có dấu của app** → lưu là block `fixed`, `source` = external. Nếu chồng lên block của app → chạy engine như một việc phát sinh giờ cố định và hiện phương án ngay khi phát hiện.
- **Người dùng kéo/sửa block của app trên Google** → nhận ở lần đồng bộ kế tiếp, cập nhật block, ghi changelog với `cause` = gcal\_sync. Vi phạm luật cứng thì chỉ cảnh báo, không tự đẩy ngược.
- **Chống vòng lặp:** bỏ qua thay đổi do chính app vừa ghi (so `etag` hoặc `updated`).

Webhook (`events.watch`) để sang giai đoạn 3, khi đã có database và token phía server. Cần kiểm tra lại tài liệu API và quota hiện hành trước khi làm.

## Check-in và ngân sách tuần

Check-in sau mỗi block là nguồn dữ liệu "thực tế" duy nhất; thiếu nó thì ngân sách tuần chỉ là kế hoạch.

**Check-in:**

- App chưa có thông báo có nút bấm, nên giai đoạn 1 dùng **hàng chờ check-in**: mỗi lần mở app, hiện các block đã kết thúc mà chưa check-in, bấm từng cái Xong / Một phần / Bỏ. Khi app đang mở, gửi Web Notification lúc block kết thúc.
- Một phần → chọn 25 / 50 / 75%. Một phần hoặc Bỏ → chọn lý do: phát sinh, mệt, mất tập trung, ốm, khác.
- Quá 48 giờ chưa check-in → `status` = unknown, không tự coi là xong.
- Task trong block bỏ hoặc dở tự quay về danh sách chờ; engine đề xuất chỗ mới trong hạn.
- Thông báo có nút bấm (cần service worker và web push) để sang giai đoạn 3.

**Màn hình ngân sách tuần:**

- Mỗi mục tiêu một thanh: đã làm thật / còn trong kế hoạch / mục tiêu tuần, xếp theo hạng mục tiêu.
- Cảnh báo khi mục tiêu hạng 1 dự kiến hụt quá 10% so với mục tiêu tuần.
- Thống kê đơn giản: tỷ lệ hoàn thành theo loại block, theo ngày trong tuần, theo khung giờ; 3 lý do bỏ hàng đầu.

Ví dụ giá trị thực tế: nếu block Chủ nhật khi ở quê chỉ hoàn thành 30%, người dùng thấy ngay và điều chỉnh lịch khung, thay vì tự tin rằng mình sẽ học được.

## Kịch bản kiểm thử nghiệm thu

Giai đoạn 1 được coi là xong khi cả 6 kịch bản dưới đây chạy đúng trên dữ liệu seed ở Phụ lục. Mục tiêu GPA có hạng 1.

| # | Tình huống | Kết quả mong đợi |
| --- | --- | --- |
| 1 | Thêm "Họp BCS", 60 phút, ưu tiên 5, cố định 18:00 thứ 3 | Đặt vào khung đệm 17:45–19:30; không block nào bị dời; ngân sách GPA không đổi |
| 2 | Khung đệm tối thứ 3 đã kín. Thêm "Họp CLB", 90 phút, ưu tiên 5, linh hoạt thứ 3 17:00–21:00 | Không được đẩy block GPA 19:45 vì việc mới ưu tiên thấp hơn; trả về cảnh báo xung đột và 3 khung thay thế |
| 3 | Thêm việc ưu tiên 1, 120 phút, cố định 9:00 thứ 6 | Được chiếm block `protected`; các block GPA bị chiếm dời sang đệm cuối thứ 6 và khung trống gần nhất trong hạn; phần không có chỗ hiện số phút GPA bị hụt |
| 4 | Lời mời họp từ Google Calendar 13:30–14:30 thứ 5, chồng block học | Lưu là `fixed` external; phát hiện ở lần đồng bộ kế tiếp (mở app hoặc vòng 5 phút) và hiện phương án dời block; chưa duyệt thì lịch giữ nguyên và hiển thị xung đột |
| 5 | Thêm việc ưu tiên 2, 90 phút, linh hoạt thứ 3 21:00–23:30 | Không đặt qua 22:00 vì sáng thứ 4 có ca 6h; trả về cảnh báo và khung thay thế |
| 6 | Check-in "Bỏ – mệt" cho block GPA 13:30 thứ 4 có 2 task | 2 task quay về danh sách chờ; engine đề xuất chỗ mới trong hạn; ngân sách thực tế không cộng block này |

## Giai đoạn 2–3: AI, nhiều người dùng, dữ liệu nghiên cứu

AI được thêm vào như một lớp giao tiếp phía trước engine, không thay thế engine: engine vẫn là nơi quyết định xếp lịch.

**Giai đoạn 2 – AI:**

- Chuyển câu tự nhiên ("họp BCS 1 tiếng tối nay") thành đúng dữ liệu của form phát sinh, dạng JSON theo schema.
- Luôn hiện form đã điền sẵn để người dùng sửa trước khi chạy engine. Đầu ra sai schema thì quay về form trống.
- Viết tóm tắt tuần và giải thích phương án bằng lời, đọc từ dữ liệu engine đã tính.
- Gọi mô hình AI qua một Netlify Function để giữ API key phía server, không gọi thẳng từ trình duyệt.

**Giai đoạn 3 – Nhiều người dùng và nghiên cứu:**

- Hạ tầng: thêm database phía server và lưu refresh token phía server (mã hóa), để engine, đồng bộ và webhook chạy được cả khi người dùng không mở app. Drive có thể giữ làm bản sao do người dùng sở hữu.
- Webhook `events.watch` và web push có nút bấm qua service worker.
- Xác minh OAuth với Google: `calendar.events` là scope nhạy cảm; khi chưa xác minh, app bị giới hạn khoảng 100 người dùng thử.
- Onboarding: nhập thời khóa biểu, chọn và xếp hạng mục tiêu, chọn lịch khung mẫu theo nhóm (ví dụ sinh viên năm nhất mùa thi).
- Đồng ý dữ liệu tách riêng: đồng ý dùng app và đồng ý cho dữ liệu ẩn danh vào nghiên cứu; rút lại được bất cứ lúc nào. Nếu dữ liệu vẫn nằm ở Drive của từng người, nghiên cứu cần cơ chế người dùng chủ động gửi bản ẩn danh lên server.
- Bộ dữ liệu nghiên cứu xuất từ changelog, `checkins`, `disruptions`, đã bỏ tiêu đề việc và ghi chú tự do (tiêu đề lịch có thể chứa thông tin nhạy cảm); chỉ giữ loại, thời lượng, ưu tiên, kết quả.
- Kiểm tra quy định bảo vệ dữ liệu cá nhân hiện hành của Việt Nam trước khi mở cho người dùng khác.

Câu hỏi nghiên cứu bộ dữ liệu này trả lời được: loại phát sinh nào làm hụt mục tiêu nhiều nhất, khung giờ nào có tỷ lệ hoàn thành cao nhất, và mỗi tuần cần bao nhiêu giờ khung đệm là đủ.

## Phụ lục: lịch khung mẫu (dữ liệu seed)

Lịch thật của founder mùa thi giữa kỳ, dùng làm `BlockTemplate` seed cho kiểm thử. Giờ ngủ: 22:00–05:00 trước các ngày thứ 3, 4, 5 (ca 6h); 23:00–07:00 các đêm khác. Thứ 7 từ 16:30 đến sáng thứ 2 ở Hải Phòng.

| Thứ | Giờ | Nhãn | Loại | Mục tiêu | Năng lượng |
| --- | --- | --- | --- | --- | --- |
| T2 | 09:00–12:00 | Học sâu, 3 block | protected | GPA | deep |
| T2 | 13:15–16:00 | Học, 3 block | flexible | GPA | deep |
| T2 | 16:30–18:00 | Gym | flexible | Gym | – |
| T2 | 19:45–20:30 | Học trước GT | flexible | GPA | light |
| T3 | 06:00–10:10 | Lớp Giải tích 1 | fixed | GPA | – |
| T3 | 10:15–11:15 | Ăn trưa với anh em | flexible | Quan hệ | – |
| T3 | 11:20–13:10 | Bài GT sau lớp (hạn 24h) | flexible | GPA | deep |
| T3 | 14:45–16:15 | Gym | flexible | Gym | – |
| T3 | 17:45–19:30 | Khung đệm | buffer | – | – |
| T3 | 19:45–20:30 | Sổ lỗi, trang Vũ khí | flexible | GPA | light |
| T4 | 06:00–10:10 | Lớp Đại số | fixed | GPA | – |
| T4 | 11:00–12:45 | Bài ĐS sau lớp (hạn 24h) | flexible | GPA | deep |
| T4 | 13:30–15:00 | GT còn tồn | flexible | GPA | deep |
| T4 | 15:30–16:30 | Lý luận TDTT | fixed | GPA | – |
| T4 | 18:00–20:00 | Khung đệm / CLB | buffer | – | – |
| T5 | 06:00–12:00 | Lớp Nhập môn CNTT | fixed | GPA | – |
| T5 | 13:15–15:45 | Học: 2 Toán + 1 CNTT | flexible | GPA | deep |
| T5 | 16:00–18:00 | Lớp Nhập môn CNTT | fixed | GPA | – |
| T5 | 18:15–19:45 | Gym | flexible | Gym | – |
| T6 | 08:00–12:00 | Học sâu, 4 block | protected | GPA | deep |
| T6 | 13:15–15:05 | Học, 2 block | flexible | GPA | deep |
| T6 | 15:10–16:00 | Khung đệm | buffer | – | – |
| T6 | 16:30–18:00 | Gym | flexible | Gym | – |
| T7 | 08:00–11:00 | Học: 2 Toán + 1 Pháp luật | flexible | GPA | deep |
| T7 | 12:00–16:00 | Lớp Pháp luật đại cương | fixed | GPA | – |
| T7 | 16:30–ngày hôm sau | Về Hải Phòng | fixed | Quan hệ | – |
| CN | 08:00–10:45 | Việc nhẹ ở quê | flexible | GPA | light |

Mục tiêu và hạng: GPA (1, 18 giờ/tuần), Gym (2, 6 giờ/tuần), Quan hệ (3), Startup (4), CLB và ban cán sự (5).
