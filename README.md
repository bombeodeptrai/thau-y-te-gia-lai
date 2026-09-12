# Thầu Y tế Gia Lai

Trang tổng hợp dữ liệu đấu thầu công khai về thiết bị y tế, vật tư tiêu hao và hóa chất xét nghiệm tại Gia Lai.

Website: <https://bombeodeptrai.github.io/thau-y-te-gia-lai/>

## Dữ liệu

- Nguồn: API tìm kiếm công khai của Hệ thống mạng đấu thầu quốc gia.
- Phạm vi lưu trữ: các gói thiết bị/vật tư y tế thuộc Gia Lai hiện nay (gồm địa bàn Gia Lai và Bình Định cũ) trong 1.095 ngày, tức 3 năm gần nhất.
- Lần đầu hệ thống quét bù đủ 3 năm theo mã tỉnh và theo giao giữa địa danh với từ khóa y tế. Nhánh thứ hai khôi phục hồ sơ cũ không còn trường mã tỉnh trong API. Các lần chạy sau quét lại 14 ngày mới nhất, ghép với dữ liệu cũ và tự xóa bản ghi quá 3 năm.
- Bộ lọc yêu cầu tiêu đề gói thầu phải nêu rõ thiết bị/vật tư y tế, vật tư tiêu hao, hóa chất xét nghiệm hoặc tên một mặt hàng chuyên môn. Tên bệnh viện/trung tâm y tế không còn là điều kiện đủ.
- Loại khỏi danh sách chính các gói thuốc, vắc xin, xây dựng, CNTT, xe, bàn ghế/nội thất hành chính, đồng phục, xử lý rác và vật tư nông nghiệp. Dịch vụ sửa chữa, bảo trì, kiểm định hoặc hiệu chuẩn chỉ được nhận khi tiêu đề nêu rõ thiết bị y tế và bên mua là cơ sở y tế. Giường bệnh, túi máu và thiết bị y tế chuyên dụng vẫn thuộc phạm vi.
- Trạng thái lấy từ mã chính thức của nguồn để phân biệt `Đang xét thầu`, `Đã đóng – chưa có kết quả`, `Đã có kết quả` và `Đã hủy/không lựa chọn`; không chỉ suy đoán từ hạn đóng thầu.
- Sau mở thầu, hệ thống lấy tên các nhà thầu tham dự và giá dự thầu từ biên bản mở thầu công khai.
- Với gói mới/đang mời thầu, hệ thống lấy danh sách phần/lô, tên thiết bị/vật tư và giá kế hoạch từ dữ liệu KHLCNT công khai; danh mục này cũng được đưa vào chỉ mục tìm kiếm.
- Với gói chào giá trực tuyến có biểu mẫu công khai, hệ thống trích trực tiếp danh mục hàng hóa và toàn bộ trường mã/ký hiệu, nhãn hiệu, hãng, xuất xứ, số lượng, thông số kỹ thuật; giao diện cho tải CSV UTF-8 để mở bằng Excel.
- Với gói đấu thầu thông thường mà cổng nguồn yêu cầu reCAPTCHA, hệ thống liên kết về trang chính thức để người dùng xác nhận. Hệ thống không tự giải hoặc vượt CAPTCHA và không suy đoán thông số kỹ thuật.
- Khi có kết quả, hệ thống phân biệt nhà thầu trúng/không trúng, giá, lý do không trúng; đồng thời lấy danh mục hàng hóa trúng thầu, model, hãng, xuất xứ, đơn giá và cấu hình kỹ thuật nếu nguồn chính thức đã công bố.
- Nguồn công khai hiện không trả model của hồ sơ không trúng. Giao diện ghi rõ `Nguồn công khai chưa công bố` thay vì suy đoán.
- Danh sách được phân trang; dữ liệu hàng hóa trúng thầu cũng được lấy hết các trang thay vì chỉ 20 mặt hàng đầu.
- Không vượt CAPTCHA, không dùng tài khoản và không truy cập dữ liệu hạn chế.

GitHub Actions quét nhanh Gia Lai mỗi 10 phút, kiểm tra chéo định kỳ và triển khai lại GitHub Pages khi dữ liệu thay đổi. Dữ liệu chi tiết được lưu thành JSON riêng cho từng tỉnh tại `data/regions/<tỉnh-thành>/`; không tạo lại các tệp tổng hợp `bidders.json`, `equipment.json` và `requirements.json` cỡ lớn. Trang này không phải website chính thức của cơ quan quản lý đấu thầu.

## Google Sheets và Gmail

Thư mục [`google-apps-script`](./google-apps-script) chứa mã cài đặt cho một Google Sheet tự đồng bộ và gửi Gmail khi phát hiện mã TBMT mới. Bản Gia Lai tải trực tiếp ba tệp vùng nhỏ `tenders.json`, `bidders.json` và `equipment.json`, tránh giới hạn phản hồi khi tải các tệp tổng hợp toàn miền.

## Chạy thử tại máy

```bash
node --test scripts/technical-requirements.test.mjs
node --test scripts/medical-scope.test.mjs scripts/official-source.test.mjs scripts/regional-data.test.mjs
node scripts/fetch-data.mjs
node scripts/build-site.mjs
python3 -m http.server 4175 --directory dist-pages
```
