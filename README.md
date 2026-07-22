# Thầu Y tế Gia Lai

Trang tổng hợp dữ liệu đấu thầu công khai về thiết bị y tế, vật tư tiêu hao và hóa chất xét nghiệm tại Gia Lai.

Website: <https://bombeodeptrai.github.io/thau-y-te-gia-lai/>

## Dữ liệu

- Nguồn: API tìm kiếm công khai của Hệ thống mạng đấu thầu quốc gia.
- Phạm vi lưu trữ: toàn bộ gói thuộc mã tỉnh Gia Lai `52` trong 365 ngày gần nhất.
- Lần đầu hệ thống quét bù đủ 365 ngày theo các cửa sổ 7 ngày. Các lần chạy sau chỉ quét lại 14 ngày mới nhất, ghép với dữ liệu cũ và tự xóa bản ghi quá 365 ngày.
- Bộ lọc yêu cầu tiêu đề gói thầu phải nêu rõ thiết bị/vật tư y tế, vật tư tiêu hao, hóa chất xét nghiệm hoặc tên một mặt hàng chuyên môn. Tên bệnh viện/trung tâm y tế không còn là điều kiện đủ.
- Loại khỏi danh sách chính các gói thuốc, vắc xin, xây dựng, CNTT, xe, bàn ghế, đồng phục, xử lý rác, dịch vụ sửa chữa/bảo trì và vật tư nông nghiệp.
- Trạng thái lấy từ mã chính thức của nguồn để phân biệt `Đang xét thầu`, `Đã đóng – chưa có kết quả`, `Đã có kết quả` và `Đã hủy/không lựa chọn`; không chỉ suy đoán từ hạn đóng thầu.
- Sau mở thầu, hệ thống lấy tên các nhà thầu tham dự và giá dự thầu từ biên bản mở thầu công khai.
- Khi có kết quả, hệ thống phân biệt nhà thầu trúng/không trúng, giá, lý do không trúng; đồng thời lấy danh mục hàng hóa trúng thầu, model, hãng, xuất xứ, đơn giá và cấu hình kỹ thuật nếu nguồn chính thức đã công bố.
- Nguồn công khai hiện không trả model của hồ sơ không trúng. Giao diện ghi rõ `Nguồn công khai chưa công bố` thay vì suy đoán.
- Danh sách được phân trang; dữ liệu hàng hóa trúng thầu cũng được lấy hết các trang thay vì chỉ 20 mặt hàng đầu.
- Không vượt CAPTCHA, không dùng tài khoản và không truy cập dữ liệu hạn chế.

GitHub Actions cập nhật dữ liệu mỗi giờ và triển khai lại GitHub Pages. Dữ liệu được lưu dưới dạng JSON tĩnh, không sử dụng máy chủ cơ sở dữ liệu. Trang này không phải website chính thức của cơ quan quản lý đấu thầu.

## Google Sheets và Gmail

Thư mục [`google-apps-script`](./google-apps-script) chứa mã cài đặt cho một Google Sheet tự đồng bộ mỗi giờ và gửi Gmail khi phát hiện mã TBMT mới. Script tạo ba trang: `Gói thầu`, `Nhà thầu` và `Danh mục thiết bị`.

## Chạy thử tại máy

```bash
node scripts/fetch-data.mjs
node scripts/build-pages.mjs
python3 -m http.server 4175 --directory dist-pages
```
