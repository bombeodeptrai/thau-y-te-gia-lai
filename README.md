# Thầu Y tế Gia Lai

Trang tổng hợp dữ liệu đấu thầu công khai về thiết bị y tế, vật tư tiêu hao và hóa chất xét nghiệm tại Gia Lai.

Website: <https://bombeodeptrai.github.io/thau-y-te-gia-lai/>

## Dữ liệu

- Nguồn: API tìm kiếm công khai của Hệ thống mạng đấu thầu quốc gia.
- Phạm vi: toàn bộ gói thuộc mã tỉnh Gia Lai `52` trong 90 ngày gần nhất, được chia thành các cửa sổ 7 ngày và quét hết mọi trang API trước khi lọc y tế.
- Bộ lọc yêu cầu tiêu đề gói thầu phải nêu rõ thiết bị/vật tư y tế, vật tư tiêu hao, hóa chất xét nghiệm hoặc tên một mặt hàng chuyên môn. Tên bệnh viện/trung tâm y tế không còn là điều kiện đủ.
- Loại khỏi danh sách chính các gói thuốc, vắc xin, xây dựng, CNTT, xe, bàn ghế, đồng phục, xử lý rác, dịch vụ sửa chữa/bảo trì và vật tư nông nghiệp.
- Có thể hiển thị kết quả lựa chọn nhà thầu, đơn vị trúng, giá trúng, danh mục hàng hóa, model, hãng, xuất xứ, đơn giá và cấu hình kỹ thuật nếu nguồn chính thức đã công bố.
- Danh sách được phân trang; dữ liệu hàng hóa trúng thầu cũng được lấy hết các trang thay vì chỉ 20 mặt hàng đầu.
- Không vượt CAPTCHA, không dùng tài khoản và không truy cập dữ liệu hạn chế.

GitHub Actions cập nhật dữ liệu mỗi giờ và triển khai lại GitHub Pages. Trang này không phải website chính thức của cơ quan quản lý đấu thầu.

## Chạy thử tại máy

```bash
node scripts/fetch-data.mjs
node scripts/build-pages.mjs
python3 -m http.server 4175 --directory dist-pages
```
