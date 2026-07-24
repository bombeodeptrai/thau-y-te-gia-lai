# Cấu hình phân tích AI – Chuyên viên đấu thầu Kiểu Việt

Website đã có hai chế độ phân tích:

1. **Phân tích nền trong GitHub Actions**: tạo kết quả AI cho các gói đang mở/sắp đóng/đang xét thầu; khi rê chuột sẽ hiện tóm tắt và nút **Phân tích AI** mở báo cáo đầy đủ.
2. **Phân tích trực tiếp bằng Google Apps Script**: tùy chọn; cho phép nút **Phân tích lại bằng AI** gọi OpenAI ngay tại thời điểm người dùng bấm.

## 1. Bật phân tích nền bằng GitHub Actions

Vào repository:

`Settings → Secrets and variables → Actions → New repository secret`

Tạo secret:

- **Name:** `OPENAI_API_KEY`
- **Secret:** khóa API của OpenAI

Tùy chọn tạo thêm Repository variables hoặc sửa workflow:

- `OPENAI_MODEL`: mặc định `gpt-5-mini`
- `AI_MAX_PER_RUN`: mặc định 12 gói/lượt
- `AI_ANALYSIS_TTL_HOURS`: mặc định 24 giờ

Không đưa API key vào `app.js`, `ai-config.js`, HTML hoặc bất kỳ tệp nào trong repository.

Sau khi thêm secret, vào **Actions → Run workflow**. Trong log sẽ xuất hiện dạng:

```text
Gọi OpenAI phân tích 10 gói bằng model gpt-5-mini.
AI IBxxxxxxxxxx: 72/100 · Tham gia có điều kiện
Đã lưu 10 phân tích AI vào data/ai-analyses.json.
```

## 2. Bật nút phân tích trực tiếp qua Google Apps Script

Mở dự án Apps Script **Đồng bộ Thầu Y tế Gia Lai**.

### Bước 1 – thêm mã

Tạo tệp mới tên `AiAnalysis.gs`, sao chép toàn bộ nội dung từ:

`google-apps-script/AiAnalysis.gs`

### Bước 2 – lưu API key trong Script Properties

Vào:

`Cài đặt dự án → Thuộc tính của tập lệnh → Chỉnh sửa thuộc tính`

Thêm:

- `OPENAI_API_KEY` = khóa API OpenAI
- `OPENAI_MODEL` = `gpt-5-mini`
- `AI_MAX_REQUESTS_PER_HOUR` = `30`

### Bước 3 – kiểm tra

Trong danh sách hàm, chọn:

`testAiAnalysisConnection`

Bấm **Chạy** và cấp quyền. Nhật ký phải trả về JSON có `overall_score`, `recommendation` và `success_probability`.

### Bước 4 – triển khai Web App

Vào:

`Triển khai → Lần triển khai mới → Ứng dụng web`

Thiết lập:

- **Thực thi dưới dạng:** Tôi
- **Ai có quyền truy cập:** Bất kỳ ai

Triển khai và sao chép URL kết thúc bằng `/exec`.

### Bước 5 – nối website

Mở `ai-config.js`, dán URL vào:

```javascript
liveEndpoint: "https://script.google.com/macros/s/DEPLOYMENT_ID/exec",
```

Commit lên `main`. Sau khi GitHub Pages triển khai, nút **Phân tích lại bằng AI** sẽ xuất hiện trong cửa sổ phân tích.

## Phạm vi đánh giá

AI sử dụng hồ sơ năng lực chuẩn hóa tại `data/kieu-viet-capability.json`, gồm kinh nghiệm công trình y tế, tư vấn giám sát lắp đặt thiết bị, lợi thế địa bàn và các khoảng trống chưa xác minh.

Kết quả luôn phải được đối chiếu với E-HSMT, tiêu chí đánh giá, giấy ủy quyền hãng, hợp đồng tương tự, năng lực tài chính, tiến độ giao hàng và hồ sơ pháp lý chính thức.
