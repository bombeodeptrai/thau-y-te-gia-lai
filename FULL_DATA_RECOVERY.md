# Khôi phục và bổ sung toàn bộ dữ liệu

Hệ thống thực hiện theo ba lớp để không làm mất dữ liệu lần nữa:

1. **Dữ liệu dự phòng Gia Lai:** giữ 153 gói đang có cho đến khi dữ liệu vùng mới đã được xác thực.
2. **Quét nền 3 năm:** quét 11 tỉnh/thành theo mã tỉnh cũ và mới; chỉ ghi nhận tỉnh có ít nhất một gói và đủ phạm vi 1.095 ngày.
3. **Bổ sung chi tiết định kỳ:** mỗi hai giờ ưu tiên tối đa 40 gói chưa có hồ sơ để lấy nhà thầu tham dự, đơn vị trúng, thiết bị, hóa chất, model, hãng, giá và yêu cầu kỹ thuật.

Mọi workflow chỉ đóng gói tỉnh quét thành công. Tỉnh lỗi hoặc nguồn công khai trả rỗng sẽ giữ nguyên bản dữ liệu gần nhất.
