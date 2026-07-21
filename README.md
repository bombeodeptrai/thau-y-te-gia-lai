# Thầu Y tế Gia Lai

Trang tổng hợp dữ liệu đấu thầu công khai về thiết bị, vật tư, hóa chất và dịch vụ y tế tại Gia Lai.

Website: <https://bombeodeptrai.github.io/thau-y-te-gia-lai/>

## Dữ liệu

- Nguồn: API tìm kiếm công khai của Hệ thống mạng đấu thầu quốc gia.
- Phạm vi: mã tỉnh Gia Lai `52`, trong 90 ngày gần nhất.
- Có thể hiển thị kết quả lựa chọn nhà thầu, đơn vị trúng, giá trúng, danh mục hàng hóa, model, hãng, xuất xứ, đơn giá và cấu hình kỹ thuật nếu nguồn chính thức đã công bố.
- Không vượt CAPTCHA, không dùng tài khoản và không truy cập dữ liệu hạn chế.

GitHub Actions cập nhật dữ liệu mỗi giờ và triển khai lại GitHub Pages. Trang này không phải website chính thức của cơ quan quản lý đấu thầu.

## Chạy thử tại máy

```bash
node scripts/fetch-data.mjs
node scripts/build-pages.mjs
python3 -m http.server 4175 --directory dist-pages
```
