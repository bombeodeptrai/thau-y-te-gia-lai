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
