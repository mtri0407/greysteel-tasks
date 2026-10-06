# Greysteel Tasks 🍊 · Hướng dẫn cài đặt và triển khai

App quản lý công việc và **lộ trình mục tiêu dài hạn**. Ai đăng nhập bằng tài khoản Google của họ cũng dùng được ngay, dữ liệu tự lưu trong Google Drive riêng của từng người, và **đăng nhập một lần là ở lại nhiều tháng** (không phải đăng nhập lại mỗi lần mở web).

---

## Cấu trúc thư mục

```
public/               <- phần chạy trên trình duyệt (Netlify publish thư mục này)
  index.html          <- toàn bộ giao diện app
  engine.js, datastore.js, calsync.js   <- logic Lịch thông minh (xem mục riêng bên dưới)
  icon.svg            <- logo quả cam
  icon-192.png, icon-512.png
  manifest.json       <- để cài như app trên điện thoại
netlify/functions/    <- phần chạy trên máy chủ, giữ phiên đăng nhập an toàn
  _lib.js, auth-callback.js, refresh-token.js, logout.js, _test.js
netlify.toml          <- cấu hình triển khai
test_*.js, test_fake_google.js   <- bộ kiểm thử (không được đưa lên mạng)
docs/SPEC-lich-thong-minh.md     <- spec tính năng Lịch thông minh
```

---

## Bước 1 · Tạo dự án và bật API trên Google Cloud

1. Vào [console.cloud.google.com](https://console.cloud.google.com), tạo dự án mới (ví dụ tên "Greysteel Tasks").
2. Vào **APIs & Services > Library**, bật hai API:
   - **Google Calendar API**
   - **Google Drive API**

## Bước 2 · Cấu hình màn hình đồng ý (OAuth consent)

Giao diện Google Cloud mới đặt phần này ở menu **Google Auth Platform**:

1. Vào mục **Branding**: điền tên app "Greysteel Tasks", email hỗ trợ, email liên hệ.
2. Vào mục **Data Access** (trước đây gọi là Scopes), thêm 4 quyền:
   - `.../auth/drive.appdata`
   - `.../auth/calendar.events`
   - `.../auth/userinfo.profile`
   - `.../auth/userinfo.email`
3. Vào mục **Audience**:
   - Chọn **External**.
   - Ở phần **Test users**, bấm **Add users** và thêm email của bạn cùng email của từng người bạn muốn cho dùng thử (tối đa 100 người). Đây chính là chỗ xử lý lỗi `403 access_denied` bạn gặp trước đó.
   - Khi nào muốn mở cho tất cả mọi người thì bấm **Publish App** (Google có thể yêu cầu xác minh vì app dùng quyền Drive và Calendar).

## Bước 3 · Tạo OAuth Client ID và Client Secret

1. Vào **Clients > Create client**, chọn **Web application**, đặt tên "Greysteel Tasks Web".
2. **Authorized JavaScript origins**, thêm:
   ```
   https://TEN-APP-CUA-BAN.netlify.app
   ```
3. **Authorized redirect URIs**, thêm chính xác (chú ý phần đuôi):
   ```
   https://TEN-APP-CUA-BAN.netlify.app/.netlify/functions/auth-callback
   ```
4. Bấm **Create**. Google hiện ra **Client ID** và **Client Secret**, giữ lại cả hai.

> Client ID là thông tin công khai nên nằm trong file `index.html` là bình thường.
> **Client Secret là bí mật**, tuyệt đối không đặt vào `index.html`. Nó chỉ được khai báo trong biến môi trường của Netlify ở bước 5, và không bao giờ được gửi xuống trình duyệt.

## Bước 4 · Điền Client ID vào app

Mở `public/index.html`, tìm dòng gần đầu thẻ `<script>`:

```js
const CONFIG = {
  GOOGLE_CLIENT_ID: "",
};
```

Dán Client ID vào giữa hai dấu ngoặc kép rồi lưu file.

## Bước 5 · Triển khai lên Netlify và khai báo biến môi trường

1. Vào [app.netlify.com](https://app.netlify.com), tạo site mới bằng cách kéo thả **cả thư mục dự án** (thư mục chứa `netlify.toml`), hoặc kết nối với một repo Git.
2. Vào **Site configuration > Environment variables**, thêm 3 biến:

   | Tên biến | Giá trị |
   |---|---|
   | `GOOGLE_CLIENT_ID` | Client ID ở bước 3 |
   | `GOOGLE_CLIENT_SECRET` | Client Secret ở bước 3 |
   | `SESSION_SECRET` | Một chuỗi ngẫu nhiên dài do bạn tự tạo |

   Để tạo `SESSION_SECRET`, mở terminal và chạy một trong hai lệnh sau, rồi copy kết quả:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   ```
   openssl rand -hex 32
   ```
   Chuỗi này dùng để mã hoá phiên đăng nhập. Đổi chuỗi này sẽ khiến tất cả mọi người phải đăng nhập lại.

3. Bấm **Deploys > Trigger deploy > Clear cache and deploy site** để Netlify nạp lại biến môi trường.
4. Quay lại Google Cloud, đảm bảo domain thật mà Netlify cấp đã được thêm đúng vào cả **JavaScript origins** lẫn **redirect URIs** ở bước 3.

## Bước 6 · Dùng thử

Mở domain Netlify, bấm "Đăng nhập với Google", đồng ý cấp quyền. Từ lần sau, mở lại web là vào thẳng app, không phải đăng nhập lại.

---

## Cài như app trên điện thoại (không cần App Store)

App đã được cấu hình sẵn thành PWA:

- **iPhone**: mở web bằng Safari, bấm nút Chia sẻ, chọn "Thêm vào MH chính".
- **Android**: mở bằng Chrome, bấm menu ba chấm, chọn "Cài đặt ứng dụng" hoặc "Thêm vào màn hình chính".

Kết quả là một icon quả cam trên màn hình chính, mở lên chạy toàn màn hình như app thật. Sau này khi muốn đưa lên App Store và CH Play thật sự, có thể đóng gói bản web này bằng Capacitor mà gần như không phải viết lại.

---

## Cách dùng Lộ trình mục tiêu

Tính năng này được thiết kế dựa trên ba mô hình đã được kiểm chứng: **periodization** trong khoa học thể thao (chia mục tiêu lớn thành các chu kỳ nhỏ dần), **OKR** (mục tiêu luôn gắn với một con số đo được), và **retrospective** của Agile (cuối mỗi chặng đối chiếu kỳ vọng với thực tế rồi điều chỉnh).

**Bước 1 · Tạo mục tiêu.** Đặt tên, chọn lĩnh vực, chọn đơn vị đo (band điểm, kg, triệu đồng, giờ... hoặc tự nhập đơn vị riêng), điền mức xuất phát và mức đích, khoảng thời gian, và số giai đoạn muốn chia. App sẽ tự dựng sườn: chia đều thời gian và nội suy kỳ vọng cho từng giai đoạn.

**Bước 2 · Chỉnh sườn theo ý bạn.** Vào từng giai đoạn để sửa tên, trọng tâm, ngày tháng, kỳ vọng cuối giai đoạn và chỉ tiêu mỗi tuần. Có thể thêm hoặc xoá giai đoạn tuỳ ý.

**Bước 3 · Ghi nhật ký mỗi ngày.** Mỗi buổi học hay tập, ghi lại khối lượng đã làm. App tự cộng vào tuần tương ứng và tính phần trăm nỗ lực. Nếu tuần này làm thiếu thì cứ log bù vào ngày sau, tổng nỗ lực của giai đoạn vẫn được cộng đủ. Mỗi nhật ký cũng tự tạo một việc đã hoàn thành trong Danh sách việc để bạn không phải quản lý hai nơi.

**Bước 4 · Tổng kết cuối giai đoạn.** Bạn tự nhập kết quả thực tế đo được (điểm thi thử, cân nặng thật, doanh thu thật). App đặt ba con số cạnh nhau: **kỳ vọng** ban đầu, **ước chừng** suy ra từ phần trăm nhật ký, và **thực tế** bạn nhập. Từ đó app nhận định bạn vượt hay chưa đạt kỳ vọng, phân tích xem nguyên nhân nằm ở kỳ vọng đặt quá cao hay ở khối lượng chưa đủ, rồi đề xuất điều chỉnh giai đoạn kế tiếp. Bấm "Áp dụng gợi ý này" là app tự cập nhật, còn không thì bạn tự chỉnh tay, quyền quyết định luôn thuộc về bạn.

Gợi ý điều chỉnh chỉ tiêu tuần chỉ xuất hiện khi đã có ít nhất hai tuần dữ liệu thật, và luôn dựa trên nhịp trung bình bạn thực sự duy trì được, nên sẽ không có chuyện đề xuất những con số vô lý.

---

## Về thông báo nhắc việc

Có hai lớp nhắc nhở:

**Trong trình duyệt** (chỉ chạy khi đang mở app): vào tab Cài đặt bấm "Cấp quyền thông báo trình duyệt". App kiểm tra mỗi 5 phút và báo việc đến hạn, quá hạn, hoặc ngày đặc biệt hôm nay.

**Google Calendar** (đáng tin cậy hơn, chạy cả khi tắt app): mỗi ngày đặc biệt bạn thêm sẽ tự tạo sự kiện lặp hàng năm trên Google Calendar chính của bạn, kèm nhắc trước theo số ngày bạn chọn. Với việc cần làm, bật công tắc "Đồng bộ vào Google Calendar" khi thêm hoặc sửa việc.

---

## Lịch thông minh xử lý phát sinh

Spec: `docs/SPEC-lich-thong-minh.md`. Phần logic nằm trong 3 file riêng, `index.html` chỉ gọi hàm và vẽ giao diện:

```
public/engine.js      <- engine xếp lịch và xử lý phát sinh (hàm thuần, trọng số trong ENGINE_CONFIG)
public/datastore.js   <- migrate file cũ, gộp hai thiết bị, changelog theo tháng
public/calsync.js     <- đồng bộ hai chiều Google Calendar (phần thuần)
```

**Bắt đầu dùng:**

1. Vào **Lộ trình mục tiêu**, bấm Sửa từng mục tiêu để đặt **Hạng ưu tiên** (1 là cao nhất) và **Ngân sách giờ mỗi tuần**.
2. Vào **Lịch thông minh > Lịch khung**, thêm block mẫu cho một tuần (hoặc bấm "Nạp lịch khung mẫu" để dùng lịch trong Phụ lục của spec).
3. Vào tab **Giờ ngủ & cài đặt**, chỉnh giờ ngủ từng đêm. Engine không bao giờ xếp việc vào giờ ngủ.
4. Ở tab **Tuần**, bấm "Sinh block tuần này từ lịch khung". Từ đó mỗi Chủ nhật app tự sinh block cho tuần tới.
5. Có việc phát sinh thì bấm **+ Thêm việc phát sinh**, xem phương án rồi chọn Duyệt / Sửa / Bỏ. App không bao giờ tự sửa lịch.
6. Mỗi lần mở app sẽ hiện các block đã kết thúc mà chưa check-in. Xem kết quả ở **Ngân sách tuần**.

**Dữ liệu:** lần đầu mở bản mới, trước lần ghi đầu tiên app lưu nguyên file cũ thành `greysteel-tasks-backup-v1-NGÀY.json` trong appDataFolder. Changelog nằm ở các file `changelog-YYYY-MM.json` cùng thư mục. Hai thiết bị cùng sửa thì app đọc lại version trên Drive và gộp theo id (bản có `updatedAt` mới hơn thắng).

---

## Kiểm thử

Trước khi triển khai bản chỉnh sửa, có thể chạy lại toàn bộ bộ kiểm thử:

```
node test_logic.js                    # 20 test cho phần tính toán lộ trình
node test_engine.js                   # 29 test engine lịch thông minh (6 kịch bản nghiệm thu + luật cứng)
node test_data.js                     # 15 test migrate, gộp hai thiết bị, changelog
node test_calsync.js                  # 12 test đồng bộ Google Calendar
node netlify/functions/_test.js       # 15 test cho phần đăng nhập
node test_full.js                     # 23 test giao diện thật bằng trình duyệt
node test_smart.js                    # 20 test giao diện lịch thông minh bằng trình duyệt
```

Hai test trình duyệt cần Playwright và dùng Google API giả lập trong `test_fake_google.js` (không gọi Google thật). Nếu Playwright được cài ở thư mục khác (ví dụ `C:\Users\Admin\node_modules`), chạy kèm `NODE_PATH`:

```
NODE_PATH=C:/Users/Admin/node_modules node test_smart.js
```

Nên chạy `test_logic.js` với nhiều múi giờ để chắc chắn không có lỗi lệch ngày:

```
TZ=Asia/Ho_Chi_Minh node test_logic.js
TZ=UTC node test_logic.js
TZ=UTC node test_engine.js
```

---

## Xử lý sự cố thường gặp

**Lỗi 403 access_denied**: email đăng nhập chưa nằm trong danh sách Test users. Thêm ở **Google Auth Platform > Audience > Test users**.

**Lỗi redirect_uri_mismatch**: redirect URI trong Google Cloud phải khớp tuyệt đối, kể cả phần `/.netlify/functions/auth-callback` ở cuối và không có dấu gạch chéo thừa.

**Vẫn phải đăng nhập lại mỗi lần**: kiểm tra ba biến môi trường trên Netlify đã khai báo đủ chưa, và đã deploy lại sau khi thêm biến chưa. Có thể mở tab Network của trình duyệt xem lời gọi `/.netlify/functions/refresh-token` trả về gì.

**Báo "Đã tạm khoá lưu để bảo vệ dữ liệu cũ"**: app không đọc được dữ liệu từ Drive nên chủ động không ghi đè, tránh mất dữ liệu. Kiểm tra mạng rồi tải lại trang, dữ liệu cũ của bạn vẫn nguyên vẹn trên Drive.
