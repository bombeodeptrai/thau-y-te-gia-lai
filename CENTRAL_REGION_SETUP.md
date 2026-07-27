# Hệ thống Thầu Y tế Miền Trung

## Phạm vi dữ liệu

Hệ thống tách dữ liệu theo 11 tỉnh/thành hiện hành tại miền Trung và Tây Nguyên, đồng thời sử dụng mã dữ liệu của các tỉnh cũ để không bỏ sót hồ sơ trước khi thay đổi địa giới:

- Thanh Hóa
- Nghệ An
- Hà Tĩnh
- Quảng Trị
- Thành phố Huế
- Thành phố Đà Nẵng
- Quảng Ngãi
- Gia Lai
- Đắk Lắk
- Khánh Hòa
- Lâm Đồng

Cấu hình nằm tại `data/regions.json`.

## Quy trình tự động

### Khởi tạo và quét sâu

Workflow `Khởi tạo và quét sâu dữ liệu miền Trung`:

- Quét tối đa 3 năm theo từng tỉnh/thành.
- Chạy song song có giới hạn để tránh quá tải nguồn công khai.
- Lưu dữ liệu riêng tại `data/regions/<tỉnh-thành>/`.
- Hợp nhất thành bộ dữ liệu chung cho website.
- Ghi tiến độ và trạng thái của từng tỉnh.
- Tự triển khai GitHub Pages sau khi hoàn tất.

Workflow chạy khi commit có nhãn `[central-full-scan]`, khi bấm Run workflow, và định kỳ mỗi tuần.

### Cập nhật nhanh

Workflow `Cập nhật nhanh dữ liệu miền Trung` chạy mỗi 30 phút:

- Chỉ quét dữ liệu mới trong 3 ngày gần nhất.
- Giữ nguyên lịch sử 3 năm đã có.
- Làm mới một số hồ sơ chi tiết ưu tiên.
- Hợp nhất và triển khai website.

### Triển khai giao diện

Workflow `Triển khai giao diện GitHub Pages` chỉ dựng website khi sửa mã nguồn, không chạy lại toàn bộ quá trình quét dữ liệu.

## Google Sheets

Mở dự án Apps Script đang liên kết với Google Sheets, tạo tệp mới tên `RegionalSheets.gs`, rồi sao chép nội dung từ:

`google-apps-script/RegionalSheets.gs`

Chạy một lần hàm:

`setupMienTrungSheets`

Hệ thống sẽ tạo:

- `Miền Trung - Tổng hợp`
- Một trang tính riêng `MT - <Tên tỉnh>` cho từng tỉnh/thành
- `Miền Trung - Nhà thầu`
- `Miền Trung - Thiết bị`

Sau đó Apps Script tự cập nhật mỗi giờ.

## Tìm kiếm trên website

Người dùng có thể:

- Chọn một tỉnh/thành hoặc toàn miền Trung.
- Tìm theo tên gói, mã TBMT, thiết bị, model, nhãn hiệu và hãng.
- Lọc theo nhóm dữ liệu và thời gian.
- Lọc theo khoảng giá trị gói thầu.
- Tìm theo tên chủ đầu tư.
- Sắp xếp theo ngày đăng, hạn đóng, giá trị hoặc số nhà thầu.
- Lưu lựa chọn tìm kiếm trên trình duyệt và chia sẻ bằng URL.
