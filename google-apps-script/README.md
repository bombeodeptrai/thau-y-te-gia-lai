# Đồng bộ Google Sheets và thông báo Gmail

## Cài đặt một lần

1. Tạo một Google Sheet trống.
2. Mở **Tiện ích mở rộng → Apps Script**.
3. Xóa mã mẫu trong `Code.gs`, sao chép toàn bộ nội dung tệp `Code.gs` trong thư mục này và dán vào.
4. Bấm **Lưu**, chọn hàm `setupAutomation`, rồi bấm **Chạy**.
5. Chấp nhận quyền truy cập Google Sheets, kết nối internet và gửi email.
6. Quay lại Google Sheet. Hai trang `Gói thầu` và `Cấu hình` sẽ được tạo tự động.

Hệ thống không gửi 241 gói hiện có trong lần khởi tạo. Từ lần chạy kế tiếp, chỉ các mã TBMT mới xuất hiện mới được gửi qua email.

## Cấu hình

- Email nhận thông báo: sheet `Cấu hình`, ô `B2`.
- Bật/tắt thông báo: sheet `Cấu hình`, ô `B3`.
- Có thể dùng menu **Thầu Y tế Gia Lai → Cập nhật ngay** hoặc **Gửi email thử**.
- Trigger tự động chạy mỗi giờ, kể cả khi không mở Google Sheet.

## Các tab `DBMT - ...` cho toàn miền Trung

1. Trong cùng dự án Apps Script, tạo thêm tệp `RegionalSheets.gs` và sao chép
   nội dung tệp cùng tên trong repository.
2. Chạy `setupMienTrungSheets` một lần và chấp nhận quyền truy cập.
3. Gia Lai được cập nhật riêng mỗi giờ. Các tỉnh còn lại được xoay vòng, mỗi
   15 phút xử lý một tỉnh để tránh vượt thời gian chạy của Apps Script.
4. Khi cần cập nhật Gia Lai ngay, chạy `syncGiaLaiSheets`.

Nếu đã cài bản cũ, cần chạy lại `setupMienTrungSheets` sau khi thay mã để tạo
trigger Gia Lai. Việc cập nhật JSON trên GitHub Pages không tự sửa trigger bên
trong Google Sheet đã được cài trước đó.
