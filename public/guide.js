/* ======================= HƯỚNG DẪN SỬ DỤNG =======================
   Ba phần:
   1. Trang "Hướng dẫn sử dụng": toàn bộ app, từng bước, có ô tìm kiếm và nút "Làm thử".
   2. Tour tương tác: làm nổi từng nút trên màn hình thật và giải thích.
   3. Danh sách "Bắt đầu nhanh" của Lịch thông minh: tự đánh dấu khi người dùng làm xong từng bước.
   File này chỉ định nghĩa hàm, dùng các biến chung của index.html (state, el, $, renderAll...)
   lúc được gọi, nên phải nạp TRƯỚC script chính.
   Khi màn hình nào đổi, sửa luôn nội dung ở đây và TĂNG GUIDE_VERSION để tour được mời xem lại. */

const GUIDE_VERSION = 3; // 2: Trợ lý AI, Xếp bù; 3: Dán lịch nhanh, Xoá hàng loạt

/* ---------- Nội dung trang hướng dẫn ----------
   Mỗi mục: id, icon, title, intro, steps (danh sách bước), tips (mẹo), try (nút làm thử). */
const GUIDE_SECTIONS = [
  { id: 'start', icon: '🚀', title: 'Bắt đầu', intro: 'Greysteel Tasks lưu mọi thứ trong Google Drive của chính bạn, không qua máy chủ nào khác.',
    steps: [
      'Bấm "Đăng nhập với Google" và đồng ý cấp quyền. Từ lần sau mở web là vào thẳng app, không phải đăng nhập lại.',
      'Dữ liệu tự lưu sau mỗi thao tác. Nhìn góc trên bên phải: "đã lưu vào Drive" là xong.',
      'Muốn dùng như app trên điện thoại: iPhone mở bằng Safari, bấm Chia sẻ, chọn "Thêm vào MH chính". Android mở bằng Chrome, bấm menu ba chấm, chọn "Cài đặt ứng dụng".',
      'Bấm 🌙 ở góc trên để đổi giao diện sáng hoặc tối.',
    ],
    tips: ['Chỉ mở app ở một tab trên mỗi thiết bị. Dùng nhiều thiết bị cùng lúc vẫn được, app tự gộp thay đổi.'],
    try: [{ label: 'Xem tour toàn bộ app', tour: 'app' }] },

  { id: 'home', icon: '🏠', title: 'Trang chủ', intro: 'Nhìn một lần là biết hôm nay cần làm gì.',
    steps: [
      'Bốn ô số ở trên cùng: việc đang làm, đến hạn hôm nay, quá hạn, đã hoàn thành.',
      'Các thông báo màu cam ở đầu trang là việc cần bạn xử lý: block chờ check-in, sự kiện Google chồng lịch, khung đệm đang trống.',
      'Thẻ "Cần chú ý" liệt kê việc quá hạn và đến hạn hôm nay. Thẻ "Sắp tới" liệt kê sinh nhật, kỷ niệm trong 14 ngày.',
      'Cuối trang là các mục tiêu đang theo đuổi, có thanh Kết quả và Thời gian để so tiến độ.',
    ],
    try: [{ label: 'Mở Trang chủ', view: 'home' }] },

  { id: 'tasks', icon: '📋', title: 'Việc cần làm', intro: 'Thêm việc, chia mức ưu tiên và theo dõi trạng thái.',
    steps: [
      'Bấm "+ Thêm việc" (ở Trang chủ, Ma trận hoặc Danh sách việc). Nhập tên, hạn, giờ nếu có.',
      'Chọn mức ưu tiên theo ma trận Eisenhower: Khẩn cấp và quan trọng, Quan trọng không khẩn, Khẩn cấp không quan trọng, Việc lặt vặt.',
      'Bật "Đồng bộ vào Google Calendar" nếu muốn điện thoại tự nhắc kể cả khi không mở app.',
      'Trên thẻ việc, bấm "▶ Bắt đầu làm" rồi "✔ Hoàn thành". Bấm "↩︎ Mở lại" nếu cần làm lại.',
      'Ở Ma trận ưu tiên, kéo thả thẻ việc sang ô khác để đổi mức ưu tiên.',
      'Ở Danh sách việc, gõ để tìm, lọc theo trạng thái và mức ưu tiên.',
      'Ở Lịch (tháng), bấm vào một ngày để thêm việc cho đúng ngày đó.',
      'Phần "🗓️ Lịch thông minh (tuỳ chọn)" trong form việc: ước lượng số block cần, năng lượng cần (sâu hay nhẹ), ngày sớm nhất và hạn xếp lịch. Engine dùng các thông tin này khi đề xuất chỗ cho việc.',
    ],
    try: [{ label: 'Mở Danh sách việc', view: 'list' }, { label: 'Mở Ma trận ưu tiên', view: 'matrix' }] },

  { id: 'goals', icon: '🎯', title: 'Lộ trình mục tiêu', intro: 'Biến một mục tiêu lớn thành các giai đoạn có kỳ vọng rõ ràng, chỉ tiêu tuần và nhật ký ngày.',
    steps: [
      'Bấm "+ Tạo mục tiêu mới". Đặt tên, lĩnh vực, đơn vị đo, mức xuất phát, mức đích, ngày bắt đầu, ngày đích, số giai đoạn.',
      'Chọn "Hạng ưu tiên" (1 là cao nhất) và "Ngân sách giờ mỗi tuần". Hai ô này là đầu vào quan trọng nhất của Lịch thông minh: mục tiêu hạng cao không bao giờ âm thầm mất giờ vào việc hạng thấp.',
      'App dựng sẵn các giai đoạn. Bấm "Mở lộ trình", rồi "Sửa" từng giai đoạn để chỉnh tên, ngày, kỳ vọng, chỉ tiêu tuần.',
      'Mỗi buổi học hay tập, vào "Mở chi tiết & ghi nhật ký", bấm "+ Ghi nhật ký hôm nay". Tuần nào thiếu thì log bù vào ngày sau, tổng vẫn được cộng đủ.',
      'Cuối giai đoạn, bấm "Tổng kết giai đoạn", nhập kết quả thật đo được. App so kỳ vọng, ước chừng và thực tế, rồi gợi ý điều chỉnh giai đoạn sau. Bấm "Áp dụng gợi ý này" nếu đồng ý.',
    ],
    tips: ['Mục tiêu nào chưa cần lộ trình chi tiết (ví dụ Gym, Quan hệ) vẫn nên tạo để đặt hạng và ngân sách giờ cho Lịch thông minh.'],
    try: [{ label: 'Mở Lộ trình mục tiêu', view: 'planner' }] },

  { id: 'smart-concepts', icon: '🧠', title: 'Lịch thông minh: hiểu 4 loại block', intro: 'Mỗi block là một hộp thời gian, mang loại block và mục tiêu nó phục vụ. Ưu tiên của block chính là hạng của mục tiêu.',
    steps: [
      '📌 Cố định: lớp học, giờ ngủ, sự kiện từ Google Calendar. Không bao giờ bị dời, không gì được đặt chồng lên.',
      '🛡️ Bảo vệ: giờ học sâu quan trọng. Chỉ việc ưu tiên 1 hoặc 2 được chiếm, và block bị chiếm phải được dời đi chỗ khác.',
      '🍊 Linh hoạt: dời được trong hạn của nó. Chỉ việc có ưu tiên cao hơn mới được đẩy nó đi.',
      '⏳ Đệm: khoảng trống để hút việc phát sinh trước tiên. Tới giờ mà vẫn trống, app hỏi bạn dùng để học thêm hay nghỉ.',
      'Năng lượng: block "sâu" dành cho dạng bài mới, khó (thường buổi sáng); block "nhẹ" cho ôn tập, sổ lỗi (thường buổi tối). Khi phải dời, engine ưu tiên chỗ cùng loại năng lượng.',
      'Block và việc là hai lớp riêng: block là hộp thời gian, việc là nội dung bên trong. Bấm "Gán việc" trên block để đặt việc vào. Block bị dời thì việc đi theo.',
    ],
    try: [{ label: 'Xem tour Lịch thông minh', tour: 'smart' }] },

  { id: 'smart-setup', icon: '🧩', title: 'Lịch thông minh: cài đặt lần đầu', intro: 'Làm một lần, sau đó app tự sinh lịch mỗi tuần.',
    steps: [
      'Đặt hạng và ngân sách giờ cho các mục tiêu (xem mục Lộ trình mục tiêu).',
      'Vào Lịch thông minh, tab "🧩 Lịch khung". Bấm "+ Thêm block mẫu" cho từng khung giờ trong tuần mẫu: chọn thứ, giờ, loại, mục tiêu, năng lượng. Một khung chứa nhiều block (ví dụ 08:00 đến 12:00 học 4 block) thì điền "Số block trong khung" là 4, app tự chia thành 4 block 50 phút.',
      'Bài cần làm xong trong thời hạn (ví dụ bài sau lớp hạn 24 giờ) thì điền "Hạn hoàn thành". Khi bị dời, block chỉ được dời trong hạn này.',
      'Muốn có sẵn ví dụ: bấm "Nạp lịch khung mẫu" (chỉ hiện khi lịch khung đang trống), rồi sửa lại cho đúng lịch của bạn.',
      'Tab "😴 Giờ ngủ & cài đặt": điền giờ đi ngủ và giờ thức dậy cho từng đêm. Mỗi dòng là đêm TRƯỚC buổi sáng của thứ đó. Engine không bao giờ xếp việc vào giờ ngủ. Bấm "Lưu giờ ngủ".',
      'Tab "🗓️ Tuần": bấm "Sinh block tuần này từ lịch khung". Từ đó mỗi Chủ nhật app tự sinh block cho tuần tới.',
    ],
    tips: ['Sửa lịch khung không đổi các tuần đã sinh. Sửa một block trong tuần cũng không đổi lịch khung.',
      'Block được ghi lên Google Calendar với màu theo loại để bạn xem trên điện thoại. Không muốn thì tắt ở tab Giờ ngủ & cài đặt.'],
    try: [{ label: 'Mở Lịch khung', view: 'schedule', tab: 'templates' }, { label: 'Mở Giờ ngủ', view: 'schedule', tab: 'sleep' }] },

  { id: 'smart-quick', icon: '📋', title: 'Lịch thông minh: dán lịch nhanh và xoá hàng loạt', intro: 'Thêm cả buổi, cả tuần trong vài giây bằng cách dán văn bản; xoá cả ngày, cả tuần khi cần làm lại.',
    steps: [
      'Ở tab Tuần, bấm "📋 Dán lịch nhanh". Dán hoặc gõ mỗi dòng một việc theo dạng giờ bắt đầu - giờ kết thúc: tên việc, ví dụ "16h-18h30: Học giải tích", "7:00 - 9:15 Ôn đại số", "7-9h Gym".',
      'Muốn thêm cho nhiều ngày: thêm dòng "Thứ 2", "T3", "Thứ sáu", "CN" hoặc ngày "15/10" phía trên các dòng của ngày đó. Có thể ghi chung dòng: "T4: 13h30-15h GT còn tồn". Dòng không ghi thứ thì vào ngày bạn chọn ở ô "Dòng không ghi thứ thì thêm vào".',
      'Phần Xem trước hiện từng dòng app đọc được, kèm cảnh báo nếu chồng block khác hoặc chồng giờ ngủ. Bỏ tích dòng không muốn thêm; chọn loại và mục tiêu cho từng dòng nếu cần (hoặc đặt loại, mục tiêu mặc định cho tất cả).',
      'Bấm "Thêm N block". Các thông tin khác (năng lượng, việc bên trong...) sửa sau bằng nút Sửa trên từng block.',
      'Muốn lặp lại mỗi tuần: ở tab Lịch khung bấm "📋 Dán vào lịch khung" (hoặc chọn "Lịch khung" ở ô Thêm vào), các dòng sẽ thành block mẫu.',
      'Xoá cả một ngày: bấm 🗑 cạnh tên ngày ở tab Tuần. Xoá cả tuần: bấm "🗑 Xoá cả tuần". Xoá toàn bộ lịch khung: ở tab Lịch khung. Xoá tất cả block ở mọi tuần: tab Giờ ngủ & cài đặt, mục Làm lại từ đầu.',
      'Sau khi xoá, đầu trang hiện "Hoàn tác" để khôi phục ngay nếu lỡ tay. Sự kiện tương ứng trên Google Calendar cũng được xoá rồi tạo lại khi hoàn tác.',
      'Đã xoá cả tuần mà muốn sinh lại từ lịch khung: bấm "Sinh block tuần này từ lịch khung". App không tự sinh lại tuần bạn vừa xoá.',
    ],
    tips: ['Dòng chỉ có giờ bắt đầu (ví dụ "20h: Gọi điện") được tạm tính 60 phút và có cảnh báo để bạn kiểm tra.',
      'Sự kiện bạn tự tạo trên Google Calendar không xoá được từ app (lần đồng bộ sau sẽ lại về), hãy xoá trên Google.'],
    try: [{ label: 'Mở Dán lịch nhanh', view: 'schedule', tab: 'week', action: 'quick' }] },

  { id: 'smart-disruption', icon: '⚡', title: 'Lịch thông minh: xử lý việc phát sinh', intro: 'Có việc đột xuất, app đề xuất cách xếp lại, bạn quyết định. App không bao giờ tự sửa lịch.',
    steps: [
      'Ở tab Tuần, bấm "+ Thêm việc phát sinh".',
      'Nhập tên, thời lượng (phút), ưu tiên 1 đến 5, hoặc chọn mục tiêu để lấy luôn hạng của mục tiêu đó.',
      'Chọn kiểu giờ: "Giờ cố định" nếu việc phải đúng giờ đó (ví dụ họp 18:00). "Linh hoạt trong khung" nếu làm lúc nào cũng được trong một khoảng (ví dụ 17:00 đến 21:00).',
      'Bấm "Xem phương án". Màn hình duyệt cho thấy: việc mới nằm ở đâu, block nào bị dời từ đâu tới đâu, block nào bị mất, và ngân sách giờ từng mục tiêu trước và sau.',
      'Bấm "Duyệt" để áp dụng (lịch và Google Calendar cùng được cập nhật), "Sửa" để mở lại form, "Bỏ" để không làm gì.',
      'Nếu không có khung hợp lệ (ví dụ chồng giờ ngủ hoặc chỉ còn giờ của mục tiêu quan trọng hơn), app nêu lý do và đưa 3 khung thay thế gần nhất. Bấm "Chọn khung này" để xem phương án với khung đó.',
    ],
    tips: ['Thứ tự app chọn chỗ: khoảng trống trước, rồi khung đệm, rồi mới đẩy block ưu tiên thấp hơn. Block bị đẩy đi vào khung đệm trống, rồi khoảng trống cùng năng lượng, rồi khoảng trống bất kỳ, trong hạn của nó.',
      'Block không còn chỗ trong hạn sẽ bị "mất". Màn hình duyệt ghi rõ số phút mục tiêu đó bị hụt để bạn cân nhắc trước khi Duyệt.'],
    try: [{ label: 'Thêm việc phát sinh', view: 'schedule', tab: 'week', action: 'disruption' }] },

  { id: 'smart-google', icon: '📅', title: 'Lịch thông minh: đồng bộ Google Calendar', intro: 'App đọc lịch Google khi mở app và mỗi 5 phút trong lúc app mở.',
    steps: [
      'Sự kiện bạn tự tạo hoặc được mời trên Google được coi là block cố định.',
      'Nếu sự kiện đó chồng lên block học, app hiện thông báo "sự kiện chồng lên lịch" ở đầu trang và đánh dấu đỏ các block bị chồng. Lịch giữ nguyên cho tới khi bạn duyệt.',
      'Bấm "Xem phương án" để xem cách dời các block bị chồng, rồi Duyệt hoặc Bỏ.',
      'Nếu bạn kéo một block của app sang giờ khác ngay trên Google Calendar, lần đồng bộ sau app cập nhật theo. Nếu giờ mới chồng giờ ngủ hay block cố định, app chỉ cảnh báo, không tự kéo lại.',
      'Xoá sự kiện của block trên Google thì block trong app cũng được xoá.',
    ],
    tips: ['Sự kiện cả ngày, sự kiện đánh dấu "rảnh" và lời mời bạn đã từ chối không được tính là bận.'],
    try: [{ label: 'Mở Lịch thông minh', view: 'schedule', tab: 'week' }] },

  { id: 'smart-checkin', icon: '✅', title: 'Lịch thông minh: check-in sau mỗi block', intro: 'Check-in là nguồn dữ liệu "thực tế" duy nhất. Không check-in thì ngân sách tuần chỉ là kế hoạch.',
    steps: [
      'Mỗi lần mở app, các block đã kết thúc mà chưa check-in hiện ra. Khi app đang mở, trình duyệt cũng báo lúc block vừa kết thúc (cần cấp quyền thông báo ở Cài đặt).',
      'Với mỗi block chọn: "Xong", "Một phần" (chọn 25, 50 hay 75%), hoặc "Bỏ".',
      'Một phần hoặc Bỏ thì chọn lý do: phát sinh, mệt, mất tập trung, ốm, khác. Có thể ghi chú thêm.',
      'Block bị Bỏ hoặc làm Một phần: app mở màn "Bù giờ và xếp lại việc", đề xuất block bù cho phần thời gian còn thiếu, xếp sớm nhất trong tuần (khung đệm trước, rồi khoảng trống cùng năng lượng). Việc trong block gốc chuyển sang block bù đầu tiên. Bấm "Duyệt tất cả" để áp dụng, "Để sau" nếu chưa muốn.',
      'Muốn bù sau cũng được: trên thẻ block bị Bỏ, làm dở hoặc chưa rõ có nút "Xếp bù". Phần không còn chỗ trong tuần sẽ được báo rõ số phút mục tiêu bị hụt.',
      'Quá 48 giờ chưa check-in, block chuyển thành "chưa rõ" và không được tính là đã làm.',
      'Có thể check-in từng block bằng nút "Check-in" trên thẻ block ở tab Tuần.',
    ],
    tips: ['Khung đệm tới giờ mà vẫn trống: chọn "Học thêm" để app tạo block cho mục tiêu hạng 1, hoặc "Nghỉ".'],
    try: [{ label: 'Mở hàng chờ check-in', action: 'checkin' }] },

  { id: 'budget', icon: '⏱️', title: 'Ngân sách tuần', intro: 'So giờ đã làm thật với kế hoạch của từng mục tiêu, xếp theo hạng.',
    steps: [
      'Mỗi mục tiêu một thanh: phần cam đậm là giờ đã làm thật (theo check-in), cam nhạt là giờ còn trong kế hoạch, vạch đen là mục tiêu tuần.',
      'Nếu mục tiêu hạng 1 dự kiến hụt quá 10% so với mục tiêu tuần, app hiện cảnh báo đỏ ở đầu trang.',
      'Phần dưới: tỷ lệ hoàn thành theo loại block, theo thứ, theo buổi (sáng, chiều, tối) và 3 lý do bỏ hay gặp nhất.',
      'Bấm "‹ Tuần trước" hoặc "Tuần sau ›" để xem tuần khác.',
    ],
    tips: ['Ví dụ: block Chủ nhật khi về quê chỉ hoàn thành 30%. Thấy vậy thì sửa lịch khung cho sát thực tế, thay vì tự tin rằng mình sẽ học được.',
      'Ngân sách chỉ tính block linh hoạt và bảo vệ có gắn mục tiêu. Giờ lên lớp (block cố định) không tính.'],
    try: [{ label: 'Mở Ngân sách tuần', view: 'budget' }] },

  { id: 'people', icon: '🎂', title: 'Ngày đặc biệt và Ghi chú vặt', intro: 'Không quên sinh nhật, kỷ niệm và những điều nhỏ nhặt.',
    steps: [
      'Ngày đặc biệt: bấm "+ Thêm ngày đặc biệt", nhập tên, loại, ngày, số ngày nhắc trước. App tạo sự kiện lặp hằng năm trên Google Calendar.',
      'Ghi chú vặt: bấm "+ Ghi chú mới", chọn danh mục, bật "Ghim lên đầu" cho ghi chú quan trọng.',
    ],
    try: [{ label: 'Mở Ngày đặc biệt', view: 'people' }, { label: 'Mở Ghi chú vặt', view: 'notes' }] },

  { id: 'settings', icon: '⚙️', title: 'Cài đặt và thông báo', intro: 'Hồ sơ, thông báo trình duyệt, giao diện.',
    steps: [
      'Vào Cài đặt, bấm "Cấp quyền thông báo trình duyệt" để nhận nhắc việc và báo block kết thúc khi app đang mở.',
      'Muốn được nhắc cả khi không mở app: bật đồng bộ Google Calendar cho việc và ngày đặc biệt.',
      'Đổi tên hiển thị, ngày sinh, icon đại diện rồi bấm "Lưu hồ sơ".',
    ],
    try: [{ label: 'Mở Cài đặt', view: 'settings' }] },

  { id: 'assistant', icon: '💬', title: 'Trợ lý AI', intro: 'Hỏi bất cứ điều gì về cách dùng app, hoặc nhờ trợ lý xử lý tình huống.',
    steps: [
      'Bấm nút "💬 Hỏi trợ lý" ở góc phải dưới màn hình.',
      'Gõ câu hỏi bằng lời bình thường, ví dụ: "Tối nay 18h có họp 1 tiếng, xếp giúp mình", "Block sáng nay mình lỡ thì làm sao?", "Tuần này GPA có đủ giờ không?".',
      'Trợ lý tự xem lịch, việc và ngân sách giờ của bạn để trả lời đúng tình huống.',
      'Khi cần thay đổi (thêm việc phát sinh, xếp bù, thêm việc), trợ lý hiện một thẻ có nút. Bấm nút để mở đúng màn hình duyệt của app, kiểm tra rồi mới bấm Duyệt.',
      'Bấm "Cuộc mới" để bắt đầu cuộc trò chuyện khác.',
    ],
    tips: ['Trợ lý không bao giờ tự sửa dữ liệu. Câu hỏi và phần dữ liệu trợ lý cần xem được gửi tới Claude (Anthropic) để trả lời.'],
    try: [{ label: 'Mở trợ lý', action: 'assistant' }] },

  { id: 'faq', icon: '❓', title: 'Câu hỏi thường gặp', intro: '',
    steps: [
      'Dữ liệu nằm ở đâu? Trong một thư mục ẩn của Google Drive chính bạn (appDataFolder). Mỗi tháng có thêm một file nhật ký thay đổi (changelog).',
      'Lần đầu dùng bản có Lịch thông minh, app tự lưu bản sao dữ liệu cũ thành file backup trước khi ghi.',
      'Dùng điện thoại và máy tính cùng lúc được không? Được. Trước khi lưu, app kiểm tra file trên Drive; nếu thiết bị khác vừa sửa, app gộp hai bên theo từng mục (bản sửa sau thắng).',
      'Sau mỗi lần app được cập nhật, hãy tải lại mọi tab đang mở. Tab chạy bản quá cũ có thể ghi đè dữ liệu lịch mới.',
      'Báo "Đã tạm khoá lưu để bảo vệ dữ liệu cũ": app không đọc được Drive nên chủ động không ghi. Kiểm tra mạng rồi tải lại trang.',
      'Không muốn app ghi block lên Google Calendar: vào Lịch thông minh, tab Giờ ngủ & cài đặt, tắt "Ghi block lên Google Calendar".',
    ],
    try: [] },
];

/* ---------- Trang Hướng dẫn sử dụng ---------- */
function RENDER_GUIDE(){
  const wrap = el('div');
  const top = el('div', 'card');
  top.innerHTML = `<h3 style="margin-top:0;">📖 Hướng dẫn sử dụng Greysteel Tasks</h3>
    <p class="subtle">Mỗi mục là các bước làm theo thứ tự. Bấm nút "Làm thử" để mở đúng màn hình, hoặc xem tour để app chỉ từng nút trên màn hình thật.</p>`;
  const acts = el('div', 'sch-actions');
  const t1 = el('button', 'btn btn-primary', '▶ Tour Lịch thông minh (1 phút)'); t1.id = 'tourSmartBtn'; t1.onclick = () => startTour('smart');
  const t2 = el('button', 'btn btn-ghost', '▶ Tour toàn bộ app'); t2.id = 'tourAppBtn'; t2.onclick = () => startTour('app');
  const t3 = el('button', 'btn btn-ghost', '💬 Hỏi trợ lý AI'); t3.id = 'askAiBtn'; t3.onclick = () => openAssistant();
  acts.append(t1, t2, t3); top.appendChild(acts);
  /* Ô tìm kiếm: chỉ ẩn/hiện mục, KHÔNG vẽ lại ô nhập để không làm hỏng bộ gõ tiếng Việt */
  const search = el('input'); search.id = 'guideSearch'; search.placeholder = 'Tìm trong hướng dẫn, ví dụ: check-in, giờ ngủ, khung đệm...';
  top.appendChild(search);
  wrap.appendChild(top);

  wrap.appendChild(smartChecklistCard(true));

  const toc = el('div', 'guide-toc');
  GUIDE_SECTIONS.forEach(s => { const a = el('button', 'btn btn-ghost btn-sm', `${s.icon} ${esc(s.title)}`); a.onclick = () => openGuideSection(s.id); toc.appendChild(a); });
  wrap.appendChild(toc);

  const list = el('div');
  GUIDE_SECTIONS.forEach(s => {
    const d = el('details', 'card guide-sec');
    d.id = 'guide-' + s.id; d.dataset.text = (s.title + ' ' + s.intro + ' ' + s.steps.join(' ') + ' ' + (s.tips || []).join(' ')).toLowerCase();
    d.innerHTML = `<summary><span class="guide-ic">${s.icon}</span> <strong>${esc(s.title)}</strong></summary>
      ${s.intro ? `<p class="subtle">${esc(s.intro)}</p>` : ''}
      <ol class="guide-steps">${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${(s.tips || []).map(x => `<div class="guide-tip">💡 ${esc(x)}</div>`).join('')}
      <div class="sch-actions guide-try" style="margin-top:10px;"></div>`;
    const tryBox = $('.guide-try', d);
    (s.try || []).forEach(t => { const b = el('button', 'btn btn-ghost btn-sm', (t.tour ? '▶ ' : '👉 ') + esc(t.label)); b.onclick = () => guideTry(t); tryBox.appendChild(b); });
    list.appendChild(d);
  });
  wrap.appendChild(list);
  const empty = el('div', 'empty', 'Không tìm thấy mục nào khớp.'); empty.style.display = 'none'; wrap.appendChild(empty);

  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    $$('.guide-sec', list).forEach(d => {
      const hit = !q || d.dataset.text.includes(q);
      d.style.display = hit ? '' : 'none';
      if (hit) shown++;
      if (q && hit) d.open = true;
    });
    empty.style.display = shown ? 'none' : '';
  });
  return wrap;
}
function openGuideSection(id){
  const d = document.getElementById('guide-' + id); if (!d) return;
  d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function guideTry(t){
  if (t.tour) return startTour(t.tour);
  if (t.action === 'assistant') return openAssistant();
  if (t.action === 'checkin') { if (!checkinDue().length) { toast('Hiện chưa có block nào chờ check-in'); return; } return openCheckinModal(); }
  if (t.view) {
    if (t.view === 'planner') state.planner = { level: 'list', goalId: null, phaseId: null };
    if (t.tab) state.schedule.tab = t.tab;
    state.view = t.view; renderAll();
  }
  if (t.action === 'disruption') setTimeout(() => openDisruptionModal(), 350);
  if (t.action === 'quick') setTimeout(() => openQuickAddModal('week'), 350);
}
function openGuide(sectionId){
  state.view = 'guide'; renderAll();
  if (sectionId) setTimeout(() => openGuideSection(sectionId), 400);
}

/* ---------- Danh sách "Bắt đầu nhanh" cho Lịch thông minh ----------
   Mỗi bước tự kiểm tra từ dữ liệu thật, nên tự đánh dấu khi người dùng làm xong. */
function smartChecklist(){
  const goals = (state.goals || []).filter(g => !g.deletedAt);
  const ranked = goals.filter(g => Number(g.rank) >= 1);
  const top = ranked.slice().sort((a, b) => Number(a.rank) - Number(b.rank))[0];
  const def = JSON.stringify(GSData.defaultSettings().sleepRules);
  const wk = currentWeekYmd();
  return [
    { id: 'rank', label: 'Xếp hạng ưu tiên cho mục tiêu', done: ranked.length > 0, go: { view: 'planner' }, help: 'goals' },
    { id: 'budget', label: 'Đặt ngân sách giờ mỗi tuần cho mục tiêu hạng 1', done: !!(top && Number(top.timeBudgetMinPerWeek) > 0), go: { view: 'planner' }, help: 'goals' },
    { id: 'template', label: 'Tạo lịch khung (tuần mẫu)', done: (state.blockTemplates || []).some(t => !t.deletedAt), go: { view: 'schedule', tab: 'templates' }, help: 'smart-setup' },
    { id: 'sleep', label: 'Chỉnh giờ ngủ từng đêm', done: !!state.settings.sleepRulesSetAt || JSON.stringify(state.settings.sleepRules || []) !== def, go: { view: 'schedule', tab: 'sleep' }, help: 'smart-setup' },
    { id: 'week', label: 'Sinh block cho tuần này', done: blocksOfWeek(wk).some(b => b.source === 'template'), go: { view: 'schedule', tab: 'week' }, help: 'smart-setup' },
    { id: 'disruption', label: 'Thử thêm một việc phát sinh và duyệt phương án', done: (state.disruptions || []).some(d => d.resolution), go: { view: 'schedule', tab: 'week', action: 'disruption' }, help: 'smart-disruption' },
    { id: 'checkin', label: 'Check-in sau một block', done: (state.checkins || []).length > 0, go: { action: 'checkin' }, help: 'smart-checkin' },
  ];
}
function guidePrefs(){ return Object.assign({ tourSeen: {}, checklistHidden: false }, state.profile.guide || {}); }
function saveGuidePrefs(patch){ updateProfile({ guide: Object.assign(guidePrefs(), patch) }); }
/* force = true: luôn hiện (dùng ở trang Hướng dẫn) */
function smartChecklistCard(force){
  const items = smartChecklist();
  const done = items.filter(x => x.done).length;
  const box = el('div');
  if (!force && (guidePrefs().checklistHidden || done === items.length)) return box;
  const c = el('div', 'card guide-check'); c.id = 'smartChecklist';
  c.innerHTML = `<div class="sch-head" style="margin-bottom:6px;"><h3 style="margin:0;">🧭 Bắt đầu nhanh với Lịch thông minh</h3><span class="tag">${done}/${items.length} bước</span></div>
    <div class="stack-track" style="margin-bottom:10px;"><div class="stack-done" style="width:${done / items.length * 100}%"></div></div>`;
  items.forEach((it, i) => {
    const row = el('div', 'guide-item' + (it.done ? ' done' : '')); row.dataset.step = it.id;
    row.innerHTML = `<span class="guide-dot">${it.done ? '✓' : i + 1}</span><span class="guide-lbl">${esc(it.label)}</span>`;
    if (!it.done) {
      const go = el('button', 'btn btn-primary btn-sm', 'Làm ngay'); go.onclick = () => guideTry(it.go);
      const h = el('button', 'btn btn-ghost btn-sm', 'Cách làm'); h.onclick = () => openGuide(it.help);
      row.append(go, h);
    }
    c.appendChild(row);
  });
  const foot = el('div', 'sch-actions'); foot.style.marginTop = '10px';
  const tour = el('button', 'btn btn-ghost btn-sm', '▶ Xem tour 1 phút'); tour.onclick = () => startTour('smart');
  foot.appendChild(tour);
  if (!force) { const hide = el('button', 'btn btn-ghost btn-sm', 'Ẩn danh sách này'); hide.onclick = () => { saveGuidePrefs({ checklistHidden: true }); softRefresh(); }; foot.appendChild(hide); }
  c.appendChild(foot);
  box.appendChild(c);
  return box;
}
/* Lời mời xem tour, hiện một lần cho mỗi phiên bản hướng dẫn */
function guideInviteBanner(){
  const box = el('div');
  if (!state.dataLoaded || (guidePrefs().tourSeen || {}).smart >= GUIDE_VERSION) return box;
  const b = el('div', 'banner'); b.id = 'tourInvite';
  b.innerHTML = '🗓️ <strong>Mới: Lịch thông minh xử lý phát sinh.</strong> Xem tour 1 phút để biết cách dùng? ';
  const go = el('button', 'btn btn-primary btn-sm', 'Xem tour'); go.onclick = () => startTour('smart');
  const later = el('button', 'btn btn-ghost btn-sm', 'Để sau'); later.style.marginLeft = '6px';
  later.onclick = () => { markTourSeen('smart'); softRefresh(); };
  const doc = el('button', 'btn btn-ghost btn-sm', 'Đọc hướng dẫn'); doc.style.marginLeft = '6px'; doc.onclick = () => { markTourSeen('smart'); openGuide('smart-concepts'); };
  b.append(go, later, doc); box.appendChild(b);
  return box;
}
function markTourSeen(id){ const p = guidePrefs(); const seen = Object.assign({}, p.tourSeen, { [id]: GUIDE_VERSION }); saveGuidePrefs({ tourSeen: seen }); }

/* ---------- Tour tương tác ----------
   Mỗi bước: go (mở màn hình nào), target (hàm tìm phần tử cần làm nổi), title, body.
   Không tìm thấy phần tử thì thẻ giải thích hiện giữa màn hình, tour vẫn chạy tiếp được. */
const navBtn = label => () => $$('.navbtn').find(b => b.textContent.trim().endsWith(label));
const TOURS = {
  smart: [
    { go: { view: 'schedule', tab: 'week' }, target: navBtn('Lịch thông minh'), title: 'Lịch thông minh',
      body: 'Nơi lịch biết mỗi block phục vụ mục tiêu nào, có được dời hay không, và tự đề xuất cách xếp lại khi có việc phát sinh. Bạn luôn là người duyệt.' },
    { target: navBtn('Lộ trình mục tiêu'), title: 'Bước 1: xếp hạng mục tiêu',
      body: 'Trong Lộ trình mục tiêu, bấm Sửa từng mục tiêu để đặt Hạng ưu tiên (1 cao nhất) và Ngân sách giờ mỗi tuần. Ưu tiên của mọi block lấy từ hạng này.' },
    { go: { view: 'schedule', tab: 'templates' }, target: () => $('[data-tab="templates"]'), title: 'Bước 2: lịch khung',
      body: 'Lịch khung là tuần mẫu. Mỗi dòng là một khung giờ với loại block (cố định, bảo vệ, linh hoạt, đệm), mục tiêu và năng lượng.' },
    { target: () => $('#loadSeed') || $('#addTemplate'), title: 'Thêm block mẫu',
      body: 'Bấm để thêm từng khung giờ. Lần đầu có thể bấm "Nạp lịch khung mẫu" để có sẵn một tuần ví dụ rồi sửa lại cho đúng lịch của bạn.' },
    { go: { view: 'schedule', tab: 'sleep' }, target: () => $('#sl-save') && $('#sl-save').closest('.card'), title: 'Bước 3: giờ ngủ',
      body: 'Điền giờ ngủ cho từng đêm. Đây là luật cứng: engine không bao giờ xếp việc vào giờ ngủ. Bên dưới có công tắc đồng bộ Google Calendar.' },
    { go: { view: 'schedule', tab: 'week' }, target: () => $('#genWeek'), title: 'Bước 4: sinh block tuần',
      body: 'Bấm một lần để tạo block thật cho tuần này từ lịch khung. Sau đó mỗi Chủ nhật app tự sinh tuần tới. Block cũng hiện trên Google Calendar với màu theo loại.' },
    { target: () => $('#quickAdd'), title: 'Dán lịch nhanh',
      body: 'Có sẵn lịch trong ghi chú? Dán vào đây theo dạng "16h-18h30: Học giải tích", mỗi dòng một việc, có thể thêm dòng "Thứ 2", "T3"... App đọc và cho xem trước rồi mới thêm.' },
    { target: () => $('.week-grid') || $('#views .empty'), title: 'Lịch tuần',
      body: 'Mỗi cột là một ngày. Viền màu cho biết loại block: xám cố định, đỏ bảo vệ, xanh linh hoạt, vàng sọc là đệm. Trên mỗi block có nút Check-in, Gán việc, Sửa, Xoá. Nút 🗑 cạnh tên ngày xoá cả ngày, có Hoàn tác.' },
    { target: () => $('#addDisruption'), title: 'Bước 5: việc phát sinh',
      body: 'Có việc đột xuất thì bấm đây: nhập thời lượng, ưu tiên, giờ cố định hoặc khung linh hoạt. App đưa phương án: việc mới nằm đâu, block nào bị dời, block nào bị mất, ngân sách trước và sau. Bạn bấm Duyệt, Sửa hoặc Bỏ.' },
    { target: () => $('#smartChecklist') || $('#openCheckin'), title: 'Bước 6: check-in',
      body: 'Sau mỗi block, app hỏi Xong, Một phần hay Bỏ (kèm lý do). Mỗi lần mở app sẽ hiện các block chờ check-in. Block bị Bỏ hoặc làm dở được đề xuất xếp bù trong tuần, việc bên trong đi theo block bù.' },
    { go: { view: 'budget' }, target: navBtn('Ngân sách tuần'), title: 'Ngân sách tuần',
      body: 'Giờ đã làm thật so với kế hoạch của từng mục tiêu, xếp theo hạng. Mục tiêu hạng 1 sắp hụt quá 10% thì app cảnh báo.' },
    { target: () => $('#aiFab'), title: 'Trợ lý AI',
      body: 'Không chắc phải làm gì? Bấm đây và hỏi bằng lời bình thường, ví dụ "tối nay 18h có họp, xếp giúp mình" hay "block sáng nay mình lỡ thì sao". Trợ lý xem lịch của bạn và chuẩn bị phương án, bạn bấm duyệt.' },
    { target: navBtn('Hướng dẫn sử dụng'), title: 'Xong rồi!',
      body: 'Hướng dẫn chi tiết từng bước luôn nằm ở mục "Hướng dẫn sử dụng". Ở đầu Lịch thông minh có danh sách "Bắt đầu nhanh" tự đánh dấu khi bạn làm xong từng bước.' },
  ],
  app: [
    { go: { view: 'home' }, target: navBtn('Trang chủ'), title: 'Trang chủ', body: 'Tổng quan hôm nay: việc đang làm, đến hạn, quá hạn, sinh nhật sắp tới, mục tiêu đang theo đuổi và các thông báo cần xử lý.' },
    { target: navBtn('Lộ trình mục tiêu'), title: 'Lộ trình mục tiêu', body: 'Chia mục tiêu lớn thành giai đoạn, có kỳ vọng, chỉ tiêu tuần và nhật ký mỗi ngày. Cuối giai đoạn đối chiếu thực tế để điều chỉnh. Đặt hạng và ngân sách giờ ở đây.' },
    { target: navBtn('Ma trận ưu tiên'), title: 'Ma trận ưu tiên', body: 'Bốn ô Eisenhower. Kéo thả thẻ việc sang ô khác để đổi mức ưu tiên.' },
    { target: navBtn('Lịch'), title: 'Lịch tháng', body: 'Xem việc và ngày đặc biệt theo tháng. Bấm vào một ngày để thêm việc cho ngày đó.' },
    { target: navBtn('Lịch thông minh'), title: 'Lịch thông minh', body: 'Lịch khung, block theo tuần, xử lý việc phát sinh và check-in. Có tour riêng 1 phút.' },
    { target: navBtn('Ngân sách tuần'), title: 'Ngân sách tuần', body: 'Giờ đã làm thật so với kế hoạch của từng mục tiêu.' },
    { target: navBtn('Danh sách việc'), title: 'Danh sách việc', body: 'Mọi việc trong một bảng: tìm theo tên, lọc theo trạng thái và ưu tiên, sửa, xoá.' },
    { target: navBtn('Ngày đặc biệt'), title: 'Ngày đặc biệt', body: 'Sinh nhật, kỷ niệm. App tạo nhắc hẹn lặp hằng năm trên Google Calendar.' },
    { target: navBtn('Ghi chú vặt'), title: 'Ghi chú vặt', body: 'Những điều nhỏ cần nhớ, có danh mục và ghim.' },
    { target: navBtn('Thống kê'), title: 'Thống kê', body: 'Tỷ lệ hoàn thành chung, theo mức ưu tiên và 7 ngày gần đây.' },
    { target: navBtn('Cài đặt'), title: 'Cài đặt', body: 'Hồ sơ, quyền thông báo trình duyệt, chế độ tối.' },
    { target: () => $('#connStatus'), title: 'Trạng thái lưu', body: '"đã lưu vào Drive" nghĩa là mọi thay đổi đã nằm an toàn trong Google Drive của bạn.' },
    { target: () => $('#aiFab'), title: 'Trợ lý AI', body: 'Hỏi bất cứ điều gì về cách dùng app hoặc nhờ xử lý tình huống. Trợ lý chỉ chuẩn bị phương án, bạn tự bấm duyệt.' },
    { target: navBtn('Hướng dẫn sử dụng'), title: 'Hướng dẫn sử dụng', body: 'Quay lại đây bất cứ lúc nào để đọc hướng dẫn chi tiết từng bước hoặc xem lại tour.' },
  ],
};

let tourState = null;
function startTour(id){
  const steps = TOURS[id]; if (!steps) return;
  if ($('#modalBg').classList.contains('show')) closeModal();
  endTour(true);
  tourState = { id, steps, i: 0 };
  const block = el('div', 'tour-block'); block.id = 'tourBlock';
  const hole = el('div', 'tour-hole'); hole.id = 'tourHole';
  const card = el('div', 'tour-card'); card.id = 'tourCard';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-live', 'polite');
  document.body.append(block, hole, card);
  window.addEventListener('resize', placeTour);
  document.addEventListener('keydown', tourKeys, true);
  showTourStep();
}
function tourKeys(e){
  if (!tourState) return;
  if (e.key === 'Escape') { e.stopPropagation(); endTour(); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); tourNext(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); tourPrev(); }
}
function showTourStep(){
  const st = tourState; if (!st) return;
  const step = st.steps[st.i];
  let wait = 0;
  if (step.go) {
    const g = step.go; let changed = false;
    if (g.tab && state.schedule.tab !== g.tab) { state.schedule.tab = g.tab; changed = true; }
    if (g.view && state.view !== g.view) { if (g.view === 'planner') state.planner = { level: 'list', goalId: null, phaseId: null }; state.view = g.view; changed = true; }
    if (changed) { renderAll(); wait = 380; }
  }
  const card = $('#tourCard');
  const n = st.steps.length;
  card.innerHTML = `<div class="tour-count">${st.i + 1} / ${n}</div><h3>${esc(step.title)}</h3><p>${esc(step.body)}</p>
    <div class="tour-btns"><button class="btn btn-ghost btn-sm" id="tourSkip">Bỏ qua</button>
    <span style="flex:1"></span>${st.i > 0 ? '<button class="btn btn-ghost btn-sm" id="tourPrev">‹ Trước</button>' : ''}
    <button class="btn btn-primary btn-sm" id="tourNext">${st.i === n - 1 ? 'Hoàn thành ✓' : 'Tiếp ›'}</button></div>`;
  $('#tourSkip').onclick = () => endTour();
  if ($('#tourPrev')) $('#tourPrev').onclick = tourPrev;
  $('#tourNext').onclick = tourNext;
  card.style.visibility = 'hidden';
  setTimeout(() => {
    if (!tourState) return;
    const t = step.target ? step.target() : null;
    st.el = t || null;
    if (t) t.scrollIntoView({ block: 'center', inline: 'center' });
    setTimeout(() => { placeTour(); card.style.visibility = ''; $('#tourNext') && $('#tourNext').focus(); }, t ? 120 : 0);
  }, wait);
}
function placeTour(){
  if (!tourState) return;
  const hole = $('#tourHole'), card = $('#tourCard'), t = tourState.el;
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
  if (t && t.getClientRects().length) {
    const r = t.getBoundingClientRect();
    Object.assign(hole.style, { display: 'block', left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
    hole.classList.remove('center');
    if (vw <= 600) { Object.assign(card.style, { left: '12px', right: '12px', top: '', bottom: '12px', transform: '' }); return; }
    const cw = Math.min(360, vw - 24), ch = card.offsetHeight || 180;
    let left = Math.min(Math.max(12, r.left), vw - cw - 12);
    let top = r.bottom + 14;
    if (top + ch > vh - 12) top = r.top - ch - 14;
    if (top < 12) { top = Math.min(vh - ch - 12, Math.max(12, r.top)); left = r.right + 14 + cw < vw ? r.right + 14 : Math.max(12, r.left - cw - 14); }
    Object.assign(card.style, { left: left + 'px', top: top + 'px', right: '', bottom: '', width: cw + 'px', transform: '' });
  } else {
    hole.style.display = 'block'; hole.classList.add('center');
    Object.assign(hole.style, { left: '50%', top: '50%', width: '0px', height: '0px' });
    Object.assign(card.style, { left: '50%', top: '50%', right: '', bottom: '', width: Math.min(360, vw - 24) + 'px', transform: 'translate(-50%,-50%)' });
  }
}
function tourNext(){ if (!tourState) return; if (tourState.i >= tourState.steps.length - 1) return endTour(); tourState.i++; showTourStep(); }
function tourPrev(){ if (!tourState || tourState.i === 0) return; tourState.i--; showTourStep(); }
function endTour(silent){
  const had = !!tourState, id = tourState && tourState.id;
  ['#tourBlock', '#tourHole', '#tourCard'].forEach(s => { const x = document.querySelector(s); if (x) x.remove(); });
  window.removeEventListener('resize', placeTour);
  document.removeEventListener('keydown', tourKeys, true);
  tourState = null;
  if (had && !silent) { markTourSeen(id); softRefresh(); }
}

/* Netlify Function của trợ lý AI dùng chung nội dung hướng dẫn này (một nguồn duy nhất). */
if (typeof module === 'object' && module.exports) module.exports = { GUIDE_VERSION, GUIDE_SECTIONS };
