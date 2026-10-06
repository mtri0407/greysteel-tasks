# TEST_PLAN · Greysteel Tasks

Đăng nhập Google thật không tự động hoá được (Google chặn trình duyệt điều khiển bằng script và app không có tài khoản test riêng), nên kiểm thử chia làm hai lớp:

- **Trước khi deploy (máy local, Google giả lập):** chạy đủ bộ test trong HUONG_DAN.md, mục Kiểm thử. Mọi luồng có đăng nhập đều nằm ở đây (`test_full.js`, `test_smart.js`).
- **Sau khi deploy (bản live, không đăng nhập):** các mục dưới đây, chạy bằng `node test_live.js`.

## Trang chủ và màn hình đăng nhập
- URL/trang cần vào: /
- Tài khoản dùng test: không cần
- Các bước kiểm tra:
  1. Mở trang chủ bản live.
  2. Đọc lỗi JS và lỗi CSP trong console.
- Kết quả mong đợi: thấy nút "Đăng nhập với Google", không có lỗi JS, không có vi phạm Content-Security-Policy.

## File logic Lịch thông minh được phục vụ đúng
- URL/trang cần vào: /engine.js, /datastore.js, /calsync.js
- Tài khoản dùng test: không cần
- Các bước kiểm tra:
  1. Tải từng file.
  2. Trong trang chủ, kiểm tra `GSEngine`, `GSData`, `GSCalSync` đã có.
  3. Gọi `GSEngine.propose` với dữ liệu seed, kịch bản 1 của spec.
- Kết quả mong đợi: HTTP 200, kiểu application/javascript; 3 biến global tồn tại; kịch bản 1 đặt "Họp BCS" vào 18:00 thứ 3 trong khung đệm.

## Netlify Functions đăng nhập vẫn chạy
- URL/trang cần vào: /.netlify/functions/refresh-token
- Tài khoản dùng test: không cần
- Các bước kiểm tra:
  1. Gọi refresh-token khi không có cookie phiên.
- Kết quả mong đợi: HTTP 401 với `error: "no_session"` (không phải 500).

## Giao diện điện thoại
- URL/trang cần vào: /
- Tài khoản dùng test: không cần
- Các bước kiểm tra:
  1. Mở trang ở khung 390 x 844.
- Kết quả mong đợi: không tràn ngang (scrollWidth không quá 400).

## Kiểm tra bằng mắt sau deploy (người dùng tự làm)
- Đăng nhập, vào Lịch thông minh > Lịch khung, nạp lịch mẫu hoặc tự tạo, sinh block tuần, thêm một việc phát sinh và duyệt.
- Kết quả mong đợi: block hiện trên Google Calendar với màu theo loại; trong Drive appDataFolder có file backup và changelog-YYYY-MM.json.
